import type { BudgetInfo, CostInfo } from "@genesis/protocol";
import { inv, isAdult, remember, takeItem, type Agent } from "../agents/agent.ts";
import { clamp01 } from "../agents/needs.ts";
import { ThoughtScheduler, type ThoughtRequest } from "../cognition/scheduler.ts";
import { nearStructure } from "../cognition/system1/actions.ts";
import { buildCreate, buildDailyPlan, buildDialogue, buildGovern, buildHeritage, buildHistorian, buildReaction, buildReflection, type BuildContext, type BuiltPrompt } from "../cognition/system2/builders.ts";
import { applyCreate, applyDailyPlan, applyDialogue, applyGovern, applyHeritage, applyReaction, applyReflection, type IntentSink } from "../cognition/system2/intents.ts";
import { legendScore } from "../life/life.ts";
import { describeEvent } from "../sim/events.ts";
import { currentStep } from "../cognition/system2/plans.ts";
import { buildWorldLaws } from "../cognition/system2/prompts/laws.ts";
import { DEFAULT_ROUTE, MAX_TOKENS, SCHEMAS, type CallType } from "../cognition/system2/schemas.ts";
import type { GenesisConfig } from "../config.ts";
import { Bm25Retriever } from "../memory/retrieval.ts";
import type { WorldDb } from "../persistence/db.ts";
import type { Engine } from "../sim/engine.ts";
import { makeEvent, type WorldEvent } from "../sim/events.ts";
import { findSimilarBelief } from "../society/beliefs.ts";
import type { Society } from "../society/society.ts";
import { attemptInvention, TECH_BY_ID } from "../society/tech.ts";
import type { BrainRoutes } from "./router.ts";
import { priceFor, type BrainRequest, type BrainResponse } from "./provider.ts";

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
  /** la sociedad, si está enganchada (tribus, líderes, leyes) */
  society: Society | null = null;
  private readonly byType = new Map<string, { calls: number; usd: number }>();
  /** último modo cognitivo grabado como evento (densidad y silencio), para que el replay lo reproduzca */
  private recordedMode: { density: number; muted: string } | null = null;
  /** capítulos de la crónica escritos en esta sesión (la DB tiene todos) */
  chapters: Array<{ tickFrom: number; tickTo: number; title: string; body: string; themes: string[]; protagonists: string[] }> = [];

  constructor(
    readonly engine: Engine,
    routes: BrainRoutes,
    readonly db: WorldDb | null,
    opts: { density?: number; society?: Society | null } = {},
  ) {
    this.cfg = engine.config;
    this.scheduler = new ThoughtScheduler(routes, this.cfg, () => engine.s.tick);
    this.laws = buildWorldLaws(this.cfg);
    this.density = opts.density ?? 1;
    this.scheduler.density = this.density;
    this.society = opts.society ?? null;
    if (db) {
      const totals = db.llmTotals();
      this.scheduler.budget.usdTotal = totals.usd;
    }
  }

  groupNameOf(agentId: number): string | null {
    return this.society?.groupNameOf(agentId) ?? null;
  }

  leaderNameOf(agentId: number): string | null {
    return this.society?.leaderNameOf(agentId) ?? null;
  }

  /** Intento de invención contra el árbol tecnológico oculto. */
  invent(a: Agent, recipe: { resultado: string; ingredientes: string[]; proceso: string }): string | null {
    const s = this.s;
    const r = attemptInvention(a, recipe, s.rng.get("life"), (kind) => nearStructure(a, { grid: s.grid, structures: s.structures }, kind));
    if (r.reason !== "ok" || !r.tech) return null;
    for (const [item, n] of Object.entries(TECH_BY_ID[r.tech]!.ingredients)) takeItem(a, item as never, n ?? 0);
    this.engine.learn(a, r.tech, "inventando");
    return r.tech;
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
        this.onLifeEvents(out.events, out.deaths);
        if (out.newDay) {
          this.scheduler.budget.newDay();
          const day = this.s.clock.day;
          if (day > 0 && day % this.cfg.brain.historianEveryDays === 0 && !this.scheduler.muted) this.requestHistorian();
        }
        this.recordMode();
        this.scheduler.pump();
      },
    };
  }

  /**
   * Deja grabado el modo cognitivo vigente en este tick (densidad del preset y
   * silencio por presupuesto) cada vez que cambia: los pedidos que el cerebro
   * decide hacer dependen de él, y el replay lo necesita para hacer los mismos.
   */
  private recordMode(): void {
    const muted = this.scheduler.budget.muted;
    const density = this.density;
    if (this.recordedMode && this.recordedMode.density === density && this.recordedMode.muted === muted) return;
    this.recordedMode = { density, muted };
    this.engine.emit(makeEvent({ kind: "brain.mode", tick: this.s.tick, label: muted === "none" ? `densidad ${density}` : `mudo (${muted})`, importance: 0, data: { density, muted }, persist: true }));
  }

  /** Nacimientos → herencia; muertes notables → epopeya. */
  private onLifeEvents(events: WorldEvent[], deaths: number[]): void {
    const s = this.s;
    for (const e of events) {
      if (e.kind === "agent.born" && e.agentId !== null) {
        const child = s.agents.get(e.agentId);
        if (child && !this.scheduler.muted) this.requestHeritage(child, "nacimiento");
      }
    }
    for (const id of deaths) {
      const dead = s.agents.get(id);
      if (!dead || this.scheduler.muted) continue;
      const leader = !!this.society && [...this.society.groups.values()].some((g) => g.leaderId === id || (g.dissolvedTick === null && g.leaderStreak.has(id)));
      const founder = [...s.beliefs.values()].some((b) => b.founderId === id && b.holders.size >= 3);
      const texts = [...s.texts.values()].filter((t) => t.authorId === id).length;
      const discoveries = dead.memories.filter((m) => m.tags.includes("descubrimiento") && m.text.startsWith("Descubrí")).length;
      const score = legendScore(this.engine, dead, { leader, founder, texts, discoveries });
      if (score < 6) continue;
      const facts = dead.memories
        .filter((m) => m.importance >= 6)
        .slice(-8)
        .map((m) => m.text);
      const holder = s.alive.map((aid) => s.agents.get(aid)!).filter((a) => (a.relationships.get(id)?.familiarity ?? 0) > 0.4).sort((p, q) => (q.relationships.get(id)?.affinity ?? 0) - (p.relationships.get(id)?.affinity ?? 0))[0] ?? null;
      this.requestBard(dead, facts, holder);
    }
    // adultez: el legado se completa con la propia infancia
    if (s.clock.isDawnTick) {
      for (const id of s.alive) {
        const a = s.agents.get(id)!;
        if (a.parents[0] === null && a.parents[1] === null) continue;
        if (a.firsts.has("herencia_adulta")) continue;
        if (!isAdult(a, s.tick, this.cfg)) continue;
        a.firsts.add("herencia_adulta");
        if (!this.scheduler.muted) this.requestHeritage(a, "adultez");
      }
    }
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
      groupNameOf: (id) => this.groupNameOf(id),
      leaderNameOf: (id) => this.leaderNameOf(id),
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
        const s = this.s;
        const id = s.counters.text++;
        const author = row.authorId !== null ? s.agents.get(row.authorId) : undefined;
        const lower = row.body.toLowerCase();
        const techIds = author ? [...author.knows].filter((k) => k !== "refugio" && (lower.includes(k) || lower.includes(TECH_BY_ID[k]?.name.replace(/^(el|la|las|los) /, "") ?? " "))) : [];
        const belief = findSimilarBelief(s, row.body, 0.35);
        s.texts.set(id, { id, ...row, medium: row.medium as never, techIds, beliefId: belief?.id ?? null, holderId: row.authorId, reads: 0 });
        this.db?.insertText({ id, ...row, techIds, beliefId: belief?.id ?? null });
        return id;
      },
      invent: (a, recipe) => this.invent(a, recipe),
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

  requestGovern(leader: Agent, issue: string): boolean {
    const society = this.society;
    const group = society?.isLeader(leader.id) ?? null;
    if (!society || !group) return false;
    const s = this.s;
    const tpd = this.cfg.time.ticksPerDay;
    const req = this.makeRequest(
      "govern",
      leader.id,
      1,
      s.tick + 18,
      `${leader.id}:govern`,
      () => {
        if (!this.agent(leader.id) || !society.isLeader(leader.id)) return null;
        const others = [...society.groups.values()].filter((g) => g.id !== group.id && g.dissolvedTick === null);
        const gctx = {
          groupName: group.name,
          members: group.members.size,
          leaderSinceDays: Math.max(0, Math.floor((s.tick - group.leaderSinceTick) / tpd)),
          norms: group.norms.slice(-8),
          rituals: group.rituals.map((r) => `${r.name} (cada ${r.everyDays} días)`),
          wars: [...group.wars].map((id) => society.groups.get(id)?.name ?? "?"),
          treaties: [...group.treaties].map((id) => society.groups.get(id)?.name ?? "?"),
          recentCrimes: society.crimes
            .filter((c) => c.groupId === group.id && s.tick - c.tick < tpd * 7)
            .slice(-5)
            .map((c) => `${s.agents.get(c.criminalId)?.name ?? "?"} ${c.verb} ${c.victimId !== null ? `a ${s.agents.get(c.victimId)?.name ?? "?"}` : ""}${c.punished ? " (castigado)" : " (sin castigo)"}`),
          issue,
          otherGroups: others.map((g) => `${g.name} (${g.members.size})`),
        };
        return buildGovern(leader, gctx, this.buildContext());
      },
      (parsed, stale) => {
        if (stale || !society.isLeader(leader.id)) return;
        applyGovern(leader, group, s, parsed as ReturnType<typeof SCHEMAS.govern.parse>, society, this.sink());
      },
      () => {
        leader.pendingThoughts = Math.max(0, leader.pendingThoughts - 1);
      },
    );
    return this.enqueue(req, leader);
  }

  requestHeritage(child: Agent, stage: "nacimiento" | "adultez"): boolean {
    const s = this.s;
    const parents = child.parents.map((p) => (p !== null ? s.agents.get(p) : undefined)).filter((p): p is Agent => !!p);
    if (parents.length === 0 && stage === "nacimiento") return false;
    const req = this.makeRequest(
      "heritage",
      child.id,
      1,
      null,
      `${child.id}:heritage:${stage}`,
      () => {
        if (!this.agent(child.id)) return null;
        const group = this.society?.groupOf(child.id) ?? (parents[0] ? this.society?.groupOf(parents[0].id) : null) ?? null;
        const norms = group ? [...group.norms.slice(-4), ...group.rituals.map((r) => `rito: ${r.name}`)] : [];
        const sources = stage === "nacimiento" ? parents : [child, ...parents];
        return buildHeritage(child, sources, this.buildContext(), norms);
      },
      (parsed) => applyHeritage(child, s, parsed as ReturnType<typeof SCHEMAS.heritage.parse>, this.sink(), stage),
      () => {
        child.pendingThoughts = Math.max(0, child.pendingThoughts - 1);
      },
    );
    return this.enqueue(req, child);
  }

  /** El Historiador escribe un capítulo con los hechos del período. */
  requestHistorian(): boolean {
    const s = this.s;
    const tpd = this.cfg.time.ticksPerDay;
    const from = s.tick - tpd * this.cfg.brain.historianEveryDays;
    const key = `historian:${Math.floor(s.tick / tpd)}`;
    const req = this.makeRequest(
      "historian",
      null,
      3,
      null,
      key,
      () => {
        const facts = this.factsSince(from);
        const previous = this.db?.chronicle(1)[0];
        return buildHistorian(facts, previous ? String(previous.body) : null, s.epoch, this.buildContext(), "historian");
      },
      (parsed) => {
        const out = parsed as ReturnType<typeof SCHEMAS.historian.parse>;
        const title = out.titulo_periodo.slice(0, 120);
        const body = out.cronica.slice(0, 6000);
        this.db?.insertChronicle({ tickFrom: from, tickTo: s.tick, title, body, kind: "historia", themes: out.temas.slice(0, 8), protagonists: out.protagonistas.slice(0, 10) });
        this.chapters.push({ tickFrom: from, tickTo: s.tick, title, body, themes: out.temas.slice(0, 8), protagonists: out.protagonistas.slice(0, 10) });
        if (this.chapters.length > 200) this.chapters.shift();
        if (out.nombre_epoca_sugerido) {
          const name = out.nombre_epoca_sugerido.slice(0, 60);
          if (name && name !== s.epoch) {
            s.epoch = name;
            this.engine.emit(makeEvent({ kind: "epoch", tick: s.tick, label: name, importance: 8, data: { epoch: name, byHistorian: true }, tags: ["epoca"] }));
          }
        }
        this.engine.emit(makeEvent({ kind: "create", tick: s.tick, label: `crónica: ${title}`, importance: 6, data: { tipo: "cronica", titulo: title }, tags: ["cronica"], persist: true }));
      },
    );
    return this.scheduler.enqueue(req);
  }

  /** El Bardo canta a un muerto que dejó huella. */
  requestBard(dead: Agent, facts: string[], holder: Agent | null): boolean {
    const s = this.s;
    const req = this.makeRequest(
      "bard",
      null,
      3,
      null,
      `bard:${dead.id}`,
      () => buildHistorian([`Murió ${dead.name}, de ${dead.causeOfDeath ?? "causas desconocidas"}`, ...facts], null, s.epoch, this.buildContext(), "bard"),
      (parsed) => {
        const out = parsed as ReturnType<typeof SCHEMAS.bard.parse>;
        const id = this.sink().text({ authorId: holder?.id ?? null, tick: s.tick, title: out.titulo.slice(0, 80), body: out.poema.slice(0, 2000), medium: "oral", kind: "epopeya", x: dead.x, y: dead.y });
        if (holder) remember(s, holder, "texto", `Aprendí el canto sobre ${dead.name}: ${out.titulo}`, 7, ["leyenda", "canto"], [dead.id]);
        this.engine.emit(makeEvent({ kind: "create", tick: s.tick, agentId: holder?.id ?? null, x: dead.x, y: dead.y, label: `una epopeya: ${out.titulo}`, importance: 7, data: { tipo: "epopeya", titulo: out.titulo, textId: id, heroId: dead.id }, tags: ["leyenda", "canto", "muerte"] }));
      },
    );
    return this.scheduler.enqueue(req);
  }

  /** Hechos del período para el Historiador: hitos, eventos importantes con diversidad, y resúmenes de la sociedad. */
  factsSince(from: number): string[] {
    const s = this.s;
    const facts: string[] = [];
    const tpd = this.cfg.time.ticksPerDay;
    const dayOf = (t: number) => `día ${Math.floor(t / tpd) + 1}`;
    const events = this.db ? this.db.events({ from, minImportance: 5, limit: 2000, order: "asc" }) : [];
    const perKind = new Map<string, number>();
    const scored = events
      .filter((e) => e.kind !== "intent" && e.kind !== "thought" && e.kind !== "speech")
      .sort((p, q) => q.importance - p.importance);
    for (const e of scored) {
      const n = perKind.get(e.kind) ?? 0;
      if (n >= 8) continue;
      perKind.set(e.kind, n + 1);
      const ev = { kind: e.kind as WorldEvent["kind"], tick: e.tick, agentId: e.agent_id, targetId: e.target_id, x: e.x, y: e.y, importance: e.importance, label: e.label, data: e.payload, persist: true, tags: e.tags };
      facts.push(`${dayOf(e.tick)}: ${describeEvent(ev, this.engine.names)}`);
      if (facts.length >= 60) break;
    }
    facts.sort();
    if (this.society) {
      const groups = this.society.groupsInfo();
      if (groups.length) facts.push(`Tribus: ${groups.map((g) => `${g.name} (${g.members.length}${g.leaderId !== null ? `, lidera ${this.engine.names.name(g.leaderId)}` : ""})`).join("; ")}`);
      const laws = this.society.lawsInfo().filter((l) => l.active);
      if (laws.length) facts.push(`Leyes vigentes: ${laws.map((l) => `${l.groupName}: ${l.statement}`).join("; ")}`);
      const eco = this.society.economyInfo();
      if (eco.currency) facts.push(`La moneda es ${eco.currency}`);
      const beliefs = this.society.beliefsInfo().slice(0, 5);
      if (beliefs.length) facts.push(`Creencias más extendidas: ${beliefs.map((b) => `"${b.statement}" (${b.adherents})`).join("; ")}`);
    }
    facts.push(`Población: ${s.alive.length} seres; nacimientos ${s.totals.births}, muertes ${s.totals.deaths} en total`);
    return facts;
  }

  requestCreate(a: Agent, hint: string | null = null): boolean {
    const req = this.makeRequest(
      "create",
      a.id,
      3,
      this.s.tick + this.cfg.time.ticksPerDay,
      `${a.id}:create`,
      () => (this.agent(a.id) ? buildCreate(a, this.buildContext(), hint) : null),
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

      // gobernar: un líder con un asunto pendiente
      if (!a.asleep && a.pendingThoughts === 0 && this.society && a.conversingUntil < s.tick) {
        const issue = this.society.pendingIssues().find((i) => i.leaderId === a.id);
        if (issue && this.society.isLeader(a.id)) {
          this.society.takeIssue(a.id);
          this.requestGovern(a, `${issue.kind}: ${issue.detail}`);
        }
      }

      // crear (por impulso o porque el plan lo pide)
      const step = a.plan.length ? currentStep(a) : null;
      const wantsToCreate = step !== null && (step.verbo === "crear" || step.verbo === "escribir");
      if (
        !a.asleep &&
        adult &&
        a.createdToday === 0 &&
        a.pendingThoughts === 0 &&
        a.needs.hambre > 0.35 &&
        a.needs.sed > 0.35 &&
        a.needs.calor > 0.35 &&
        (wantsToCreate ||
          ((a.needs.estima < 0.4 || a.needs.sentido < 0.4) &&
            a.needs.hambre > 0.5 &&
            a.genome.curiosidad + a.genome.inteligencia > 1.0 &&
            (a.current === null || a.current.verb === "descansar" || a.current.verb === "explorar") &&
            s.rng.get("social").chance(0.02 * this.density)))
      ) {
        a.createdToday++;
        this.requestCreate(a, step?.verbo === "escribir" ? "texto" : null);
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

void inv;
