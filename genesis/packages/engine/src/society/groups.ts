import type { Agent } from "../agents/agent.ts";
import type { EngineState } from "../sim/state.ts";

export interface Ritual {
  name: string;
  everyDays: number;
  beliefId: number | null;
  lastHeldDay: number;
  declaredBy: number;
}

export interface Group {
  id: number;
  name: string;
  named: boolean;
  foundedTick: number;
  dissolvedTick: number | null;
  members: Set<number>;
  leaderId: number | null;
  leaderSinceTick: number;
  color: string;
  home: { x: number; y: number } | null;
  rituals: Ritual[];
  /** normas dichas en voz alta por líderes (texto) */
  norms: string[];
  /** grupos con los que está en guerra / en paz */
  wars: Set<number>;
  treaties: Set<number>;
  /** días consecutivos en que un candidato a líder encabezó la deferencia */
  leaderStreak: Map<number, number>;
}

export interface GroupCandidate {
  members: number[];
  streak: number;
}

const COLORS = ["#e6a23c", "#5b8def", "#d46a6a", "#6cc27a", "#b07cd6", "#e0c341", "#4fb3bf", "#f28ac0", "#9c7b4f", "#7ad0ff"];

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Detección de tribus por propagación de etiquetas sobre un grafo de afinidad
 * práctica: dormir cerca, interactuar bien y ser parientes.
 */
export function detectCommunities(
  s: EngineState,
  weights: Map<string, number>,
  threshold = 0.35,
  minSize = 4,
): number[][] {
  const ids = s.alive.slice();
  const neighbors = new Map<number, Array<[number, number]>>();
  for (const [key, w] of weights) {
    if (w < threshold) continue;
    const [p, q] = key.split(":").map(Number) as [number, number];
    if (!s.agents.get(p) || !s.agents.get(q)) continue;
    if (s.agents.get(p)!.diedTick !== null || s.agents.get(q)!.diedTick !== null) continue;
    (neighbors.get(p) ?? neighbors.set(p, []).get(p)!).push([q, w]);
    (neighbors.get(q) ?? neighbors.set(q, []).get(q)!).push([p, w]);
  }
  const label = new Map<number, number>();
  for (const id of ids) label.set(id, id);
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    for (const id of ids) {
      const ns = neighbors.get(id);
      if (!ns || ns.length === 0) continue;
      const score = new Map<number, number>();
      for (const [n, w] of ns) score.set(label.get(n)!, (score.get(label.get(n)!) ?? 0) + w);
      let best = label.get(id)!;
      let bestScore = -1;
      for (const [l, sc] of [...score.entries()].sort((p, q) => p[0] - q[0])) {
        if (sc > bestScore) {
          bestScore = sc;
          best = l;
        }
      }
      if (best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const byLabel = new Map<number, number[]>();
  for (const [id, l] of label) (byLabel.get(l) ?? byLabel.set(l, []).get(l)!).push(id);
  return [...byLabel.values()].filter((m) => m.length >= minSize).map((m) => m.sort((p, q) => p - q));
}

export function jaccard(a: Iterable<number>, b: Iterable<number>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function createGroup(id: number, name: string, members: number[], tick: number): Group {
  return {
    id,
    name,
    named: false,
    foundedTick: tick,
    dissolvedTick: null,
    members: new Set(members),
    leaderId: null,
    leaderSinceTick: -1,
    color: COLORS[(id - 1) % COLORS.length]!,
    home: null,
    rituals: [],
    norms: [],
    wars: new Set(),
    treaties: new Set(),
    leaderStreak: new Map(),
  };
}

/** Deferencia hacia cada miembro: confianza×afinidad que le tienen los demás, regalos netos y seguimiento. */
export function deference(s: EngineState, g: Group, netGifts: Map<number, number>, speeches: Map<number, number>): Map<number, number> {
  const d = new Map<number, number>();
  for (const x of g.members) {
    let score = 0;
    for (const y of g.members) {
      if (x === y) continue;
      const rel = s.agents.get(y)?.relationships.get(x);
      if (rel) score += Math.max(0, rel.trust) * Math.max(0, rel.affinity + 0.2);
    }
    score += 2 * Math.max(0, netGifts.get(x) ?? 0);
    score += 0.5 * (speeches.get(x) ?? 0);
    const a = s.agents.get(x);
    if (a) score += a.needs.estima * 0.5;
    d.set(x, score);
  }
  return d;
}

export function groupHome(s: EngineState, g: Group): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const id of g.members) {
    const a = s.agents.get(id);
    if (!a || a.diedTick !== null) continue;
    const p = a.home ?? { x: a.x, y: a.y };
    sx += p.x;
    sy += p.y;
    n++;
  }
  return n ? { x: Math.round(sx / n), y: Math.round(sy / n) } : null;
}

export function membersAlive(s: EngineState, g: Group): Agent[] {
  const out: Agent[] = [];
  for (const id of g.members) {
    const a = s.agents.get(id);
    if (a && a.diedTick === null) out.push(a);
  }
  return out;
}
