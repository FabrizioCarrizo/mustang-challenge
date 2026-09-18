import type { Engine, TickOutput } from "../sim/engine.ts";
import type { WorldDb } from "./db.ts";

/**
 * Escritura diferida: junta lo que produjo el tick y lo graba en una sola
 * transacción. Devuelve los `seq` de los eventos persistidos.
 */
export class PersistenceWriter {
  private lastFlushMs = 0;
  private buffered: TickOutput[] = [];

  constructor(
    private readonly db: WorldDb,
    private readonly engine: Engine,
    private readonly coalesceMs = 0,
  ) {}

  /** Registra la salida del tick; escribe ahora o difiere si `coalesceMs` > 0. */
  write(out: TickOutput, now = Date.now()): void {
    this.buffered.push(out);
    if (this.coalesceMs <= 0 || now - this.lastFlushMs >= this.coalesceMs) this.flush(now);
  }

  flush(now = Date.now()): void {
    if (this.buffered.length === 0) return;
    const s = this.engine.s;
    const batch = this.buffered;
    this.buffered = [];
    const memories = s.pendingMemories;
    s.pendingMemories = [];
    this.db.transaction(() => {
      for (const out of batch) {
        this.db.insertEvents(out.events);
        if (out.metrics) this.db.insertMetrics(out.metrics);
        if (out.deaths.length > 0) {
          this.db.upsertAgents(
            out.deaths.map((id) => s.agents.get(id)!).filter(Boolean),
            out.tick,
          );
        }
      }
      this.db.insertMemories(memories);
    });
    this.lastFlushMs = now;
  }

  /** Guarda snapshot + proyección de seres. */
  snapshot(): { tick: number; bytes: number; hash: string } {
    this.flush();
    const s = this.engine.s;
    const hash = this.engine.hash();
    const row = this.db.transaction(() => {
      this.db.upsertAgents(s.agents.values(), s.tick);
      this.db.setMeta("last_tick", String(s.tick));
      return this.db.saveSnapshot(this.engine.snapshot(), hash);
    });
    return { tick: row.tick, bytes: row.bytes, hash };
  }
}
