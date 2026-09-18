import type { WorldDb } from "../persistence/db.ts";
import type { CallType } from "../cognition/system2/schemas.ts";
import { emptyUsage, type BrainProvider, type BrainRequest, type BrainResponse } from "./provider.ts";

interface RecordedIntent {
  seq: number;
  tick: number;
  agentId: number | null;
  targetId: number | null;
  type: string;
  output: unknown;
  used: boolean;
}

/**
 * Cerebro de replay: en vez de llamar a un modelo, devuelve las decisiones
 * grabadas (eventos `intent`) para el mismo ser y tipo de llamada, en orden.
 * Si no hay ninguna grabada, el ser vive con System 1.
 */
export class ReplayBrain implements BrainProvider {
  readonly name = "replay";
  readonly model = "replay";
  private readonly intents: RecordedIntent[];
  misses = 0;
  hits = 0;

  constructor(db: WorldDb, fromTick: number, toTick: number) {
    this.intents = db
      .events({ kind: "intent", from: Math.max(0, fromTick - 200), to: toTick + 200, limit: 200000, order: "asc" })
      .map((r) => ({ seq: r.seq, tick: r.tick, agentId: r.agent_id, targetId: r.target_id, type: String(r.payload.type ?? ""), output: r.payload.output, used: false }));
  }

  async call<T>(req: BrainRequest<T>): Promise<BrainResponse<T>> {
    const meta = (req.meta ?? {}) as { mock?: { tick?: number } };
    const tick = meta.mock?.tick ?? 0;
    const type = req.type as CallType;
    // el intent grabado más cercano en el tiempo, del mismo ser y tipo, todavía no usado
    let best: RecordedIntent | null = null;
    let bestDist = Infinity;
    for (const it of this.intents) {
      if (it.used || it.type !== type || it.agentId !== req.agentId) continue;
      const dist = Math.abs(it.tick - tick);
      if (dist < bestDist) {
        bestDist = dist;
        best = it;
      }
    }
    if (!best || bestDist > 300) {
      this.misses++;
      return { status: "error", parsed: null, raw: null, usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: 0, usd: 0, error: "sin decisión grabada" };
    }
    best.used = true;
    this.hits++;
    const parsed = req.schema.safeParse(best.output);
    if (!parsed.success) {
      return { status: "invalid", parsed: null, raw: JSON.stringify(best.output), usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: 0, usd: 0, error: "grabación inválida" };
    }
    return { status: "ok", parsed: parsed.data, raw: JSON.stringify(best.output), usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: 0, usd: 0, error: null };
  }
}
