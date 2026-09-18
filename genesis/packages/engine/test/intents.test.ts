import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine.ts";
import { applyDialogue, applyReflection, type IntentSink } from "../src/cognition/system2/intents.ts";
import type { WorldEvent } from "../src/sim/events.ts";
import type { Dialogue, Reflection } from "../src/cognition/system2/schemas.ts";

function setup() {
  const engine = Engine.genesis({ world: { size: 64, initialPopulation: 6 } }, 9);
  for (let t = 0; t < 30; t++) engine.step();
  const a = engine.s.agents.get(engine.s.alive[0]!)!;
  const b = engine.s.agents.get(engine.s.alive[1]!)!;
  b.x = a.x;
  b.y = a.y;
  const events: WorldEvent[] = [];
  const sink: IntentSink = {
    emit: (e) => events.push(e),
    learn: (ag, tech) => ag.knows.add(tech),
    conversation: () => 1,
    text: () => 1,
    invent: () => null,
  };
  return { engine, a, b, events, sink };
}

function dialogueWith(acuerdos: Dialogue["acuerdos"]): Dialogue {
  return {
    turnos: [
      { hablante: "A", texto: "Hola" },
      { hablante: "B", texto: "Hola" },
    ],
    acuerdos,
    cambio_relacion: { A_hacia_B: { confianza: 0.1, afinidad: 0.1 }, B_hacia_A: { confianza: 0.1, afinidad: 0.1 } },
    animo_A: "sereno",
    animo_B: "sereno",
    resumen_para_A: "hablamos",
    resumen_para_B: "hablamos",
  };
}

describe("intents", () => {
  it("un trueque con bienes se ejecuta; sin bienes queda como promesa", () => {
    const { engine, a, b, events, sink } = setup();
    a.inventory.clear();
    b.inventory.clear();
    a.inventory.set("madera", 3);
    b.inventory.set("comida", 3);
    applyDialogue(a, b, engine.s, dialogueWith([{ tipo: "intercambio", de: "A", a: "B", objeto: "madera", cantidad: 2, contra_objeto: "comida", contra_cantidad: 1, texto: null }]), sink);
    expect(a.inventory.get("madera")).toBe(1);
    expect(a.inventory.get("comida")).toBe(1);
    expect(b.inventory.get("madera")).toBe(2);
    expect(b.inventory.get("comida")).toBe(2);
    expect(events.some((e) => e.kind === "trade")).toBe(true);
    expect(engine.s.today.trades).toBe(1);

    const before = events.length;
    applyDialogue(a, b, engine.s, dialogueWith([{ tipo: "intercambio", de: "A", a: "B", objeto: "gema", cantidad: 1, contra_objeto: "comida", contra_cantidad: 1, texto: null }]), sink);
    expect(events.slice(before).some((e) => e.kind === "trade")).toBe(false);
    expect(b.relationships.get(a.id)!.debt).toBe(1);
    expect(a.relationships.get(b.id)!.debt).toBe(-1);
    expect(b.memories.some((m) => m.tags.includes("promesa"))).toBe(true);
  });

  it("la enseñanza transfiere técnicas y la unión forma pareja", () => {
    const { engine, a, b, sink } = setup();
    a.knows.add("fuego");
    engine.s.rng.get("social"); // determinista
    let taught = false;
    for (let i = 0; i < 6 && !taught; i++) {
      applyDialogue(a, b, engine.s, dialogueWith([{ tipo: "enseñanza", de: "A", a: "B", objeto: "fuego", cantidad: null, contra_objeto: null, contra_cantidad: null, texto: null }]), sink);
      taught = b.knows.has("fuego");
    }
    expect(taught).toBe(true);
    a.bornTick = -100000;
    b.bornTick = -100000;
    applyDialogue(a, b, engine.s, dialogueWith([{ tipo: "union", de: "A", a: "B", objeto: null, cantidad: null, contra_objeto: null, contra_cantidad: null, texto: null }]), sink);
    expect(a.bondedTo).toBe(b.id);
    expect(b.bondedTo).toBe(a.id);
    expect(a.relationships.get(b.id)!.label).toBe("pareja");
  });

  it("la reflexión crea creencias compartibles que explican eventos", () => {
    const { engine, a, b, events, sink } = setup();
    const out: Reflection = {
      sueño: null,
      reflexiones: [{ texto: "Las tormentas llegan cuando alguien rompe una promesa", importancia: 7 }],
      creencias_nuevas: [{ enunciado: "Las tormentas son la ira del cielo", tipo: "cosmologia", confianza: 0.7, explica: ["tormenta"] }],
      creencias_revisadas: [],
      relaciones: [{ ser: b.name, confianza: 0.2, afinidad: 0.9, etiqueta: "amigo" }],
      intencion_manana: "hablar con todos",
    };
    applyReflection(a, engine.s, out, sink);
    expect(engine.s.beliefs.size).toBe(1);
    expect(a.beliefs.size).toBe(1);
    expect(events.some((e) => e.kind === "belief")).toBe(true);
    expect(a.relationships.get(b.id)!.affinity).toBeCloseTo(0.3, 5);
    expect(a.relationships.get(b.id)!.label).toBe("amigo");
    expect(a.intention).toBe("hablar con todos");
    // transmisión: B adopta la creencia de A
    applyDialogue(a, b, engine.s, dialogueWith([{ tipo: "transmision_creencia", de: "A", a: "B", objeto: null, cantidad: null, contra_objeto: null, contra_cantidad: null, texto: "Las tormentas son la ira del cielo" }]), sink);
    expect(b.beliefs.size).toBe(1);
    expect(engine.s.beliefs.size).toBe(1);
    const belief = [...engine.s.beliefs.values()][0]!;
    expect(belief.holders.size).toBe(2);
    expect(belief.transmissions).toBe(1);
  });
});
