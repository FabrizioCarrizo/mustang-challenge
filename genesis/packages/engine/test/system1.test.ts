import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine.ts";
import { decide, type DecisionContext } from "../src/cognition/system1/utility.ts";
import { idx } from "../src/world/grid.ts";

function ctxFor(e: Engine, agentId: number): DecisionContext {
  const a = e.s.agents.get(agentId)!;
  const cellIdx = idx(e.s.grid.size, a.x, a.y);
  return {
    cfg: e.config,
    clock: e.s.clock,
    grid: e.s.grid,
    agents: e.s.agents,
    structures: e.s.structures,
    rng: e.s.rng.get("s1"),
    perception: { nearby: [], adjacent: [], tempHere: 18, warmthHere: 0, danger: 0, cellIdx, structureHere: null, threatX: null, threatY: null },
    shelterExists: false,
  };
}

describe("System 1", () => {
  it("con hambre y comida en la mochila, come", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 3 } }, 4);
    for (let t = 0; t < 40; t++) e.step(); // que sea de día
    const a = e.s.agents.get(e.s.alive[0]!)!;
    a.needs.hambre = 0.1;
    a.needs.sed = 0.9;
    a.needs.calor = 0.9;
    a.needs.descanso = 0.9;
    a.inventory.set("comida", 3);
    a.current = null;
    const c = decide(a, ctxFor(e, a.id));
    expect(c.verb).toBe("comer");
  });

  it("con sed elige beber o ir hacia el agua", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 3 } }, 4);
    for (let t = 0; t < 40; t++) e.step();
    const a = e.s.agents.get(e.s.alive[0]!)!;
    a.needs.sed = 0.05;
    a.needs.hambre = 0.9;
    a.needs.calor = 0.9;
    a.needs.descanso = 0.9;
    a.current = null;
    const c = decide(a, ctxFor(e, a.id));
    expect(c.verb).toBe("beber");
  });

  it("de noche y cansado, duerme", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 3 } }, 4);
    // avanzar hasta las 23 h
    while (e.s.clock.hour < 23) e.step();
    const a = e.s.agents.get(e.s.alive[0]!)!;
    a.needs.sed = 0.9;
    a.needs.hambre = 0.9;
    a.needs.calor = 0.9;
    a.needs.descanso = 0.3;
    a.asleep = false;
    a.current = null;
    const c = decide(a, ctxFor(e, a.id));
    expect(c.verb).toBe("dormir");
  });

  it("las necesidades quedan acotadas y sin NaN tras muchos ticks", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 10 } }, 12);
    for (let t = 0; t < 144 * 3; t++) e.step();
    for (const id of e.s.alive) {
      const a = e.s.agents.get(id)!;
      for (const v of Object.values(a.needs)) {
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Number.isNaN(a.health)).toBe(false);
    }
  });

  it("sin agua ni comida los seres mueren en pocos días", () => {
    const e = Engine.genesis({ world: { size: 48, initialPopulation: 4, abundance: 0.1 } }, 21);
    // vaciar toda la comida y alejar el agua: llenamos el mundo de piedra
    const g = e.s.grid;
    for (let i = 0; i < g.resources.comida.length; i++) {
      g.resources.comida[i] = 0;
      g.resourceMax.comida[i] = 0;
    }
    for (const id of e.s.alive) e.s.agents.get(id)!.inventory.clear();
    let days = 0;
    while (e.s.alive.length > 0 && days < 12) {
      for (let t = 0; t < 144; t++) e.step();
      days++;
    }
    expect(e.s.alive.length).toBe(0);
    expect(days).toBeLessThanOrEqual(8);
    const dead = [...e.s.agents.values()];
    expect(dead.every((a) => a.causeOfDeath === "hambre" || a.causeOfDeath === "sed" || a.causeOfDeath === "frío")).toBe(true);
  });
});
