import type { Agent, Memory } from "../agents/agent.ts";
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
}

export function emptyDayStats(): DayStats {
  return { births: 0, deaths: 0, violence: 0, trades: 0, gifts: 0, dialogues: 0, llmCalls: 0, usd: 0 };
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
}
