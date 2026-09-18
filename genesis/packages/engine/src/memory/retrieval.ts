import MiniSearch from "minisearch";
import type { Agent, Memory } from "../agents/agent.ts";

/**
 * Recuperación de memorias: recencia × importancia × relevancia (BM25).
 * Índice por ser sobre la memoria de trabajo; se reconstruye si cambió.
 */
export interface Retriever {
  retrieve(agent: Agent, query: string, k: number, tick: number, ticksPerDay: number): Memory[];
}

interface IndexEntry {
  index: MiniSearch<{ id: number; text: string; tags: string }>;
  count: number;
  lastId: number;
}

const STOPWORDS = new Set(["de", "la", "el", "los", "las", "un", "una", "y", "o", "a", "en", "con", "que", "por", "para", "del", "al", "se", "su", "sus", "lo", "me", "mi", "yo", "es", "fue", "muy"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export class Bm25Retriever implements Retriever {
  private readonly indexes = new Map<number, IndexEntry>();
  /** vida media de la recencia, en días simulados */
  halfLifeDays = 3;

  private indexFor(agent: Agent): MiniSearch<{ id: number; text: string; tags: string }> {
    const mems = agent.memories;
    const lastId = mems.length ? mems[mems.length - 1]!.id : -1;
    const entry = this.indexes.get(agent.id);
    if (entry && entry.count === mems.length && entry.lastId === lastId) return entry.index;
    const index = new MiniSearch<{ id: number; text: string; tags: string }>({
      fields: ["text", "tags"],
      storeFields: ["id"],
      tokenize,
      searchOptions: { boost: { tags: 1.5 }, prefix: true, fuzzy: 0.1 },
    });
    index.addAll(mems.map((m) => ({ id: m.id, text: m.text, tags: m.tags.join(" ") })));
    this.indexes.set(agent.id, { index, count: mems.length, lastId });
    return index;
  }

  forget(agentId: number): void {
    this.indexes.delete(agentId);
  }

  retrieve(agent: Agent, query: string, k: number, tick: number, ticksPerDay: number): Memory[] {
    const mems = agent.memories;
    if (mems.length === 0) return [];
    const relevance = new Map<number, number>();
    if (query.trim().length > 0) {
      const index = this.indexFor(agent);
      const results = index.search(query);
      const max = results.length ? results[0]!.score : 1;
      for (const r of results) relevance.set(r.id as number, r.score / max);
    }
    const halfLife = this.halfLifeDays * ticksPerDay;
    const scored = mems.map((m) => {
      const age = Math.max(0, tick - m.tick);
      const recency = Math.pow(0.5, age / halfLife);
      const importance = m.importance / 10;
      const rel = relevance.get(m.id) ?? 0;
      const kindBoost = m.kind === "reflexion" || m.kind === "creencia" ? 1.5 : m.kind === "voz_divina" ? 1.4 : 1;
      return { m, score: (recency + importance + rel) * kindBoost };
    });
    scored.sort((p, q) => q.score - p.score);
    return scored
      .slice(0, k)
      .map((s) => s.m)
      .sort((p, q) => p.tick - q.tick);
  }
}
