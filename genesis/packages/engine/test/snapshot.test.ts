import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine.ts";

describe("snapshot", () => {
  it("serializar y restaurar conserva el estado y la evolución", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 12 } }, 99);
    for (let t = 0; t < 300; t++) e.step();
    const data = e.snapshot();
    const json = JSON.stringify(data);
    const restored = Engine.fromSnapshot(JSON.parse(json));
    expect(restored.hash()).toBe(e.hash());
    expect(restored.s.alive).toEqual(e.s.alive);
    for (let t = 0; t < 200; t++) {
      e.step();
      restored.step();
    }
    expect(restored.hash()).toBe(e.hash());
    expect(restored.s.tick).toBe(e.s.tick);
    const a = e.s.agents.get(e.s.alive[0]!)!;
    const b = restored.s.agents.get(e.s.alive[0]!)!;
    expect(b.memories.length).toBe(a.memories.length);
    expect(b.inventory.get("comida") ?? 0).toBeCloseTo(a.inventory.get("comida") ?? 0, 6);
  });

  it("dos mundos con la misma seed evolucionan igual", () => {
    const a = Engine.genesis({ world: { size: 64, initialPopulation: 15 } }, 123);
    const b = Engine.genesis({ world: { size: 64, initialPopulation: 15 } }, 123);
    for (let t = 0; t < 400; t++) {
      a.step();
      b.step();
    }
    expect(a.hash()).toBe(b.hash());
  });
});
