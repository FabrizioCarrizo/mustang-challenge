import type { ResourceKind } from "@genesis/protocol";
import { addItem, adjustRelationship, carryCapacity, inv, inventoryWeight, takeItem, type Agent, type CurrentAction } from "../../agents/agent.ts";
import { clamp01 } from "../../agents/needs.ts";
import type { GenesisConfig } from "../../config.ts";
import type { Rng } from "../../rng.ts";
import type { Clock } from "../../sim/clock.ts";
import { makeEvent, type WorldEvent } from "../../sim/events.ts";
import { NEIGHBORS8, NO_PATH, descend, idx, inBounds, isWalkable, moveCost, type WorldGrid } from "../../world/grid.ts";
import { STRUCTURE_SPECS, createStructure, type Structure } from "../../world/structures.ts";
import type { Candidate } from "./utility.ts";

export interface ActionContext {
  cfg: GenesisConfig;
  clock: Clock;
  grid: WorldGrid;
  agents: Map<number, Agent>;
  structures: Map<number, Structure>;
  rng: Rng;
  events: WorldEvent[];
  nextStructureId: () => number;
  resourceChanged: (cellIdx: number) => void;
  shelterChanged: () => void;
  /** enseñar una técnica (lo resuelve el motor: eventos, hitos) */
  learn?: (a: Agent, tech: string, how: string) => void;
  onTrade?: (a: Agent, b: Agent, gave: Record<string, number>, got: Record<string, number>) => void;
}

export function startAction(a: Agent, c: Candidate, tick: number): CurrentAction {
  const cur: CurrentAction = {
    verb: c.verb,
    targetX: c.targetX,
    targetY: c.targetY,
    targetId: c.targetId,
    resource: c.resource,
    structureKind: c.structureKind,
    item: c.item,
    amount: c.amount,
    ticksLeft: c.ticks,
    startedTick: tick,
    progress: 0,
    reason: c.reason,
    fromPlan: c.fromPlan,
    heading: a.current?.heading ?? 0,
  };
  a.current = cur;
  return cur;
}

function adjacentTarget(a: Agent, ctx: ActionContext, cur: CurrentAction): Agent | null | "moving" {
  const other = cur.targetId !== null ? ctx.agents.get(cur.targetId) : undefined;
  if (!other || other.diedTick !== null) return null;
  if (Math.max(Math.abs(other.x - a.x), Math.abs(other.y - a.y)) <= 1) return other;
  const d = Math.max(Math.abs(other.x - a.x), Math.abs(other.y - a.y));
  if (d > 40 || ctx.clock.tick - cur.startedTick > 60) return null;
  moveToward(a, ctx, other.x, other.y);
  return "moving";
}

/** Trueque de System 1: intercambia una unidad de lo que a uno le sobra por lo que al otro le falta. */
export function barter(a: Agent, b: Agent, ctx: ActionContext): boolean {
  const goods = ["comida", "madera", "piedra"] as const;
  let give: (typeof goods)[number] | null = null;
  let get: (typeof goods)[number] | null = null;
  for (const g of goods) {
    if (inv(a, g) >= 3 && inv(b, g) < 1 && !give) give = g;
    if (inv(b, g) >= 3 && inv(a, g) < 1 && !get) get = g;
  }
  if (!give || !get || give === get) return false;
  takeItem(a, give, 1);
  takeItem(b, get, 1);
  addItem(a, get, 1);
  addItem(b, give, 1);
  const tick = ctx.clock.tick;
  adjustRelationship(a, b.id, tick, { trust: 0.03, affinity: 0.02, familiarity: 0.05 });
  adjustRelationship(b, a.id, tick, { trust: 0.03, affinity: 0.02, familiarity: 0.05 });
  ctx.events.push(
    makeEvent({
      kind: "trade",
      tick,
      agentId: a.id,
      targetId: b.id,
      x: a.x,
      y: a.y,
      label: `${give}/${get}`,
      data: { dio: `1 ${give}`, recibio: `1 ${get}`, gave: { [give]: 1 }, got: { [get]: 1 } },
      tags: ["trueque"],
    }),
  );
  ctx.onTrade?.(a, b, { [give]: 1 }, { [get]: 1 });
  return true;
}

/** Ejecuta un tick de la acción en curso. Devuelve true si la acción terminó. */
export function executeAction(a: Agent, ctx: ActionContext, field: Uint16Array | null): boolean {
  const cur = a.current;
  if (!cur) return true;
  const { grid, cfg, clock } = ctx;
  const tick = clock.tick;
  switch (cur.verb) {
    case "beber": {
      const here = idx(grid.size, a.x, a.y);
      if (grid.distWater[here] !== 0) return moveAlong(a, ctx, field ?? grid.distWater);
      a.needs.sed = clamp01(a.needs.sed + cfg.needs.drinkPerTick);
      a.lastDrankTick = tick;
      cur.ticksLeft--;
      return cur.ticksLeft <= 0 || a.needs.sed >= 0.99;
    }
    case "comer": {
      const amount = Math.min(inv(a, "comida"), 1);
      if (amount <= 0) return true;
      takeItem(a, "comida", amount);
      a.needs.hambre = clamp01(a.needs.hambre + cfg.needs.foodPerUnit * amount);
      a.lastAteTick = tick;
      return true;
    }
    case "recolectar":
    case "juntar":
    case "acopiar": {
      const res: ResourceKind = cur.resource ?? "comida";
      const here = idx(grid.size, a.x, a.y);
      const cell = grid.resources[res];
      if (cell[here]! < 0.1) {
        const f = field ?? grid.dist[res];
        if (f[here] === 0) return true; // el campo está desactualizado: reintenta el próximo tick
        return moveAlong(a, ctx, f);
      }
      if (inventoryWeight(a) >= carryCapacity(a)) return true;
      const amount = Math.min(cell[here]!, cfg.resources.gatherPerTick * (0.7 + 0.6 * a.genome.fuerza));
      cell[here] = cell[here]! - amount;
      ctx.resourceChanged(here);
      addItem(a, res, amount);
      cur.ticksLeft--;
      markFirst(a, ctx, `recolectar ${res}`);
      return cur.ticksLeft <= 0 || cell[here]! < 0.1;
    }
    case "dormir": {
      if (cur.targetX !== null && cur.targetY !== null && (a.x !== cur.targetX || a.y !== cur.targetY)) {
        const arrived = moveToward(a, ctx, cur.targetX, cur.targetY);
        if (!arrived) return false;
      }
      a.asleep = true;
      return false; // el despertar lo decide el motor
    }
    case "refugiarse": {
      const here = idx(grid.size, a.x, a.y);
      const f = field ?? grid.distShelter;
      if (f[here] === 0 || f[here] === NO_PATH) return true;
      return moveAlong(a, ctx, f);
    }
    case "encender_fuego": {
      if (inv(a, "madera") < 2) return true;
      const here = idx(grid.size, a.x, a.y);
      // reaviva una fogata existente en la celda o alrededor antes de armar otra
      const cells = [here];
      for (const [dx, dy] of NEIGHBORS8) {
        const nx = a.x + dx;
        const ny = a.y + dy;
        if (inBounds(grid.size, nx, ny)) cells.push(idx(grid.size, nx, ny));
      }
      for (const ci of cells) {
        const sid = grid.structureAt[ci]!;
        if (sid < 0) continue;
        const s = ctx.structures.get(sid);
        if (s && s.kind === "fogata") {
          takeItem(a, "madera", 2);
          const wasLit = s.lit;
          s.lit = true;
          s.fuel += 2 * 36;
          s.lastChangeTick = tick;
          ctx.shelterChanged();
          if (!wasLit) {
            ctx.events.push(makeEvent({ kind: "fire.lit", tick, agentId: a.id, x: s.x, y: s.y, data: { structureId: s.id }, tags: ["fuego"], persist: false }));
          }
          return true;
        }
      }
      let site = -1;
      if (grid.structureAt[here] === -1) site = here;
      else {
        for (const ci of cells) {
          if (grid.structureAt[ci] === -1 && isWalkable(grid.terrain[ci]!)) {
            site = ci;
            break;
          }
        }
      }
      if (site < 0) return true;
      takeItem(a, "madera", 2);
      const sx = site % grid.size;
      const sy = (site - sx) / grid.size;
      const s = createStructure(ctx.nextStructureId(), "fogata", sx, sy, a.id, tick);
      s.progress = 1;
      s.lit = true;
      s.fuel = 2 * 36;
      s.lastChangeTick = tick;
      ctx.structures.set(s.id, s);
      grid.structureAt[site] = s.id;
      ctx.shelterChanged();
      ctx.events.push(makeEvent({ kind: "fire.lit", tick, agentId: a.id, x: sx, y: sy, data: { structureId: s.id }, tags: ["fuego"] }));
      markFirst(a, ctx, "encender fuego");
      return true;
    }
    case "construir": {
      const kind = cur.structureKind ?? "refugio";
      const spec = STRUCTURE_SPECS[kind];
      // elegir sitio: la celda actual si está libre, si no una vecina
      if (cur.targetX === null || cur.targetY === null) {
        const here = idx(grid.size, a.x, a.y);
        let site = grid.structureAt[here] === -1 && grid.distWater[here]! > 0 ? here : -1;
        if (site < 0) {
          for (const [dx, dy] of NEIGHBORS8) {
            const nx = a.x + dx;
            const ny = a.y + dy;
            if (!inBounds(grid.size, nx, ny)) continue;
            const ni = idx(grid.size, nx, ny);
            if (isWalkable(grid.terrain[ni]!) && grid.structureAt[ni] === -1) {
              site = ni;
              break;
            }
          }
        }
        if (site < 0) return true;
        cur.targetX = site % grid.size;
        cur.targetY = (site - cur.targetX) / grid.size;
      }
      if (a.x !== cur.targetX || a.y !== cur.targetY) {
        const arrived = moveToward(a, ctx, cur.targetX, cur.targetY);
        if (!arrived) return false;
      }
      const site = idx(grid.size, cur.targetX, cur.targetY);
      let s: Structure | null = null;
      const existingId = grid.structureAt[site]!;
      if (existingId >= 0) {
        const ex = ctx.structures.get(existingId);
        if (!ex || ex.kind !== kind || ex.progress >= 1) {
          if (a.buildingId === existingId) a.buildingId = null;
          return true;
        }
        s = ex;
      } else {
        for (const [item, n] of Object.entries(spec.materials)) {
          if (inv(a, item as never) < (n ?? 0)) return true;
        }
        for (const [item, n] of Object.entries(spec.materials)) takeItem(a, item as never, n ?? 0);
        s = createStructure(ctx.nextStructureId(), kind, cur.targetX, cur.targetY, a.id, tick);
        ctx.structures.set(s.id, s);
        grid.structureAt[site] = s.id;
      }
      a.buildingId = s.id;
      s.progress = Math.min(1, s.progress + (0.6 + 0.8 * a.genome.fuerza) / spec.work);
      s.lastChangeTick = tick;
      cur.progress = s.progress;
      if (s.progress >= 1) {
        a.buildingId = null;
        if (kind === "refugio") a.home = { x: s.x, y: s.y };
        ctx.shelterChanged();
        ctx.events.push(
          makeEvent({ kind: "structure.built", tick, agentId: a.id, x: s.x, y: s.y, label: kind, data: { structureId: s.id }, tags: ["construccion"] }),
        );
        markFirst(a, ctx, `construir ${kind}`);
        return true;
      }
      return false;
    }
    case "huir": {
      if (cur.targetX === null || cur.targetY === null) return true;
      const dx = Math.sign(a.x - cur.targetX);
      const dy = Math.sign(a.y - cur.targetY);
      stepDirection(a, ctx, dx || (ctx.rng.int(3) - 1), dy || (ctx.rng.int(3) - 1));
      cur.ticksLeft--;
      return cur.ticksLeft <= 0;
    }
    case "conversar": {
      const other = cur.targetId !== null ? ctx.agents.get(cur.targetId) : undefined;
      if (!other || other.diedTick !== null || Math.max(Math.abs(other.x - a.x), Math.abs(other.y - a.y)) > 1) return true;
      const gain = cfg.social.smallTalkSocialGain / 2;
      a.needs.social = clamp01(a.needs.social + gain);
      other.needs.social = clamp01(other.needs.social + gain * 0.7);
      cur.ticksLeft--;
      if (cur.ticksLeft <= 0) {
        const warmth = 0.015 + 0.02 * (a.genome.empatia + other.genome.empatia) / 2 + (ctx.rng.float() - 0.4) * 0.02;
        adjustRelationship(a, other.id, tick, { affinity: warmth, familiarity: 0.06, trust: 0.01 });
        adjustRelationship(other, a.id, tick, { affinity: warmth * 0.8, familiarity: 0.06, trust: 0.01 });
        a.needs.estima = clamp01(a.needs.estima + 0.02);
        other.needs.estima = clamp01(other.needs.estima + 0.02);
        a.lastDialogueTick = tick;
        ctx.events.push(makeEvent({ kind: "smalltalk", tick, agentId: a.id, targetId: other.id, x: a.x, y: a.y, persist: false }));
        return true;
      }
      return false;
    }
    case "explorar": {
      if (cur.ticksLeft === 8 || ctx.rng.chance(0.12)) cur.heading = ctx.rng.int(8);
      const [dx, dy] = NEIGHBORS8[cur.heading]!;
      const moved = stepDirection(a, ctx, dx, dy);
      if (!moved) cur.heading = ctx.rng.int(8);
      cur.ticksLeft--;
      return cur.ticksLeft <= 0;
    }
    case "descansar": {
      a.needs.descanso = clamp01(a.needs.descanso + 0.003);
      cur.ticksLeft--;
      return cur.ticksLeft <= 0;
    }
    case "regalar": {
      const other = adjacentTarget(a, ctx, cur);
      if (other === "moving") return false;
      if (!other) return true;
      const item = cur.item ?? "comida";
      const n = Math.min(inv(a, item), Math.max(1, cur.amount || 1));
      if (n < 0.5) return true;
      takeItem(a, item, n);
      addItem(other, item, n);
      adjustRelationship(a, other.id, tick, { affinity: 0.03, familiarity: 0.05, debt: 1 });
      adjustRelationship(other, a.id, tick, { trust: 0.08, affinity: 0.1, familiarity: 0.05, debt: -1 });
      ctx.events.push(
        makeEvent({ kind: "gift", tick, agentId: a.id, targetId: other.id, x: a.x, y: a.y, label: item, data: { cantidad: Math.round(n) }, tags: ["regalo", "generosidad"] }),
      );
      markFirst(a, ctx, "regalar");
      return true;
    }
    case "ofrecer_trueque": {
      const other = adjacentTarget(a, ctx, cur);
      if (other === "moving") return false;
      if (!other) return true;
      barter(a, other, ctx);
      return true;
    }
    case "enseñar": {
      const other = adjacentTarget(a, ctx, cur);
      if (other === "moving") return false;
      if (!other) return true;
      const tech = [...a.knows].find((k) => !other.knows.has(k) && k !== "refugio");
      if (!tech) return true;
      cur.ticksLeft--;
      if (cur.ticksLeft > 0) return false;
      const chance = 0.35 + 0.5 * other.genome.inteligencia + 0.15 * a.genome.empatia;
      if (ctx.rng.chance(chance)) {
        ctx.learn?.(other, tech, `porque ${a.name} le enseñó`);
        ctx.events.push(makeEvent({ kind: "teach", tick, agentId: a.id, targetId: other.id, x: a.x, y: a.y, label: tech, importance: 5, tags: ["enseñanza", tech] }));
        adjustRelationship(other, a.id, tick, { trust: 0.1, affinity: 0.08, familiarity: 0.08, debt: -1 });
        adjustRelationship(a, other.id, tick, { affinity: 0.04, familiarity: 0.08, debt: 1 });
        a.needs.estima = clamp01(a.needs.estima + 0.15);
      }
      return true;
    }
    case "rezar":
    case "ritual": {
      cur.ticksLeft--;
      if (cur.ticksLeft > 0) return false;
      ctx.events.push(
        makeEvent({
          kind: cur.verb === "ritual" ? "ritual" : "pray",
          tick,
          agentId: a.id,
          x: a.x,
          y: a.y,
          label: cur.reason,
          importance: cur.verb === "ritual" ? 4 : 3,
          tags: ["rito", "fe"],
        }),
      );
      a.needs.seguridad = clamp01(a.needs.seguridad + 0.05);
      markFirst(a, ctx, cur.verb);
      return true;
    }
    case "ir_a": {
      if (cur.targetId !== null) {
        const other = ctx.agents.get(cur.targetId);
        if (!other || other.diedTick !== null) return true;
        cur.targetX = other.x;
        cur.targetY = other.y;
        if (Math.max(Math.abs(other.x - a.x), Math.abs(other.y - a.y)) <= 1) return true;
      }
      if (field) return moveAlong(a, ctx, field);
      if (cur.targetX === null || cur.targetY === null) return true;
      return moveToward(a, ctx, cur.targetX, cur.targetY);
    }
    default:
      return true;
  }
}

function markFirst(a: Agent, ctx: ActionContext, what: string): void {
  if (a.firsts.has(what)) return;
  a.firsts.add(what);
  ctx.events.push(makeEvent({ kind: "agent.first", tick: ctx.clock.tick, agentId: a.id, x: a.x, y: a.y, label: what, importance: 2, persist: false }));
}

/** Avanza siguiendo un campo de distancia. Devuelve true si llegó. */
function moveAlong(a: Agent, ctx: ActionContext, field: Uint16Array): boolean {
  const { grid } = ctx;
  const here = idx(grid.size, a.x, a.y);
  if (field[here] === 0) return true;
  if (field[here] === NO_PATH) {
    a.current = null;
    return true;
  }
  const next = descend(grid, field, a.x, a.y);
  if (next < 0) return true;
  const nx = next % grid.size;
  const ny = (next - nx) / grid.size;
  stepTo(a, ctx, nx, ny);
  return false;
}

/** Paso codicioso hacia (tx, ty) evitando celdas ocupadas si es posible. Devuelve true si llegó. */
export function moveToward(a: Agent, ctx: ActionContext, tx: number, ty: number): boolean {
  if (a.x === tx && a.y === ty) return true;
  const { grid } = ctx;
  let bestX = a.x;
  let bestY = a.y;
  let bestD = Infinity;
  for (const [dx, dy] of NEIGHBORS8) {
    const nx = a.x + dx;
    const ny = a.y + dy;
    if (!inBounds(grid.size, nx, ny)) continue;
    const ni = idx(grid.size, nx, ny);
    if (!isWalkable(grid.terrain[ni]!)) continue;
    const d = Math.hypot(nx - tx, ny - ty) + moveCost(grid.terrain[ni]!) * 0.3 + grid.occupants[ni]! * 0.4;
    if (d < bestD) {
      bestD = d;
      bestX = nx;
      bestY = ny;
    }
  }
  if (bestX === a.x && bestY === a.y) {
    a.stuckTicks++;
    if (a.stuckTicks > 8) {
      a.stuckTicks = 0;
      a.current = null;
    }
    return false;
  }
  stepTo(a, ctx, bestX, bestY);
  return a.x === tx && a.y === ty;
}

function stepDirection(a: Agent, ctx: ActionContext, dx: number, dy: number): boolean {
  const nx = a.x + dx;
  const ny = a.y + dy;
  const { grid } = ctx;
  if (!inBounds(grid.size, nx, ny)) return false;
  const ni = idx(grid.size, nx, ny);
  if (!isWalkable(grid.terrain[ni]!)) return false;
  stepTo(a, ctx, nx, ny);
  return true;
}

/** Mueve al ser respetando el costo del terreno (acumula presupuesto de movimiento). */
function stepTo(a: Agent, ctx: ActionContext, nx: number, ny: number): void {
  const { grid } = ctx;
  const ni = idx(grid.size, nx, ny);
  const cost = moveCost(grid.terrain[ni]!) / (0.8 + 0.4 * a.genome.fuerza);
  a.moveBudget += 1;
  if (a.moveBudget < cost) return;
  a.moveBudget -= cost;
  const here = idx(grid.size, a.x, a.y);
  if (grid.occupants[here]! > 0) grid.occupants[here] = grid.occupants[here]! - 1;
  a.x = nx;
  a.y = ny;
  grid.occupants[ni] = Math.min(255, grid.occupants[ni]! + 1);
  a.stuckTicks = 0;
}
