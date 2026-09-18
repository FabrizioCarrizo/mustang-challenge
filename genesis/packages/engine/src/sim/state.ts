import type { Agent, Memory } from "../agents/agent.ts";
import type { Belief } from "../society/beliefs.ts";
import type { GenesisConfig } from "../config.ts";
import type { RngStreams } from "../rng.ts";
import type { ClimateState } from "../world/climate.ts";
import type { WorldGrid } from "../world/grid.ts";
import type { Structure } from "../world/structures.ts";
import type { Clock } from "./clock.ts";

export interface Counters {
  agent: number;
  structure: number;
  memory: number;
  group: number;
  belief: number;
  text: number;
  milestone: number;
  request: number;
}

export interface DayStats {
  births: number;
  deaths: number;
  violence: number;
  trades: number;
  gifts: number;
  dialogues: number;
  llmCalls: number;
  usd: number;
  /** unidades consumidas por ítem (comer, quemar, construir, fabricar) */
  consumed: Record<string, number>;
}

export function emptyDayStats(): DayStats {
  return { births: 0, deaths: 0, violence: 0, trades: 0, gifts: 0, dialogues: 0, llmCalls: 0, usd: 0, consumed: {} };
}

export interface TextRecord {
  id: number;
  authorId: number | null;
  tick: number;
  title: string;
  body: string;
  /** oral: solo en la memoria de quien lo oyó; tallado: corto, en un lugar; escrito: persiste y se lee */
  medium: "oral" | "tallado" | "escrito" | "objeto";
  kind: string;
  techIds: string[];
  beliefId: number | null;
  x: number;
  y: number;
  holderId: number | null;
  reads: number;
}

export interface EngineState {
  config: GenesisConfig;
  seed: number;
  worldName: string;
  tick: number;
  clock: Clock;
  climate: ClimateState;
  grid: WorldGrid;
  agents: Map<number, Agent>;
  /** ids vivos, ordenados */
  alive: number[];
  structures: Map<number, Structure>;
  counters: Counters;
  rng: RngStreams;
  today: DayStats;
  /** estadísticas del día anterior completo */
  yesterday: DayStats;
  /** estadísticas acumuladas */
  totals: { births: number; deaths: number; violence: number; trades: number; usd: number; llmCalls: number };
  /** ticks en los que se completó el último recálculo de campos */
  lastFieldTick: number;
  shelterDirty: boolean;
  /** nombres ya usados */
  takenNames: Set<string>;
  /** época actual */
  epoch: string;
  /** hitos alcanzados (clave → tick) */
  milestones: Map<string, number>;
  /** memorias creadas en este tick, pendientes de persistir (transitorio) */
  pendingMemories: Array<{ agentId: number; memory: Memory }>;
  /** creencias del mundo */
  beliefs: Map<number, Belief>;
  /** textos y obras que existen en el mundo */
  texts: Map<number, TextRecord>;
}
