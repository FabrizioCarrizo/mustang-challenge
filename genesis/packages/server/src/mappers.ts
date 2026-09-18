import type {
  AgentDetail,
  AgentStatus,
  AgentSummary,
  ClimateInfo,
  ClockInfo,
  EventInfo,
  MemoryInfo,
  StructureInfo,
  WorldInfo,
} from "@genesis/protocol";
import { RESOURCES, type ResourceKind } from "@genesis/protocol";
import { describeEvent, lifeStage, type Agent, type Clock, type Engine, type Memory, type WorldEvent } from "@genesis/engine";

export function clockInfo(c: Clock): ClockInfo {
  return {
    tick: c.tick,
    minuteOfDay: c.minuteOfDay,
    hour: c.hour,
    day: c.day,
    dayOfSeason: c.dayOfSeason,
    seasonIndex: c.seasonIndex,
    season: c.season,
    year: c.year,
    dayOfYear: c.dayOfYear,
    isDay: c.isDay,
    daylight: c.daylight,
  };
}

export function climateInfo(engine: Engine): ClimateInfo {
  const c = engine.s.climate;
  return { temperature: Math.round(c.temperature * 10) / 10, weather: c.weather, drought: c.drought };
}

export function worldInfo(engine: Engine): WorldInfo {
  const cfg = engine.config;
  return {
    name: engine.s.worldName,
    seed: engine.s.seed,
    size: engine.s.grid.size,
    createdTick: 0,
    ticksPerDay: cfg.time.ticksPerDay,
    daysPerSeason: cfg.time.daysPerSeason,
    seasonsPerYear: cfg.time.seasonsPerYear,
  };
}

export function agentStatus(a: Agent): AgentStatus {
  if (a.diedTick !== null) return "muerto";
  if (a.asleep) return "durmiendo";
  if (a.current?.verb === "conversar") return "conversando";
  if (a.current?.verb === "atacar" || a.current?.verb === "huir") return "peleando";
  if (a.disease > 0) return "enfermo";
  if (a.health < 0.5) return "herido";
  return "activo";
}

export function agentSummary(a: Agent, engine: Engine): AgentSummary {
  return {
    id: a.id,
    name: a.name,
    sex: a.sex,
    x: a.x,
    y: a.y,
    st: agentStatus(a),
    act: a.asleep ? "dormir" : (a.current?.verb ?? "descansar"),
    g: a.groupId,
    age: Math.round(engine.ageYears(a) * 100) / 100,
    hp: Math.round(a.health * 100) / 100,
    alive: a.diedTick === null,
  };
}

export function agentDetail(a: Agent, engine: Engine, groupName: string | null = null): AgentDetail {
  const inventory: Partial<Record<string, number>> = {};
  for (const [k, v] of a.inventory) inventory[k] = Math.round(v * 10) / 10;
  const relationships = [...a.relationships.entries()]
    .map(([id, r]) => ({
      id,
      name: engine.names.name(id),
      trust: round2(r.trust),
      affinity: round2(r.affinity),
      debt: round2(r.debt),
      kinship: round2(r.kinship),
      familiarity: round2(r.familiarity),
      label: r.label,
    }))
    .sort((p, q) => q.familiarity + Math.abs(q.affinity) - (p.familiarity + Math.abs(p.affinity)))
    .slice(0, 40);
  return {
    ...agentSummary(a, engine),
    needs: { ...a.needs },
    traits: { ...a.genome },
    inventory,
    health: round2(a.health),
    injuries: round2(a.injuries),
    disease: round2(a.disease),
    pregnant: a.pregnantUntil !== null,
    bornTick: a.bornTick,
    diedTick: a.diedTick,
    causeOfDeath: a.causeOfDeath,
    home: a.home ? { ...a.home } : null,
    current: a.current ? `${a.current.verb}${a.current.reason ? ` (${a.current.reason})` : ""}` : a.asleep ? "dormir" : null,
    plan: a.plan.map((p) => ({ verbo: p.verbo, objetivo: p.objetivo, prioridad: p.prioridad, done: p.done })),
    mood: a.mood,
    relationships,
    knows: [...a.knows],
    culturalGenome: a.culturalGenome,
    parents: [a.parents[0], a.parents[1]],
    children: a.children.slice(),
    groupName,
    lifeStage: lifeStage(a, engine.s.tick, engine.config),
  };
}

export function structureInfo(st: {
  id: number;
  kind: StructureInfo["kind"];
  x: number;
  y: number;
  ownerId: number | null;
  groupId: number | null;
  progress: number;
  hp: number;
  dedication: string | null;
  lit: boolean;
}): StructureInfo {
  return {
    id: st.id,
    kind: st.kind,
    x: st.x,
    y: st.y,
    ownerId: st.ownerId,
    groupId: st.groupId,
    progress: Math.round(st.progress * 100) / 100,
    hp: st.hp,
    dedication: st.dedication,
    lit: st.lit,
  };
}

export function eventInfo(e: WorldEvent, seq: number, engine: Engine): EventInfo {
  return {
    seq,
    tick: e.tick,
    kind: e.kind,
    importance: e.importance,
    text: describeEvent(e, engine.names),
    agentId: e.agentId,
    targetId: e.targetId,
    x: e.x,
    y: e.y,
  };
}

export function memoryInfo(m: Memory): MemoryInfo {
  return { id: m.id, tick: m.tick, kind: m.kind, text: m.text, importance: m.importance, tags: m.tags };
}

/** Recursos cuantizados a 0..255 relativo al máximo de la celda (o al máximo global si la celda no tiene máximo). */
export function quantizeResources(engine: Engine): Record<ResourceKind, string> {
  const g = engine.s.grid;
  const out = {} as Record<ResourceKind, string>;
  for (const r of RESOURCES) {
    const arr = g.resources[r];
    const max = g.resourceMax[r];
    const q = new Uint8Array(arr.length);
    const globalMax = engine.config.resources.maxPerCell[r] * engine.config.world.abundance;
    for (let i = 0; i < arr.length; i++) {
      const m = max[i]! > 0 ? max[i]! : globalMax;
      q[i] = Math.max(0, Math.min(255, Math.round((arr[i]! / m) * 255)));
    }
    out[r] = Buffer.from(q).toString("base64");
  }
  return out;
}

export function quantizeCell(engine: Engine, cell: number, r: ResourceKind): number {
  const g = engine.s.grid;
  const m = g.resourceMax[r][cell]! > 0 ? g.resourceMax[r][cell]! : engine.config.resources.maxPerCell[r] * engine.config.world.abundance;
  return Math.max(0, Math.min(255, Math.round((g.resources[r][cell]! / m) * 255)));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
