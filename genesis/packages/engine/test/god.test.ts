import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine.ts";
import { Brain } from "../src/brain/brain.ts";
import { buildRoutes } from "../src/brain/router.ts";
import { idx } from "../src/world/grid.ts";

async function tickAsync(e: Engine, n: number, collect?: (kinds: string[]) => void): Promise<void> {
  for (let t = 0; t < n; t++) {
    const out = e.step();
    collect?.(out.events.map((ev) => (ev.kind === "intent" ? `intent:${String(ev.data.type)}` : ev.kind)));
    await new Promise<void>((r) => setImmediate(r));
  }
}

describe("poderes divinos", () => {
  it("el susurro deja una memoria, se graba como evento y provoca una reacción", async () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 6 } }, 71);
    const brain = new Brain(e, buildRoutes(e.config, "mock")!, null, { density: 1 });
    brain.install();
    await tickAsync(e, 40);
    const a = e.s.agents.get(e.s.alive[0]!)!;
    const p = e.god({ kind: "whisper", agentId: a.id, text: "El río recuerda a los que comparten" });
    const kinds: string[] = [];
    await tickAsync(e, 12, (k) => kinds.push(...k));
    const r = await p;
    expect(r.ok).toBe(true);
    expect(a.memories.some((m) => m.kind === "voz_divina" && m.text.includes("El río recuerda"))).toBe(true);
    expect(kinds).toContain("god");
    expect(kinds).toContain("intent:reaction");
  });

  it("fulminar, resucitar, sanar, teletransportar y aparecer seres", async () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 6 } }, 72);
    const a = e.s.agents.get(e.s.alive[0]!)!;
    const pop = e.s.alive.length;
    const smite = e.god({ kind: "smite", agentId: a.id });
    e.step();
    expect((await smite).ok).toBe(true);
    expect(a.diedTick).not.toBeNull();
    expect(a.causeOfDeath).toBe("un rayo del cielo");
    expect(e.s.alive.length).toBe(pop - 1);
    const res = e.god({ kind: "resurrect", agentId: a.id });
    e.step();
    expect((await res).ok).toBe(true);
    expect(a.diedTick).toBeNull();
    expect(e.s.alive.length).toBe(pop);
    a.health = 0.2;
    const heal = e.god({ kind: "heal", agentId: a.id });
    e.step();
    expect((await heal).ok).toBe(true);
    expect(a.health).toBeGreaterThan(0.95);
    // teletransporte a una celda caminable
    let tx = -1;
    let ty = -1;
    for (let y = 5; y < e.s.grid.size - 5 && tx < 0; y++) for (let x = 5; x < e.s.grid.size - 5; x++) {
      const t = e.s.grid.terrain[idx(e.s.grid.size, x, y)]!;
      if (t === 3 && Math.abs(x - a.x) > 15) {
        tx = x;
        ty = y;
        break;
      }
    }
    const tp = e.god({ kind: "teleport", agentId: a.id, x: tx, y: ty });
    e.step();
    expect((await tp).ok).toBe(true);
    expect(Math.abs(a.x - tx) + Math.abs(a.y - ty)).toBeLessThanOrEqual(2);
    const spawn = e.god({ kind: "spawn_agent", x: a.x, y: a.y, count: 3 });
    e.step();
    expect((await spawn).ok).toBe(true);
    expect(e.s.alive.length).toBe(pop + 3);
  });

  it("recursos, clima y desastres cambian el mundo", async () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 6 } }, 73);
    const a = e.s.agents.get(e.s.alive[0]!)!;
    const cell = idx(e.s.grid.size, a.x, a.y);
    const before = e.s.grid.resources.comida[cell]!;
    const sp = e.god({ kind: "spawn_resource", x: a.x, y: a.y, resource: "comida", amount: 5, radius: 1 });
    e.step();
    expect((await sp).ok).toBe(true);
    expect(e.s.grid.resources.comida[cell]!).toBeGreaterThanOrEqual(before + 4);
    const w = e.god({ kind: "weather", weather: "nieve", days: 2 });
    e.step();
    expect((await w).ok).toBe(true);
    expect(e.s.climate.weather).toBe("nieve");
    const d = e.god({ kind: "disaster", type: "eclipse" });
    const sentidoBefore = a.needs.sentido;
    e.step();
    expect((await d).ok).toBe(true);
    expect(a.needs.sentido).toBeLessThan(sentidoBefore);
    const q = e.god({ kind: "disaster", type: "sequia" });
    e.step();
    expect((await q).ok).toBe(true);
    expect(e.s.climate.drought).toBe(true);
  });
});
