import type { WorldDb } from "../persistence/db.ts";
import type { CallType } from "../cognition/system2/schemas.ts";
import { emptyUsage, type BrainProvider, type BrainRequest, type BrainResponse } from "./provider.ts";

type Status = BrainResponse<unknown>["status"];

interface RecordedCall {
  tick: number;
  agentId: number | null;
  type: string;
  status: Status;
  usd: number;
  raw: string | null;
  used: boolean;
}

interface Held {
  tick: number;
  resolve: () => void;
}

/**
 * Cerebro de replay: en vez de llamar a un modelo, devuelve las respuestas
 * grabadas en `llm_calls` (una por llamada integrada, con su estado, su costo
 * y su cuerpo) para el mismo ser y tipo de llamada, y las retiene hasta el
 * tick en que la corrida original las integró, así el mundo las aplica en el
 * mismo instante. Si el cuerpo fue podado, se recurre al evento `intent`
 * de ese tick; si tampoco está, la llamada se reproduce como inválida.
 * Un pedido sin grabación nunca se resuelve: en la corrida original tampoco
 * llegó a integrarse (quedó en vuelo al apagar), y el ser sigue con System 1.
 */
export class ReplayBrain implements BrainProvider {
  readonly name = "replay";
  readonly model = "replay";
  private readonly calls: RecordedCall[];
  private readonly intents = new Map<string, unknown>();
  private held: Held[] = [];
  misses = 0;
  hits = 0;

  constructor(
    db: WorldDb,
    private readonly fromTick: number,
    private readonly toTick: number,
    private readonly tickNow: () => number,
  ) {
    const lo = Math.max(0, fromTick - 200);
    const hi = toTick + 200;
    this.calls = db.llmCallRows(lo, hi).map((r) => ({ tick: r.tick, agentId: r.agentId, type: r.callType, status: r.status as Status, usd: r.usd, raw: r.responseJson, used: false }));
    for (const r of db.events({ kind: "intent", from: lo, to: hi, limit: 200000, order: "asc" })) {
      this.intents.set(`${r.agent_id}|${r.payload.type}|${r.tick}`, r.payload.output);
    }
  }

  async call<T>(req: BrainRequest<T>): Promise<BrainResponse<T>> {
    const now = this.tickNow();
    const type = req.type as CallType;
    // la primera llamada grabada, todavía sin usar, del mismo ser y tipo, integrada después de este tick
    const rec = this.calls.find((c) => !c.used && c.type === type && c.agentId === req.agentId && c.tick > now);
    if (!rec) {
      this.misses++;
      return new Promise<BrainResponse<T>>(() => {
        /* sin grabación: en la corrida original nunca se integró */
      });
    }
    rec.used = true;
    this.hits++;
    const base = { usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: 0, usd: rec.usd };
    if (rec.status !== "ok") {
      return this.hold<T>(rec.tick, { status: rec.status, parsed: null, raw: rec.status === "error" ? null : rec.raw, ...base, error: `fallo grabado (${rec.status})` });
    }
    let output: unknown = rec.raw !== null ? safeJson(rec.raw) : undefined;
    if (output === undefined) output = this.intents.get(`${req.agentId}|${type}|${rec.tick}`);
    const parsed = output !== undefined ? req.schema.safeParse(output) : null;
    if (!parsed || !parsed.success) {
      return this.hold<T>(rec.tick, { status: "invalid", parsed: null, raw: rec.raw, ...base, error: output === undefined ? "grabación podada" : "grabación inválida" });
    }
    return this.hold<T>(rec.tick, { status: "ok", parsed: parsed.data, raw: rec.raw ?? JSON.stringify(output), ...base, error: null });
  }

  private hold<T>(tick: number, res: BrainResponse<T>): Promise<BrainResponse<T>> {
    return new Promise<BrainResponse<T>>((resolve) => {
      this.held.push({ tick, resolve: () => resolve(res) });
    });
  }

  /**
   * Libera las respuestas grabadas para `tick`. Se llama después del paso que
   * dejó al mundo en `tick - 1`; el paso siguiente las integra en `tick`.
   */
  release(tick: number): number {
    let n = 0;
    const keep: Held[] = [];
    for (const h of this.held) {
      if (h.tick <= tick) {
        h.resolve();
        n++;
      } else keep.push(h);
    }
    this.held = keep;
    return n;
  }

  /** Respuestas retenidas a la espera de su tick. */
  get pending(): number {
    return this.held.length;
  }

  /** Llamadas grabadas dentro de la ventana que ningún pedido reclamó (su pedido se despachó antes del snapshot de partida). */
  get orphans(): number {
    let n = 0;
    for (const c of this.calls) if (!c.used && c.tick > this.fromTick && c.tick <= this.toTick) n++;
    return n;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
