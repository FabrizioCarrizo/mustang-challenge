import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine.ts";
import { Brain } from "../src/brain/brain.ts";
import { buildRoutes } from "../src/brain/router.ts";
import { Society } from "../src/society/society.ts";
import { createWorld } from "../src/persistence/world.ts";
import { giveBirth, inherit } from "../src/life/life.ts";
import { mixGenomes, randomGenome } from "../src/agents/genome.ts";
import { Rng } from "../src/rng.ts";
import { TRAITS } from "@genesis/protocol";
import { ticksPerYear } from "../src/config.ts";

describe("vida", () => {
  it("la mezcla genética queda en rango y cerca de los padres", () => {
    const rng = new Rng(3);
    const a = randomGenome(rng);
    const b = randomGenome(rng);
    let farFromBoth = 0;
    for (let i = 0; i < 500; i++) {
      const c = mixGenomes(a, b, rng);
      for (const t of TRAITS) {
        expect(c[t]).toBeGreaterThanOrEqual(0);
        expect(c[t]).toBeLessThanOrEqual(1);
        if (Math.abs(c[t] - a[t]) > 0.3 && Math.abs(c[t] - b[t]) > 0.3) farFromBoth++;
      }
    }
    expect(farFromBoth / (500 * TRAITS.length)).toBeLessThan(0.05);
  });

  it("una pareja concibe, nace un hijo con parentesco y creencias heredadas", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 6 } }, 12);
    const ids = e.s.alive;
    const mother = e.s.agents.get(ids.find((id) => e.s.agents.get(id)!.sex === "f")!)!;
    const father = e.s.agents.get(ids.find((id) => e.s.agents.get(id)!.sex === "m")!)!;
    mother.bondedTo = father.id;
    father.bondedTo = mother.id;
    father.x = mother.x;
    father.y = mother.y;
    mother.pregnantUntil = e.s.tick + 1;
    mother.pregnantBy = father.id;
    const before = e.s.alive.length;
    const child = giveBirth(e, mother);
    expect(e.s.alive.length).toBe(before + 1);
    expect(child.parents).toEqual([mother.id, father.id]);
    expect(mother.children).toContain(child.id);
    expect(child.relationships.get(mother.id)!.kinship).toBe(1);
    expect(mother.relationships.get(child.id)!.label).toBe("hijo");
    expect(e.s.today.births).toBe(1);
  });

  it("los seres envejecen y mueren de viejos; los bienes pasan al heredero", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 8 } }, 13);
    const perYear = ticksPerYear(e.config);
    for (const id of e.s.alive) e.s.agents.get(id)!.bornTick = -Math.round(perYear * (e.config.life.maxAgeYears + 2));
    for (let d = 0; d < 20 && e.s.alive.length > 0; d++) for (let t = 0; t < 144; t++) e.step();
    expect(e.s.alive.length).toBeLessThan(8);
    const dead = [...e.s.agents.values()].find((a) => a.diedTick !== null)!;
    expect(dead.causeOfDeath).toBe("vejez");
    // herencia explícita
    const e2 = Engine.genesis({ world: { size: 64, initialPopulation: 4 } }, 14);
    const [p, q] = e2.s.alive.map((id) => e2.s.agents.get(id)!);
    p!.bondedTo = q!.id;
    q!.bondedTo = p!.id;
    p!.inventory.clear();
    p!.inventory.set("gema", 3);
    const heir = inherit(e2, p!);
    expect(heir?.id).toBe(q!.id);
    expect(q!.inventory.get("gema")).toBe(3);
    expect(q!.memories.some((m) => m.tags.includes("herencia"))).toBe(true);
  });

  it("con cerebro mock: herencia al nacer, crónica del historiador y epopeya por una leyenda", async () => {
    const dir = mkdtempSync(join(tmpdir(), "genesis-life-"));
    try {
      const w = createWorld(dir, "vida", 51, { world: { size: 64, initialPopulation: 14 }, brain: { historianEveryDays: 3 } });
      const e = w.engine;
      const society = new Society(e, w.db);
      society.install();
      e.society = society;
      const brain = new Brain(e, buildRoutes(e.config, "mock")!, w.db, { density: 1, society });
      brain.install();
      // forzamos un nacimiento y una muerte notable
      const ids = e.s.alive;
      const mother = e.s.agents.get(ids.find((id) => e.s.agents.get(id)!.sex === "f")!)!;
      const father = e.s.agents.get(ids.find((id) => e.s.agents.get(id)!.sex === "m")!)!;
      mother.bondedTo = father.id;
      father.bondedTo = mother.id;
      mother.pregnantUntil = e.s.tick + 10;
      mother.pregnantBy = father.id;
      const legend = e.s.agents.get(ids[ids.length - 1]!)!;
      for (const id of ids) if (id !== legend.id) e.s.agents.get(id)!.relationships.set(legend.id, { trust: 0.9, affinity: 0.9, debt: 0, kinship: 0, familiarity: 0.9, label: "amigo", lastTick: 0, interactions: 5 });
      legend.inventory.set("arte", 4);
      let childId: number | null = null;
      const created: string[] = [];
      for (let t = 0; t < 144 * 7; t++) {
        const out = e.step();
        w.writer.write(out);
        for (const ev of out.events) {
          if (ev.kind === "agent.born") childId = ev.agentId;
          if (ev.kind === "create") created.push(String(ev.data.tipo));
        }
        if (t === 144 * 2) {
          legend.causeOfDeath = "vejez";
          legend.health = 0; // muere en el próximo tick, dentro del loop del mundo
          legend.needs.sed = 0;
        }
        await new Promise<void>((r) => setImmediate(r));
      }
      w.writer.flush();
      expect(childId).not.toBeNull();
      const child = e.s.agents.get(childId!)!;
      expect(child.culturalGenome.length).toBeGreaterThan(20);
      expect(child.parents[0]).toBe(mother.id);
      expect(w.db.chronicle().length).toBeGreaterThan(0);
      expect(created).toContain("epopeya");
      expect([...e.s.texts.values()].some((t) => t.kind === "epopeya")).toBe(true);
      expect(brain.scheduler.callsFailed).toBe(0);
      w.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
