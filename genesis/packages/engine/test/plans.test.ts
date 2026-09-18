import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine.ts";
import { planCandidate, planFromOutput } from "../src/cognition/system2/plans.ts";
import type { DailyPlan } from "../src/cognition/system2/schemas.ts";

function plan(objetivos: DailyPlan["objetivos"]): DailyPlan {
  return { resumen_interno: "", estado_animo: "sereno", objetivos, riesgo_percibido: "", deseo_social: [], nota_diario: "" };
}

describe("planes", () => {
  it("resuelve nombres de seres y descarta los desconocidos", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 6 } }, 3);
    const a = e.s.agents.get(e.s.alive[0]!)!;
    const b = e.s.agents.get(e.s.alive[1]!)!;
    const steps = planFromOutput(a, e.s, plan([
      { verbo: "conversar", objetivo: { tipo: "ser", nombre: b.name.toUpperCase() }, cantidad: null, hasta_hora: null, prioridad: 3, motivo: "hola" },
      { verbo: "conversar", objetivo: { tipo: "ser", nombre: "Nadie" }, cantidad: null, hasta_hora: null, prioridad: 3, motivo: "x" },
      { verbo: "ir_a", objetivo: { tipo: "lugar", nombre: "12, 7" }, cantidad: null, hasta_hora: null, prioridad: 5, motivo: "x" },
    ]));
    expect(steps.length).toBe(2);
    expect(steps[0]!.verbo).toBe("ir_a");
    expect(steps[0]!.targetX).toBe(12);
    expect(steps[1]!.targetId).toBe(b.id);
  });

  it("construir sin materiales se convierte en juntar madera", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 4 } }, 4);
    const a = e.s.agents.get(e.s.alive[0]!)!;
    a.home = null;
    a.inventory.clear();
    a.plan = planFromOutput(a, e.s, plan([{ verbo: "construir", objetivo: { tipo: "estructura", nombre: "refugio" }, cantidad: null, hasta_hora: null, prioridad: 5, motivo: "techo" }]));
    const c1 = planCandidate(a, e.s);
    expect(c1?.verb).toBe("juntar");
    expect(c1?.resource).toBe("madera");
    expect(c1?.fromPlan).toBe(true);
    a.inventory.set("madera", 5);
    const c2 = planCandidate(a, e.s);
    expect(c2?.verb).toBe("construir");
  });

  it("un objetivo imposible se abandona", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 4 } }, 4);
    const a = e.s.agents.get(e.s.alive[0]!)!;
    const b = e.s.agents.get(e.s.alive[1]!)!;
    b.x = Math.min(e.s.grid.size - 1, a.x + 40);
    a.plan = planFromOutput(a, e.s, plan([{ verbo: "conversar", objetivo: { tipo: "ser", nombre: b.name }, cantidad: null, hasta_hora: null, prioridad: 2, motivo: "x" }]));
    expect(planCandidate(a, e.s)).toBeNull();
    expect(a.plan[0]!.done).toBe(true);
  });
});
