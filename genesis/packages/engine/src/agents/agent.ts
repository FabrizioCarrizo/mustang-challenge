import type { ItemKind, LifeStage, ResourceKind, Sex, StructureKind, Verb } from "@genesis/protocol";
import type { GenesisConfig } from "../config.ts";
import type { Rng } from "../rng.ts";
import { ageYears } from "../sim/clock.ts";
import { randomGenome, type Genome } from "./genome.ts";
import { generateName } from "./naming.ts";
import { initialNeeds, type Needs } from "./needs.ts";

export interface Relationship {
  trust: number;
  affinity: number;
  debt: number;
  kinship: number;
  familiarity: number;
  label: string | null;
  lastTick: number;
  interactions: number;
}

export interface CurrentAction {
  verb: Verb;
  targetX: number | null;
  targetY: number | null;
  targetId: number | null;
  resource: ResourceKind | null;
  structureKind: StructureKind | null;
  item: ItemKind | null;
  amount: number;
  ticksLeft: number;
  startedTick: number;
  progress: number;
  reason: string;
  fromPlan: boolean;
  /** rumbo persistente para explorar */
  heading: number;
}

export interface PlanStep {
  verbo: Verb;
  objetivo: string;
  objetivoTipo: string;
  targetId: number | null;
  targetX: number | null;
  targetY: number | null;
  cantidad: number | null;
  hastaHora: number | null;
  prioridad: number;
  motivo: string;
  done: boolean;
  attempts: number;
  /** cantidad del ítem al empezar el paso (para saber si juntó lo pedido) */
  startAmount: number | null;
}

export interface Memory {
  id: number;
  tick: number;
  kind: "observacion" | "dialogo" | "reflexion" | "creencia" | "diario" | "sueño" | "resumen" | "texto" | "voz_divina";
  text: string;
  importance: number;
  tags: string[];
  refs: number[];
}

export interface Agent {
  id: number;
  name: string;
  sex: Sex;
  bornTick: number;
  diedTick: number | null;
  causeOfDeath: string | null;
  x: number;
  y: number;
  genome: Genome;
  needs: Needs;
  health: number;
  injuries: number;
  disease: number;
  pregnantUntil: number | null;
  pregnantBy: number | null;
  asleep: boolean;
  inventory: Map<ItemKind, number>;
  relationships: Map<number, Relationship>;
  current: CurrentAction | null;
  plan: PlanStep[];
  planTick: number;
  mood: string | null;
  knows: Set<string>;
  culturalGenome: string;
  groupId: number | null;
  home: { x: number; y: number } | null;
  /** estructura que está construyendo (sin terminar) */
  buildingId: number | null;
  parents: [number | null, number | null];
  children: number[];
  bondedTo: number | null;
  memories: Memory[];
  beliefs: Map<number, number>;
  /** contadores diarios y de estado interno */
  dialoguesToday: number;
  callsToday: number;
  tokensToday: number;
  usdToday: number;
  lastPlanDay: number;
  lastReflectionTick: number;
  importanceSinceReflection: number;
  lastDialogueTick: number;
  lastAteTick: number;
  lastDrankTick: number;
  lastSufferingTick: number;
  stuckTicks: number;
  lastX: number;
  lastY: number;
  moveBudget: number;
  /** eventos vividos hoy (para la reflexión y el diario) */
  diaryPending: string[];
  /** conteo de veces que hizo cada verbo (para "primera vez") */
  firsts: Set<string>;
  lastSpeech: string | null;
  lastSpeechTick: number;
  /** ficha estable cacheada por día (System 2) */
  cardCache: { day: number; text: string } | null;
  /** seres con los que quiere hablar hoy (ids) */
  socialWishes: number[];
  conversingWith: number | null;
  conversingUntil: number;
  /** tick de la última charla con cada ser */
  lastDialogueWith: Map<number, number>;
  intention: string | null;
  reactionsToday: number;
  createdToday: number;
  reflectedThisSleep: boolean;
  /** número de pedidos System 2 en cola o en vuelo para este ser */
  pendingThoughts: number;
  lastAttackedBy: number | null;
  lastAttackedTick: number;
}

export function createAgent(
  id: number,
  tick: number,
  x: number,
  y: number,
  rng: Rng,
  taken: Set<string>,
  overrides: Partial<Agent> = {},
): Agent {
  const sex: Sex = overrides.sex ?? (rng.chance(0.5) ? "f" : "m");
  const genome = overrides.genome ?? randomGenome(rng);
  return {
    id,
    name: overrides.name ?? generateName(rng, sex, taken),
    sex,
    bornTick: overrides.bornTick ?? tick,
    diedTick: null,
    causeOfDeath: null,
    x,
    y,
    genome,
    needs: initialNeeds(),
    health: 1,
    injuries: 0,
    disease: 0,
    pregnantUntil: null,
    pregnantBy: null,
    asleep: false,
    inventory: new Map(),
    relationships: new Map(),
    current: null,
    plan: [],
    planTick: -1,
    mood: null,
    knows: new Set(overrides.knows ?? ["refugio"]),
    culturalGenome: overrides.culturalGenome ?? "",
    groupId: null,
    home: null,
    buildingId: null,
    parents: overrides.parents ?? [null, null],
    children: [],
    bondedTo: null,
    memories: [],
    beliefs: new Map(),
    dialoguesToday: 0,
    callsToday: 0,
    tokensToday: 0,
    usdToday: 0,
    lastPlanDay: -1,
    lastReflectionTick: tick,
    importanceSinceReflection: 0,
    lastDialogueTick: -1000,
    lastAteTick: tick,
    lastDrankTick: tick,
    lastSufferingTick: -1000,
    stuckTicks: 0,
    lastX: x,
    lastY: y,
    moveBudget: 0,
    diaryPending: [],
    firsts: new Set(),
    lastSpeech: null,
    lastSpeechTick: -1,
    cardCache: null,
    socialWishes: [],
    conversingWith: null,
    conversingUntil: -1,
    lastDialogueWith: new Map(),
    intention: null,
    reactionsToday: 0,
    createdToday: 0,
    reflectedThisSleep: false,
    pendingThoughts: 0,
    lastAttackedBy: null,
    lastAttackedTick: -1000,
  };
}

export function isAlive(a: Agent): boolean {
  return a.diedTick === null;
}

export function inv(a: Agent, item: ItemKind): number {
  return a.inventory.get(item) ?? 0;
}

export function addItem(a: Agent, item: ItemKind, n: number): void {
  const cur = a.inventory.get(item) ?? 0;
  const next = cur + n;
  if (next <= 1e-9) a.inventory.delete(item);
  else a.inventory.set(item, next);
}

export function takeItem(a: Agent, item: ItemKind, n: number): number {
  const cur = a.inventory.get(item) ?? 0;
  const taken = Math.min(cur, n);
  addItem(a, item, -taken);
  return taken;
}

export function inventoryWeight(a: Agent): number {
  let w = 0;
  for (const [, n] of a.inventory) w += n;
  return w;
}

export function carryCapacity(a: Agent): number {
  return 12 + Math.round(a.genome.fuerza * 12);
}

export function relationship(a: Agent, otherId: number, tick: number): Relationship {
  let r = a.relationships.get(otherId);
  if (!r) {
    r = { trust: 0.3, affinity: 0, debt: 0, kinship: 0, familiarity: 0, label: null, lastTick: tick, interactions: 0 };
    a.relationships.set(otherId, r);
  }
  return r;
}

export function adjustRelationship(
  a: Agent,
  otherId: number,
  tick: number,
  delta: { trust?: number; affinity?: number; debt?: number; familiarity?: number },
): Relationship {
  const r = relationship(a, otherId, tick);
  if (delta.trust) r.trust = Math.min(1, Math.max(0, r.trust + delta.trust));
  if (delta.affinity) r.affinity = Math.min(1, Math.max(-1, r.affinity + delta.affinity));
  if (delta.debt) r.debt += delta.debt;
  if (delta.familiarity) r.familiarity = Math.min(1, r.familiarity + delta.familiarity);
  r.lastTick = tick;
  r.interactions++;
  return r;
}

export function lifeStage(a: Agent, tick: number, cfg: GenesisConfig): LifeStage {
  const age = ageYears(a.bornTick, tick, cfg);
  if (age < cfg.life.adultAgeYears * 0.6) return "infancia";
  if (age < cfg.life.adultAgeYears) return "juventud";
  if (age < cfg.life.elderAgeYears) return "adultez";
  return "vejez";
}

export function isAdult(a: Agent, tick: number, cfg: GenesisConfig): boolean {
  return ageYears(a.bornTick, tick, cfg) >= cfg.life.adultAgeYears;
}

/** Memoria de trabajo acotada (anillo de 200). */
export const WORKING_MEMORY_LIMIT = 200;

export function pushMemory(a: Agent, m: Memory): void {
  a.memories.push(m);
  a.importanceSinceReflection += m.importance;
  if (a.memories.length > WORKING_MEMORY_LIMIT) {
    // conserva las más importantes entre las viejas, descarta las triviales
    a.memories.sort((p, q) => p.tick - q.tick);
    const cut = a.memories.length - WORKING_MEMORY_LIMIT;
    const old = a.memories.slice(0, cut * 2);
    const keep = old.filter((m) => m.importance >= 6).slice(-cut);
    a.memories = keep.concat(a.memories.slice(cut * 2));
  }
}

export function resetDailyCounters(a: Agent): void {
  a.dialoguesToday = 0;
  a.callsToday = 0;
  a.tokensToday = 0;
  a.usdToday = 0;
  a.reactionsToday = 0;
  a.createdToday = 0;
  a.socialWishes = [];
}

/** Crea una memoria y la deja pendiente de persistir. */
export function remember(
  s: { counters: { memory: number }; pendingMemories: Array<{ agentId: number; memory: Memory }>; tick: number },
  a: Agent,
  kind: Memory["kind"],
  text: string,
  importance: number,
  tags: string[] = [],
  refs: number[] = [],
): Memory {
  const m: Memory = { id: s.counters.memory++, tick: s.tick, kind, text, importance: Math.max(0, Math.min(10, importance)), tags, refs };
  pushMemory(a, m);
  s.pendingMemories.push({ agentId: a.id, memory: m });
  return m;
}
