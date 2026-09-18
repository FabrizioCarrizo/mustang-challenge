import type {
  ItemKind,
  Need,
  ResourceKind,
  Season,
  Sex,
  StructureKind,
  Trait,
  Weather,
} from "./enums.ts";

export interface ClockInfo {
  tick: number;
  minuteOfDay: number;
  hour: number;
  day: number;
  dayOfSeason: number;
  seasonIndex: number;
  season: Season;
  year: number;
  dayOfYear: number;
  isDay: boolean;
  daylight: number;
}

export interface ClimateInfo {
  temperature: number;
  weather: Weather;
  drought: boolean;
}

export interface WorldInfo {
  name: string;
  seed: number;
  size: number;
  createdTick: number;
  ticksPerDay: number;
  daysPerSeason: number;
  seasonsPerYear: number;
}

export type AgentStatus =
  | "activo"
  | "durmiendo"
  | "conversando"
  | "peleando"
  | "herido"
  | "enfermo"
  | "muerto";

export interface AgentSummary {
  id: number;
  name: string;
  sex: Sex;
  x: number;
  y: number;
  st: AgentStatus;
  /** verbo actual */
  act: string;
  g: number | null;
  /** edad en años simulados */
  age: number;
  hp: number;
  alive: boolean;
}

export interface RelationshipInfo {
  id: number;
  name: string;
  trust: number;
  affinity: number;
  debt: number;
  kinship: number;
  familiarity: number;
  label: string | null;
}

export interface PlanStepInfo {
  verbo: string;
  objetivo: string;
  prioridad: number;
  done: boolean;
}

export interface AgentDetail extends AgentSummary {
  needs: Record<Need, number>;
  traits: Record<Trait, number>;
  inventory: Partial<Record<ItemKind, number>>;
  health: number;
  injuries: number;
  disease: number;
  pregnant: boolean;
  bornTick: number;
  diedTick: number | null;
  causeOfDeath: string | null;
  home: { x: number; y: number } | null;
  current: string | null;
  plan: PlanStepInfo[];
  mood: string | null;
  relationships: RelationshipInfo[];
  knows: string[];
  culturalGenome: string;
  parents: [number | null, number | null];
  children: number[];
  groupName: string | null;
  lifeStage: string;
}

export interface StructureInfo {
  id: number;
  kind: StructureKind;
  x: number;
  y: number;
  ownerId: number | null;
  groupId: number | null;
  progress: number;
  hp: number;
  dedication: string | null;
  lit: boolean;
}

export interface GroupInfo {
  id: number;
  name: string;
  members: number[];
  leaderId: number | null;
  foundedTick: number;
  color: string;
  home: { x: number; y: number } | null;
}

export interface MilestoneInfo {
  id: number;
  tick: number;
  key: string;
  title: string;
  description: string;
  agentIds: number[];
  epoch: string | null;
}

export interface MetricsPoint {
  tick: number;
  population: number;
  births: number;
  deaths: number;
  violence: number;
  trades: number;
  gini: number;
  avgNeeds: Record<Need, number>;
  usd: number;
  llmCalls: number;
  groups: number;
  beliefs: number;
  techs: number;
}

export interface BudgetInfo {
  usdToday: number;
  usdTotal: number;
  usdPerSimDay: number;
  usdPerRealHour: number;
  usdTotalCap: number;
  inFlight: number;
  queued: number;
  mode: "none" | "mock" | "claude" | "ollama" | "mute" | "replay";
  cacheHitRate: number;
}

export interface PacingInfo {
  paused: boolean;
  multiplier: number;
  simDayRealSeconds: number;
  preset: string;
  measuredTicksPerSecond: number;
}

export interface EventInfo {
  seq: number;
  tick: number;
  kind: string;
  importance: number;
  text: string;
  agentId: number | null;
  targetId: number | null;
  x: number | null;
  y: number | null;
}

export interface SpeechInfo {
  agentId: number;
  text: string;
  tick: number;
}

export interface MemoryInfo {
  id: number;
  tick: number;
  kind: string;
  text: string;
  importance: number;
  tags: string[];
}

export interface ConversationInfo {
  id: number;
  tick: number;
  aId: number;
  bId: number;
  aName: string;
  bName: string;
  turns: Array<{ speaker: "A" | "B"; text: string }>;
  outcomes: Array<{ tipo: string; detalle: string }>;
}

export interface LlmCallInfo {
  id: number;
  tick: number;
  callType: string;
  model: string;
  status: string;
  usd: number;
  inTokens: number;
  cacheRead: number;
  outTokens: number;
  latencyMs: number;
  volatileText: string | null;
  responseJson: string | null;
}

export interface BeliefInfo {
  id: number;
  statement: string;
  kind: string;
  founderId: number | null;
  founderName: string | null;
  tick: number;
  adherents: number;
  religion: boolean;
}

export interface LawInfo {
  id: number;
  groupId: number;
  groupName: string;
  declarerId: number;
  declarerName: string;
  tick: number;
  statement: string;
  prohibits: string[];
  punishment: string;
  active: boolean;
  enforcements: number;
}

export interface TechInfo {
  id: string;
  name: string;
  requires: string[];
  discoveredTick: number | null;
  discovererId: number | null;
  knownBy: number;
}

export interface TextInfo {
  id: number;
  authorId: number | null;
  authorName: string;
  tick: number;
  title: string;
  body: string;
  medium: string;
  kind: string;
  reads: number;
}

export interface EconomyInfo {
  currency: string | null;
  currencySinceTick: number | null;
  prices: Array<{ good: string; price: number }>;
  cpi: number;
  gini: number;
  tradesLast7Days: number;
  giftsLast7Days: number;
  topHolders: Array<{ id: number; name: string; wealth: number }>;
}

export interface ChronicleChapter {
  id: number;
  tickFrom: number;
  tickTo: number;
  title: string;
  body: string;
  kind: string;
  themes: string[];
  protagonists: string[];
}

export interface CostInfo {
  totalUsd: number;
  calls: number;
  inTokens: number;
  cacheRead: number;
  outTokens: number;
  cacheHitRate: number;
  usdPerSimDay: number;
  byType: Array<{ callType: string; calls: number; usd: number }>;
}

export interface SnapshotListItem {
  tick: number;
  bytes: number;
  agents: number;
  hash: string;
  createdAt: string;
}

export interface SnapshotMessage {
  t: "snapshot";
  world: WorldInfo;
  clock: ClockInfo;
  climate: ClimateInfo;
  /** base64 de Uint8Array, un byte por celda */
  terrain: string;
  /** base64 de Uint8Array cuantizado 0..255 por recurso */
  resources: Record<ResourceKind, string>;
  structures: StructureInfo[];
  agents: AgentSummary[];
  groups: GroupInfo[];
  milestones: MilestoneInfo[];
  metrics: MetricsPoint[];
  budget: BudgetInfo;
  pacing: PacingInfo;
  epoch: string;
}

export interface DeltaMessage {
  t: "delta";
  tick: number;
  clock: ClockInfo;
  climate: ClimateInfo;
  agents: AgentSummary[];
  removed: number[];
  /** [índice de celda, recurso, valor 0..255] */
  resources: Array<[number, ResourceKind, number]>;
  structures: StructureInfo[];
  removedStructures: number[];
  events: EventInfo[];
  speech: SpeechInfo[];
  metrics: MetricsPoint | null;
  groups: GroupInfo[] | null;
  milestones: MilestoneInfo[];
  focus: AgentDetail | null;
  budget: BudgetInfo;
  pacing: PacingInfo;
  epoch: string | null;
}

export type ServerMessage =
  | SnapshotMessage
  | DeltaMessage
  | { t: "pong" }
  | { t: "notice"; level: "info" | "warn" | "error"; text: string }
  | { t: "error"; message: string };

export type GodAction =
  | { kind: "whisper"; agentId: number; text: string }
  | { kind: "spawn_resource"; x: number; y: number; resource: ResourceKind; amount: number; radius: number }
  | { kind: "disaster"; type: "tormenta" | "sequia" | "plaga" | "terremoto" | "eclipse" | "diluvio"; x?: number; y?: number }
  | { kind: "weather"; weather: Weather; days: number }
  | { kind: "resurrect"; agentId: number }
  | { kind: "prophet"; agentId: number; revelation: string }
  | { kind: "teleport"; agentId: number; x: number; y: number }
  | { kind: "heal"; agentId: number }
  | { kind: "smite"; agentId: number }
  | { kind: "spawn_agent"; x: number; y: number; count: number };

export type ClientMessage =
  | { t: "hello" }
  | { t: "ping" }
  | { t: "control"; action: "pause" | "play" | "speed" | "preset"; value?: number | string }
  | { t: "god"; action: GodAction }
  | { t: "subscribe"; agentId: number | null }
  | { t: "replay"; toTick: number | null };
