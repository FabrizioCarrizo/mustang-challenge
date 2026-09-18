import type { ItemKind, ResourceKind, StructureKind, Verb } from "@genesis/protocol";
import { inv, type Agent } from "../../agents/agent.ts";
import { urgency } from "../../agents/needs.ts";
import type { GenesisConfig } from "../../config.ts";
import type { Rng } from "../../rng.ts";
import type { Clock } from "../../sim/clock.ts";
import { NO_PATH, idx, type WorldGrid } from "../../world/grid.ts";
import type { Structure } from "../../world/structures.ts";

export interface Perception {
  nearby: number[];
  adjacent: number[];
  /** temperatura efectiva en la celda (con abrigo) */
  tempHere: number;
  warmthHere: number;
  danger: number;
  cellIdx: number;
  /** estructura completa en la celda, si hay */
  structureHere: Structure | null;
  threatX: number | null;
  threatY: number | null;
}

export interface Candidate {
  verb: Verb;
  score: number;
  reason: string;
  targetX: number | null;
  targetY: number | null;
  targetId: number | null;
  resource: ResourceKind | null;
  structureKind: StructureKind | null;
  item: ItemKind | null;
  amount: number;
  ticks: number;
  /** campo de distancia a seguir hasta el objetivo */
  field: Uint16Array | null;
  fromPlan: boolean;
}

export interface DecisionContext {
  cfg: GenesisConfig;
  clock: Clock;
  grid: WorldGrid;
  agents: Map<number, Agent>;
  structures: Map<number, Structure>;
  rng: Rng;
  perception: Perception;
  /** hay algún refugio o fuego alcanzable */
  shelterExists: boolean;
  /** candidato derivado del plan System 2 (si hay) */
  planCandidate?: Candidate | null;
  /** crimen pendiente de castigo que este ser podría aplicar */
  pendingCrime?: { criminalId: number } | null;
}

export function cand(verb: Verb, score: number, reason: string, extra: Partial<Candidate> = {}): Candidate {
  return {
    verb,
    score,
    reason,
    targetX: null,
    targetY: null,
    targetId: null,
    resource: null,
    structureKind: null,
    item: null,
    amount: 0,
    ticks: 1,
    field: null,
    fromPlan: false,
    ...extra,
  };
}

function distCost(d: number): number {
  if (d === NO_PATH) return 99;
  return d / 10;
}

/**
 * System 1: elige la acción de mayor utilidad. Sin LLM. Corre cada tick.
 */
export function decide(a: Agent, ctx: DecisionContext): Candidate {
  const { cfg, clock, grid, perception: p, rng } = ctx;
  const u = urgency(a.needs, cfg);
  const cands: Candidate[] = [];
  const i = p.cellIdx;
  const season = clock.season;
  const coldSeason = season === "otoño" || season === "invierno";
  const night = !clock.isDay;
  const dWater = grid.distWater[i]!;
  const dFood = grid.dist.comida[i]!;
  const dWood = grid.dist.madera[i]!;
  const dShelter = grid.distShelter[i]!;
  const food = inv(a, "comida");
  const wood = inv(a, "madera");
  const knowsFire = a.knows.has("fuego");
  const commitment = a.current;

  // --- beber (del agua o del cántaro) ---
  if (inv(a, "agua") >= 1 && dWater > 0) {
    cands.push(cand("beber", u.sed * (1 - a.needs.sed) * 1.3, "bebo del cántaro", { ticks: 1 }));
  }
  cands.push(
    cand("beber", u.sed * (1 - a.needs.sed) * 1.2 - distCost(dWater), "tengo sed", {
      field: grid.distWater,
      ticks: 2,
    }),
  );
  if (inv(a, "cantaro") >= 1 && inv(a, "agua") < 1 && dWater !== NO_PATH && dWater > 3) {
    cands.push(cand("cargar_agua", 0.12 + u.sed * 0.3 - distCost(dWater), "lleno el cántaro", { field: grid.distWater, ticks: 1 }));
  }

  // --- violencia: responder a un ataque ---
  if (a.lastAttackedBy !== null && clock.tick - a.lastAttackedTick <= 6) {
    const attacker = ctx.agents.get(a.lastAttackedBy);
    if (attacker && attacker.diedTick === null && Math.max(Math.abs(attacker.x - a.x), Math.abs(attacker.y - a.y)) <= 3) {
      if (a.genome.agresion > 0.45 && a.health > 0.35) {
        cands.push(cand("atacar", 0.55 + a.genome.agresion * 0.4 + (inv(a, "arma") >= 1 ? 0.15 : 0), "me defiendo", { targetId: attacker.id, ticks: 1 }));
      }
      cands.push(cand("huir", 0.5 + (1 - a.genome.riesgo) * 0.4 + (1 - a.health) * 0.5, "escapo del ataque", { targetX: attacker.x, targetY: attacker.y, ticks: 4 }));
    }
  }

  // --- justicia: castigar un crimen ---
  if (ctx.pendingCrime) {
    const criminal = ctx.agents.get(ctx.pendingCrime.criminalId);
    if (criminal && criminal.diedTick === null) {
      const d = Math.max(Math.abs(criminal.x - a.x), Math.abs(criminal.y - a.y));
      if (d <= 12) cands.push(cand("castigar", 0.45 + a.genome.agresion * 0.2 - distCost(d), "hago justicia", { targetId: criminal.id, ticks: 1 }));
    }
  }

  // --- comer de la mochila ---
  if (food >= 0.25) {
    cands.push(cand("comer", u.hambre * Math.min(1 - a.needs.hambre, cfg.needs.foodPerUnit * Math.min(food, 1)) * 1.5, "tengo hambre y llevo comida"));
  }

  // --- recolectar comida (por hambre o por acopio) ---
  {
    const stockTarget = 2 + (season === "otoño" ? 4 : season === "invierno" ? 3 : 1);
    const stockDrive = 0.18 * Math.max(0, 1 - food / stockTarget) * (coldSeason ? 1.4 : 1);
    const hungerDrive = food < 0.25 ? u.hambre * 0.9 : u.hambre * 0.3;
    const drive = Math.max(hungerDrive, stockDrive);
    cands.push(
      cand("recolectar", drive - distCost(dFood), food < 0.25 ? "busco comida" : "acopio comida", {
        resource: "comida",
        field: grid.dist.comida,
        ticks: 3,
      }),
    );
  }

  // --- dormir ---
  {
    const tired = 1 - a.needs.descanso;
    let s = u.descanso * tired;
    if (night) s = Math.max(s, a.needs.descanso < 0.98 ? 0.6 + 0.3 * tired : 0.4);
    if (a.needs.descanso < 0.15) s += 0.8;
    const atHome = a.home && a.home.x === a.x && a.home.y === a.y;
    if (a.home && !atHome && s > 0.2) {
      const d = Math.max(Math.abs(a.home.x - a.x), Math.abs(a.home.y - a.y));
      if (d <= 36) {
        cands.push(
          cand("dormir", s - d / 40 + 0.15, "vuelvo a casa a dormir", { targetX: a.home.x, targetY: a.home.y, ticks: 40 }),
        );
      }
    }
    cands.push(cand("dormir", s - (a.home && !atHome ? 0.2 : 0), night ? "es de noche" : "estoy cansado", { ticks: 40 }));
  }

  // --- calor: refugiarse, encender fuego, construir refugio, juntar leña ---
  {
    const cold = 1 - a.needs.calor;
    const coldDrive = u.calor * cold;
    if (p.warmthHere <= 0 && coldDrive > 0.05 && dShelter !== NO_PATH) {
      cands.push(cand("refugiarse", coldDrive * 1.1 - distCost(dShelter), "tengo frío", { field: grid.distShelter, ticks: 1 }));
    }
    if (knowsFire && wood >= 2 && (coldDrive > 0.08 || (night && coldSeason)) && p.warmthHere <= 0) {
      cands.push(cand("encender_fuego", coldDrive * 1.2 + (night && coldSeason ? 0.25 : 0), "enciendo un fuego", { ticks: 2 }));
    }
    const wantsHome = !a.home;
    const anticipation = wantsHome ? (coldSeason ? 0.45 : 0.22) : 0;
    const building = a.buildingId !== null ? ctx.structures.get(a.buildingId) : undefined;
    if (building && building.progress < 1) {
      const d = Math.max(Math.abs(building.x - a.x), Math.abs(building.y - a.y));
      cands.push(
        cand("construir", coldDrive * 0.9 + anticipation + 0.2 - distCost(d), "sigo construyendo mi refugio", {
          structureKind: building.kind,
          targetX: building.x,
          targetY: building.y,
          ticks: 18,
        }),
      );
    } else if (wantsHome && wood >= 4) {
      cands.push(cand("construir", coldDrive * 0.9 + anticipation, "construyo un refugio", { structureKind: "refugio", ticks: 18 }));
    }
    const woodTarget = (wantsHome && !building ? 4 : 0) + (knowsFire ? (coldSeason ? 6 : 2) : 0);
    if (wood < woodTarget && dWood !== NO_PATH) {
      const drive = 0.2 * (1 - wood / Math.max(1, woodTarget)) + (wantsHome ? anticipation * 0.8 : 0) + coldDrive * 0.4;
      cands.push(cand("juntar", drive - distCost(dWood), wantsHome ? "junto madera para un refugio" : "junto leña", { resource: "madera", field: grid.dist.madera, ticks: 3 }));
    }
  }

  // --- seguridad: huir ---
  if (p.danger > 0.25 && p.threatX !== null && p.threatY !== null) {
    cands.push(cand("huir", u.seguridad * 1.2 + p.danger, "huyo del peligro", { targetX: p.threatX, targetY: p.threatY, ticks: 3 }));
  }

  // --- social: charlar o acercarse ---
  if (a.needs.social < 0.85 && p.adjacent.length > 0) {
    for (const id of p.adjacent) {
      const other = ctx.agents.get(id);
      if (!other || other.asleep || other.diedTick !== null) continue;
      const rel = a.relationships.get(id);
      const aff = rel ? rel.affinity : 0;
      const s = u.social * 0.9 + 0.08 + aff * 0.2 + a.genome.empatia * 0.05;
      cands.push(cand("conversar", s, "charlo un rato", { targetId: id, ticks: 2 }));
      break;
    }
  } else if (a.needs.social < 0.5 && p.nearby.length > 0) {
    let bestId = -1;
    let bestD = 99;
    for (const id of p.nearby) {
      const other = ctx.agents.get(id);
      if (!other || other.diedTick !== null) continue;
      const d = Math.max(Math.abs(other.x - a.x), Math.abs(other.y - a.y));
      const rel = a.relationships.get(id);
      const score = d - (rel ? rel.affinity * 3 : 0);
      if (score < bestD) {
        bestD = score;
        bestId = id;
      }
    }
    if (bestId >= 0) {
      const other = ctx.agents.get(bestId)!;
      cands.push(cand("ir_a", u.social * 0.6 - distCost(bestD), "busco compañía", { targetId: bestId, targetX: other.x, targetY: other.y, ticks: 1 }));
    }
  }

  // --- familia: alimentar a los hijos chicos y seguir a la madre ---
  for (const cid of a.children) {
    const child = ctx.agents.get(cid);
    if (!child || child.diedTick !== null) continue;
    const d = Math.max(Math.abs(child.x - a.x), Math.abs(child.y - a.y));
    if (child.needs.hambre < 0.5 && food >= 1 && d <= 8) {
      cands.push(cand("regalar", 0.5 + (1 - child.needs.hambre) * 0.6 - distCost(d), `alimento a ${child.name}`, { targetId: child.id, item: "comida", amount: 1 }));
    }
  }
  if (a.parents[0] !== null && (clock.tick - a.bornTick) < 48 * 144) {
    const mother = ctx.agents.get(a.parents[0]) ?? (a.parents[1] !== null ? ctx.agents.get(a.parents[1]) : undefined);
    if (mother && mother.diedTick === null) {
      const d = Math.max(Math.abs(mother.x - a.x), Math.abs(mother.y - a.y));
      if (d > 3) cands.push(cand("ir_a", 0.35 + Math.min(0.4, d / 20), "sigo a mi madre", { targetId: mother.id, targetX: mother.x, targetY: mother.y }));
    }
  }

  // --- explorar / vagar ---
  cands.push(cand("explorar", 0.04 + a.genome.curiosidad * 0.14 + (clock.isDay ? 0.03 : -0.1), "curioseo", { ticks: 8 }));

  // --- descansar ---
  cands.push(cand("descansar", 0.03, "descanso un momento", { ticks: 1 }));

  // --- el plan de System 2 ---
  if (ctx.planCandidate) cands.push(ctx.planCandidate);

  // compromiso con la acción en curso y ruido
  let best: Candidate | null = null;
  for (const c of cands) {
    let s = c.score + (rng.float() - 0.5) * 0.1;
    if (commitment && commitment.verb === c.verb && commitment.ticksLeft > 0 && sameTarget(commitment, c)) s += 0.25;
    if (!best || s > best.score) {
      best = { ...c, score: s };
    }
  }
  return best!;
}

export function sameTarget(
  cur: { targetId: number | null; resource: ResourceKind | null; structureKind: StructureKind | null; item?: ItemKind | null },
  c: Candidate,
): boolean {
  return cur.targetId === c.targetId && cur.resource === c.resource && cur.structureKind === c.structureKind && (cur.item ?? null) === c.item;
}

export function cellIndexOf(grid: WorldGrid, a: Agent): number {
  return idx(grid.size, a.x, a.y);
}
