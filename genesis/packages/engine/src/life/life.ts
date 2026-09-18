import { addItem, adjustRelationship, inv, isAdult, relationship, remember, type Agent } from "../agents/agent.ts";
import { mixGenomes } from "../agents/genome.ts";
import { clamp01 } from "../agents/needs.ts";
import { ticksPerYear } from "../config.ts";
import { holdBelief, beliefsOf } from "../society/beliefs.ts";
import type { Engine } from "../sim/engine.ts";
import { makeEvent } from "../sim/events.ts";

/**
 * Vida y muerte: vínculos, embarazos, nacimientos, herencia de bienes,
 * envejecimiento, enfermedad y curación. Corre dentro del motor.
 */

export function ageOf(engine: Engine, a: Agent): number {
  return (engine.s.tick - a.bornTick) / ticksPerYear(engine.config);
}

/** Cada tick: nacimientos pendientes. */
export function stepBirths(engine: Engine): void {
  const s = engine.s;
  for (const id of s.alive.slice()) {
    const mother = s.agents.get(id)!;
    if (mother.pregnantUntil === null || s.tick < mother.pregnantUntil) continue;
    giveBirth(engine, mother);
  }
}

export function giveBirth(engine: Engine, mother: Agent): Agent {
  const s = engine.s;
  const father = mother.pregnantBy !== null ? (s.agents.get(mother.pregnantBy) ?? null) : null;
  const rng = s.rng.get("genome");
  const genome = father ? mixGenomes(mother.genome, father.genome, rng) : mixGenomes(mother.genome, mother.genome, rng, 0.15);
  const child = engine.spawnAgent(mother.x, mother.y, { genome, parents: [mother.id, father?.id ?? null] });
  child.groupId = mother.groupId;
  child.home = mother.home ? { ...mother.home } : null;
  mother.pregnantUntil = null;
  mother.pregnantBy = null;
  mother.children.push(child.id);
  if (father) father.children.push(child.id);
  // parentesco
  for (const p of [mother, father]) {
    if (!p) continue;
    const r1 = relationship(p, child.id, s.tick);
    r1.kinship = 1;
    r1.affinity = 0.8;
    r1.trust = 0.9;
    r1.label = p.sex === "f" ? "hijo" : "hijo";
    const r2 = relationship(child, p.id, s.tick);
    r2.kinship = 1;
    r2.affinity = 0.8;
    r2.trust = 0.9;
    r2.label = p.sex === "f" ? "madre" : "padre";
    for (const sibId of p.children) {
      if (sibId === child.id) continue;
      const sib = s.agents.get(sibId);
      if (!sib || sib.diedTick !== null) continue;
      relationship(sib, child.id, s.tick).kinship = Math.max(relationship(sib, child.id, s.tick).kinship, 0.5);
      relationship(child, sib.id, s.tick).kinship = 0.5;
    }
  }
  // los hijos creen lo que creen sus padres, un poco menos
  for (const p of [mother, father]) {
    if (!p) continue;
    for (const { belief, confidence } of beliefsOf(s, p).slice(0, 5)) {
      holdBelief(s, child, { statement: belief.statement, kind: belief.kind, confidence: confidence * 0.6, explains: belief.explains, founderId: belief.founderId });
    }
  }
  s.today.births++;
  s.totals.births++;
  mother.needs.estima = clamp01(mother.needs.estima + 0.2);
  mother.needs.sentido = clamp01(mother.needs.sentido + 0.2);
  if (father) {
    father.needs.estima = clamp01(father.needs.estima + 0.15);
    father.needs.sentido = clamp01(father.needs.sentido + 0.15);
  }
  engine.emit(
    makeEvent({
      kind: "agent.born",
      tick: s.tick,
      agentId: child.id,
      x: child.x,
      y: child.y,
      label: child.name,
      importance: 8,
      data: { motherId: mother.id, fatherId: father?.id ?? null },
      tags: ["nacimiento", "vida"],
    }),
  );
  return child;
}

/** Al empezar el día: vínculos, concepción, vejez, enfermedad, curación, adultez. */
export function dailyLife(engine: Engine): void {
  const s = engine.s;
  const cfg = engine.config;
  const rng = s.rng.get("life");
  const perYear = ticksPerYear(cfg);
  for (const id of s.alive.slice()) {
    const a = s.agents.get(id);
    if (!a || a.diedTick !== null) continue;
    const age = (s.tick - a.bornTick) / perYear;

    // vejez
    if (age > cfg.life.elderAgeYears) {
      const t = (age - cfg.life.elderAgeYears) / Math.max(0.5, cfg.life.maxAgeYears - cfg.life.elderAgeYears);
      const p = Math.min(0.6, t * t * 0.12 * (1.3 - a.genome.longevidad * 0.6));
      if (rng.chance(p)) {
        a.causeOfDeath = "vejez";
        a.health = 0;
        engine.kill(a.id);
        continue;
      }
    }

    // enfermedad: aparece, se contagia, se cura
    if (a.disease > 0) {
      let cure = 0.2 * (0.5 + a.health) * (0.7 + 0.6 * a.genome.longevidad);
      const healer = engine.spatial.query(a.x, a.y, 1, s.agents).map((hid) => s.agents.get(hid)!).find((h) => h.id !== a.id && h.diedTick === null && h.knows.has("medicina"));
      if (healer) {
        cure += 0.45;
        adjustRelationship(a, healer.id, s.tick, { trust: 0.1, affinity: 0.1, debt: -1 });
        healer.needs.estima = clamp01(healer.needs.estima + 0.1);
      }
      if (rng.chance(cure)) {
        a.disease = 0;
        engine.emit(makeEvent({ kind: "agent.healed", tick: s.tick, agentId: a.id, targetId: healer?.id ?? null, x: a.x, y: a.y, importance: 4, data: { healer: healer?.id ?? null }, tags: ["enfermedad", "salud"] }));
      }
    } else {
      let p = cfg.life.diseaseChancePerDay;
      if (a.needs.calor < 0.3 || a.needs.hambre < 0.3) p *= 3;
      if (age > cfg.life.elderAgeYears || age < 0.5) p *= 2;
      const sickNear = engine.spatial.query(a.x, a.y, 2, s.agents).some((oid) => oid !== a.id && (s.agents.get(oid)?.disease ?? 0) > 0);
      if (sickNear) p += 0.05;
      if (rng.chance(p)) {
        a.disease = 1;
        engine.emit(makeEvent({ kind: "agent.sick", tick: s.tick, agentId: a.id, x: a.x, y: a.y, importance: 5, tags: ["enfermedad"] }));
      }
    }

    // vínculos de pareja por afinidad (System 1)
    if (a.bondedTo === null && isAdult(a, s.tick, cfg) && age < cfg.life.fertileToYears + 2) {
      for (const [oid, rel] of a.relationships) {
        if (rel.affinity < 0.5 || rel.familiarity < 0.3 || rel.kinship > 0) continue;
        const o = s.agents.get(oid);
        if (!o || o.diedTick !== null || o.bondedTo !== null || o.sex === a.sex || !isAdult(o, s.tick, cfg)) continue;
        const back = o.relationships.get(a.id);
        if (!back || back.affinity < 0.5) continue;
        if (Math.max(Math.abs(o.x - a.x), Math.abs(o.y - a.y)) > 6) continue;
        if (!rng.chance(0.25)) continue;
        a.bondedTo = o.id;
        o.bondedTo = a.id;
        for (const [x, y] of [
          [a, o],
          [o, a],
        ] as const) {
          const r = relationship(x, y.id, s.tick);
          r.label = "pareja";
          r.kinship = Math.max(r.kinship, 0.5);
          r.affinity = Math.min(1, r.affinity + 0.2);
          r.trust = Math.min(1, r.trust + 0.2);
          remember(s, x, "observacion", `${y.name} y yo somos pareja`, 8, ["union", "pareja"], [y.id]);
        }
        engine.emit(makeEvent({ kind: "bond", tick: s.tick, agentId: a.id, targetId: o.id, x: a.x, y: a.y, label: "pareja", importance: 7, tags: ["union", "pareja"] }));
        break;
      }
    }

    // concepción
    if (a.sex === "f" && a.pregnantUntil === null && a.bondedTo !== null && age >= cfg.life.fertileFromYears && age <= cfg.life.fertileToYears) {
      const partner = s.agents.get(a.bondedTo);
      if (partner && partner.diedTick === null && Math.max(Math.abs(partner.x - a.x), Math.abs(partner.y - a.y)) <= 2 && a.needs.hambre > 0.45 && a.needs.sed > 0.3 && a.health > 0.6) {
        const young = a.children.filter((cid) => {
          const c = s.agents.get(cid);
          return c && c.diedTick === null && (s.tick - c.bornTick) / perYear < 1;
        }).length;
        const p = cfg.life.baseFertilityPerDay * (0.5 + a.genome.fertilidad) * (0.5 + partner.genome.fertilidad) * (young > 0 ? 0.15 : 1);
        if (rng.chance(p)) {
          a.pregnantUntil = s.tick + Math.round(cfg.life.gestationDays * cfg.time.ticksPerDay);
          a.pregnantBy = partner.id;
          engine.emit(makeEvent({ kind: "pregnancy", tick: s.tick, agentId: a.id, targetId: partner.id, x: a.x, y: a.y, importance: 6, tags: ["embarazo", "vida"] }));
        }
      }
    }
  }
}

/** Al morir: los bienes y la casa pasan a la pareja o al hijo mayor. */
export function inherit(engine: Engine, dead: Agent): Agent | null {
  const s = engine.s;
  let heir: Agent | null = null;
  if (dead.bondedTo !== null) {
    const p = s.agents.get(dead.bondedTo);
    if (p && p.diedTick === null) heir = p;
  }
  if (!heir) {
    const kids = dead.children.map((c) => s.agents.get(c)).filter((c): c is Agent => !!c && c.diedTick === null).sort((p, q) => p.bornTick - q.bornTick);
    heir = kids[0] ?? null;
  }
  if (!heir) return null;
  let got = 0;
  for (const [item, n] of dead.inventory) {
    addItem(heir, item, n);
    got += n;
  }
  dead.inventory.clear();
  if (dead.home && !heir.home) heir.home = { ...dead.home };
  if (got > 0) remember(s, heir, "observacion", `Heredé lo que dejó ${dead.name}`, 5, ["herencia", "muerte"], [dead.id]);
  return heir;
}

/** Puntaje de leyenda: cuánto dejó un ser en la memoria del mundo. */
export function legendScore(engine: Engine, dead: Agent, extras: { leader: boolean; founder: boolean; texts: number; discoveries: number }): number {
  const s = engine.s;
  let known = 0;
  for (const id of s.alive) {
    const r = s.agents.get(id)!.relationships.get(dead.id);
    if (r && r.familiarity > 0.4) known++;
  }
  return known * 0.5 + (extras.leader ? 3 : 0) + (extras.founder ? 3 : 0) + extras.texts + extras.discoveries * 2 + dead.children.length * 0.5 + inv(dead, "arte");
}
