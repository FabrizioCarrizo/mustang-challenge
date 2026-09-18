import type { BudgetInfo, CostInfo } from "@genesis/protocol";
import { isAdult, type Agent } from "../agents/agent.ts";
import { clamp01 } from "../agents/needs.ts";
import { ThoughtScheduler, type ThoughtRequest } from "../cognition/scheduler.ts";
import { buildCreate, buildDailyPlan, buildDialogue, buildReaction, buildReflection, type BuildContext, type BuiltPrompt } from "../cognition/system2/builders.ts";
import { applyCreate, applyDailyPlan, applyDialogue, applyReaction, applyReflection, type IntentSink } from "../cognition/system2/intents.ts";
import { buildWorldLaws } from "../cognition/system2/prompts/laws.ts";
import { DEFAULT_ROUTE, MAX_TOKENS, SCHEMAS, type CallType } from "../cognition/system2/schemas.ts";
import type { GenesisConfig } from "../config.ts";
import { Bm25Retriever } from "../memory/retrieval.ts";
import type { WorldDb } from "../persistence/db.ts";
import type { Engine } from "../sim/engine.ts";
import { makeEvent, type WorldEvent } from "../sim/events.ts";
import type { BrainRoutes } from "./router.ts";
import { estimateTokens, priceFor, type BrainRequest, type BrainResponse } from "./provider.ts";

const REACTION_KINDS = new Set(["agent.died", "attack", "theft", "storm", "drought", "discovery", "god", "agent.born", "structure.destroyed", "crime", "war"]);

/**
 * El cerebro: conecta System 2 con el mundo. Dispara pensamientos (triggers),
 * los despacha (scheduler), integra resultados (intents) y deja registro.
 */
export class Brain {
  readonly scheduler: ThoughtScheduler;
  readonly retriever = new Bm25Retriever();
  readonly laws: string;
  private nextId = 1;
  private readonly cfg: GenesisConfig;
  private newDialoguesThisTick = 0;
  private density: number;
  /** proveedores de contexto social (fase 3) */
  groupNameOf: (agentId: number) => string | null = () => null;
  leaderNameOf: (agentId: number) => string | null = () => null;
  /** intento de invención (fase 3 lo reemplaza por el árbol tecnológico) */
  inventor: (a: Agent, recipe: { resultado: string; ingredientes: string[]; proceso: string }) => string | null;
  private readonly byType = new Map<string, { calls: number; usd: number }>();

  constructor(
    readonly engine: Engine,
    routes: BrainRoutes,
    readonly db: WorldDb | null,
    opts: { density?: number } = {},
  ) {
    this.cfg = engine.config;
    this.scheduler = new ThoughtScheduler(routes, this.cfg, () => engine.s.tick);
    this.laws = buildWorldLaws(this.cfg);
    this.density = opts.density ?? 1;
    this.scheduler.density = this.density;
    this.inventor = (a, recipe) => simpleInvention(a, recipe, engine);
    if (db) {
      const totals = db.llmTotals();
      this.scheduler.budget.usdTotal = totals.usd;
    }
  }

  get s() {
    return this.engine.s;
  }

  setDensity(d: number): void {
    this.density = Math.max(0.05, Math.min(1, d));
    this.scheduler.density = this.density;
  }

  /** Engancha el cerebro al loop del motor. */
  install(): void {
    const prev = this.engine.hooks;
    this.engine.hooks = {
      beforeWorld: (e) => {
        prev.beforeWorld?.(e);
        this.integrate();
      },
      afterActions: (e) => {
        prev.afterActions?.(e);
        this.evaluate();
      },
      afterTick: (e, out) => {
        prev.afterTick?.(e, out);
        for (const id of out.deaths) this.retriever.forget(id);
        if (out.newDay) this.scheduler.budget.newDay();
        this.scheduler.pump();
      },
    };
  }

  stop(): void {
    this.scheduler.abortAll();
  }

  budgetInfo(): BudgetInfo {
    return this.scheduler.budgetInfo();
  }

  backpressure(): boolean {
    return this.scheduler.pendingOfType("daily_plan") > this.cfg.pacing.maxPendingPlans;
  }

  costInfo(): CostInfo {
    const t = this.db?.llmTotals() ?? { calls: 0, usd: 0, inTokens: 0, cacheRead: 0, outTokens: 0 };
    const days = Math.max(1, this.s.tick / this.cfg.time.ticksPerDay);
    return {
      totalUsd: Math.round(t.usd * 10000) / 10000,
      calls: t.calls,
      inTokens: t.inTokens,
      cacheRead: t.cacheRead,
      outTokens: t.outTokens,
      cacheHitRate: t.inTokens + t.cacheRead > 0 ? Math.round((t.cacheRead / (t.inTokens + t.cacheRead)) * 1000) / 1000 : 0,
      usdPerSimDay: Math.round((t.usd / days) * 10000) / 10000,
      byType: [...this.byType.entries()].map(([callType, v]) => ({ callType, calls: v.calls, usd: Math.round(v.usd * 10000) / 10000 })),
    };
  }

  private buildContext(): BuildContext {
    return {
      s: this.s,
      spatial: this.engine.spatial,
      retriever: this.retriever,
      laws: this.laws,
      groupNameOf: this.groupNameOf,
      leaderNameOf: this.leaderNameOf,
      names: this.engine.names,
    };
  }

  private sink(): IntentSink {
    return {
      emit: (e) => this.engine.emit(e),
      learn: (a, tech, how) => this.engine.learn(a, tech, how),
      conversation: (row) => {
        if (!this.db) return 0;
        return this.db.insertConversation(row);
      },
      text: (row) => {
        const id = this.s.counters.text++;
        this.db?.insertText({ id, ...row });
        return id;
      },
      invent: (a, recipe) => this.inventor(a, recipe),
    };
  }

  // ------------------------------------------------------------ pedidos

  private makeRequest<T extends CallType>(
    type: T,
    agentId: number | null,
    priority: number,
    deadlineTick: number | null,
    key: string,
    build: () => BuiltPrompt | null,
    apply: (parsed: unknown, stale: boolean) => void,
    onDropped?: (reason: string) => void,
  ): ThoughtRequest {
    const route = DEFAULT_ROUTE[type];
    const provider = route === "epochal" ? this.scheduler.routes.epochal : this.scheduler.routes.routine;
    const price = priceFor(provider.model);
    const estUsd = (5000 * price.cacheRead + 1500 * price.input + MAX_TOKENS[type] * 0.6 * price.output) / 1_000_000;
    const id = this.nextId++;
    const brain = this;
    return {
      id,
      agentId,
      type,
      route,
      priority,
      enqueuedTick: this.s.tick,
      deadlineTick,
      estUsd,
      key,
      build: () => {
        const built = build();
        if (!built) return null;
        const req: BrainRequest<unknown> = {
          id,
          agentId,
          type,
          route,
          system: built.system,
          user: built.user,
          schema: SCHEMAS[type],
          maxTokens: MAX_TOKENS[type],
          promptHash: built.promptHash,
          meta: built.meta,
        };
        return req;
      },
      apply: (res, stale) => {
        if (res.status === "ok" && res.parsed !== null) apply(res.parsed, stale);
        brain.log(type, agentId, res, build);
      },
      onDropped,
    };
  }

  private log(type: CallType, agentId: number | null, res: BrainResponse<unknown>, _build: () => BuiltPrompt | null): void {
    const t = this.byType.get(type) ?? { calls: 0, usd: 0 };
    t.calls++;
    t.usd += res.usd;
    this.byType.set(type, t);
    this.s.today.llmCalls++;
    this.s.today.usd += res.usd;
    this.s.totals.llmCalls++;
    this.s.totals.usd += res.usd;
    if (agentId !== null) {
      const a = this.s.agents.get(agentId);
      if (a) {
        a.callsToday++;
        a.usdToday += res.usd;
        a.tokensToday += res.usage.inputTokens + res.usage.outputTokens;
        a.pendingThoughts = Math.max(0, a.pendingThoughts - 1);
      }
    }
    this.db?.insertLlmCall({
      tick: this.s.tick,
      agentId,
      callType: type,
      provider: res.provider,
      model: res.model,
      inTokens: res.usage.inputTokens,
      cacheRead: res.usage.cacheRead,
      cacheWrite: res.usage.cacheWrite,
      outTokens: res.usage.outputTokens,
      usd: res.usd,
      latencyMs: res.latencyMs,
      status: res.status,
      promptHash: null,
      volatileText: null,
      responseJson: res.raw ? res.raw.slice(0, 20000) : res.error,
    });
  }

  private agent(id: number): Agent | null {
    const a = this.s.agents.get(id);
    return a && a.diedTick === null ? a : null;
  }

  requestPlan(a: Agent): boolean {
    const req = this.makeRequest(
      "daily_plan",
      a.id,
      1,
      this.s.tick + 36,
      `${a.id}:plan`,
      () => (this.agent(a.id) ? buildDailyPlan(a, this.buildContext()) : null),
      (parsed, stale) => {
        if (stale) {
          const out = parsed as ReturnType<typeof SCHEMAS.daily_plan.parse>;
          if (out.nota_diario) a.diaryPending.push(out.nota_diario);
          return;
        }
        applyDailyPlan(a, this.s, parsed as ReturnType<typeof SCHEMAS.daily_plan.parse>, this.sink());
      },
      () => {
        a.pendingThoughts = Math.max(0, a.pendingThoughts - 1);
      },
    );
    return this.enqueue(req, a);
  }

  requestReflection(a: Agent): boolean {
    const req = this.makeRequest(
      "reflection",
      a.id,
      2,
      null,
      `${a.id}:reflection`,
      () => (this.agent(a.id) ? buildReflection(a, this.buildContext()) : null),
      (parsed) => applyReflection(a, this.s, parsed as ReturnType<typeof SCHEMAS.reflection.parse>, this.sink()),
      () => {
        a.pendingThoughts = Math.max(0, a.pendingThoughts - 1);
      },
    );
    return this.enqueue(req, a);
  }

  requestDialogue(a: Agent, b: Agent, motives: string[], business: boolean): boolean {
    const until = this.s.tick + 12;
    const release = () => {
      for (const x of [a, b]) {
        if (x.conversingWith === (x === a ? b.id : a.id)) {
          x.conversingWith = null;
          x.conversingUntil = -1;
        }
        x.pendingThoughts = Math.max(0, x.pendingThoughts - 1);
      }
    };
    const req = this.makeRequest(
      "dialogue",
      a.id,
      business ? 1 : 2,
      until,
      `dialogo:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`,
      () => (this.agent(a.id) && this.agent(b.id) ? buildDialogue(a, b, motives, this.buildContext()) : null),
      (parsed, stale) => {
        b.pendingThoughts = Math.max(0, b.pendingThoughts - 1);
        if (stale || !this.agent(a.id) || !this.agent(b.id) || Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > 3) {
          release();
          smallTalk(a, b, this.s.tick);
          return;
        }
        applyDialogue(a, b, this.s, parsed as ReturnType<typeof SCHEMAS.dialogue.parse>, this.sink());
      },
      () => {
        release();
        smallTalk(a, b, this.s.tick);
      },
    );
    a.conversingWith = b.id;
    b.conversingWith = a.id;
    a.conversingUntil = until;
    b.conversingUntil = until;
    b.pendingThoughts++;
    const ok = this.enqueue(req, a);
    if (!ok) release();
    return ok;
  }

  requestReaction(a: Agent, event: WorldEvent): boolean {
    const req = this.makeRequest(
      "reaction",
      a.id,
      0,
      this.s.tick + 6,
      `${a.id}:reaction:${event.kind}:${event.tick}`,
      () => (this.agent(a.id) ? buildReaction(a, event, this.buildContext()) : null),
      (parsed, stale) => {
        if (stale) return;
        applyReaction(a, this.s, parsed as ReturnType<typeof SCHEMAS.reaction.parse>, event, this.sink());
      },
      () => {
        a.pendingThoughts = Math.max(0, a.pendingThoughts - 1);
      },
    );
    return this.enqueue(req, a);
  }

  requestCreate(a: Agent): boolean {
    const req = this.makeRequest(
      "create",
      a.id,
      3,
      this.s.tick + this.cfg.time.ticksPerDay,
      `${a.id}:create`,
      () => (this.agent(a.id) ? buildCreate(a, this.buildContext()) : null),
      (parsed, stale) => {
        if (stale) return;
        applyCreate(a, this.s, parsed as ReturnType<typeof SCHEMAS.create.parse>, this.sink());
      },
      () => {
        a.pendingThoughts = Math.max(0, a.pendingThoughts - 1);
      },
    );
    return this.enqueue(req, a);
  }

  private enqueue(req: ThoughtRequest, a: Agent | null): boolean {
    if (a) {
      if (a.callsToday >= this.cfg.brain.maxCallsPerAgentPerDay || a.tokensToday >= this.cfg.brain.maxTokensPerAgentPerDay) {
        req.onDropped?.("cupo diario del ser");
        return false;
      }
    }
    const ok = this.scheduler.enqueue(req);
    if (ok && a) {
      a.pendingThoughts++;
      // pensar cuesta calorías
      a.needs.hambre = clamp01(a.needs.hambre - this.cfg.brain.caloriesPerCall);
    }
    return ok;
  }

  // ------------------------------------------------------------ integración

  integrate(): void {
    const done = this.scheduler.drain();
    if (done.length === 0) return;
    done.sort((p, q) => (p.req.agentId ?? -1) - (q.req.agentId ?? -1) || p.req.id - q.req.id);
    for (const { req, res } of done) {
      const stale = req.deadlineTick !== null && this.s.tick > req.deadlineTick;
      try {
        req.apply(res, stale);
      } catch (err) {
        this.engine.emit(
          makeEvent({ kind: "thought", tick: this.s.tick, agentId: req.agentId, label: `error al aplicar ${req.type}: ${(err as Error).message}`, importance: 1, persist: false }),
        );
      }
    }
  }

  // ------------------------------------------------------------ disparadores

  evaluate(): void {
    const s = this.s;
    const cfg = this.cfg;
    const clock = s.clock;
    this.newDialoguesThisTick = 0;
    const planEvery = Math.max(1, Math.round(1 / this.density));
    const muted = this.scheduler.muted;
    const events = this.engine.currentEvents;
    const notable = events.filter((e) => e.importance >= 7 && REACTION_KINDS.has(e.kind));
    const scratch: number[] = [];
    const maxDialogues = Math.max(1, Math.round(cfg.social.maxDialoguesPerAgentPerDay * this.density));
    const dialogueCap = Math.max(1, Math.floor(s.alive.length / cfg.social.maxNewDialoguesPerTickDivisor));
    for (const id of s.alive) {
      const a = s.agents.get(id)!;
      const adult = isAdult(a, s.tick, cfg);
      const age = this.engine.ageYears(a);
      if (age < cfg.life.childhoodMinAgeYearsForPlans) continue;

      // reacciones: valen aunque el presupuesto esté agotado (prioridad 0, cupo 2/día)
      if (notable.length && a.reactionsToday < 2 && a.pendingThoughts === 0) {
        for (const e of notable) {
          if (e.agentId === a.id && e.kind !== "agent.born" && e.kind !== "discovery") continue;
          const witnessed = e.x === null || e.targetId === a.id || e.agentId === a.id || (Math.abs(e.x - a.x) <= cfg.social.perceptionRadius && Math.abs((e.y ?? 0) - a.y) <= cfg.social.perceptionRadius);
          if (!witnessed) continue;
          if (this.requestReaction(a, e)) a.reactionsToday++;
          break;
        }
      }
      if (muted) continue;

      // plan del día
      if (!a.asleep && a.lastPlanDay < clock.day && a.conversingUntil < s.tick && (clock.day + a.id) % planEvery === 0) {
        const jitter = (a.id % 7) * 0.25;
        if (clock.hour >= cfg.time.dawnHour + jitter && clock.hour < 12 && a.pendingThoughts === 0) {
          a.lastPlanDay = clock.day;
          this.requestPlan(a);
        }
      }

      // reflexión al dormirse
      if (a.asleep && !a.reflectedThisSleep && a.pendingThoughts === 0) {
        const threshold = cfg.brain.reflectionImportanceThreshold / this.density;
        const sinceLast = s.tick - a.lastReflectionTick;
        if (a.importanceSinceReflection >= threshold || sinceLast >= cfg.time.ticksPerDay * 3 * planEvery) {
          a.reflectedThisSleep = true;
          this.requestReflection(a);
        }
      }

      // crear
      if (
        !a.asleep &&
        adult &&
        a.createdToday === 0 &&
        a.pendingThoughts === 0 &&
        (a.needs.estima < 0.4 || a.needs.sentido < 0.4) &&
        a.needs.hambre > 0.5 &&
        a.needs.sed > 0.5 &&
        a.needs.calor > 0.5 &&
        a.genome.curiosidad + a.genome.inteligencia > 1.0 &&
        (a.current === null || a.current.verb === "descansar" || a.current.verb === "explorar") &&
        s.rng.get("social").chance(0.02 * this.density)
      ) {
        a.createdToday++;
        this.requestCreate(a);
      }

      // charlas
      if (
        !a.asleep &&
        adult &&
        a.conversingUntil < s.tick &&
        a.dialoguesToday < maxDialogues &&
        a.pendingThoughts === 0 &&
        this.newDialoguesThisTick < dialogueCap &&
        a.needs.hambre > 0.15 &&
        a.needs.sed > 0.15
      ) {
        const near = this.engine.spatial.query(a.x, a.y, 1, s.agents, scratch);
        let best: { b: Agent; score: number; motives: string[]; business: boolean } | null = null;
        for (const oid of near) {
          if (oid === a.id) continue;
          const b = s.agents.get(oid)!;
          if (b.diedTick !== null || b.asleep || b.conversingUntil >= s.tick || b.pendingThoughts > 0 || b.dialoguesToday >= maxDialogues || !isAdult(b, s.tick, cfg)) continue;
          const sc = this.dialogueScore(a, b);
          if (sc.score >= cfg.social.dialogueScoreThreshold && (!best || sc.score > best.score)) best = { b, ...sc };
        }
        if (best) {
          if (this.requestDialogue(a, best.b, best.motives, best.business)) this.newDialoguesThisTick++;
        }
      }
    }
  }

  private dialogueScore(a: Agent, b: Agent): { score: number; motives: string[]; business: boolean } {
    const s = this.s;
    const rel = a.relationships.get(b.id);
    const relB = b.relationships.get(a.id);
    const motives: string[] = [];
    let business = false;
    let score = (1 - a.needs.social) * 0.8 + (1 - b.needs.social) * 0.3;
    if (rel) {
      score += rel.affinity * 0.4 + (1 - rel.familiarity) * 0.2;
      if (Math.abs(rel.debt) > 0.5) {
        score += 0.3;
        business = true;
        motives.push(rel.debt > 0 ? `${b.name} le debe un favor a ${a.name}` : `${a.name} le debe un favor a ${b.name}`);
      }
    } else score += 0.3;
    if (a.socialWishes.includes(b.id)) {
      score += 0.6;
      business = true;
      motives.push(`${a.name} quería hablar con ${b.name}`);
    }
    if (b.socialWishes.includes(a.id)) {
      score += 0.4;
      business = true;
      motives.push(`${b.name} quería hablar con ${a.name}`);
    }
    const teach = [...a.knows].find((k) => k !== "refugio" && !b.knows.has(k));
    if (teach && (rel?.affinity ?? 0) >= 0) {
      score += 0.2;
      motives.push(`${a.name} sabe ${teach} y ${b.name} no`);
    }
    const foodA = a.inventory.get("comida") ?? 0;
    const foodB = b.inventory.get("comida") ?? 0;
    if ((foodA >= 4 && foodB < 1) || (foodB >= 4 && foodA < 1)) {
      score += 0.3;
      business = true;
      motives.push(foodA > foodB ? `${b.name} no tiene comida y ${a.name} sí` : `${a.name} no tiene comida y ${b.name} sí`);
    }
    if (a.beliefs.size > 0 && b.beliefs.size === 0) {
      score += 0.15;
      motives.push(`${a.name} tiene creencias que ${b.name} no comparte`);
    }
    const last = a.lastDialogueWith.get(b.id);
    if (last !== undefined && s.tick - last < s.config.time.ticksPerDay && !business) score -= 0.6;
    if (relB && relB.affinity < -0.4) {
      score -= 0.3;
      motives.push(`${b.name} no aprecia a ${a.name}`);
    }
    if (!motives.length) motives.push("se cruzaron");
    return { score, motives, business };
  }
}

/** Efecto mínimo de una charla que no llegó a pensarse. */
export function smallTalk(a: Agent, b: Agent, tick: number): void {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    x.needs.social = clamp01(x.needs.social + 0.1);
    x.lastDialogueWith.set(y.id, tick);
  }
}

const INVENTION_KEYWORDS: Array<{ match: RegExp; tech: string; requires: string[]; items: string[] }> = [
  { match: /fuego|chispa|encender/i, tech: "fuego", requires: [], items: ["madera"] },
  { match: /herramienta|hacha|cuchillo|filo|piedra tallada|martillo|arma|lanza|punta/i, tech: "herramientas", requires: [], items: ["piedra", "madera"] },
  { match: /caza|trampa|lanza/i, tech: "caza", requires: ["herramientas"], items: ["madera"] },
  { match: /c[aá]ntaro|cer[aá]mica|barro|vasija|olla/i, tech: "ceramica", requires: ["fuego"], items: [] },
  { match: /ropa|tejido|tejer|abrigo|manta|fibra/i, tech: "tejido", requires: [], items: [] },
  { match: /sembrar|semilla|cultiv|granja|huerta/i, tech: "agricultura", requires: [], items: ["semilla"] },
  { match: /muro|piedra apilada|construir con piedra|casa de piedra/i, tech: "construccion", requires: ["herramientas"], items: ["piedra"] },
  { match: /metal|fundir|horno|mineral/i, tech: "metalurgia", requires: ["fuego", "ceramica"], items: ["mineral"] },
  { match: /escrib|tablilla|marca|signo|letra|contar con marcas/i, tech: "escritura", requires: [], items: [] },
  { match: /hierba|curar|medicina|remedio/i, tech: "medicina", requires: [], items: [] },
  { match: /rueda|rodar|tronco que gira/i, tech: "rueda", requires: ["herramientas"], items: ["madera"] },
  { match: /balsa|canoa|navegar|barca/i, tech: "navegacion", requires: ["herramientas"], items: ["madera"] },
];

/** Invención por palabras clave (hasta que la fase 3 traiga el árbol tecnológico). */
export function simpleInvention(a: Agent, recipe: { resultado: string; ingredientes: string[]; proceso: string }, engine: Engine): string | null {
  const text = `${recipe.resultado} ${recipe.ingredientes.join(" ")} ${recipe.proceso}`;
  const rng = engine.s.rng.get("life");
  for (const k of INVENTION_KEYWORDS) {
    if (!k.match.test(text)) continue;
    if (a.knows.has(k.tech)) return null;
    if (k.requires.some((r) => !a.knows.has(r))) return null;
    if (k.items.some((it) => (a.inventory.get(it as never) ?? 0) < 1)) return null;
    const chance = 0.2 + 0.4 * a.genome.inteligencia + 0.1 * a.genome.curiosidad;
    if (rng.chance(chance)) {
      engine.learn(a, k.tech, "inventando");
      return k.tech;
    }
    return null;
  }
  return null;
}
