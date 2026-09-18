import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorld, openWorld, worldExists } from "../src/persistence/world.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "genesis-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("persistencia", () => {
  it("crea, corre, guarda y reanuda con el mismo hash", () => {
    const w = createWorld(dir, "t", 5, { world: { size: 64, initialPopulation: 12 } });
    expect(worldExists(dir, "t")).toBe(true);
    for (let t = 0; t < 200; t++) w.writer.write(w.engine.step());
    const snap = w.writer.snapshot();
    const hashesA: string[] = [];
    for (let t = 0; t < 150; t++) {
      w.writer.write(w.engine.step());
      if (t % 50 === 0) hashesA.push(w.engine.hash());
    }
    const eventsBefore = w.db.countEvents();
    w.writer.flush();
    w.db.close();

    const r = openWorld(dir, "t");
    expect(r.resumedFromTick).toBe(snap.tick);
    expect(r.engine.hash()).toBe(snap.hash);
    r.db.deleteAfterTick(r.resumedFromTick);
    const hashesB: string[] = [];
    for (let t = 0; t < 150; t++) {
      r.writer.write(r.engine.step());
      if (t % 50 === 0) hashesB.push(r.engine.hash());
    }
    r.writer.flush();
    expect(hashesB).toEqual(hashesA);
    expect(r.db.countEvents()).toBe(eventsBefore);
    r.db.close();
  });

  it("persiste memorias consultables por FTS", () => {
    const w = createWorld(dir, "m", 6, { world: { size: 64, initialPopulation: 10 } });
    for (let t = 0; t < 144 * 2; t++) w.writer.write(w.engine.step());
    w.writer.flush();
    const a = w.engine.s.agents.get(w.engine.s.alive[0]!)!;
    const all = w.db.memoriesOf(a.id, { limit: 50 });
    expect(all.length).toBeGreaterThan(0);
    const word = all[0]!.text.split(" ").find((wd) => wd.length > 4) ?? "";
    if (word) {
      const found = w.db.memoriesOf(a.id, { query: word, limit: 10 });
      expect(found.length).toBeGreaterThan(0);
    }
    const sizes = w.db.sizes();
    expect(sizes.memories).toBeGreaterThan(0);
    expect(sizes.metrics).toBe(48);
    w.db.close();
  });

  it("los snapshots se adelgazan conservando los recientes", () => {
    const w = createWorld(dir, "s", 7, { world: { size: 48, initialPopulation: 6 } });
    const tpd = w.engine.config.time.ticksPerDay;
    for (let d = 1; d <= 20; d++) {
      for (let t = 0; t < tpd; t++) w.writer.write(w.engine.step());
      w.writer.snapshot();
    }
    expect(w.db.listSnapshots().length).toBe(21);
    const removed = w.db.thinSnapshots(7, 7, tpd);
    const left = w.db.listSnapshots().map((r) => r.tick / tpd);
    expect(removed).toBeGreaterThan(0);
    expect(left).toContain(0);
    expect(left).toContain(7);
    expect(left).toContain(14);
    for (let d = 14; d <= 20; d++) expect(left).toContain(d);
    w.db.close();
  });
});
