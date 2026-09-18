import type { ItemKind, ResourceKind, StructureKind } from "@genesis/protocol";
import { addItem, adjustRelationship, carryCapacity, inv, inventoryWeight, takeItem, type Agent, type CurrentAction } from "../../agents/agent.ts";
import { clamp01 } from "../../agents/needs.ts";
import type { GenesisConfig } from "../../config.ts";
import type { Rng } from "../../rng.ts";
import type { Clock } from "../../sim/clock.ts";
import { makeEvent, type WorldEvent } from "../../sim/events.ts";
import type { TextRecord } from "../../sim/state.ts";
import type { Crime, Punishment } from "../../society/laws.ts";
import { craftRecipeFor } from "../../society/tech.ts";
import { NEIGHBORS8, NO_PATH, descend, idx, inBounds, isWalkable, moveCost, type WorldGrid } from "../../world/grid.ts";
import { STRUCTURE_SPECS, createStructure, type Structure } from "../../world/structures.ts";
import type { Candidate } from "./utility.ts";

/** ¿Hay una estructura de este tipo (terminada; encendida si es fuego) a ≤ `radius` celdas? */
export function nearStructure(a: Agent, ctx: { grid: WorldGrid; structures: Map<number, Structure> }, kind: StructureKind | "agua", radius = 2): boolean {
  const { grid } = ctx;
  if (kind === "agua") return grid.distWater[idx(grid.size, a.x, a.y)]! <= radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = a.x + dx;
      const ny = a.y + dy;
      if (!inBounds(grid.size, nx, ny)) continue;
      const sid = grid.structureAt[idx(grid.size, nx, ny)]!;
      if (sid < 0) continue;
      const st = ctx.structures.get(sid);
      if (st && st.kind === kind && st.progress >= 1 && ((st.kind !== "fogata" && st.kind !== "horno") || st.lit)) return true;
    }
  }
  return false;
}

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
  /** contabilidad de consumo (economía) */
  consume?: (item: ItemKind, n: number) => void;
  /** memoria directa (para actos que no son eventos públicos) */
  remember?: (a: Agent, text: string, importance: number, tags: string[]) => void;
  texts?: Map<number, TextRecord>;
  pendingCrimeFor?: (agentId: number) => Crime | null;
  punish?: (crime: Crime, by: Agent) => { punishment: Punishment; victimId: number | null } | null;
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
      if (grid.distWater[here] !== 0) {
        if (inv(a, "agua") >= 1) {
          takeItem(a, "agua", 1);
          a.needs.sed = clamp01(a.needs.sed + cfg.needs.drinkPerTick);
          a.lastDrankTick = tick;
          return true;
        }
        return moveAlong(a, ctx, field ?? grid.distWater);
      }
      a.needs.sed = clamp01(a.needs.sed + cfg.needs.drinkPerTick);
      a.lastDrankTick = tick;
      cur.ticksLeft--;
      return cur.ticksLeft <= 0 || a.needs.sed >= 0.99;
    }
    case "cargar_agua": {
      if (inv(a, "cantaro") < 1) return true;
      const here = idx(grid.size, a.x, a.y);
      if (grid.distWater[here] !== 0) return moveAlong(a, ctx, field ?? grid.distWater);
      const cap = 3 * Math.floor(inv(a, "cantaro"));
      addItem(a, "agua", Math.max(0, cap - inv(a, "agua")));
      markFirst(a, ctx, "cargar agua");
      return true;
    }
    case "comer": {
      const amount = Math.min(inv(a, "comida"), 1);
      if (amount <= 0) return true;
      takeItem(a, "comida", amount);
      ctx.consume?.("comida", amount);
      a.needs.hambre = clamp01(a.needs.hambre + cfg.needs.foodPerUnit * amount);
      a.lastAteTick = tick;
      return true;
    }
    case "recolectar":
    case "juntar":
    case "acopiar":
    case "cazar": {
      const res: ResourceKind = cur.resource ?? "comida";
      const here = idx(grid.size, a.x, a.y);
      const cell = grid.resources[res];
      if (cell[here]! < 0.1) {
        const f = field ?? grid.dist[res];
        if (f[here] === 0) return true; // el campo está desactualizado: reintenta el próximo tick
        return moveAlong(a, ctx, f);
      }
      if (inventoryWeight(a) >= carryCapacity(a)) return true;
      const toolBonus = inv(a, "herramienta") >= 1 ? 1.5 : 1;
      const huntBonus = cur.verb === "cazar" && a.knows.has("caza") ? 1 + 0.5 * a.genome.fuerza + (inv(a, "arma") >= 1 ? 0.5 : 0) : 1;
      const amount = Math.min(cell[here]!, cfg.resources.gatherPerTick * (0.7 + 0.6 * a.genome.fuerza) * toolBonus * huntBonus);
      cell[here] = cell[here]! - amount;
      ctx.resourceChanged(here);
      addItem(a, res, amount);
      if (res === "comida" && ctx.rng.chance(0.12)) addItem(a, "semilla", 1);
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
          ctx.consume?.("madera", 2);
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
      ctx.consume?.("madera", 2);
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
        for (const [item, n] of Object.entries(spec.materials)) {
          takeItem(a, item as never, n ?? 0);
          ctx.consume?.(item as ItemKind, n ?? 0);
        }
        s = createStructure(ctx.nextStructureId(), kind, cur.targetX, cur.targetY, a.id, tick);
        s.groupId = a.groupId;
        ctx.structures.set(s.id, s);
        grid.structureAt[site] = s.id;
      }
      a.buildingId = s.id;
      const toolBonus = inv(a, "herramienta") >= 1 ? 1.5 : 1;
      s.progress = Math.min(1, s.progress + ((0.6 + 0.8 * a.genome.fuerza) * toolBonus) / spec.work);
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
    case "atacar": {
      const other = adjacentTarget(a, ctx, cur);
      if (other === "moving") return false;
      if (!other) return true;
      const weapon = inv(a, "arma") >= 1 ? 2 : 1;
      const armor = inv(other, "ropa") >= 1 ? 0.8 : 1;
      const damage = (0.12 + 0.18 * a.genome.fuerza) * weapon * armor;
      other.health -= damage;
      other.injuries += damage;
      other.needs.seguridad = clamp01(other.needs.seguridad - 0.3);
      other.lastAttackedBy = a.id;
      other.lastAttackedTick = tick;
      other.asleep = false;
      if (other.health <= 0) other.causeOfDeath = `violencia (${a.name})`;
      const here = idx(grid.size, a.x, a.y);
      grid.danger[here] = 1;
      grid.danger[idx(grid.size, other.x, other.y)] = 1;
      adjustRelationship(other, a.id, tick, { trust: -0.3, affinity: -0.3 });
      adjustRelationship(a, other.id, tick, { affinity: -0.1 });
      a.needs.estima = clamp01(a.needs.estima + 0.05 * a.genome.agresion);
      a.lastAttackedBy = null;
      ctx.events.push(
        makeEvent({ kind: "attack", tick, agentId: a.id, targetId: other.id, x: a.x, y: a.y, label: cur.reason, importance: 7, data: { damage: Math.round(damage * 100) / 100, weapon: weapon > 1 }, tags: ["violencia", "ataque"] }),
      );
      markFirst(a, ctx, "atacar");
      return true;
    }
    case "robar": {
      const other = adjacentTarget(a, ctx, cur);
      if (other === "moving") return false;
      if (!other) return true;
      const candidates: ItemKind[] = ["comida", "madera", "piedra", "gema", "herramienta"];
      const item = candidates.find((it) => inv(other, it) >= (it === "gema" || it === "herramienta" ? 1 : 2)) ?? null;
      if (!item) return true;
      const n = Math.min(inv(other, item), item === "comida" || item === "madera" ? 1 + (a.genome.fuerza > 0.6 ? 1 : 0) : 1);
      takeItem(other, item, n);
      addItem(a, item, n);
      const detected = ctx.rng.chance(other.asleep ? 0.15 : 0.55);
      ctx.remember?.(a, `Le robé ${n} de ${item} a ${other.name}${detected ? " y me vieron" : " sin que nadie lo notara"}`, detected ? 6 : 4, ["robo"]);
      if (detected) {
        adjustRelationship(other, a.id, tick, { trust: -0.3, affinity: -0.2 });
        ctx.events.push(makeEvent({ kind: "theft", tick, agentId: a.id, targetId: other.id, x: a.x, y: a.y, label: `${n} de ${item}`, importance: 6, data: { item, cantidad: n }, tags: ["robo", "injusticia"] }));
      }
      markFirst(a, ctx, "robar");
      return true;
    }
    case "castigar": {
      const crime = ctx.pendingCrimeFor?.(a.id) ?? null;
      if (!crime) return true;
      cur.targetId = crime.criminalId;
      const criminal = adjacentTarget(a, ctx, cur);
      if (criminal === "moving") return false;
      if (!criminal) return true;
      const result = ctx.punish?.(crime, a) ?? null;
      if (!result) return true;
      const victim = result.victimId !== null ? ctx.agents.get(result.victimId) : undefined;
      switch (result.punishment) {
        case "multa": {
          let taken = 0;
          for (const it of ["comida", "madera", "piedra"] as const) {
            const q = Math.min(inv(criminal, it), 2 - taken);
            if (q > 0) {
              takeItem(criminal, it, q);
              addItem(victim && victim.diedTick === null ? victim : a, it, q);
              taken += q;
            }
            if (taken >= 2) break;
          }
          break;
        }
        case "golpe":
          criminal.health -= 0.15;
          criminal.injuries += 0.15;
          criminal.needs.seguridad = clamp01(criminal.needs.seguridad - 0.2);
          break;
        default:
          break;
      }
      adjustRelationship(criminal, a.id, tick, { affinity: -0.3 });
      a.needs.estima = clamp01(a.needs.estima + 0.1);
      ctx.events.push(
        makeEvent({ kind: "punish", tick, agentId: a.id, targetId: criminal.id, x: a.x, y: a.y, label: result.punishment, importance: 6, data: { crimeId: crime.id, lawId: crime.lawId }, tags: ["castigo", "norma"] }),
      );
      markFirst(a, ctx, "castigar");
      return true;
    }
    case "reclamar": {
      let claimed = 0;
      const cells = [idx(grid.size, a.x, a.y)];
      for (const [dx, dy] of NEIGHBORS8) if (inBounds(grid.size, a.x + dx, a.y + dy)) cells.push(idx(grid.size, a.x + dx, a.y + dy));
      for (const c of cells) {
        if (grid.owner[c] === -1) {
          grid.owner[c] = a.id;
          claimed++;
        }
      }
      if (claimed > 0) ctx.events.push(makeEvent({ kind: "claim", tick, agentId: a.id, x: a.x, y: a.y, label: `${claimed} celdas`, importance: 3, tags: ["propiedad"] }));
      markFirst(a, ctx, "reclamar");
      return true;
    }
    case "fabricar": {
      const recipe = cur.item ? craftRecipeFor(cur.item) : null;
      if (!recipe || !a.knows.has(recipe.tech)) return true;
      for (const [it, n] of Object.entries(recipe.ingredients)) if (inv(a, it as ItemKind) < (n ?? 0)) return true;
      if (recipe.near && !nearStructure(a, ctx, recipe.near)) return true;
      cur.ticksLeft--;
      if (cur.ticksLeft > 0) return false;
      for (const [it, n] of Object.entries(recipe.ingredients)) {
        takeItem(a, it as ItemKind, n ?? 0);
        ctx.consume?.(it as ItemKind, n ?? 0);
      }
      addItem(a, recipe.item, 1);
      a.needs.estima = clamp01(a.needs.estima + 0.08);
      ctx.events.push(makeEvent({ kind: "craft", tick, agentId: a.id, x: a.x, y: a.y, label: recipe.item, importance: 4, data: { item: recipe.item }, tags: ["fabricar", recipe.item] }));
      markFirst(a, ctx, `fabricar ${recipe.item}`);
      return true;
    }
    case "cuidar": {
      // la granja más cercana propia o de la tribu
      let farm: Structure | null = null;
      let best = 999;
      for (const st of ctx.structures.values()) {
        if (st.kind !== "granja" || st.progress < 1) continue;
        if (st.ownerId !== a.id && (st.groupId === null || st.groupId !== a.groupId)) continue;
        const d = Math.max(Math.abs(st.x - a.x), Math.abs(st.y - a.y));
        if (d < best) {
          best = d;
          farm = st;
        }
      }
      if (!farm || best > 25) return true;
      if (best > 1) {
        moveToward(a, ctx, farm.x, farm.y);
        return false;
      }
      farm.growth = Math.min(1, farm.growth + 0.02 * (0.7 + 0.6 * a.genome.fuerza));
      cur.ticksLeft--;
      if (farm.growth >= 1) {
        farm.growth = 0;
        const yieldFood = 6 + Math.round(4 * a.genome.inteligencia);
        addItem(a, "comida", yieldFood);
        addItem(a, "semilla", 2);
        ctx.events.push(makeEvent({ kind: "harvest", tick, agentId: a.id, x: farm.x, y: farm.y, label: `${yieldFood} de comida`, importance: 4, data: { structureId: farm.id, comida: yieldFood }, tags: ["cosecha", "agricultura"] }));
        markFirst(a, ctx, "cosechar");
        return true;
      }
      return cur.ticksLeft <= 0;
    }
    case "leer": {
      const texts = ctx.texts;
      if (!texts) return true;
      let found: TextRecord | null = null;
      for (const t of texts.values()) {
        if (t.medium === "objeto") continue;
        const holder = t.holderId !== null ? ctx.agents.get(t.holderId) : undefined;
        const nearPlace = Math.max(Math.abs(t.x - a.x), Math.abs(t.y - a.y)) <= 1;
        const nearHolder = holder && holder.diedTick === null && Math.max(Math.abs(holder.x - a.x), Math.abs(holder.y - a.y)) <= 1 && holder.id !== a.id;
        if (t.medium === "oral" ? nearHolder : nearPlace || nearHolder) {
          if (a.firsts.has(`leyo:${t.id}`)) continue;
          found = t;
          break;
        }
      }
      if (!found) return true;
      cur.ticksLeft--;
      if (cur.ticksLeft > 0) return false;
      a.firsts.add(`leyo:${found.id}`);
      if (found.medium === "escrito" && !a.knows.has("escritura")) {
        ctx.remember?.(a, `Vi marcas en ${found.title === "" ? "una tablilla" : `"${found.title}"`} pero no sé leerlas`, 3, ["texto"]);
        return true;
      }
      found.reads++;
      ctx.remember?.(a, `${found.medium === "oral" ? "Escuché" : "Leí"} "${found.title}": ${found.body.slice(0, 220)}`, 5, ["texto", found.kind]);
      for (const t of found.techIds) if (!a.knows.has(t)) ctx.learn?.(a, t, `leyendo "${found.title}"`);
      a.needs.sentido = clamp01(a.needs.sentido + 0.05);
      ctx.events.push(makeEvent({ kind: "read", tick, agentId: a.id, targetId: found.authorId, x: a.x, y: a.y, label: found.title, importance: 4, data: { textId: found.id, medium: found.medium }, tags: ["texto"] }));
      return true;
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
