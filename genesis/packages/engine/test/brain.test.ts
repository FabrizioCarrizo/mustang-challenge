import { describe, expect, it } from "vitest";
import { Brain } from "../src/brain/brain.ts";
import { buildRoutes } from "../src/brain/router.ts";
import { Engine } from "../src/sim/engine.ts";
import { GUIDES } from "../src/cognition/system2/prompts/guides.ts";
import { buildWorldLaws } from "../src/cognition/system2/prompts/laws.ts";
import { estimateTokens } from "../src/brain/provider.ts";
import { buildDailyPlan, buildDialogue } from "../src/cognition/system2/builders.ts";
import { Bm25Retriever } from "../src/memory/retrieval.ts";
import { loadConfig } from "../src/config.ts";

async function runWithBrain(seed: number, days: number, pop = 16): Promise<{ engine: Engine; brain: Brain; kinds: Record<string, number> }> {
  const engine = Engine.genesis({ world: { size: 64, initialPopulation: pop } }, seed);
  const routes = buildRoutes(engine.config, "mock")!;
  const brain = new Brain(engine, routes, null, { density: 1 });
  brain.install();
  const kinds: Record<string, number> = {};
  for (let t = 0; t < 144 * days; t++) {
    const out = engine.step();
    for (const e of out.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    await new Promise<void>((r) => setImmediate(r));
  }
  return { engine, brain, kinds };
}

describe("cerebro con MockBrain", () => {
  it("las leyes más la guía superan el mínimo cacheable", () => {
    const laws = buildWorldLaws(loadConfig({}));
    expect(estimateTokens(laws) + estimateTokens(GUIDES.daily_plan)).toBeGreaterThan(4096);
    expect(laws).not.toMatch(/undefined|NaN/);
  });

  it("el prefijo del prompt es idéntico entre llamadas del mismo día y no incluye ticks", () => {
    const engine = Engine.genesis({ world: { size: 64, initialPopulation: 8 } }, 5);
    for (let t = 0; t < 50; t++) engine.step();
    const ctx = { s: engine.s, spatial: engine.spatial, retriever: new Bm25Retriever(), laws: buildWorldLaws(engine.config), groupNameOf: () => null, leaderNameOf: () => null, names: engine.names };
    const a = engine.s.agents.get(engine.s.alive[0]!)!;
    const b = engine.s.agents.get(engine.s.alive[1]!)!;
    const p1 = buildDailyPlan(a, ctx);
    engine.step();
    engine.step();
    const p2 = buildDailyPlan(a, ctx);
    const p3 = buildDialogue(a, b, ["se cruzaron"], ctx);
    expect(p1.system.map((s) => s.text).join("")).toBe(p2.system.map((s) => s.text).join(""));
    expect(p1.system[0]!.text).toBe(p3.system[0]!.text);
    expect(p1.system[2]!.text).toBe(p3.system[2]!.text);
    expect(p1.system[0]!.cache).toBe(true);
    expect(p1.system[2]!.text).not.toMatch(/tick|\bhora\b/);
    expect(p1.user).toContain("# AHORA");
    expect(p1.user).toContain(a.name.length ? "Mochila" : "");
    expect(p3.user).toContain(`B es ${b.name}`);
  });

  it("planifica, conversa, reflexiona y forma creencias en 3 días", async () => {
    const { engine, brain, kinds } = await runWithBrain(31, 3);
    const s = engine.s;
    const withPlan = s.alive.filter((id) => s.agents.get(id)!.plan.length > 0).length;
    expect(withPlan).toBeGreaterThan(s.alive.length * 0.5);
    expect(kinds["intent"] ?? 0).toBeGreaterThan(10);
    expect(kinds["dialogue"] ?? 0).toBeGreaterThan(0);
    const kindsOfMemory = new Set<string>();
    for (const id of s.alive) for (const m of s.agents.get(id)!.memories) kindsOfMemory.add(m.kind);
    expect(kindsOfMemory.has("diario")).toBe(true);
    expect(kindsOfMemory.has("dialogo")).toBe(true);
    expect(kindsOfMemory.has("reflexion")).toBe(true);
    expect(brain.scheduler.callsOk).toBeGreaterThan(10);
    expect(brain.scheduler.callsFailed).toBe(0);
    expect(brain.scheduler.flying).toBe(0);
    // nadie queda "conversando" para siempre
    for (const id of s.alive) expect(s.agents.get(id)!.conversingUntil).toBeLessThan(s.tick);
    const budget = brain.budgetInfo();
    expect(budget.mode).toBe("mock");
  });

  it("dos corridas con la misma seed dan la misma historia", async () => {
    const a = await runWithBrain(77, 2, 12);
    const b = await runWithBrain(77, 2, 12);
    expect(a.engine.hash()).toBe(b.engine.hash());
    expect(a.kinds).toEqual(b.kinds);
  });
});
