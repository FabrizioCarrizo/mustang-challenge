import type {
  AgentDetail,
  AgentSummary,
  BudgetInfo,
  ClimateInfo,
  ClockInfo,
  DeltaMessage,
  EventInfo,
  GroupInfo,
  MetricsPoint,
  MilestoneInfo,
  PacingInfo,
  ResourceKind,
  SnapshotListItem,
  SnapshotMessage,
  SpeechInfo,
  StructureInfo,
  WorldInfo,
} from "@genesis/protocol";
import { RESOURCES } from "@genesis/protocol";
import { create } from "zustand";
import { decodeBase64 } from "../lib/base64.ts";
import { DEFAULT_TICKS_PER_DAY } from "../lib/time.ts";
import { socket } from "../lib/ws.ts";

export type ConnectionState = "connecting" | "open" | "reconnecting";

export interface SpeechBubble extends SpeechInfo {
  /** performance.now() al recibirlo */
  at: number;
}

export const METRICS_RING = 2000;
export const EVENTS_RING = 300;
export const SPEECH_TTL_MS = 6500;

export interface WorldState {
  connection: ConnectionState;
  reconnectAttempt: number;
  /** ya llegó el primer snapshot */
  ready: boolean;
  world: WorldInfo | null;
  clock: ClockInfo | null;
  climate: ClimateInfo | null;
  tick: number;
  epoch: string;
  budget: BudgetInfo | null;
  pacing: PacingInfo | null;

  /** un byte por celda (índice en TERRAINS), fila mayor */
  terrain: Uint8Array | null;
  terrainVersion: number;
  /** por recurso, 0..255 relativo al máximo de la celda; se muta en el lugar */
  resources: Record<ResourceKind, Uint8Array> | null;
  resourcesVersion: number;
  /** parches del último delta (para que el render actualice solo esas celdas) */
  resourcePatches: Array<[number, ResourceKind, number]>;

  /** se muta en el lugar; `agentsVersion` avisa a quien renderiza */
  agents: Map<number, AgentSummary>;
  agentsVersion: number;
  /** id → tick en el que lo vimos morir (se conserva un día simulado) */
  deaths: Map<number, number>;
  structures: Map<number, StructureInfo>;
  structuresVersion: number;
  groups: GroupInfo[];
  groupColors: Map<number, string>;
  milestones: MilestoneInfo[];
  /** ordenadas por tick, ≤ METRICS_RING */
  metrics: MetricsPoint[];
  /** más nuevo primero, ≤ EVENTS_RING */
  events: EventInfo[];
  speech: Map<number, SpeechBubble>;
  speechVersion: number;
  /** detalle del ser suscripto (llega en cada delta) */
  focus: AgentDetail | null;
  lastDeltaAt: number;
  /** viendo el pasado: tick del snapshot de replay que se muestra */
  replayTick: number | null;
  /** replay pedido y todavía no recibido */
  replayPending: number | null;
  /** el último tick vivo conocido (sigue corriendo mientras vemos el pasado) */
  liveTick: number;
  /** snapshots diarios disponibles (para la barra de tiempo) */
  snapshots: SnapshotListItem[];

  setConnection(c: ConnectionState, attempt?: number): void;
  applySnapshot(m: SnapshotMessage): void;
  applyDelta(m: DeltaMessage, selectedId: number | null): void;
  mergeMetrics(points: MetricsPoint[]): void;
  mergeEvents(list: EventInfo[]): void;
  setMilestones(list: MilestoneInfo[]): void;
  setFocus(d: AgentDetail | null): void;
  setSnapshots(list: SnapshotListItem[]): void;
  /** pide al servidor una vista del pasado (o `null` para volver al presente) */
  requestReplay(toTick: number | null): void;
  /** el servidor no pudo reconstruir el pasado */
  cancelReplayRequest(): void;
}

export function isReplaying(s: Pick<WorldState, "replayTick" | "replayPending">): boolean {
  return s.replayTick !== null || s.replayPending !== null;
}

function emptyResources(): Record<ResourceKind, Uint8Array> {
  const out = {} as Record<ResourceKind, Uint8Array>;
  for (const r of RESOURCES) out[r] = new Uint8Array(0);
  return out;
}

function shallowEqual(a: Record<string, unknown> | null, b: Record<string, unknown>): boolean {
  if (!a) return false;
  for (const k in b) if (a[k] !== b[k]) return false;
  for (const k in a) if (!(k in b)) return false;
  return true;
}

/** Inserta puntos manteniendo orden por tick y sin duplicados. */
function mergeMetricPoints(current: MetricsPoint[], incoming: MetricsPoint[]): MetricsPoint[] {
  if (incoming.length === 0) return current;
  const lastTick = current.length ? current[current.length - 1]!.tick : -1;
  const sortedIncoming = incoming.slice().sort((a, b) => a.tick - b.tick);
  let out: MetricsPoint[];
  if (sortedIncoming[0]!.tick > lastTick) {
    out = current.concat(sortedIncoming);
  } else {
    const byTick = new Map<number, MetricsPoint>();
    for (const p of current) byTick.set(p.tick, p);
    for (const p of sortedIncoming) byTick.set(p.tick, p);
    out = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  }
  if (out.length > METRICS_RING) out = out.slice(out.length - METRICS_RING);
  return out;
}

/** Une listas de eventos (más nuevo primero) sin duplicar `seq`. */
function mergeEventLists(current: EventInfo[], incoming: EventInfo[]): EventInfo[] {
  if (incoming.length === 0) return current;
  const seen = new Set<number>();
  const all = incoming.concat(current).filter((e) => {
    if (seen.has(e.seq)) return false;
    seen.add(e.seq);
    return true;
  });
  all.sort((a, b) => b.seq - a.seq);
  return all.length > EVENTS_RING ? all.slice(0, EVENTS_RING) : all;
}

let focusTimer: number | null = null;
let pendingFocus: AgentDetail | null = null;
let lastFocusAt = 0;
const FOCUS_MIN_INTERVAL = 250;

export const useWorldStore = create<WorldState>()((set, get) => ({
  connection: "connecting",
  reconnectAttempt: 0,
  ready: false,
  world: null,
  clock: null,
  climate: null,
  tick: 0,
  epoch: "",
  budget: null,
  pacing: null,
  terrain: null,
  terrainVersion: 0,
  resources: null,
  resourcesVersion: 0,
  resourcePatches: [],
  agents: new Map(),
  agentsVersion: 0,
  deaths: new Map(),
  structures: new Map(),
  structuresVersion: 0,
  groups: [],
  groupColors: new Map(),
  milestones: [],
  metrics: [],
  events: [],
  speech: new Map(),
  speechVersion: 0,
  focus: null,
  lastDeltaAt: 0,
  replayTick: null,
  replayPending: null,
  liveTick: 0,
  snapshots: [],

  setConnection(connection, attempt = 0) {
    set({ connection, reconnectAttempt: attempt });
  },

  applySnapshot(m) {
    const s = get();
    const replayTick = m.replayTick ?? null;
    const terrain = decodeBase64(m.terrain);
    const resources = emptyResources();
    for (const r of RESOURCES) {
      const b64 = m.resources[r];
      resources[r] = b64 ? decodeBase64(b64) : new Uint8Array(terrain.length);
    }
    const agents = new Map<number, AgentSummary>();
    const deaths = new Map<number, number>();
    for (const a of m.agents) {
      agents.set(a.id, a);
      if (!a.alive) deaths.set(a.id, s.deaths.get(a.id) ?? m.clock.tick);
    }
    const structures = new Map<number, StructureInfo>();
    for (const st of m.structures) structures.set(st.id, st);
    const groupColors = new Map<number, string>();
    for (const g of m.groups) groupColors.set(g.id, g.color);
    s.speech.clear();
    set({
      ready: true,
      world: m.world,
      clock: m.clock,
      climate: m.climate,
      tick: m.clock.tick,
      liveTick: replayTick === null ? m.clock.tick : Math.max(s.liveTick, s.tick),
      epoch: m.epoch,
      budget: m.budget,
      pacing: m.pacing,
      terrain,
      terrainVersion: s.terrainVersion + 1,
      resources,
      resourcesVersion: s.resourcesVersion + 1,
      resourcePatches: [],
      agents,
      agentsVersion: s.agentsVersion + 1,
      deaths,
      structures,
      structuresVersion: s.structuresVersion + 1,
      groups: m.groups,
      groupColors,
      // en el pasado se muestran los hitos de entonces; en vivo, una lista vacía no borra nada
      milestones: replayTick !== null || m.milestones.length ? m.milestones : s.milestones,
      metrics: replayTick !== null ? s.metrics : mergeMetricPoints(s.metrics, m.metrics),
      speechVersion: s.speechVersion + 1,
      lastDeltaAt: performance.now(),
      replayTick,
      replayPending: null,
    });
  },

  applyDelta(m, selectedId) {
    const s = get();
    // viendo el pasado no llegan deltas; si alguno se cuela, no debe romper la vista congelada
    if (isReplaying(s)) {
      set({ liveTick: Math.max(s.liveTick, m.tick) });
      return;
    }
    const tpd = s.world?.ticksPerDay ?? DEFAULT_TICKS_PER_DAY;
    const patch: Partial<WorldState> = {
      tick: m.tick,
      liveTick: m.tick,
      clock: m.clock,
      climate: m.climate,
      lastDeltaAt: performance.now(),
    };
    if (!shallowEqual(s.budget as unknown as Record<string, unknown> | null, m.budget as unknown as Record<string, unknown>)) patch.budget = m.budget;
    if (!shallowEqual(s.pacing as unknown as Record<string, unknown> | null, m.pacing as unknown as Record<string, unknown>)) patch.pacing = m.pacing;

    // seres: se mutan en el lugar
    let agentsChanged = false;
    for (const a of m.agents) {
      s.agents.set(a.id, a);
      if (!a.alive && !s.deaths.has(a.id)) s.deaths.set(a.id, m.tick);
      agentsChanged = true;
    }
    for (const id of m.removed) {
      const a = s.agents.get(id);
      if (a && a.alive) {
        a.alive = false;
        a.st = "muerto";
      }
      if (!s.deaths.has(id)) s.deaths.set(id, m.tick);
      agentsChanged = true;
    }
    if (s.deaths.size) {
      for (const [id, t] of s.deaths) {
        if (m.tick - t > tpd) {
          s.deaths.delete(id);
          s.agents.delete(id);
          agentsChanged = true;
        }
      }
    }
    if (agentsChanged) patch.agentsVersion = s.agentsVersion + 1;

    // recursos: parches sobre los typed arrays
    if (m.resources.length && s.resources) {
      for (const [cell, kind, v] of m.resources) {
        const arr = s.resources[kind];
        if (arr && cell >= 0 && cell < arr.length) arr[cell] = v;
      }
      patch.resourcePatches = m.resources;
      patch.resourcesVersion = s.resourcesVersion + 1;
    }

    if (m.structures.length || m.removedStructures.length) {
      for (const st of m.structures) s.structures.set(st.id, st);
      for (const id of m.removedStructures) s.structures.delete(id);
      patch.structuresVersion = s.structuresVersion + 1;
    }

    if (m.events.length) patch.events = mergeEventLists(s.events, m.events.slice().reverse());

    if (m.speech.length || s.speech.size) {
      const now = performance.now();
      for (const sp of m.speech) s.speech.set(sp.agentId, { ...sp, at: now });
      for (const [id, b] of s.speech) if (now - b.at > SPEECH_TTL_MS + 1000) s.speech.delete(id);
      if (m.speech.length) patch.speechVersion = s.speechVersion + 1;
    }

    if (m.metrics) patch.metrics = mergeMetricPoints(s.metrics, [m.metrics]);

    if (m.groups) {
      patch.groups = m.groups;
      const groupColors = new Map<number, string>();
      for (const g of m.groups) groupColors.set(g.id, g.color);
      patch.groupColors = groupColors;
    }
    if (m.milestones.length) patch.milestones = m.milestones;
    if (m.epoch !== null && m.epoch !== s.epoch) patch.epoch = m.epoch;

    set(patch);

    if (m.focus && m.focus.id === selectedId) get().setFocus(m.focus);
  },

  mergeMetrics(points) {
    set({ metrics: mergeMetricPoints(get().metrics, points) });
  },

  mergeEvents(list) {
    set({ events: mergeEventLists(get().events, list) });
  },

  setMilestones(list) {
    set({ milestones: list });
  },

  setSnapshots(list) {
    set({ snapshots: list.slice().sort((a, b) => a.tick - b.tick) });
  },

  requestReplay(toTick) {
    const s = get();
    if (toTick === null) {
      if (!isReplaying(s)) return;
      set({ replayPending: null });
      socket.send({ t: "replay", toTick: null });
      return;
    }
    const target = Math.max(0, Math.min(s.liveTick, Math.floor(toTick)));
    set({ replayPending: target });
    socket.send({ t: "replay", toTick: target });
  },

  cancelReplayRequest() {
    if (get().replayPending !== null) set({ replayPending: null });
  },

  /** Limita el detalle a ~4 actualizaciones por segundo (llega en cada delta). */
  setFocus(d) {
    if (d === null) {
      pendingFocus = null;
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer);
        focusTimer = null;
      }
      set({ focus: null });
      return;
    }
    const now = performance.now();
    if (now - lastFocusAt >= FOCUS_MIN_INTERVAL) {
      lastFocusAt = now;
      set({ focus: d });
      return;
    }
    pendingFocus = d;
    if (focusTimer === null) {
      focusTimer = window.setTimeout(() => {
        focusTimer = null;
        if (pendingFocus) {
          lastFocusAt = performance.now();
          set({ focus: pendingFocus });
          pendingFocus = null;
        }
      }, FOCUS_MIN_INTERVAL - (now - lastFocusAt));
    }
  },
}));

/** Nombre de un ser conocido (o `#id`). */
export function agentName(id: number | null | undefined, agents = useWorldStore.getState().agents): string {
  if (id === null || id === undefined) return "—";
  return agents.get(id)?.name ?? `#${id}`;
}

export function countAlive(agents: Map<number, AgentSummary>): number {
  let n = 0;
  for (const a of agents.values()) if (a.alive) n++;
  return n;
}
