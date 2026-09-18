import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Brain } from "../src/brain/brain.ts";
import { buildRoutes } from "../src/brain/router.ts";
import { forkWorld, pruneWorld } from "../src/persistence/maintenance.ts";
import { replayWorld } from "../src/persistence/replay.ts";
import { createWorld, openWorld } from "../src/persistence/world.ts";
import { Society } from "../src/society/society.ts";
import { WorldDb, worldPaths } from "../src/persistence/db.ts";

describe("replay, bifurcación y poda", () => {
  it("la historia grabada con cerebro mock y un acto divino se reproduce con las mismas huellas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "genesis-replay-"));
    try {
      const w = createWorld(dir, "r", 91, { world: { size: 64, initialPopulation: 12 } });
      const e = w.engine;
      const society = new Society(e, w.db);
      society.install();
      e.society = society;
      const brain = new Brain(e, buildRoutes(e.config, "mock")!, w.db, { density: 1, society });
      brain.install();
      const tpd = e.config.time.ticksPerDay;
      for (let t = 1; t <= tpd * 3; t++) {
        if (t === 200) void e.god({ kind: "whisper", agentId: e.s.alive[0]!, text: "Juntá leña antes de que nieve" });
        if (t === 300) void e.god({ kind: "spawn_resource", x: e.s.agents.get(e.s.alive[1]!)!.x, y: e.s.agents.get(e.s.alive[1]!)!.y, resource: "comida", amount: 3, radius: 2 });
        const out = e.step();
        w.writer.write(out);
        if (out.tick % tpd === 0) w.writer.snapshot();
        await new Promise<void>((r) => setImmediate(r));
      }
      w.writer.flush();
      const finalHash = e.hash();
      // las llamadas que terminaron en el último tick nunca se integraron (eso pasa al tick siguiente): no dejan grabación
      const completed = brain.scheduler.callsOk + brain.scheduler.callsFailed;
      const integrated = w.db.llmTotals().calls;
      expect(completed).toBeGreaterThan(integrated);
      const result = await replayWorld(w.db, tpd + 1, tpd * 3);
      expect(result.fromTick).toBe(tpd);
      expect(result.steps.length).toBe(2);
      for (const s of result.steps) expect(s.match).toBe(true);
      expect(result.engine.hash()).toBe(finalHash);
      expect(result.godActions).toBe(2); // el susurro (t=200) y la abundancia (t=300) son posteriores al snapshot de partida (tick 144) y se reaplican
      expect(result.intentHits).toBeGreaterThan(0);
      // las únicas decisiones sin grabación son las que la corrida original no llegó a integrar
      expect(result.intentMisses).toBe(completed - integrated);
      w.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bifurcar crea un mundo independiente y podar pliega memorias viejas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "genesis-fork-"));
    try {
      const w = createWorld(dir, "base", 92, { world: { size: 64, initialPopulation: 10 }, persistence: { memoryFoldDays: 1, memoryFoldImportance: 5, retentionDays: 1 } });
      const tpd = w.engine.config.time.ticksPerDay;
      for (let t = 1; t <= tpd * 4; t++) {
        w.writer.write(w.engine.step());
        if (t % tpd === 0) w.writer.snapshot();
      }
      w.writer.flush();
      const r = forkWorld(w.db, dir, "rama", tpd * 2);
      expect(r.tick).toBe(tpd * 2);
      const forked = openWorld(dir, "rama");
      expect(forked.engine.s.tick).toBe(tpd * 2);
      expect(forked.engine.s.worldName).toBe("rama");
      expect(forked.db.getMeta("forked_from")).toBe(`base@${tpd * 2}`);
      expect(forked.db.countEvents()).toBeGreaterThan(0);
      // evolucionan por separado
      for (let t = 0; t < 50; t++) forked.writer.write(forked.engine.step());
      forked.writer.flush();
      expect(forked.engine.s.tick).toBe(tpd * 2 + 50);
      expect(w.engine.s.tick).toBe(tpd * 4);
      forked.db.close();

      const sizesBefore = w.db.sizes();
      const report = pruneWorld(w.db, w.engine.config, w.engine.s.tick);
      const sizesAfter = w.db.sizes();
      expect(report.memoriesFolded).toBeGreaterThan(0);
      expect(sizesAfter.memories).toBeLessThan(sizesBefore.memories);
      // los snapshots y la reanudación siguen funcionando
      const reopened = WorldDb.open(worldPaths(dir, "base").db);
      expect(reopened.latestSnapshot()?.tick).toBe(tpd * 4);
      reopened.close();
      w.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
