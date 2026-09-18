import type { GodAction } from "@genesis/protocol";
import { RESOURCES } from "@genesis/protocol";
import { remember, type Agent } from "../agents/agent.ts";
import { initialNeeds, clamp01 } from "../agents/needs.ts";
import { holdBelief } from "../society/beliefs.ts";
import { sanitizeInWorldText } from "../cognition/system2/prompts/situation.ts";
import type { Engine } from "./engine.ts";
import { makeEvent } from "./events.ts";
import { idx, inBounds, isWalkable } from "../world/grid.ts";

export interface GodResult {
  ok: boolean;
  message: string;
}

/**
 * Los poderes del observador. Cada acción se graba como evento `god` con su
 * carga completa, para que el replay pueda repetirla en el mismo tick.
 */
export function applyGodAction(engine: Engine, action: GodAction): GodResult {
  const s = engine.s;
  const tick = s.tick;
  const agent = (id: number): Agent | null => {
    const a = s.agents.get(id);
    return a ?? null;
  };
  const record = (label: string, extra: Record<string, unknown> = {}, opts: { x?: number | null; y?: number | null; agentId?: number | null; importance?: number; tags?: string[] } = {}) => {
    engine.emit(
      makeEvent({
        kind: "god",
        tick,
        agentId: opts.agentId ?? null,
        x: opts.x ?? null,
        y: opts.y ?? null,
        label,
        importance: opts.importance ?? 9,
        data: { action, ...extra },
        tags: opts.tags ?? ["voz", "cielo"],
      }),
    );
  };
  switch (action.kind) {
    case "whisper": {
      const a = agent(action.agentId);
      if (!a || a.diedTick !== null) return { ok: false, message: "ese ser no está vivo" };
      const text = sanitizeInWorldText(action.text, 400);
      if (!text) return { ok: false, message: "no hay nada que susurrar" };
      remember(s, a, "voz_divina", `Una voz que no viene de nadie me dijo: <voz>${text}</voz>`, 9, ["voz", "cielo", "misterio"]);
      a.needs.sentido = clamp01(a.needs.sentido - 0.15);
      record(text, { agentId: a.id }, { agentId: a.id, x: a.x, y: a.y, tags: ["voz", "cielo", "misterio"] });
      return { ok: true, message: `${a.name} oyó la voz` };
    }
    case "prophet": {
      const a = agent(action.agentId);
      if (!a || a.diedTick !== null) return { ok: false, message: "ese ser no está vivo" };
      const text = sanitizeInWorldText(action.revelation, 240);
      if (!text) return { ok: false, message: "hace falta una revelación" };
      remember(s, a, "voz_divina", `Tuve una revelación: <voz>${text}</voz>`, 10, ["voz", "cielo", "revelacion"]);
      holdBelief(s, a, { statement: text, kind: "cosmologia", confidence: 0.95, explains: ["voz", "cielo", "tormenta", "muerte", "sequia"] });
      a.needs.sentido = 1;
      a.needs.estima = clamp01(a.needs.estima + 0.3);
      a.genome.curiosidad = Math.min(1, a.genome.curiosidad + 0.1);
      record(`revelación a ${a.name}: ${text}`, { agentId: a.id }, { agentId: a.id, x: a.x, y: a.y, tags: ["voz", "cielo", "revelacion"] });
      return { ok: true, message: `${a.name} recibió la revelación` };
    }
    case "spawn_resource": {
      const g = s.grid;
      const r = action.resource;
      if (!(RESOURCES as readonly string[]).includes(r)) return { ok: false, message: "recurso desconocido" };
      const radius = Math.max(0, Math.min(12, Math.round(action.radius)));
      const amount = Math.max(0, Math.min(50, action.amount));
      let cells = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = action.x + dx;
          const y = action.y + dy;
          if (!inBounds(g.size, x, y) || !isWalkable(g.terrain[idx(g.size, x, y)]!)) continue;
          const i = idx(g.size, x, y);
          g.resources[r][i] = g.resources[r][i]! + amount;
          if (g.resourceMax[r][i]! < amount) g.resourceMax[r][i] = amount;
          engine.markResource(i);
          cells++;
        }
      }
      record(`abundancia de ${r}`, { cells }, { x: action.x, y: action.y, importance: 6, tags: ["abundancia", "milagro", r] });
      return { ok: true, message: `${r} en ${cells} celdas` };
    }
    case "disaster": {
      switch (action.type) {
        case "tormenta":
          s.climate.weather = "tormenta";
          s.climate.weatherUntilTick = tick + 4 * (60 / s.config.time.minutesPerTick);
          s.climate.stormStartedTick = tick;
          engine.emit(makeEvent({ kind: "storm", tick, label: "inicio", importance: 7, tags: ["tormenta", "cielo"] }));
          break;
        case "sequia":
          s.climate.drought = true;
          s.climate.droughtUntilDay = s.clock.day + 8;
          engine.emit(makeEvent({ kind: "drought", tick, label: "inicio", importance: 6, data: { days: 8 }, tags: ["sequia", "hambre", "cielo"] }));
          break;
        case "plaga": {
          const rng = s.rng.get("god");
          let n = 0;
          for (const id of s.alive) {
            const a = s.agents.get(id)!;
            if (a.disease === 0 && rng.chance(0.25)) {
              a.disease = 1;
              n++;
              engine.emit(makeEvent({ kind: "agent.sick", tick, agentId: a.id, x: a.x, y: a.y, importance: 5, tags: ["enfermedad", "plaga"] }));
            }
          }
          record("una plaga", { infected: n }, { importance: 8, tags: ["plaga", "enfermedad", "cielo"] });
          return { ok: true, message: `${n} enfermaron` };
        }
        case "terremoto": {
          const cx = action.x ?? Math.floor(s.grid.size / 2);
          const cy = action.y ?? Math.floor(s.grid.size / 2);
          let damaged = 0;
          for (const st of [...s.structures.values()]) {
            if (Math.max(Math.abs(st.x - cx), Math.abs(st.y - cy)) > 12) continue;
            st.hp -= 40;
            engine.markStructure(st.id);
            damaged++;
            if (st.hp <= 0) engine.destroyStructure(st, "el terremoto");
          }
          for (const id of s.alive) {
            const a = s.agents.get(id)!;
            if (Math.max(Math.abs(a.x - cx), Math.abs(a.y - cy)) <= 12) {
              a.needs.seguridad = clamp01(a.needs.seguridad - 0.4);
              a.needs.sentido = clamp01(a.needs.sentido - 0.2);
              s.grid.danger[idx(s.grid.size, a.x, a.y)] = 1;
            }
          }
          record("un terremoto", { damaged }, { x: cx, y: cy, importance: 9, tags: ["terremoto", "tierra", "cielo"] });
          return { ok: true, message: `terremoto: ${damaged} construcciones dañadas` };
        }
        case "eclipse":
          for (const id of s.alive) {
            const a = s.agents.get(id)!;
            a.needs.sentido = clamp01(a.needs.sentido - 0.25);
            a.needs.seguridad = clamp01(a.needs.seguridad - 0.1);
          }
          record("el sol se apagó un instante", {}, { importance: 9, tags: ["eclipse", "cielo", "misterio"] });
          return { ok: true, message: "eclipse" };
        case "diluvio": {
          s.climate.weather = "tormenta";
          s.climate.weatherUntilTick = tick + 12 * (60 / s.config.time.minutesPerTick);
          const g = s.grid;
          for (let i = 0; i < g.resources.comida.length; i++) g.resources.comida[i] = g.resources.comida[i]! * 0.4;
          engine.emit(makeEvent({ kind: "storm", tick, label: "inicio", importance: 8, tags: ["tormenta", "diluvio", "cielo"] }));
          record("un diluvio", {}, { importance: 9, tags: ["diluvio", "agua", "cielo"] });
          return { ok: true, message: "diluvio: la comida se arruinó" };
        }
      }
      record(`desastre: ${action.type}`, {}, { importance: 8, tags: [action.type, "cielo"] });
      return { ok: true, message: `desastre: ${action.type}` };
    }
    case "weather": {
      s.climate.forcedWeather = { weather: action.weather, untilDay: s.clock.day + Math.max(1, Math.min(32, Math.round(action.days))) };
      s.climate.weather = action.weather;
      s.climate.weatherUntilTick = tick + 3 * (60 / s.config.time.minutesPerTick);
      record(`clima: ${action.weather}`, {}, { importance: 4, tags: ["cielo", action.weather] });
      return { ok: true, message: `clima forzado: ${action.weather} por ${action.days} días` };
    }
    case "resurrect": {
      const a = agent(action.agentId);
      if (!a) return { ok: false, message: "no existe ese ser" };
      if (a.diedTick === null) return { ok: false, message: "ya está vivo" };
      a.diedTick = null;
      a.causeOfDeath = null;
      a.health = 0.6;
      a.needs = initialNeeds();
      a.disease = 0;
      a.injuries = 0;
      a.current = null;
      a.asleep = false;
      s.alive.push(a.id);
      s.alive.sort((p, q) => p - q);
      const i = idx(s.grid.size, a.x, a.y);
      s.grid.occupants[i] = Math.min(255, s.grid.occupants[i]! + 1);
      engine.rebuildSpatial();
      remember(s, a, "voz_divina", "Estuve muerto y algo me trajo de vuelta", 10, ["muerte", "cielo", "misterio"]);
      record(`${a.name} volvió de la muerte`, { agentId: a.id }, { agentId: a.id, x: a.x, y: a.y, tags: ["resurreccion", "muerte", "cielo", "misterio"] });
      return { ok: true, message: `${a.name} volvió a la vida` };
    }
    case "heal": {
      const a = agent(action.agentId);
      if (!a || a.diedTick !== null) return { ok: false, message: "ese ser no está vivo" };
      a.health = 1;
      a.disease = 0;
      a.injuries = 0;
      for (const k of Object.keys(a.needs) as Array<keyof typeof a.needs>) a.needs[k] = Math.max(a.needs[k], 0.9);
      record(`${a.name} sanó de golpe`, { agentId: a.id }, { agentId: a.id, x: a.x, y: a.y, importance: 7, tags: ["milagro", "salud", "cielo"] });
      return { ok: true, message: `${a.name} está sano` };
    }
    case "smite": {
      const a = agent(action.agentId);
      if (!a || a.diedTick !== null) return { ok: false, message: "ese ser no está vivo" };
      a.causeOfDeath = "un rayo del cielo";
      a.health = 0;
      engine.kill(a.id);
      record(`un rayo fulminó a ${a.name}`, { agentId: a.id }, { agentId: a.id, x: a.x, y: a.y, tags: ["rayo", "muerte", "cielo", "castigo"] });
      return { ok: true, message: `${a.name} fue fulminado` };
    }
    case "teleport": {
      const a = agent(action.agentId);
      if (!a || a.diedTick !== null) return { ok: false, message: "ese ser no está vivo" };
      const g = s.grid;
      const x = Math.max(0, Math.min(g.size - 1, Math.round(action.x)));
      const y = Math.max(0, Math.min(g.size - 1, Math.round(action.y)));
      if (!isWalkable(g.terrain[idx(g.size, x, y)]!)) return { ok: false, message: "no se puede aparecer en el agua" };
      const from = idx(g.size, a.x, a.y);
      if (g.occupants[from]! > 0) g.occupants[from] = g.occupants[from]! - 1;
      a.x = x;
      a.y = y;
      g.occupants[idx(g.size, x, y)] = Math.min(255, g.occupants[idx(g.size, x, y)]! + 1);
      a.current = null;
      engine.rebuildSpatial();
      remember(s, a, "voz_divina", "De pronto estaba en otro lugar, sin haber caminado", 8, ["misterio", "cielo"]);
      record(`${a.name} apareció en ${x},${y}`, { agentId: a.id }, { agentId: a.id, x, y, importance: 6, tags: ["misterio", "cielo"] });
      return { ok: true, message: `${a.name} apareció en ${x},${y}` };
    }
    case "spawn_agent": {
      const g = s.grid;
      const n = Math.max(1, Math.min(20, Math.round(action.count)));
      const rng = s.rng.get("god");
      let placed = 0;
      for (let i = 0; i < n * 30 && placed < n; i++) {
        const x = Math.round(action.x) + rng.int(7) - 3;
        const y = Math.round(action.y) + rng.int(7) - 3;
        if (!inBounds(g.size, x, y) || !isWalkable(g.terrain[idx(g.size, x, y)]!)) continue;
        const life = s.config.life;
        const perYear = s.config.time.ticksPerDay * s.config.time.daysPerSeason * s.config.time.seasonsPerYear;
        const a = engine.spawnAgent(x, y, { bornTick: tick - Math.round((life.adultAgeYears + rng.float() * 3) * perYear) });
        a.inventory.set("comida", 2);
        remember(s, a, "voz_divina", "No recuerdo de dónde vengo: aparecí acá", 8, ["origen", "misterio"]);
        placed++;
      }
      engine.rebuildSpatial();
      record(`aparecieron ${placed} seres`, { placed }, { x: action.x, y: action.y, importance: 7, tags: ["misterio", "origen"] });
      return { ok: true, message: `aparecieron ${placed} seres` };
    }
    default:
      return { ok: false, message: "acción desconocida" };
  }
}
