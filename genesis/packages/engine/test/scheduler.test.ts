import { describe, expect, it } from "vitest";
import { BudgetTracker, ThoughtScheduler, type ThoughtRequest } from "../src/cognition/scheduler.ts";
import { loadConfig } from "../src/config.ts";
import { usdFor, type BrainProvider, type BrainRequest, type BrainResponse } from "../src/brain/provider.ts";
import { SCHEMAS } from "../src/cognition/system2/schemas.ts";

class FakeProvider implements BrainProvider {
  name = "fake";
  model = "claude-haiku-4-5";
  calls = 0;
  constructor(private readonly delay = 0) {}
  async call<T>(req: BrainRequest<T>): Promise<BrainResponse<T>> {
    this.calls++;
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    const usage = { inputTokens: 1000, cacheRead: 4000, cacheWrite: 0, outputTokens: 300 };
    return { status: "ok", parsed: {} as T, raw: "{}", usage, model: this.model, provider: this.name, latencyMs: 1, usd: usdFor(this.model, usage), error: null };
  }
}

function req(sched: ThoughtScheduler, id: number, priority: number, opts: Partial<ThoughtRequest> = {}): ThoughtRequest & { applied: number; dropped: string[] } {
  const r = {
    id,
    agentId: id,
    type: "daily_plan" as const,
    route: "routine" as const,
    priority,
    enqueuedTick: 0,
    deadlineTick: null,
    estUsd: 0.001,
    key: `k${id}`,
    applied: 0,
    dropped: [] as string[],
    build: () => ({ id, agentId: id, type: "daily_plan" as const, route: "routine" as const, system: [], user: "", schema: SCHEMAS.daily_plan, maxTokens: 10, promptHash: "" }),
    apply: () => {
      r.applied++;
    },
    onDropped: (reason: string) => {
      r.dropped.push(reason);
    },
    ...opts,
  };
  void sched;
  return r;
}

describe("presupuesto", () => {
  it("calcula el costo con la tabla de precios", () => {
    const usd = usdFor("claude-haiku-4-5", { inputTokens: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0, outputTokens: 1_000_000 });
    expect(usd).toBeCloseTo(1 + 0.1 + 5, 6);
    expect(usdFor("claude-fable-5-1", { inputTokens: 0, cacheRead: 1_000_000, cacheWrite: 0, outputTokens: 0 })).toBeCloseTo(0.25, 6);
  });

  it("silencia al superar los topes y se recupera al día siguiente", () => {
    const b = new BudgetTracker(1, 100, 1000);
    expect(b.allows(0.5)).toBe(true);
    b.add(0.9);
    expect(b.allows(0.2)).toBe(false);
    expect(b.muted).toBe("day");
    b.newDay();
    expect(b.allows(0.2)).toBe(true);
    expect(b.muted).toBe("none");
    b.add(999.5);
    expect(b.allows(1)).toBe(false);
    expect(b.muted).toBe("total");
  });
});

describe("scheduler", () => {
  it("despacha por prioridad, deduplica y respeta la concurrencia", async () => {
    const cfg = loadConfig({ brain: { concurrency: 2 } });
    const provider = new FakeProvider(5);
    let tick = 0;
    const sched = new ThoughtScheduler({ routine: provider, epochal: provider, mode: "mock" }, cfg, () => tick);
    const r1 = req(sched, 1, 3);
    const r2 = req(sched, 2, 0);
    const r3 = req(sched, 3, 1);
    expect(sched.enqueue(r1)).toBe(true);
    expect(sched.enqueue(r2)).toBe(true);
    expect(sched.enqueue(r3)).toBe(true);
    expect(sched.enqueue(req(sched, 2, 0))).toBe(false); // misma clave
    sched.pump();
    expect(sched.flying).toBe(2);
    expect(sched.queued).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    sched.pump();
    await new Promise((r) => setTimeout(r, 20));
    const done = sched.drain();
    expect(done.map((d) => d.req.id)).toEqual([2, 3, 1]);
    expect(sched.budget.usdTotal).toBeGreaterThan(0);
    expect(sched.cacheHitRate()).toBeGreaterThan(0.5);
  });

  it("descarta lo poco prioritario bajo presión y lo vencido antes de despachar", () => {
    const cfg = loadConfig({ brain: { concurrency: 1 } });
    const provider = new FakeProvider();
    let tick = 100;
    const sched = new ThoughtScheduler({ routine: provider, epochal: provider, mode: "mock" }, cfg, () => tick);
    for (let i = 1; i <= 4; i++) expect(sched.enqueue(req(sched, i, 1))).toBe(true);
    const low = req(sched, 50, 3);
    expect(sched.enqueue(low)).toBe(false);
    expect(low.dropped[0]).toContain("presión");
    const expired = req(sched, 60, 0, { deadlineTick: 50 });
    expect(sched.enqueue(expired)).toBe(true);
    sched.pump();
    expect(expired.dropped[0]).toContain("venció");
  });

  it("con el presupuesto agotado solo pasan las reacciones", () => {
    const cfg = loadConfig({ brain: { concurrency: 4 }, budget: { usdTotal: 0.0001 } });
    const provider = new FakeProvider();
    const sched = new ThoughtScheduler({ routine: provider, epochal: provider, mode: "mock" }, cfg, () => 0);
    sched.budget.add(0.001);
    const plan = req(sched, 1, 1);
    const reaction = req(sched, 2, 0);
    sched.enqueue(plan);
    sched.enqueue(reaction);
    sched.pump();
    expect(plan.dropped[0]).toContain("presupuesto");
    expect(sched.flying).toBe(1);
    expect(sched.muted).toBe(true);
    expect(sched.budgetInfo().mode).toBe("mute");
  });
});
