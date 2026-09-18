import { pushMemory, type Agent, type Memory } from "../agents/agent.ts";
import { clamp01 } from "../agents/needs.ts";
import { describeEvent, type NameResolver, type WorldEvent } from "../sim/events.ts";
import type { SpatialHash } from "../sim/spatial.ts";
import type { EngineState } from "../sim/state.ts";

const GLOBAL_KINDS = new Set(["season", "storm", "drought", "epoch", "milestone", "currency", "war", "treaty"]);
const MEMORY_MIN_IMPORTANCE = 3;

/**
 * Convierte los eventos del tick en observaciones (memorias) para los seres que
 * los presenciaron y aplica los choques de sentido y seguridad. Es física, no LLM.
 */
export function recordObservations(s: EngineState, events: WorldEvent[], spatial: SpatialHash, names: NameResolver): void {
  if (events.length === 0) return;
  const radius = s.config.social.perceptionRadius;
  const scratch: number[] = [];
  for (const e of events) {
    if (e.kind === "smalltalk" || e.kind === "state.hash" || e.kind === "intent" || e.kind === "thought") continue;
    if (e.importance < 2) continue;
    if (e.kind === "agent.first") {
      // solo el protagonista recuerda sus primeras veces
      const a = e.agentId !== null ? s.agents.get(e.agentId) : undefined;
      if (a && a.diedTick === null) {
        const m: Memory = {
          id: s.counters.memory++,
          tick: e.tick,
          kind: "observacion",
          text: describeEvent(e, names, a.id),
          importance: 3,
          tags: ["primera_vez"],
          refs: [],
        };
        pushMemory(a, m);
        s.pendingMemories.push({ agentId: a.id, memory: m });
      }
      continue;
    }
    const text = describeEvent(e, names);
    const global = GLOBAL_KINDS.has(e.kind) || (e.x === null && e.y === null);
    const witnesses: number[] = [];
    if (global) {
      for (const id of s.alive) witnesses.push(id);
    } else {
      spatial.query(e.x!, e.y!, radius, s.agents, scratch);
      for (const id of scratch) witnesses.push(id);
      if (e.agentId !== null && !witnesses.includes(e.agentId)) witnesses.push(e.agentId);
      if (e.targetId !== null && !witnesses.includes(e.targetId)) witnesses.push(e.targetId);
    }
    for (const id of witnesses) {
      const a = s.agents.get(id);
      if (!a || a.diedTick !== null) continue;
      if (a.asleep && !global && e.importance < 7) continue;
      const imp = witnessImportance(a, e);
      applyShocks(a, e, s);
      if (imp < MEMORY_MIN_IMPORTANCE) continue;
      const m: Memory = {
        id: s.counters.memory++,
        tick: e.tick,
        kind: "observacion",
        text: e.agentId === a.id ? describeEvent(e, names, a.id) : text,
        importance: imp,
        tags: e.tags.length ? e.tags.slice() : [e.kind],
        refs: [e.agentId ?? -1, e.targetId ?? -1].filter((v) => v >= 0),
      };
      pushMemory(a, m);
      s.pendingMemories.push({ agentId: a.id, memory: m });
      if (imp >= 5) a.diaryPending.push(m.text);
    }
  }
}

function isBonded(a: Agent, otherId: number | null): boolean {
  if (otherId === null) return false;
  if (a.bondedTo === otherId) return true;
  if (a.parents[0] === otherId || a.parents[1] === otherId) return true;
  if (a.children.includes(otherId)) return true;
  const r = a.relationships.get(otherId);
  return !!r && (r.kinship > 0 || r.affinity > 0.6);
}

function witnessImportance(a: Agent, e: WorldEvent): number {
  let imp = e.importance;
  const self = e.agentId === a.id;
  const target = e.targetId === a.id;
  if (target) imp += 1;
  if (!self && (isBonded(a, e.agentId) || isBonded(a, e.targetId))) imp += 2;
  const firstKey = `vio:${e.kind}`;
  if (!a.firsts.has(firstKey)) {
    a.firsts.add(firstKey);
    imp += 2;
  }
  return Math.min(10, imp);
}

function applyShocks(a: Agent, e: WorldEvent, s: EngineState): void {
  switch (e.kind) {
    case "agent.died": {
      if (e.agentId === a.id) return;
      const close = isBonded(a, e.agentId);
      a.needs.sentido = clamp01(a.needs.sentido - (close ? 0.4 : 0.15));
      a.needs.seguridad = clamp01(a.needs.seguridad - 0.1);
      break;
    }
    case "storm":
      if (e.label === "inicio") {
        const atHome = a.home && a.home.x === a.x && a.home.y === a.y;
        a.needs.sentido = clamp01(a.needs.sentido - (atHome ? 0.04 : 0.1));
        a.needs.seguridad = clamp01(a.needs.seguridad - (atHome ? 0.05 : 0.15));
      }
      break;
    case "drought":
      if (e.label === "inicio") a.needs.sentido = clamp01(a.needs.sentido - 0.1);
      break;
    case "attack":
      a.needs.seguridad = clamp01(a.needs.seguridad - (e.targetId === a.id ? 0.3 : 0.2));
      break;
    case "theft":
      if (e.targetId === a.id) a.needs.seguridad = clamp01(a.needs.seguridad - 0.15);
      break;
    case "god":
      a.needs.sentido = clamp01(a.needs.sentido - 0.1);
      break;
    case "ritual":
    case "pray":
      a.needs.sentido = clamp01(a.needs.sentido + (e.agentId === a.id ? 0.15 : 0.05));
      break;
    case "create":
      if (e.agentId === a.id) {
        a.needs.sentido = clamp01(a.needs.sentido + 0.1);
        a.needs.estima = clamp01(a.needs.estima + 0.1);
      } else a.needs.sentido = clamp01(a.needs.sentido + 0.03);
      break;
    case "gift":
      if (e.agentId === a.id) a.needs.estima = clamp01(a.needs.estima + 0.08);
      if (e.targetId === a.id) a.needs.social = clamp01(a.needs.social + 0.1);
      break;
    case "structure.built":
      if (e.agentId === a.id) a.needs.estima = clamp01(a.needs.estima + 0.12);
      break;
    case "discovery":
      if (e.agentId === a.id) {
        a.needs.estima = clamp01(a.needs.estima + 0.2);
        a.needs.sentido = clamp01(a.needs.sentido + 0.1);
      }
      break;
    default:
      break;
  }
  void s;
}

