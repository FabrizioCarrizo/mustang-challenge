import type { GodAction } from "@genesis/protocol";
import { Brain } from "../brain/brain.ts";
import { ReplayBrain } from "../brain/replay.ts";
import { Engine } from "../sim/engine.ts";
import { Society } from "../society/society.ts";
import type { WorldDb } from "./db.ts";

export interface ReplayStep {
  tick: number;
  recordedHash: string | null;
  hash: string;
  match: boolean | null;
}

export interface ReplayResult {
  engine: Engine;
  fromTick: number;
  toTick: number;
  steps: ReplayStep[];
  intentHits: number;
  intentMisses: number;
  godActions: number;
}

/**
 * Reproduce la historia grabada desde el snapshot anterior a `fromTick`
 * hasta `toTick`, reaplicando las decisiones y los actos de dios en sus ticks,
 * y compara las huellas diarias con las grabadas. Cede el hilo en cada tick
 * para que las decisiones grabadas (asíncronas) se integren como en vivo.
 */
export async function replayWorld(db: WorldDb, fromTick: number, toTick: number, opts: { onDay?: (step: ReplayStep) => void } = {}): Promise<ReplayResult> {
  const row = db.snapshotAtOrBefore(fromTick);
  if (!row) throw new Error(`No hay snapshot anterior al tick ${fromTick}`);
  const engine = Engine.fromSnapshot(db.loadSnapshot(row.tick));
  const society = new Society(engine, null);
  society.install();
  engine.society = society;
  const replayBrain = new ReplayBrain(db, row.tick, toTick);
  const brain = new Brain(engine, { routine: replayBrain, epochal: replayBrain, mode: "mock" }, null, { density: 1, society });
  brain.install();
  // actos de dios grabados
  const gods = db.events({ kind: "god", from: row.tick + 1, to: toTick, limit: 10000, order: "asc" });
  const hashes = new Map<number, string>();
  for (const h of db.events({ kind: "state.hash", from: row.tick + 1, to: toTick, limit: 100000, order: "asc" })) hashes.set(h.tick, h.label);
  const steps: ReplayStep[] = [];
  let gi = 0;
  let godActions = 0;
  while (engine.s.tick < toTick) {
    const next = engine.s.tick + 1;
    while (gi < gods.length && gods[gi]!.tick === next) {
      const action = gods[gi]!.payload.action as GodAction | undefined;
      if (action) {
        void engine.god(action);
        godActions++;
      }
      gi++;
    }
    engine.step();
    if (engine.s.clock.isNewDay) {
      const recorded = hashes.get(engine.s.tick) ?? null;
      const hash = engine.hash();
      const step: ReplayStep = { tick: engine.s.tick, recordedHash: recorded, hash, match: recorded ? recorded === hash : null };
      steps.push(step);
      opts.onDay?.(step);
    }
    await new Promise<void>((r) => setImmediate(r));
  }
  brain.stop();
  return { engine, fromTick: row.tick, toTick, steps, intentHits: replayBrain.hits, intentMisses: replayBrain.misses, godActions };
}
