import type { Agent } from "../agents/agent.ts";
import type { EngineState } from "../sim/state.ts";

export interface Belief {
  id: number;
  statement: string;
  kind: string;
  founderId: number | null;
  tick: number;
  explains: string[];
  holders: Map<number, number>;
  parentId: number | null;
  /** cuántas veces se transmitió conversando */
  transmissions: number;
}

export function normalizeStatement(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = ` ${s} `;
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function statementSimilarity(a: string, b: string): number {
  const ta = trigrams(normalizeStatement(a));
  const tb = trigrams(normalizeStatement(b));
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Busca una creencia equivalente (misma idea) ya existente. */
export function findSimilarBelief(s: EngineState, statement: string, threshold = 0.6): Belief | null {
  let best: Belief | null = null;
  let bestSim = threshold;
  for (const b of s.beliefs.values()) {
    const sim = statementSimilarity(b.statement, statement);
    if (sim >= bestSim) {
      bestSim = sim;
      best = b;
    }
  }
  return best;
}

/** Crea o refuerza una creencia en la mente de un ser. Devuelve la creencia y si es nueva en el mundo. */
export function holdBelief(
  s: EngineState,
  a: Agent,
  input: { statement: string; kind: string; confidence: number; explains: string[]; founderId?: number | null; parentId?: number | null },
): { belief: Belief; isNew: boolean; adopted: boolean } {
  const conf = Math.max(0, Math.min(1, input.confidence));
  let belief = findSimilarBelief(s, input.statement);
  let isNew = false;
  if (!belief) {
    belief = {
      id: s.counters.belief++,
      statement: input.statement.trim().slice(0, 240),
      kind: input.kind,
      founderId: input.founderId ?? a.id,
      tick: s.tick,
      explains: [...new Set(input.explains.map((e) => e.toLowerCase().trim()).filter(Boolean))],
      holders: new Map(),
      parentId: input.parentId ?? null,
      transmissions: 0,
    };
    s.beliefs.set(belief.id, belief);
    isNew = true;
  } else {
    for (const e of input.explains) {
      const tag = e.toLowerCase().trim();
      if (tag && !belief.explains.includes(tag)) belief.explains.push(tag);
    }
  }
  const adopted = !a.beliefs.has(belief.id);
  const prev = a.beliefs.get(belief.id) ?? 0;
  const next = adopted ? conf : Math.max(prev, Math.min(1, prev + (conf - prev) * 0.5));
  a.beliefs.set(belief.id, next);
  belief.holders.set(a.id, next);
  return { belief, isNew, adopted };
}

export function reviseBelief(s: EngineState, a: Agent, statement: string, confidence: number): boolean {
  const belief = findSimilarBelief(s, statement, 0.5);
  if (!belief || !a.beliefs.has(belief.id)) return false;
  const c = Math.max(0, Math.min(1, confidence));
  if (c < 0.05) {
    a.beliefs.delete(belief.id);
    belief.holders.delete(a.id);
  } else {
    a.beliefs.set(belief.id, c);
    belief.holders.set(a.id, c);
  }
  return true;
}

/** ¿Alguna creencia del ser (confianza ≥ 0.4) explica estas etiquetas? */
export function explains(s: EngineState, a: Agent, tags: string[], minConfidence = 0.4): boolean {
  if (tags.length === 0) return false;
  for (const [id, conf] of a.beliefs) {
    if (conf < minConfidence) continue;
    const b = s.beliefs.get(id);
    if (!b) continue;
    for (const t of tags) if (b.explains.includes(t)) return true;
  }
  return false;
}

export function dropDeadHolder(s: EngineState, agentId: number): void {
  for (const b of s.beliefs.values()) b.holders.delete(agentId);
}

export function beliefsOf(s: EngineState, a: Agent): Array<{ belief: Belief; confidence: number }> {
  const out: Array<{ belief: Belief; confidence: number }> = [];
  for (const [id, confidence] of a.beliefs) {
    const belief = s.beliefs.get(id);
    if (belief) out.push({ belief, confidence });
  }
  return out.sort((p, q) => q.confidence - p.confidence);
}
