import { describe, expect, it } from "vitest";
import { Rng, RngStreams, hashString } from "../src/rng.ts";

describe("Rng", () => {
  it("es determinista para la misma seed", () => {
    const a = new Rng(42, "x");
    const b = new Rng(42, "x");
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("streams distintos dan secuencias distintas", () => {
    const s = new RngStreams(7);
    const a = s.get("climate").float();
    const b = s.get("actions").float();
    expect(a).not.toBe(b);
  });

  it("guarda y restaura el estado", () => {
    const r = new Rng(3);
    r.float();
    const st = r.state();
    const next = r.float();
    const r2 = Rng.fromState(st);
    expect(r2.float()).toBe(next);
  });

  it("int y pick se mantienen en rango", () => {
    const r = new Rng(9);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
    expect(["a", "b"]).toContain(r.pick(["a", "b"]));
  });

  it("la normal tiene media y desvío razonables", () => {
    const r = new Rng(11);
    let sum = 0;
    let sq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.normal(0, 1);
      sum += v;
      sq += v * v;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(Math.abs(sq / n - 1)).toBeLessThan(0.05);
  });

  it("hashString es estable", () => {
    expect(hashString("genesis")).toBe(hashString("genesis"));
    expect(hashString("genesis")).not.toBe(hashString("génesis"));
  });
});
