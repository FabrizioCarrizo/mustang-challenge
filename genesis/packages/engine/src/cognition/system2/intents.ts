import type { ItemKind } from "@genesis/protocol";
import { ITEMS } from "@genesis/protocol";
import { addItem, adjustRelationship, inv, isAdult, remember, takeItem, type Agent } from "../../agents/agent.ts";
import { clamp01 } from "../../agents/needs.ts";
import { makeEvent, type WorldEvent } from "../../sim/events.ts";
import type { EngineState } from "../../sim/state.ts";
import { holdBelief, reviseBelief, findSimilarBelief, beliefsOf } from "../../society/beliefs.ts";
import { sanitizeInWorldText } from "./prompts/situation.ts";
import { findAgentByName, markStepDoneByVerb, planFromOutput } from "./plans.ts";
import type { Creation, DailyPlan, Dialogue, Reaction, Reflection } from "./schemas.ts";

export interface IntentSink {
  emit(e: WorldEvent): void;
  learn(a: Agent, tech: string, how: string): void;
  conversation(row: { tick: number; aId: number; bId: number; x: number; y: number; turns: Array<{ speaker: "A" | "B"; text: string }>; outcomes: Array<{ tipo: string; detalle: string }>; summaryA: string; summaryB: string }): number;
  text(row: { authorId: number; tick: number; title: string; body: string; medium: string; kind: string; x: number; y: number }): number;
  /** intento de invención: devuelve la técnica descubierta o null */
  invent(a: Agent, recipe: { resultado: string; ingredientes: string[]; proceso: string }): string | null;
}

function clampDelta(v: number, max = 0.3): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-max, Math.min(max, v));
}

export function applyDailyPlan(a: Agent, s: EngineState, out: DailyPlan, sink: IntentSink): void {
  a.plan = planFromOutput(a, s, out);
  a.planTick = s.tick;
  a.lastPlanDay = s.clock.day;
  a.mood = out.estado_animo;
  a.intention = null;
  a.socialWishes = out.deseo_social.map((w) => findAgentByName(s, w.ser, a)).filter((id): id is number => id !== null);
  a.diaryPending = [];
  const nota = sanitizeInWorldText(out.nota_diario, 600);
  if (nota) remember(s, a, "diario", nota, 3, ["diario"]);
  sink.emit(
    makeEvent({
      kind: "intent",
      tick: s.tick,
      agentId: a.id,
      x: a.x,
      y: a.y,
      label: `planear el día (${a.plan.length} pasos)`,
      importance: 1,
      data: { type: "daily_plan", output: out },
      persist: true,
    }),
  );
}

export function applyReflection(a: Agent, s: EngineState, out: Reflection, sink: IntentSink): void {
  for (const r of out.reflexiones.slice(0, 4)) {
    const text = sanitizeInWorldText(r.texto, 400);
    if (text) remember(s, a, "reflexion", text, Math.max(3, Math.min(10, Math.round(r.importancia))), ["reflexion"]);
  }
  if (out.sueño) remember(s, a, "sueño", sanitizeInWorldText(out.sueño, 300), 3, ["sueño"]);
  for (const c of out.creencias_nuevas.slice(0, 2)) {
    const statement = sanitizeInWorldText(c.enunciado, 240);
    if (!statement) continue;
    const { belief, isNew, adopted } = holdBelief(s, a, { statement, kind: c.tipo, confidence: c.confianza, explains: c.explica });
    if (adopted) {
      remember(s, a, "creencia", `Creo que ${statement}`, 6, ["creencia", ...belief.explains]);
      a.needs.sentido = clamp01(a.needs.sentido + 0.1);
      sink.emit(
        makeEvent({
          kind: "belief",
          tick: s.tick,
          agentId: a.id,
          x: a.x,
          y: a.y,
          label: `empezó a creer que ${statement}`,
          importance: isNew ? 5 : 3,
          data: { beliefId: belief.id, statement, kind: c.tipo, first: isNew },
          tags: ["creencia", ...belief.explains],
        }),
      );
    }
  }
  for (const c of out.creencias_revisadas.slice(0, 4)) reviseBelief(s, a, c.enunciado, c.confianza);
  for (const r of out.relaciones.slice(0, 6)) {
    const id = findAgentByName(s, r.ser, a);
    if (id === null) continue;
    const rel = adjustRelationship(a, id, s.tick, { trust: clampDelta(r.confianza), affinity: clampDelta(r.afinidad) });
    if (r.etiqueta) rel.label = sanitizeInWorldText(r.etiqueta, 24).toLowerCase();
  }
  a.intention = out.intencion_manana ? sanitizeInWorldText(out.intencion_manana, 200) : null;
  a.lastReflectionTick = s.tick;
  a.importanceSinceReflection = 0;
  sink.emit(
    makeEvent({ kind: "intent", tick: s.tick, agentId: a.id, x: a.x, y: a.y, label: "reflexionar", importance: 1, data: { type: "reflection", output: out }, persist: true }),
  );
}

function itemOf(name: string | null): ItemKind | null {
  if (!name) return null;
  const n = name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (ITEMS as readonly string[]).includes(n) ? (n as ItemKind) : null;
}

export function applyDialogue(a: Agent, b: Agent, s: EngineState, out: Dialogue, sink: IntentSink): void {
  const who = (side: "A" | "B") => (side === "A" ? a : b);
  const turns = out.turnos.slice(0, 6).map((t) => ({ speaker: t.hablante, text: sanitizeInWorldText(t.texto, 300) })).filter((t) => t.text);
  const outcomes: Array<{ tipo: string; detalle: string }> = [];
  let importance = 3;
  for (const ac of out.acuerdos.slice(0, 5)) {
    const de = who(ac.de);
    const to = who(ac.a);
    if (de === to && ac.tipo !== "ninguno") continue;
    switch (ac.tipo) {
      case "intercambio": {
        const give = itemOf(ac.objeto);
        const get = itemOf(ac.contra_objeto);
        const n1 = Math.max(1, Math.min(5, Math.round(ac.cantidad ?? 1)));
        const n2 = Math.max(1, Math.min(5, Math.round(ac.contra_cantidad ?? 1)));
        if (give && get && inv(de, give) >= n1 && inv(to, get) >= n2) {
          takeItem(de, give, n1);
          takeItem(to, get, n2);
          addItem(to, give, n1);
          addItem(de, get, n2);
          s.today.trades++;
          s.totals.trades++;
          sink.emit(
            makeEvent({
              kind: "trade",
              tick: s.tick,
              agentId: de.id,
              targetId: to.id,
              x: a.x,
              y: a.y,
              label: `${give}/${get}`,
              data: { dio: `${n1} ${give}`, recibio: `${n2} ${get}`, gave: { [give]: n1 }, got: { [get]: n2 } },
              tags: ["trueque"],
            }),
          );
          outcomes.push({ tipo: "intercambio", detalle: `${de.name} dio ${n1} ${give} por ${n2} ${get}` });
          importance += 2;
        } else if (give || get) {
          // no tenían lo prometido: queda como promesa
          adjustRelationship(to, de.id, s.tick, { debt: 1 });
          adjustRelationship(de, to.id, s.tick, { debt: -1 });
          const what = `${de.name} prometió ${give ?? ac.objeto} a cambio de ${get ?? ac.contra_objeto}`;
          remember(s, to, "dialogo", what, 5, ["promesa"], [de.id]);
          remember(s, de, "dialogo", `Prometí a ${to.name}: ${give ?? ac.objeto} por ${get ?? ac.contra_objeto}`, 5, ["promesa"], [to.id]);
          outcomes.push({ tipo: "promesa", detalle: what });
          importance += 1;
        }
        break;
      }
      case "regalo": {
        const item = itemOf(ac.objeto);
        const n = Math.max(1, Math.min(5, Math.round(ac.cantidad ?? 1)));
        if (item && inv(de, item) >= n) {
          takeItem(de, item, n);
          addItem(to, item, n);
          adjustRelationship(to, de.id, s.tick, { trust: 0.08, affinity: 0.1, debt: -1 });
          adjustRelationship(de, to.id, s.tick, { affinity: 0.03, debt: 1 });
          s.today.gifts++;
          sink.emit(makeEvent({ kind: "gift", tick: s.tick, agentId: de.id, targetId: to.id, x: a.x, y: a.y, label: item, data: { cantidad: n }, tags: ["regalo", "generosidad"] }));
          outcomes.push({ tipo: "regalo", detalle: `${de.name} regaló ${n} ${item} a ${to.name}` });
          importance += 2;
        }
        break;
      }
      case "promesa":
      case "deuda": {
        const text = sanitizeInWorldText(ac.texto ?? ac.objeto ?? "un favor", 200);
        adjustRelationship(to, de.id, s.tick, { debt: 1 });
        adjustRelationship(de, to.id, s.tick, { debt: -1 });
        remember(s, to, "dialogo", `${de.name} me prometió: ${text}`, 5, ["promesa"], [de.id]);
        remember(s, de, "dialogo", `Le prometí a ${to.name}: ${text}`, 5, ["promesa"], [to.id]);
        outcomes.push({ tipo: ac.tipo, detalle: `${de.name} → ${to.name}: ${text}` });
        importance += 1;
        break;
      }
      case "alianza": {
        for (const [x, y] of [
          [de, to],
          [to, de],
        ] as const) {
          const rel = adjustRelationship(x, y.id, s.tick, { trust: 0.15, affinity: 0.1 });
          if (!rel.label || rel.label === "conocido") rel.label = "aliado";
        }
        sink.emit(makeEvent({ kind: "bond", tick: s.tick, agentId: de.id, targetId: to.id, x: a.x, y: a.y, label: "alianza", importance: 6, tags: ["alianza"] }));
        outcomes.push({ tipo: "alianza", detalle: `${de.name} y ${to.name} se aliaron` });
        importance += 3;
        break;
      }
      case "enseñanza": {
        const tech = (ac.objeto ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        if (tech && de.knows.has(tech) && !to.knows.has(tech)) {
          const chance = 0.4 + 0.45 * to.genome.inteligencia + 0.15 * de.genome.empatia;
          if (s.rng.get("social").chance(chance)) {
            sink.learn(to, tech, `porque ${de.name} le enseñó`);
            sink.emit(makeEvent({ kind: "teach", tick: s.tick, agentId: de.id, targetId: to.id, x: a.x, y: a.y, label: tech, importance: 5, tags: ["enseñanza", tech] }));
            adjustRelationship(to, de.id, s.tick, { trust: 0.1, affinity: 0.08, debt: -1 });
            de.needs.estima = clamp01(de.needs.estima + 0.15);
            outcomes.push({ tipo: "enseñanza", detalle: `${de.name} enseñó ${tech} a ${to.name}` });
            importance += 2;
          } else {
            outcomes.push({ tipo: "enseñanza", detalle: `${de.name} intentó enseñar ${tech} a ${to.name}, sin éxito` });
          }
        }
        break;
      }
      case "transmision_creencia": {
        const statement = sanitizeInWorldText(ac.texto ?? ac.objeto ?? "", 240);
        if (!statement) break;
        const held = beliefsOf(s, de);
        let source = findSimilarBelief(s, statement, 0.5);
        let sourceConf = source ? (de.beliefs.get(source.id) ?? 0.4) : 0.4;
        if (!source && held.length) {
          source = held[0]!.belief;
          sourceConf = held[0]!.confidence;
        }
        const trust = to.relationships.get(de.id)?.trust ?? 0.3;
        const conf = sourceConf * (0.5 + 0.5 * trust) * (0.6 + 0.4 * to.genome.empatia);
        if (conf < 0.15) break;
        const { belief, adopted } = holdBelief(s, to, {
          statement: source ? source.statement : statement,
          kind: source ? source.kind : "mito",
          confidence: conf,
          explains: source ? source.explains : [],
          founderId: source ? source.founderId : de.id,
        });
        if (adopted) {
          belief.transmissions++;
          remember(s, to, "creencia", `${de.name} me convenció de que ${belief.statement}`, 5, ["creencia", ...belief.explains], [de.id]);
          to.needs.sentido = clamp01(to.needs.sentido + 0.08);
          sink.emit(
            makeEvent({
              kind: "belief",
              tick: s.tick,
              agentId: to.id,
              targetId: de.id,
              x: a.x,
              y: a.y,
              label: `adoptó de ${de.name} la creencia de que ${belief.statement}`,
              importance: 4,
              data: { beliefId: belief.id, statement: belief.statement, from: de.id },
              tags: ["creencia", ...belief.explains],
            }),
          );
          outcomes.push({ tipo: "transmision_creencia", detalle: `${to.name} ahora cree que ${belief.statement}` });
          importance += 2;
        }
        break;
      }
      case "invitacion": {
        const rel = adjustRelationship(to, de.id, s.tick, { affinity: 0.05, trust: 0.05 });
        if (!rel.label) rel.label = "invitado";
        outcomes.push({ tipo: "invitacion", detalle: `${de.name} invitó a ${to.name} a unirse a su gente` });
        break;
      }
      case "amenaza": {
        to.needs.seguridad = clamp01(to.needs.seguridad - 0.2);
        adjustRelationship(to, de.id, s.tick, { affinity: -0.2, trust: -0.2 });
        remember(s, to, "dialogo", `${de.name} me amenazó: ${sanitizeInWorldText(ac.texto ?? "", 160)}`, 6, ["amenaza"], [de.id]);
        outcomes.push({ tipo: "amenaza", detalle: `${de.name} amenazó a ${to.name}` });
        importance += 2;
        break;
      }
      case "reconciliacion": {
        for (const [x, y] of [
          [de, to],
          [to, de],
        ] as const) {
          const rel = adjustRelationship(x, y.id, s.tick, { trust: 0.1 });
          rel.affinity = Math.max(0, rel.affinity) + 0.2;
          if (rel.label === "enemigo" || rel.label === "rival") rel.label = null;
        }
        outcomes.push({ tipo: "reconciliacion", detalle: `${de.name} y ${to.name} hicieron las paces` });
        importance += 2;
        break;
      }
      case "union": {
        const cfg = s.config;
        if (isAdult(de, s.tick, cfg) && isAdult(to, s.tick, cfg) && (de.bondedTo === null || de.bondedTo === to.id) && (to.bondedTo === null || to.bondedTo === de.id)) {
          de.bondedTo = to.id;
          to.bondedTo = de.id;
          for (const [x, y] of [
            [de, to],
            [to, de],
          ] as const) {
            const rel = adjustRelationship(x, y.id, s.tick, { trust: 0.2, affinity: 0.2 });
            rel.label = "pareja";
            rel.kinship = Math.max(rel.kinship, 0.5);
          }
          sink.emit(makeEvent({ kind: "bond", tick: s.tick, agentId: de.id, targetId: to.id, x: a.x, y: a.y, label: "pareja", importance: 7, tags: ["union", "pareja"] }));
          outcomes.push({ tipo: "union", detalle: `${de.name} y ${to.name} se unieron como pareja` });
          importance += 3;
        }
        break;
      }
      default:
        break;
    }
  }
  const ab = out.cambio_relacion.A_hacia_B;
  const ba = out.cambio_relacion.B_hacia_A;
  adjustRelationship(a, b.id, s.tick, { trust: clampDelta(ab.confianza), affinity: clampDelta(ab.afinidad), familiarity: 0.08 });
  adjustRelationship(b, a.id, s.tick, { trust: clampDelta(ba.confianza), affinity: clampDelta(ba.afinidad), familiarity: 0.08 });
  a.mood = out.animo_A;
  b.mood = out.animo_B;
  const conversationId = sink.conversation({
    tick: s.tick,
    aId: a.id,
    bId: b.id,
    x: a.x,
    y: a.y,
    turns,
    outcomes,
    summaryA: sanitizeInWorldText(out.resumen_para_A, 300),
    summaryB: sanitizeInWorldText(out.resumen_para_B, 300),
  });
  const imp = Math.min(9, importance);
  remember(s, a, "dialogo", `Con ${b.name}: ${sanitizeInWorldText(out.resumen_para_A, 300)}`, imp, ["charla"], [b.id]);
  remember(s, b, "dialogo", `Con ${a.name}: ${sanitizeInWorldText(out.resumen_para_B, 300)}`, imp, ["charla"], [a.id]);
  for (const side of ["A", "B"] as const) {
    const first = turns.find((t) => t.speaker === side);
    const speaker = who(side);
    if (first) {
      speaker.lastSpeech = first.text;
      speaker.lastSpeechTick = s.tick;
      sink.emit(makeEvent({ kind: "speech", tick: s.tick, agentId: speaker.id, x: speaker.x, y: speaker.y, importance: 1, data: { texto: first.text }, persist: false }));
    }
  }
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    x.needs.social = clamp01(x.needs.social + 0.3);
    x.needs.estima = clamp01(x.needs.estima + 0.03);
    x.dialoguesToday++;
    x.lastDialogueTick = s.tick;
    x.lastDialogueWith.set(y.id, s.tick);
    x.conversingWith = null;
    x.conversingUntil = -1;
    markStepDoneByVerb(x, "conversar", y.id);
  }
  s.today.dialogues++;
  sink.emit(
    makeEvent({
      kind: "dialogue",
      tick: s.tick,
      agentId: a.id,
      targetId: b.id,
      x: a.x,
      y: a.y,
      label: outcomes.map((o) => o.tipo).join(", "),
      importance: Math.min(7, 2 + outcomes.length),
      data: { conversationId, outcomes: outcomes.map((o) => o.tipo) },
      tags: ["charla"],
    }),
  );
  sink.emit(
    makeEvent({ kind: "intent", tick: s.tick, agentId: a.id, targetId: b.id, x: a.x, y: a.y, label: `conversar con ${b.name}`, importance: 1, data: { type: "dialogue", output: out }, persist: true }),
  );
}

export function applyReaction(a: Agent, s: EngineState, out: Reaction, event: WorldEvent, sink: IntentSink): void {
  const text = sanitizeInWorldText(out.interpretacion, 400);
  const intensity = Math.max(0, Math.min(1, out.intensidad));
  if (text) remember(s, a, "diario", text, Math.round(4 + intensity * 4), [...event.tags, "reaccion"]);
  a.mood = out.emocion;
  if (out.creencia) {
    const statement = sanitizeInWorldText(out.creencia.enunciado, 240);
    if (statement) {
      const { belief, isNew, adopted } = holdBelief(s, a, {
        statement,
        kind: out.creencia.tipo,
        confidence: out.creencia.confianza,
        explains: [...new Set([...out.creencia.explica, ...event.tags])],
      });
      if (adopted) {
        remember(s, a, "creencia", `Creo que ${belief.statement}`, 6, ["creencia", ...belief.explains]);
        sink.emit(
          makeEvent({
            kind: "belief",
            tick: s.tick,
            agentId: a.id,
            x: a.x,
            y: a.y,
            label: `empezó a creer que ${belief.statement}`,
            importance: isNew ? 5 : 3,
            data: { beliefId: belief.id, statement: belief.statement, kind: belief.kind, first: isNew },
            tags: ["creencia", ...belief.explains],
          }),
        );
      }
    }
  }
  a.needs.sentido = clamp01(a.needs.sentido + (out.explica_evento ? 0.06 : -0.04));
  if (out.accion_inmediata) {
    const steps = planFromOutput(a, s, {
      resumen_interno: "",
      estado_animo: out.emocion,
      objetivos: [{ verbo: out.accion_inmediata.verbo, objetivo: out.accion_inmediata.objetivo, cantidad: null, hasta_hora: null, prioridad: 5, motivo: text || "reacción" }],
      riesgo_percibido: "",
      deseo_social: [],
      nota_diario: "",
    });
    if (steps.length) a.plan.unshift(steps[0]!);
  }
  if (out.nota_diario) a.diaryPending.push(sanitizeInWorldText(out.nota_diario, 200));
  sink.emit(
    makeEvent({ kind: "intent", tick: s.tick, agentId: a.id, x: a.x, y: a.y, label: `reaccionar: ${out.emocion}`, importance: 1, data: { type: "reaction", output: out, event: event.kind }, persist: true }),
  );
}

export function applyCreate(a: Agent, s: EngineState, out: Creation, sink: IntentSink): void {
  const title = sanitizeInWorldText(out.titulo, 80) || "sin título";
  const body = sanitizeInWorldText(out.contenido, 900);
  if (out.tipo === "invento") {
    const recipe = out.receta_propuesta ?? { resultado: title, ingredientes: out.materiales, proceso: body };
    const tech = sink.invent(a, recipe);
    if (tech) {
      remember(s, a, "reflexion", `Probando ${recipe.ingredientes.join(" y ") || "lo que tenía"} descubrí ${tech}`, 8, ["invento", tech]);
    } else {
      remember(s, a, "diario", `Intenté hacer ${sanitizeInWorldText(recipe.resultado, 40)} con ${recipe.ingredientes.join(" y ") || "lo que tenía"} y no salió`, 3, ["invento"]);
      a.needs.estima = clamp01(a.needs.estima - 0.02);
    }
  } else {
    const medium = out.tipo === "arte" ? "objeto" : out.tipo === "texto" && a.knows.has("escritura") ? "escrito" : "oral";
    const textId = sink.text({ authorId: a.id, tick: s.tick, title, body, medium, kind: out.tipo, x: a.x, y: a.y });
    if (out.tipo === "arte") addItem(a, "arte", 1);
    remember(s, a, "diario", `Hice ${out.tipo === "arte" ? "una obra" : `un ${out.tipo}`}: ${title}`, 5, ["creacion", out.tipo]);
    sink.emit(
      makeEvent({
        kind: "create",
        tick: s.tick,
        agentId: a.id,
        x: a.x,
        y: a.y,
        label: `${out.tipo === "arte" ? "una obra" : `un ${out.tipo}`}: ${title}`,
        importance: 5,
        data: { textId, tipo: out.tipo, titulo: title, dedicadoA: out.dedicado_a },
        tags: ["creacion", "sentido"],
      }),
    );
    if (out.dedicado_a) {
      const id = findAgentByName(s, out.dedicado_a, a);
      if (id !== null) {
        const other = s.agents.get(id)!;
        adjustRelationship(other, a.id, s.tick, { affinity: 0.1, trust: 0.05 });
        remember(s, other, "observacion", `${a.name} me dedicó ${out.tipo === "arte" ? "una obra" : `un ${out.tipo}`}: ${title}`, 6, ["creacion"], [a.id]);
        other.needs.estima = clamp01(other.needs.estima + 0.1);
      }
    }
  }
  a.createdToday++;
  if (out.nota_diario) a.diaryPending.push(sanitizeInWorldText(out.nota_diario, 200));
  markStepDoneByVerb(a, "crear");
  sink.emit(makeEvent({ kind: "intent", tick: s.tick, agentId: a.id, x: a.x, y: a.y, label: `crear ${out.tipo}`, importance: 1, data: { type: "create", output: out }, persist: true }));
}
