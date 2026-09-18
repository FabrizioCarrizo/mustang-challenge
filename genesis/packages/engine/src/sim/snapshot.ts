import { RESOURCES, type ResourceKind } from "@genesis/protocol";
import type { Agent, Memory, Relationship, CurrentAction, PlanStep } from "../agents/agent.ts";
import { loadConfig, type GenesisConfig } from "../config.ts";
import { RngStreams, type RngState } from "../rng.ts";
import type { ClimateState } from "../world/climate.ts";
import { createGrid, idx } from "../world/grid.ts";
import { recomputeResourceFields } from "../world/resources.ts";
import type { Structure } from "../world/structures.ts";
import { computeClock } from "./clock.ts";
import type { Counters, DayStats, EngineState } from "./state.ts";

export const SNAPSHOT_VERSION = 1;

interface SerializedAgent extends Omit<Agent, "inventory" | "relationships" | "knows" | "beliefs" | "firsts" | "memories"> {
  inventory: Array<[string, number]>;
  relationships: Array<[number, Relationship]>;
  knows: string[];
  beliefs: Array<[number, number]>;
  firsts: string[];
  memories: Memory[];
}

interface SerializedStructure extends Omit<Structure, "contents"> {
  contents: Array<[string, number]>;
}

export interface SnapshotData {
  version: number;
  tick: number;
  seed: number;
  worldName: string;
  config: GenesisConfig;
  climate: ClimateState;
  grid: {
    size: number;
    terrain: string;
    elevation: string;
    moisture: string;
    fertility: string;
    resources: Record<ResourceKind, string>;
    resourceMax: Record<ResourceKind, string>;
    structureAt: string;
    owner: string;
    danger: string;
  };
  agents: SerializedAgent[];
  structures: SerializedStructure[];
  counters: Counters;
  rng: Record<string, RngState>;
  today: DayStats;
  totals: EngineState["totals"];
  takenNames: string[];
  epoch: string;
  milestones: Array<[string, number]>;
  lastFieldTick: number;
}

function b64(arr: Uint8Array | Float32Array | Int32Array | Uint16Array): string {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString("base64");
}

function fromB64Uint8(s: string, n: number): Uint8Array {
  const buf = Buffer.from(s, "base64");
  const out = new Uint8Array(n);
  out.set(buf.subarray(0, n));
  return out;
}

function fromB64Float32(s: string, n: number): Float32Array {
  const buf = Buffer.from(s, "base64");
  const out = new Float32Array(n);
  const view = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  out.set(view.subarray(0, n));
  return out;
}

function fromB64Int32(s: string, n: number): Int32Array {
  const buf = Buffer.from(s, "base64");
  const out = new Int32Array(n);
  const view = new Int32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  out.set(view.subarray(0, n));
  return out;
}

export function serializeAgent(a: Agent): SerializedAgent {
  return {
    ...a,
    inventory: [...a.inventory.entries()],
    relationships: [...a.relationships.entries()].map(([k, v]) => [k, { ...v }]),
    knows: [...a.knows],
    beliefs: [...a.beliefs.entries()],
    firsts: [...a.firsts],
    memories: a.memories.map((m) => ({ ...m, tags: m.tags.slice(), refs: m.refs.slice() })),
    current: a.current ? ({ ...a.current } as CurrentAction) : null,
    plan: a.plan.map((p) => ({ ...p }) as PlanStep),
    home: a.home ? { ...a.home } : null,
    parents: [a.parents[0], a.parents[1]],
    children: a.children.slice(),
    diaryPending: a.diaryPending.slice(),
    genome: { ...a.genome },
    needs: { ...a.needs },
  };
}

export function deserializeAgent(d: SerializedAgent): Agent {
  return {
    ...d,
    inventory: new Map(d.inventory as Array<[never, number]>),
    relationships: new Map(d.relationships),
    knows: new Set(d.knows),
    beliefs: new Map(d.beliefs),
    firsts: new Set(d.firsts),
    memories: d.memories.map((m) => ({ ...m })),
    current: d.current ? { ...d.current } : null,
    plan: d.plan.map((p) => ({ ...p })),
    home: d.home ? { ...d.home } : null,
    parents: [d.parents[0], d.parents[1]],
    children: d.children.slice(),
    diaryPending: d.diaryPending.slice(),
    genome: { ...d.genome },
    needs: { ...d.needs },
  };
}

export function serializeState(s: EngineState): SnapshotData {
  const g = s.grid;
  const resources = {} as Record<ResourceKind, string>;
  const resourceMax = {} as Record<ResourceKind, string>;
  for (const r of RESOURCES) {
    resources[r] = b64(g.resources[r]);
    resourceMax[r] = b64(g.resourceMax[r]);
  }
  return {
    version: SNAPSHOT_VERSION,
    tick: s.tick,
    seed: s.seed,
    worldName: s.worldName,
    config: s.config,
    climate: { ...s.climate, forcedWeather: s.climate.forcedWeather ? { ...s.climate.forcedWeather } : null },
    grid: {
      size: g.size,
      terrain: b64(g.terrain),
      elevation: b64(g.elevation),
      moisture: b64(g.moisture),
      fertility: b64(g.fertility),
      resources,
      resourceMax,
      structureAt: b64(g.structureAt),
      owner: b64(g.owner),
      danger: b64(g.danger),
    },
    agents: [...s.agents.values()].map(serializeAgent),
    structures: [...s.structures.values()].map((st) => ({ ...st, contents: [...st.contents.entries()] })),
    counters: { ...s.counters },
    rng: s.rng.state(),
    today: { ...s.today },
    totals: { ...s.totals },
    takenNames: [...s.takenNames],
    epoch: s.epoch,
    milestones: [...s.milestones.entries()],
    lastFieldTick: s.lastFieldTick,
  };
}

export function deserializeState(d: SnapshotData): EngineState {
  if (d.version !== SNAPSHOT_VERSION) throw new Error(`Snapshot de versión ${d.version}, se esperaba ${SNAPSHOT_VERSION}`);
  const config = loadConfig(d.config);
  const size = d.grid.size;
  const n = size * size;
  const grid = createGrid(size);
  grid.terrain = fromB64Uint8(d.grid.terrain, n);
  grid.elevation = fromB64Uint8(d.grid.elevation, n);
  grid.moisture = fromB64Uint8(d.grid.moisture, n);
  grid.fertility = fromB64Uint8(d.grid.fertility, n);
  for (const r of RESOURCES) {
    grid.resources[r] = fromB64Float32(d.grid.resources[r], n);
    grid.resourceMax[r] = fromB64Float32(d.grid.resourceMax[r], n);
  }
  grid.structureAt = fromB64Int32(d.grid.structureAt, n);
  grid.owner = fromB64Int32(d.grid.owner, n);
  grid.danger = fromB64Float32(d.grid.danger, n);
  const agents = new Map<number, Agent>();
  const alive: number[] = [];
  for (const sa of d.agents) {
    const a = deserializeAgent(sa);
    agents.set(a.id, a);
    if (a.diedTick === null) {
      alive.push(a.id);
      const i = idx(size, a.x, a.y);
      grid.occupants[i] = Math.min(255, grid.occupants[i]! + 1);
    }
  }
  alive.sort((a, b) => a - b);
  const structures = new Map<number, Structure>();
  for (const ss of d.structures) structures.set(ss.id, { ...ss, contents: new Map(ss.contents as Array<[never, number]>) });
  const rng = new RngStreams(d.seed);
  rng.restore(d.rng);
  const state: EngineState = {
    config,
    seed: d.seed,
    worldName: d.worldName,
    tick: d.tick,
    clock: computeClock(d.tick, config),
    climate: { ...d.climate },
    grid,
    agents,
    alive,
    structures,
    counters: { ...d.counters },
    rng,
    today: { ...d.today },
    totals: { ...d.totals },
    lastFieldTick: d.lastFieldTick,
    shelterDirty: true,
    takenNames: new Set(d.takenNames),
    epoch: d.epoch,
    milestones: new Map(d.milestones),
    pendingMemories: [],
  };
  recomputeResourceFields(grid);
  return state;
}
