import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine.ts";
import { collectMetrics } from "../src/metrics/collector.ts";

describe("soak de 30 días sin cerebro", () => {
  it("la población sobrevive un año entero y el mundo se mantiene sano", () => {
    const e = Engine.genesis({ world: { size: 128, initialPopulation: 40 } }, 2024);
    const t0 = Date.now();
    const days = 32;
    let maxStructures = 0;
    for (let d = 0; d < days; d++) {
      for (let t = 0; t < 144; t++) {
        const out = e.step();
        for (const ev of out.events) expect(Number.isNaN(ev.importance)).toBe(false);
      }
      maxStructures = Math.max(maxStructures, e.s.structures.size);
      const m = collectMetrics(e.s);
      for (const v of Object.values(m.avgNeeds)) expect(Number.isNaN(v)).toBe(false);
      expect(m.gini).toBeGreaterThanOrEqual(0);
      expect(m.gini).toBeLessThanOrEqual(1);
    }
    const msPerTick = (Date.now() - t0) / (days * 144);
    expect(e.s.alive.length).toBeGreaterThanOrEqual(24);
    expect(maxStructures).toBeLessThan(400);
    expect(msPerTick).toBeLessThan(25);
    // todos los vivos tienen memorias y alguien descubrió el fuego
    const knowFire = e.s.alive.filter((id) => e.s.agents.get(id)!.knows.has("fuego")).length;
    expect(knowFire).toBeGreaterThan(0);
    const homes = e.s.alive.filter((id) => e.s.agents.get(id)!.home !== null).length;
    expect(homes).toBeGreaterThan(e.s.alive.length * 0.5);
  });
});
