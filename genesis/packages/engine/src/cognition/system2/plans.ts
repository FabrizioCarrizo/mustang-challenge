import type { ItemKind, ResourceKind, StructureKind } from "@genesis/protocol";
import { ITEMS, RESOURCES, STRUCTURES } from "@genesis/protocol";
import { inv, type Agent, type CurrentAction, type PlanStep } from "../../agents/agent.ts";
import type { EngineState } from "../../sim/state.ts";
import { NO_PATH, idx } from "../../world/grid.ts";
import { STRUCTURE_SPECS } from "../../world/structures.ts";
import { cand, type Candidate } from "../system1/utility.ts";
import type { DailyPlan } from "./schemas.ts";

const MAX_ATTEMPTS = 6;
const PLAN_BASE = 0.32;

/** Convierte el plan del LLM en pasos ejecutables, resolviendo nombres a ids y lugares. */
export function planFromOutput(a: Agent, s: EngineState, out: DailyPlan): PlanStep[] {
  const steps: PlanStep[] = [];
  const sorted = out.objetivos.slice().sort((p, q) => q.prioridad - p.prioridad);
  for (const o of sorted.slice(0, 6)) {
    const step: PlanStep = {
      verbo: o.verbo,
      objetivo: o.objetivo.nombre,
      objetivoTipo: o.objetivo.tipo,
      targetId: null,
      targetX: null,
      targetY: null,
      cantidad: o.cantidad,
      hastaHora: o.hasta_hora,
      prioridad: Math.max(1, Math.min(5, Math.round(o.prioridad))),
      motivo: o.motivo,
      done: false,
      attempts: 0,
      startAmount: null,
    };
    if (o.objetivo.tipo === "ser") {
      const id = findAgentByName(s, o.objetivo.nombre, a);
      if (id === null) continue;
      step.targetId = id;
    } else if (o.objetivo.tipo === "lugar") {
      const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(o.objetivo.nombre);
      if (m) {
        step.targetX = Math.min(s.grid.size - 1, Number(m[1]));
        step.targetY = Math.min(s.grid.size - 1, Number(m[2]));
      }
    }
    steps.push(step);
  }
  return steps;
}

export function findAgentByName(s: EngineState, name: string, self: Agent): number | null {
  const norm = name.trim().toLowerCase();
  if (!norm) return null;
  // primero entre los conocidos, después entre todos los vivos
  for (const [id] of self.relationships) {
    const o = s.agents.get(id);
    if (o && o.diedTick === null && o.name.toLowerCase() === norm) return id;
  }
  for (const id of s.alive) {
    const o = s.agents.get(id)!;
    if (o.id !== self.id && o.name.toLowerCase() === norm) return id;
  }
  return null;
}

function itemKind(name: string): ItemKind | null {
  const n = name.trim().toLowerCase().replace("á", "a");
  return (ITEMS as readonly string[]).includes(n) ? (n as ItemKind) : null;
}

function resourceKind(name: string): ResourceKind | null {
  const n = name.trim().toLowerCase();
  return (RESOURCES as readonly string[]).includes(n) ? (n as ResourceKind) : null;
}

function structureKind(name: string): StructureKind | null {
  const n = name.trim().toLowerCase();
  return (STRUCTURES as readonly string[]).includes(n) ? (n as StructureKind) : null;
}

/** Paso actual del plan: el primero no hecho, factible. */
export function currentStep(a: Agent): PlanStep | null {
  for (const st of a.plan) if (!st.done) return st;
  return null;
}

/** Candidato de System 1 derivado del paso actual del plan, o null. */
export function planCandidate(a: Agent, s: EngineState): Candidate | null {
  const step = currentStep(a);
  if (!step) return null;
  const g = s.grid;
  const here = idx(g.size, a.x, a.y);
  const score = PLAN_BASE + step.prioridad * 0.06;
  const reason = step.motivo || step.verbo;
  const base = { fromPlan: true as const };
  switch (step.verbo) {
    case "recolectar":
    case "acopiar":
    case "cazar": {
      const field = g.dist.comida;
      if (field[here] === NO_PATH) return giveUp(step);
      return cand("recolectar", score, reason, { ...base, resource: "comida", field, ticks: 3 });
    }
    case "juntar": {
      const r = resourceKind(step.objetivo) ?? "madera";
      const field = g.dist[r];
      if (field[here] === NO_PATH) return giveUp(step);
      return cand("juntar", score, reason, { ...base, resource: r, field, ticks: 3 });
    }
    case "ir_a": {
      if (step.targetId !== null) {
        const o = s.agents.get(step.targetId);
        if (!o || o.diedTick !== null) return giveUp(step);
        return cand("ir_a", score, reason, { ...base, targetId: o.id, targetX: o.x, targetY: o.y });
      }
      if (step.targetX !== null && step.targetY !== null) return cand("ir_a", score, reason, { ...base, targetX: step.targetX, targetY: step.targetY });
      const field = placeField(step.objetivo, a, s);
      if (field === "home") {
        if (!a.home) return giveUp(step);
        return cand("ir_a", score, reason, { ...base, targetX: a.home.x, targetY: a.home.y });
      }
      if (!field || field[here] === NO_PATH) return giveUp(step);
      return cand("ir_a", score, reason, { ...base, field });
    }
    case "construir": {
      const kind = structureKind(step.objetivo) ?? "refugio";
      const spec = STRUCTURE_SPECS[kind];
      if (spec.tech && !a.knows.has(spec.tech)) return giveUp(step);
      if (kind === "refugio" && a.home) return giveUp(step);
      const building = a.buildingId !== null ? s.structures.get(a.buildingId) : undefined;
      if (building && building.progress < 1 && building.kind === kind) {
        return cand("construir", score + 0.1, reason, { ...base, structureKind: kind, targetX: building.x, targetY: building.y, ticks: 18 });
      }
      for (const [item, n] of Object.entries(spec.materials)) {
        if (inv(a, item as ItemKind) < (n ?? 0)) {
          const r = resourceKind(item);
          if (r && g.dist[r][here] !== NO_PATH) return cand("juntar", score, `junto ${item} para construir`, { ...base, resource: r, field: g.dist[r], ticks: 3 });
          return giveUp(step);
        }
      }
      return cand("construir", score, reason, { ...base, structureKind: kind, ticks: 18 });
    }
    case "conversar": {
      if (step.targetId === null) return giveUp(step);
      const o = s.agents.get(step.targetId);
      if (!o || o.diedTick !== null) return giveUp(step);
      const d = Math.max(Math.abs(o.x - a.x), Math.abs(o.y - a.y));
      if (d > 30) return giveUp(step);
      if (d > 1) return cand("ir_a", score, reason, { ...base, targetId: o.id, targetX: o.x, targetY: o.y });
      return cand("conversar", score, reason, { ...base, targetId: o.id, ticks: 2 });
    }
    case "regalar": {
      if (step.targetId === null) return giveUp(step);
      const item = itemKind(step.objetivo) ?? "comida";
      if (inv(a, item) < 1) return giveUp(step);
      return cand("regalar", score, reason, { ...base, targetId: step.targetId, item, amount: Math.max(1, Math.min(3, step.cantidad ?? 1)) });
    }
    case "ofrecer_trueque": {
      if (step.targetId === null) return giveUp(step);
      return cand("ofrecer_trueque", score, reason, { ...base, targetId: step.targetId });
    }
    case "enseñar": {
      if (step.targetId === null) return giveUp(step);
      return cand("enseñar", score, reason, { ...base, targetId: step.targetId, ticks: 4 });
    }
    case "rezar":
      return cand("rezar", score, reason, { ...base, ticks: 3 });
    case "ritual":
      return cand("ritual", score, reason, { ...base, ticks: 6 });
    case "explorar":
      return cand("explorar", score, reason, { ...base, ticks: 12 });
    case "descansar":
      return cand("descansar", score, reason, { ...base, ticks: 6 });
    case "crear":
      // la creación la dispara System 2; el paso se completa cuando se aplica
      return null;
    default:
      // verbos que llegan en fases posteriores: se dan por hechos
      step.done = true;
      return null;
  }
}

function giveUp(step: PlanStep): null {
  step.done = true;
  return null;
}

function placeField(name: string, a: Agent, s: EngineState): Uint16Array | "home" | null {
  const n = name.trim().toLowerCase();
  const g = s.grid;
  if (n.includes("casa") || n.includes("refugio")) return "home";
  if (n.includes("agua") || n.includes("río") || n.includes("rio") || n.includes("lago") || n.includes("costa")) return g.distWater;
  if (n.includes("bosque")) return g.dist.madera;
  if (n.includes("colina") || n.includes("montaña") || n.includes("montana") || n.includes("piedra")) return g.dist.piedra;
  if (n.includes("pradera") || n.includes("comida")) return g.dist.comida;
  if (n.includes("fuego") || n.includes("fogata") || n.includes("tribu")) return g.distShelter;
  void a;
  return null;
}

/** Marca el paso como avanzado o cumplido cuando una acción del plan terminó. */
export function advancePlan(a: Agent, done: CurrentAction): void {
  const step = currentStep(a);
  if (!step) return;
  step.attempts++;
  switch (step.verbo) {
    case "recolectar":
    case "acopiar":
    case "cazar":
    case "juntar": {
      const item: ItemKind = step.verbo === "juntar" ? ((resourceKind(step.objetivo) ?? "madera") as ItemKind) : "comida";
      if (step.startAmount === null) step.startAmount = inv(a, item);
      const have = inv(a, item);
      const target = step.cantidad ?? 3;
      if (have >= target || have - step.startAmount >= target || step.attempts >= MAX_ATTEMPTS) step.done = true;
      break;
    }
    case "construir": {
      if (done.verb === "construir" && a.buildingId === null) step.done = true;
      else if (step.attempts >= MAX_ATTEMPTS * 3) step.done = true;
      break;
    }
    case "conversar":
      if (done.verb === "conversar" || step.attempts >= MAX_ATTEMPTS) step.done = true;
      break;
    case "ir_a":
      if (done.verb === "ir_a" || step.attempts >= MAX_ATTEMPTS) step.done = true;
      break;
    default:
      if (done.verb !== "ir_a" || step.attempts >= MAX_ATTEMPTS) step.done = true;
  }
}

export function markStepDoneByVerb(a: Agent, verb: PlanStep["verbo"], targetId: number | null = null): void {
  for (const st of a.plan) {
    if (!st.done && st.verbo === verb && (targetId === null || st.targetId === targetId)) {
      st.done = true;
      return;
    }
  }
}
