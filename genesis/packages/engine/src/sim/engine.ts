import { RESOURCES, type ResourceKind } from "@genesis/protocol";
import { createAgent, inv, remember, resetDailyCounters, type Agent } from "../agents/agent.ts";
import type { Crime, Punishment } from "../society/laws.ts";
import { clamp01 } from "../agents/needs.ts";
import { executeAction, startAction, type ActionContext } from "../cognition/system1/actions.ts";
import { decide, type DecisionContext, type Perception } from "../cognition/system1/utility.ts";
import { advancePlan, planCandidate } from "../cognition/system2/plans.ts";
import { dropDeadHolder } from "../society/beliefs.ts";
import { loadConfig, ticksPerHour, ticksPerYear, type GenesisConfig, type GenesisConfigInput } from "../config.ts";
import { recordObservations } from "../memory/observe.ts";
import { collectMetrics } from "../metrics/collector.ts";
import { RngStreams } from "../rng.ts";
import { cellTemperature, initialClimate, stepClimate } from "../world/climate.ts";
import { NEIGHBORS8, NO_PATH, createGrid, idx, inBounds, isWalkable, type WorldGrid } from "../world/grid.ts";
import { initResources, recomputeResourceFields, recomputeShelterField, regrowResources } from "../world/resources.ts";
import { generateTerrain } from "../world/terrain.ts";
import { STRUCTURE_SPECS, providesWarmth, type Structure } from "../world/structures.ts";
import { computeClock } from "./clock.ts";
import { makeEvent, type NameResolver, type WorldEvent } from "./events.ts";
import { stateHash } from "./hash.ts";
import { deserializeState, serializeState, type SnapshotData } from "./snapshot.ts";
import { SpatialHash } from "./spatial.ts";
import { emptyDayStats, type EngineState } from "./state.ts";
import type { MetricsPoint } from "@genesis/protocol";

/** De noche solo se siguen los pasos vitales del plan. */
function planCandidateUrgent(a: Agent): boolean {
  const step = a.plan.find((p) => !p.done);
  return !!step && step.prioridad >= 5;
}

/** Lo mínimo que el motor necesita de la sociedad (evita la dependencia circular). */
export interface SocietyLike {
  crimes: Crime[];
  pendingCrimeFor(agentId: number): Crime | null;
  punish(crime: Crime, by: Agent): { punishment: Punishment; victimId: number | null } | null;
}

export interface TickOutput {
  tick: number;
  events: WorldEvent[];
  resourceChanges: number[];
  structuresChanged: number[];
  removedStructures: number[];
  newDay: boolean;
  newHour: boolean;
  metrics: MetricsPoint | null;
  deaths: number[];
}

/** Ganchos para las capas superiores (cerebro, sociedad, dios). */
export interface EngineHooks {
  /** corre después de integrar el reloj y antes del clima; ideal para intents y acciones de dios */
  beforeWorld?: (engine: Engine) => void;
  /** corre después de las acciones y antes de la memoria */
  afterActions?: (engine: Engine) => void;
  /** corre al final del tick, antes de emitir la salida */
  afterTick?: (engine: Engine, out: TickOutput) => void;
}

export class Engine {
  readonly s: EngineState;
  readonly spatial: SpatialHash;
  private events: WorldEvent[] = [];
  private resourceChanged = new Set<number>();
  private structuresChanged = new Set<number>();
  private removedStructures: number[] = [];
  readonly names: NameResolver;
  hooks: EngineHooks = {};
  /** sociedad enganchada (detectores, leyes, crímenes) */
  society: SocietyLike | null = null;

  constructor(state: EngineState) {
    this.s = state;
    this.spatial = new SpatialHash(state.grid.size);
    this.names = {
      name: (id) => (id === null ? "alguien" : (this.s.agents.get(id)?.name ?? `ser#${id}`)),
    };
    this.rebuildSpatial();
    this.recomputeShelter();
  }

  // ---------------------------------------------------------------- génesis

  static genesis(input: GenesisConfigInput, seed: number): Engine {
    const config = loadConfig(input);
    const rng = new RngStreams(seed);
    const grid = createGrid(config.world.size);
    generateTerrain(grid, config, rng.get("terrain"));
    initResources(grid, config, rng.get("resources"));
    recomputeResourceFields(grid);
    const state: EngineState = {
      config,
      seed,
      worldName: config.world.name,
      tick: 0,
      clock: computeClock(0, config),
      climate: initialClimate(),
      grid,
      agents: new Map(),
      alive: [],
      structures: new Map(),
      counters: { agent: 1, structure: 1, memory: 1, group: 1, belief: 1, text: 1, milestone: 1, request: 1 },
      rng,
      today: emptyDayStats(),
      yesterday: emptyDayStats(),
      totals: { births: 0, deaths: 0, violence: 0, trades: 0, usd: 0, llmCalls: 0 },
      lastFieldTick: 0,
      shelterDirty: true,
      takenNames: new Set(),
      epoch: "Edad del Hambre",
      milestones: new Map(),
      pendingMemories: [],
      beliefs: new Map(),
      texts: new Map(),
    };
    const engine = new Engine(state);
    engine.populate(config.world.initialPopulation);
    engine.s.clock = computeClock(0, config);
    stepClimate(engine.s.climate, engine.s.clock, config, rng.get("climate"));
    return engine;
  }

  /** sistemas enganchados que guardan estado propio en el snapshot */
  readonly extraSerializers = new Map<string, { serialize(): unknown; restore(data: unknown): void }>();
  private pendingExtra: Record<string, unknown> = {};

  static fromSnapshot(d: SnapshotData): Engine {
    const e = new Engine(deserializeState(d));
    e.pendingExtra = d.extra ?? {};
    return e;
  }

  /** Registra un sistema con estado propio; si el snapshot traía datos para él, los restaura. */
  attachSystem(name: string, sys: { serialize(): unknown; restore(data: unknown): void }): void {
    this.extraSerializers.set(name, sys);
    if (name in this.pendingExtra) {
      sys.restore(this.pendingExtra[name]);
      delete this.pendingExtra[name];
    }
  }

  snapshot(): SnapshotData {
    const extra: Record<string, unknown> = { ...this.pendingExtra };
    for (const [name, sys] of this.extraSerializers) extra[name] = sys.serialize();
    return serializeState(this.s, extra);
  }

  hash(): string {
    return stateHash(this.s);
  }

  get config(): GenesisConfig {
    return this.s.config;
  }

  /** Celda de origen: fértil y cerca del agua. */
  findCradle(): { x: number; y: number } {
    const { grid } = this.s;
    const size = grid.size;
    let best = -1;
    let bestScore = -Infinity;
    for (let y = 4; y < size - 4; y++) {
      for (let x = 4; x < size - 4; x++) {
        const i = idx(size, x, y);
        if (!isWalkable(grid.terrain[i]!)) continue;
        const dw = grid.distWater[i]!;
        if (dw === NO_PATH || dw > 6) continue;
        // suma de comida en un radio de 5
        let food = 0;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(size, nx, ny)) continue;
            food += grid.resources.comida[idx(size, nx, ny)]!;
          }
        }
        const wood = grid.dist.madera[i]! === NO_PATH ? 0 : Math.max(0, 1 - grid.dist.madera[i]! / 20);
        const score = food + wood * 20 - dw * 2;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }
    if (best < 0) best = idx(size, Math.floor(size / 2), Math.floor(size / 2));
    const x = best % size;
    return { x, y: (best - x) / size };
  }

  populate(count: number): void {
    const cradle = this.findCradle();
    const rng = this.s.rng.get("life");
    const { grid } = this.s;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 200) {
      attempts++;
      const r = 2 + Math.floor(Math.sqrt(placed) * 1.5);
      const x = cradle.x + rng.int(2 * r + 1) - r;
      const y = cradle.y + rng.int(2 * r + 1) - r;
      if (!inBounds(grid.size, x, y)) continue;
      const i = idx(grid.size, x, y);
      if (!isWalkable(grid.terrain[i]!) || grid.occupants[i]! >= 2) continue;
      // los primeros seres nacen adultos, con edades variadas
      const life = this.s.config.life;
      const perYear = ticksPerYear(this.s.config);
      const ageYears = life.adultAgeYears + rng.float() * (life.fertileToYears - life.adultAgeYears);
      const a = this.spawnAgent(x, y, { bornTick: -Math.round(ageYears * perYear) });
      const genomeRng = this.s.rng.get("genome");
      a.inventory.set("comida", 1 + genomeRng.int(3));
      if (genomeRng.chance(0.1)) a.knows.add("fuego");
      placed++;
    }
    this.rebuildSpatial();
  }

  spawnAgent(x: number, y: number, overrides: Partial<Agent>): Agent {
    const id = this.s.counters.agent++;
    const a = createAgent(id, this.s.tick, x, y, this.s.rng.get("genome"), this.s.takenNames, overrides);
    this.s.agents.set(id, a);
    this.s.alive.push(id);
    this.s.alive.sort((p, q) => p - q);
    const i = idx(this.s.grid.size, x, y);
    this.s.grid.occupants[i] = Math.min(255, this.s.grid.occupants[i]! + 1);
    return a;
  }

  // ---------------------------------------------------------------- utilidades

  emit(e: WorldEvent): void {
    this.events.push(e);
  }

  /** Eventos emitidos en el tick en curso (para disparadores). */
  get currentEvents(): WorldEvent[] {
    return this.events;
  }

  markResource(cell: number): void {
    this.resourceChanged.add(cell);
  }

  markStructure(id: number): void {
    this.structuresChanged.add(id);
  }

  rebuildSpatial(): void {
    this.spatial.clear();
    for (const id of this.s.alive) this.spatial.insert(this.s.agents.get(id)!);
  }

  recomputeShelter(): void {
    const cells: number[] = [];
    for (const st of this.s.structures.values()) {
      if (providesWarmth(st)) cells.push(idx(this.s.grid.size, st.x, st.y));
    }
    recomputeShelterField(this.s.grid, cells);
    this.s.shelterDirty = false;
  }

  /** Abrigo disponible en una celda: refugio en la celda o fuego encendido en la vecindad. */
  warmthAt(x: number, y: number): { warmth: number; structure: Structure | null } {
    const { grid, structures, config } = this.s;
    let warmth = 0;
    let structure: Structure | null = null;
    const here = grid.structureAt[idx(grid.size, x, y)]!;
    if (here >= 0) {
      const st = structures.get(here);
      if (st && providesWarmth(st)) {
        const w = st.kind === "fogata" ? config.climate.fireWarmth : STRUCTURE_SPECS[st.kind].warmth;
        warmth = Math.max(warmth, w);
        structure = st;
      }
    }
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(grid.size, nx, ny)) continue;
      const sid = grid.structureAt[idx(grid.size, nx, ny)]!;
      if (sid < 0) continue;
      const st = structures.get(sid);
      if (st && (st.kind === "fogata" || st.kind === "horno") && providesWarmth(st)) {
        warmth = Math.max(warmth, config.climate.fireWarmth * 0.8);
        structure = structure ?? st;
      }
    }
    return { warmth, structure };
  }

  // ---------------------------------------------------------------- tick

  step(): TickOutput {
    const s = this.s;
    const cfg = s.config;
    this.events = [];
    this.resourceChanged.clear();
    this.structuresChanged.clear();
    this.removedStructures = [];

    s.tick++;
    s.clock = computeClock(s.tick, cfg);
    const clock = s.clock;
    const tph = ticksPerHour(cfg);
    const newHour = s.tick % tph === 0;

    if (clock.isNewDay) this.startNewDay();

    this.hooks.beforeWorld?.(this);

    // clima
    const climateEvents = stepClimate(s.climate, clock, cfg, s.rng.get("climate"));
    for (const ce of climateEvents) this.emitClimate(ce);

    // recursos y campos, una vez por hora
    if (newHour) {
      regrowResources(s.grid, cfg, clock.season, s.climate.drought, s.rng.get("resources"), this.resourceChanged);
      recomputeResourceFields(s.grid);
      s.lastFieldTick = s.tick;
      const danger = s.grid.danger;
      for (let i = 0; i < danger.length; i++) if (danger[i]! > 0) danger[i] = danger[i]! * 0.9;
      this.growFarms();
    }
    this.burnFires();
    if (s.shelterDirty) this.recomputeShelter();

    // cuerpo
    const deaths: number[] = [];
    for (const id of s.alive) {
      const a = s.agents.get(id)!;
      this.stepBody(a, tph, deaths);
    }

    // percepción y decisión
    this.rebuildSpatial();
    const actx: ActionContext = {
      cfg,
      clock,
      grid: s.grid,
      agents: s.agents,
      structures: s.structures,
      rng: s.rng.get("actions"),
      events: this.events,
      nextStructureId: () => s.counters.structure++,
      resourceChanged: (c) => this.resourceChanged.add(c),
      shelterChanged: () => {
        s.shelterDirty = true;
      },
      learn: (ag, tech, how) => this.learn(ag, tech, how),
      onTrade: () => {
        s.today.trades++;
        s.totals.trades++;
      },
      consume: (item, n) => {
        s.today.consumed[item] = (s.today.consumed[item] ?? 0) + n;
      },
      remember: (ag, text, importance, tags) => {
        remember(s, ag, "observacion", text, importance, tags);
      },
      texts: s.texts,
      pendingCrimeFor: (id) => this.society?.pendingCrimeFor(id) ?? null,
      punish: (crime, by) => this.society?.punish(crime, by) ?? null,
    };
    const shelterExists = s.structures.size > 0;
    const scratch: number[] = [];
    for (const id of s.alive) {
      const a = s.agents.get(id)!;
      if (a.health <= 0) continue;
      // charla en curso (System 2): se queda quieto hasta que llegue la respuesta o venza
      if (a.conversingUntil >= s.tick) {
        a.needs.social = clamp01(a.needs.social + 0.004);
        continue;
      }
      if (a.conversingUntil !== -1) {
        a.conversingUntil = -1;
        a.conversingWith = null;
      }
      const p = this.perceive(a, scratch);
      if (a.asleep) {
        if (!this.shouldWake(a, p)) continue;
        a.asleep = false;
        a.reflectedThisSleep = false;
        a.current = null;
      }
      const dctx: DecisionContext = {
        cfg,
        clock,
        grid: s.grid,
        agents: s.agents,
        structures: s.structures,
        rng: s.rng.get("s1"),
        perception: p,
        shelterExists,
        planCandidate: a.plan.length && (clock.isDay || (planCandidateUrgent(a))) ? planCandidate(a, s) : null,
        pendingCrime: this.society && a.groupId !== null && this.society.crimes.length > 0 ? this.society.pendingCrimeFor(a.id) : null,
      };
      const c = decide(a, dctx);
      const cur = a.current;
      const sameAction =
        cur &&
        cur.verb === c.verb &&
        cur.targetId === c.targetId &&
        cur.resource === c.resource &&
        cur.structureKind === c.structureKind &&
        (cur.item ?? null) === c.item &&
        (cur.ticksLeft > 0 || cur.verb === "construir" || cur.verb === "dormir");
      if (!sameAction) startAction(a, c, s.tick);
      const done = executeAction(a, actx, a.current && a.current.verb === c.verb ? c.field : null);
      if (done) {
        const finished = a.current;
        a.current = null;
        if (finished?.fromPlan) advancePlan(a, finished);
      }
      this.serendipity(a);
    }

    this.hooks.afterActions?.(this);

    // memoria y choques
    recordObservations(s, this.events, this.spatial, this.names);

    // muertes
    for (const id of deaths) this.kill(id);

    if (s.shelterDirty) this.recomputeShelter();

    const metrics = newHour ? collectMetrics(s) : null;
    const out: TickOutput = {
      tick: s.tick,
      events: this.events,
      resourceChanges: [...this.resourceChanged],
      structuresChanged: [...this.structuresChanged],
      removedStructures: this.removedStructures,
      newDay: clock.isNewDay,
      newHour,
      metrics,
      deaths,
    };
    this.hooks.afterTick?.(this, out);
    return out;
  }

  private startNewDay(): void {
    const s = this.s;
    s.yesterday = s.today;
    s.today = emptyDayStats();
    for (const id of s.alive) resetDailyCounters(s.agents.get(id)!);
    // obras abandonadas (dueño muerto o sin avance en 3 días) se desmoronan
    const abandonedAfter = s.config.time.ticksPerDay * 3;
    for (const st of [...s.structures.values()]) {
      if (st.progress >= 1) continue;
      const owner = st.ownerId !== null ? s.agents.get(st.ownerId) : undefined;
      const ownerGone = !owner || owner.diedTick !== null || owner.buildingId !== st.id;
      if (ownerGone || s.tick - st.lastChangeTick > abandonedAfter) {
        s.structures.delete(st.id);
        s.grid.structureAt[idx(s.grid.size, st.x, st.y)] = -1;
        this.removedStructures.push(st.id);
        if (owner && owner.buildingId === st.id) owner.buildingId = null;
      }
    }
    if (s.clock.dayOfSeason === 0) {
      this.events.push(
        makeEvent({ kind: "season", tick: s.tick, label: s.clock.season, importance: 2, data: { year: s.clock.year + 1 }, tags: ["estacion", s.clock.season] }),
      );
    }
    // deriva de relaciones
    const decay = s.config.social.trustDecayPerDay;
    for (const id of s.alive) {
      const a = s.agents.get(id)!;
      for (const [, r] of a.relationships) {
        if (r.trust > 0.3) r.trust = Math.max(0.3, r.trust - decay);
        if (r.affinity > 0) r.affinity = Math.max(0, r.affinity - decay);
        else if (r.affinity < 0) r.affinity = Math.min(0, r.affinity + decay);
      }
    }
  }

  private emitClimate(ce: ReturnType<typeof stepClimate>[number]): void {
    const tick = this.s.tick;
    switch (ce.kind) {
      case "storm_start":
        this.events.push(makeEvent({ kind: "storm", tick, label: "inicio", importance: 6, tags: ["tormenta", "cielo"] }));
        this.stormDamage();
        break;
      case "storm_end":
        this.events.push(makeEvent({ kind: "storm", tick, label: "fin", importance: 2, tags: ["tormenta"] }));
        break;
      case "drought_start":
        this.events.push(makeEvent({ kind: "drought", tick, label: "inicio", importance: 6, data: { days: ce.days }, tags: ["sequia", "hambre", "cielo"] }));
        break;
      case "drought_end":
        this.events.push(makeEvent({ kind: "drought", tick, label: "fin", importance: 3, tags: ["sequia", "lluvia"] }));
        break;
      case "weather":
        this.events.push(makeEvent({ kind: "weather", tick, label: ce.weather, importance: 1, persist: false }));
        break;
    }
  }

  private stormDamage(): void {
    const s = this.s;
    const rng = s.rng.get("climate");
    for (const st of s.structures.values()) {
      if (st.kind === "fogata" && st.lit) {
        st.lit = false;
        st.fuel = 0;
        st.lastChangeTick = s.tick;
        s.shelterDirty = true;
        this.structuresChanged.add(st.id);
        this.events.push(makeEvent({ kind: "fire.out", tick: s.tick, x: st.x, y: st.y, importance: 2, data: { structureId: st.id }, persist: false }));
      } else if (st.progress >= 1 && rng.chance(0.2)) {
        st.hp -= 10;
        this.structuresChanged.add(st.id);
        if (st.hp <= 0) this.destroyStructure(st, "la tormenta");
      }
    }
  }

  destroyStructure(st: Structure, cause: string): void {
    const s = this.s;
    s.structures.delete(st.id);
    s.grid.structureAt[idx(s.grid.size, st.x, st.y)] = -1;
    this.removedStructures.push(st.id);
    s.shelterDirty = true;
    this.events.push(makeEvent({ kind: "structure.destroyed", tick: s.tick, x: st.x, y: st.y, label: `${st.kind} (${cause})`, importance: 5, data: { structureId: st.id, cause }, tags: ["perdida"] }));
    for (const id of s.alive) {
      const a = s.agents.get(id)!;
      if (a.home && a.home.x === st.x && a.home.y === st.y) a.home = null;
    }
  }

  private burnFires(): void {
    const s = this.s;
    const rain = s.climate.weather === "lluvia" || s.climate.weather === "nieve";
    const staleAfter = s.config.time.ticksPerDay;
    const toRemove: Structure[] = [];
    for (const st of s.structures.values()) {
      if (st.kind === "fogata" && !st.lit && s.tick - st.lastChangeTick > staleAfter) {
        toRemove.push(st);
        continue;
      }
      if (!st.lit) continue;
      st.fuel -= rain ? 2 : 1;
      if (st.fuel <= 0) {
        st.lit = false;
        st.fuel = 0;
        st.lastChangeTick = s.tick;
        s.shelterDirty = true;
        this.structuresChanged.add(st.id);
        this.events.push(makeEvent({ kind: "fire.out", tick: s.tick, x: st.x, y: st.y, importance: 2, data: { structureId: st.id }, persist: false }));
      }
    }
    // las cenizas frías desaparecen en silencio
    for (const st of toRemove) {
      s.structures.delete(st.id);
      s.grid.structureAt[idx(s.grid.size, st.x, st.y)] = -1;
      this.removedStructures.push(st.id);
    }
  }

  private stepBody(a: Agent, tph: number, deaths: number[]): void {
    const s = this.s;
    const cfg = s.config;
    const needs = a.needs;
    const metab = 0.8 + 0.4 * a.genome.metabolismo;
    const verb = a.current?.verb;
    const working = verb === "recolectar" || verb === "juntar" || verb === "construir" || verb === "explorar" || verb === "huir" || verb === "cazar";
    const activity = a.asleep ? 0.5 : working ? 1.4 : 1;
    const d = cfg.needs.decay;
    needs.sed = clamp01(needs.sed - d.sed * metab * activity);
    needs.hambre = clamp01(needs.hambre - d.hambre * metab * activity);
    const { warmth, structure } = this.warmthAt(a.x, a.y);
    const inShelter = structure !== null && structure.kind !== "fogata";
    if (a.asleep) needs.descanso = clamp01(needs.descanso + cfg.needs.sleepRecoveryPerTick * (inShelter ? 1.3 : 1));
    else needs.descanso = clamp01(needs.descanso - d.descanso * (working ? 1.3 : 1));
    // calor
    const elev = s.grid.elevation[idx(s.grid.size, a.x, a.y)]!;
    let tEff = cellTemperature(s.climate.temperature, elev, cfg) + warmth;
    if (inv(a, "ropa") > 0) tEff += cfg.climate.clothingWarmth;
    if (a.asleep && inShelter) tEff += 2;
    const target = clamp01((tEff + 2) / (cfg.climate.comfortTemperature + 2));
    if (target < needs.calor) needs.calor = Math.max(target, needs.calor - d.calor * (s.climate.weather === "tormenta" ? 1.5 : 1));
    else needs.calor = Math.min(target, needs.calor + 0.03);
    needs.seguridad = clamp01(needs.seguridad + 0.002 * (inShelter ? 2 : 1));
    needs.social = clamp01(needs.social - d.social);
    needs.estima = clamp01(needs.estima - d.estima);
    needs.sentido = clamp01(needs.sentido - d.sentido);
    // salud
    let damage = 0;
    let cause: string | null = null;
    const vitals: Array<["sed" | "hambre" | "calor", string]> = [
      ["sed", "sed"],
      ["hambre", "hambre"],
      ["calor", "frío"],
    ];
    for (const [need, label] of vitals) {
      if (needs[need] <= 0) {
        damage += cfg.needs.damagePerHour[need] / tph;
        if (!cause) cause = label;
        if (s.tick - a.lastSufferingTick > tph * 12) {
          a.lastSufferingTick = s.tick;
          this.events.push(makeEvent({ kind: "agent.suffering", tick: s.tick, agentId: a.id, x: a.x, y: a.y, label, importance: 4, tags: [label, "sufrimiento"] }));
        }
      }
    }
    if (a.disease > 0) damage += 0.004 / tph;
    if (damage > 0) a.health -= damage;
    else if (a.health < 1 && needs.sed > 0.3 && needs.hambre > 0.3 && needs.calor > 0.3) {
      a.health = Math.min(1, a.health + cfg.needs.healPerHour / tph);
      if (a.injuries > 0) a.injuries = Math.max(0, a.injuries - cfg.needs.healPerHour / tph);
    }
    if (a.health <= 0) {
      if (!a.causeOfDeath) a.causeOfDeath = cause ?? (a.disease > 0 ? "enfermedad" : "heridas");
      deaths.push(a.id);
    }
  }

  /** Las granjas crecen solas, despacio, salvo en invierno. */
  private growFarms(): void {
    const s = this.s;
    if (s.clock.season === "invierno") return;
    const rate = 0.002 * s.config.resources.seasonFactor[s.clock.season] * (s.climate.drought ? 0.3 : 1);
    for (const st of s.structures.values()) {
      if (st.kind === "granja" && st.progress >= 1 && st.growth < 1) st.growth = Math.min(1, st.growth + rate);
    }
  }

  private perceive(a: Agent, scratch: number[]): Perception {
    const s = this.s;
    const r = s.config.social.perceptionRadius;
    const nearby = this.spatial.query(a.x, a.y, r, s.agents, scratch).filter((id) => id !== a.id);
    const adjacent: number[] = [];
    for (const id of nearby) {
      const o = s.agents.get(id)!;
      if (Math.abs(o.x - a.x) <= 1 && Math.abs(o.y - a.y) <= 1) adjacent.push(id);
    }
    const cellIdx = idx(s.grid.size, a.x, a.y);
    const { warmth, structure } = this.warmthAt(a.x, a.y);
    const danger = s.grid.danger[cellIdx]!;
    return {
      nearby,
      adjacent,
      tempHere: cellTemperature(s.climate.temperature, s.grid.elevation[cellIdx]!, s.config) + warmth,
      warmthHere: warmth,
      danger,
      cellIdx,
      structureHere: structure,
      threatX: danger > 0.25 ? a.x + (s.rng.get("s1").int(3) - 1) : null,
      threatY: danger > 0.25 ? a.y + (s.rng.get("s1").int(3) - 1) : null,
    };
  }

  private shouldWake(a: Agent, p: Perception): boolean {
    const n = a.needs;
    const c = this.s.clock;
    // de noche se duerme de corrido, salvo emergencia
    if (n.sed < 0.12 || n.hambre < 0.12 || n.calor < 0.1) return true;
    if (p.danger > 0.5) return true;
    if (!c.isDay) return false;
    if (n.descanso >= 0.98) return true;
    if (c.hour >= this.s.config.time.dawnHour && n.descanso > 0.6) return true;
    return false;
  }

  /** Descubrimiento accidental del fuego y aprendizaje por observación. */
  private serendipity(a: Agent): void {
    const s = this.s;
    const rng = s.rng.get("life");
    if (!a.knows.has("fuego")) {
      const verb = a.current?.verb;
      if ((verb === "juntar" || verb === "recolectar") && rng.chance(0.0008 * (0.3 + a.genome.curiosidad))) {
        this.learn(a, "fuego", "por accidente, frotando madera");
        return;
      }
      const { structure } = this.warmthAt(a.x, a.y);
      if (structure && structure.kind === "fogata" && structure.lit && rng.chance(0.04 * (0.5 + a.genome.inteligencia))) {
        this.learn(a, "fuego", "observando un fuego encendido");
      }
    }
  }

  learn(a: Agent, tech: string, how: string): void {
    if (a.knows.has(tech)) return;
    a.knows.add(tech);
    const first = !this.s.milestones.has(`tech:${tech}`);
    this.events.push(
      makeEvent({
        kind: "discovery",
        tick: this.s.tick,
        agentId: a.id,
        x: a.x,
        y: a.y,
        label: tech,
        importance: first ? 9 : 5,
        data: { how, first },
        tags: ["descubrimiento", tech],
      }),
    );
  }

  kill(id: number): void {
    const s = this.s;
    const a = s.agents.get(id);
    if (!a || a.diedTick !== null) return;
    a.diedTick = s.tick;
    a.asleep = false;
    a.current = null;
    a.conversingUntil = -1;
    a.conversingWith = null;
    dropDeadHolder(s, id);
    if (a.bondedTo !== null) {
      const partner = s.agents.get(a.bondedTo);
      if (partner && partner.bondedTo === id) partner.bondedTo = null;
    }
    s.alive = s.alive.filter((v) => v !== id);
    const i = idx(s.grid.size, a.x, a.y);
    if (s.grid.occupants[i]! > 0) s.grid.occupants[i] = s.grid.occupants[i]! - 1;
    // sus pertenencias quedan en el lugar
    for (const r of RESOURCES) {
      const n = a.inventory.get(r as ResourceKind) ?? 0;
      if (n > 0) {
        s.grid.resources[r][i] = s.grid.resources[r][i]! + n;
        this.resourceChanged.add(i);
      }
    }
    s.today.deaths++;
    s.totals.deaths++;
    this.events.push(
      makeEvent({
        kind: "agent.died",
        tick: s.tick,
        agentId: id,
        x: a.x,
        y: a.y,
        label: a.causeOfDeath ?? "causas desconocidas",
        importance: 8,
        data: { age: this.ageYears(a) },
        tags: ["muerte", a.causeOfDeath ?? "muerte"],
      }),
    );
    this.rebuildSpatial();
    // la muerte se presencia: la registran los vecinos en este mismo tick
    recordObservations(s, [this.events[this.events.length - 1]!], this.spatial, this.names);
  }

  ageYears(a: Agent): number {
    const cfg = this.s.config;
    return (this.s.tick - a.bornTick) / (cfg.time.ticksPerDay * cfg.time.daysPerSeason * cfg.time.seasonsPerYear);
  }

  get grid(): WorldGrid {
    return this.s.grid;
  }
}
