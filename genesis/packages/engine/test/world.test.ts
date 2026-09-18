import { describe, expect, it } from "vitest";
import { TERRAINS } from "@genesis/protocol";
import { Engine } from "../src/sim/engine.ts";
import { Fnv } from "../src/rng.ts";
import { NO_PATH, T, descend, idx, isWalkable } from "../src/world/grid.ts";

function terrainHash(e: Engine): string {
  return new Fnv().bytes(e.s.grid.terrain).hex();
}

describe("mundo", () => {
  it("el terreno es reproducible por seed", () => {
    const a = Engine.genesis({ world: { size: 64, initialPopulation: 5 } }, 1);
    const b = Engine.genesis({ world: { size: 64, initialPopulation: 5 } }, 1);
    const c = Engine.genesis({ world: { size: 64, initialPopulation: 5 } }, 2);
    expect(terrainHash(a)).toBe(terrainHash(b));
    expect(terrainHash(a)).not.toBe(terrainHash(c));
  });

  it("tiene agua, tierra caminable y recursos", () => {
    const e = Engine.genesis({ world: { size: 96, initialPopulation: 5 } }, 5);
    const g = e.s.grid;
    const counts = new Array(TERRAINS.length).fill(0);
    for (let i = 0; i < g.terrain.length; i++) counts[g.terrain[i]!]++;
    expect(counts[T.agua]! + counts[T.agua_profunda]!).toBeGreaterThan(g.terrain.length * 0.02);
    expect(counts[T.pradera]! + counts[T.bosque]!).toBeGreaterThan(g.terrain.length * 0.2);
    let food = 0;
    for (let i = 0; i < g.resources.comida.length; i++) food += g.resources.comida[i]!;
    expect(food).toBeGreaterThan(100);
  });

  it("los campos de distancia llevan al agua", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 3 } }, 8);
    const g = e.s.grid;
    const a = e.s.agents.get(e.s.alive[0]!)!;
    let x = a.x;
    let y = a.y;
    let d = g.distWater[idx(g.size, x, y)]!;
    expect(d).not.toBe(NO_PATH);
    let steps = 0;
    while (d > 0 && steps < 500) {
      const next = descend(g, g.distWater, x, y);
      expect(next).toBeGreaterThanOrEqual(0);
      x = next % g.size;
      y = (next - x) / g.size;
      const nd = g.distWater[next]!;
      expect(nd).toBeLessThan(d);
      d = nd;
      steps++;
    }
    expect(d).toBe(0);
    expect(isWalkable(g.terrain[idx(g.size, x, y)]!)).toBe(true);
  });

  it("los seres nacen en celdas caminables cerca del agua", () => {
    const e = Engine.genesis({ world: { size: 96, initialPopulation: 30 } }, 3);
    const g = e.s.grid;
    expect(e.s.alive.length).toBe(30);
    for (const id of e.s.alive) {
      const a = e.s.agents.get(id)!;
      expect(isWalkable(g.terrain[idx(g.size, a.x, a.y)]!)).toBe(true);
      expect(g.distWater[idx(g.size, a.x, a.y)]!).toBeLessThan(30);
    }
    const names = new Set(e.s.alive.map((id) => e.s.agents.get(id)!.name));
    expect(names.size).toBe(30);
  });
});
