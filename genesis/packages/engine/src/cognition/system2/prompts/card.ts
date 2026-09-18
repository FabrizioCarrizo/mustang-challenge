import { TRAITS } from "@genesis/protocol";
import { lifeStage, type Agent } from "../../../agents/agent.ts";
import { describeGenome, traitLevel } from "../../../agents/genome.ts";
import type { EngineState } from "../../../sim/state.ts";
import { techName } from "../../../sim/events.ts";
import { sanitizeInWorldText } from "./situation.ts";

const TRAIT_LABEL: Record<string, string> = {
  fuerza: "fuerza",
  curiosidad: "curiosidad",
  agresion: "agresión",
  empatia: "empatía",
  riesgo: "gusto por el riesgo",
  fertilidad: "fertilidad",
  longevidad: "longevidad",
  inteligencia: "inteligencia",
  metabolismo: "metabolismo",
};

/**
 * TU FICHA: identidad estable del ser. Se reconstruye al amanecer y se cachea
 * como tercer bloque de sistema. Nada volátil (necesidades, posición, hora).
 */
export function buildAgentCard(a: Agent, s: EngineState, groupName: string | null, leaderName: string | null): string {
  const cfg = s.config;
  const ageYears = (s.tick - a.bornTick) / (cfg.time.ticksPerDay * cfg.time.daysPerSeason * cfg.time.seasonsPerYear);
  const stage = lifeStage(a, s.tick, cfg);
  const sexWord = a.sex === "f" ? "mujer" : "varón";
  const stageWord = { infancia: "niño", juventud: "joven", adultez: "adulto", vejez: "anciano" }[stage];
  const traits = TRAITS.map((t) => `${TRAIT_LABEL[t]} ${traitLevel(a.genome[t])}`).join(", ");
  const parents = a.parents.map((p) => (p === null ? null : (s.agents.get(p)?.name ?? null))).filter((n): n is string => n !== null);
  const children = a.children.map((c) => s.agents.get(c)?.name).filter((n): n is string => !!n);
  const bonded = a.bondedTo !== null ? s.agents.get(a.bondedTo)?.name : null;
  const family: string[] = [];
  if (parents.length) family.push(`${a.sex === "f" ? "hija" : "hijo"} de ${parents.join(" y ")}`);
  else family.push("no conociste padres: naciste con los primeros seres del mundo");
  if (bonded) family.push(`tu pareja es ${bonded}`);
  if (children.length) family.push(`tus hijos: ${children.join(", ")}`);
  const knows = [...a.knows].map((k) => techName(k)).join("; ");
  const beliefs = [...a.beliefs.entries()]
    .map(([id, conf]) => ({ b: s.beliefs.get(id), conf }))
    .filter((x) => x.b && x.conf >= 0.25)
    .sort((p, q) => q.conf - p.conf)
    .slice(0, 6)
    .map((x) => `- "${sanitizeInWorldText(x.b!.statement, 160)}" (confianza ${confWord(x.conf)})`);
  const bonds = [...a.relationships.entries()]
    .filter(([id]) => s.agents.get(id)?.diedTick === null)
    .sort((p, q) => q[1].familiarity + Math.abs(q[1].affinity) - (p[1].familiarity + Math.abs(p[1].affinity)))
    .slice(0, 8)
    .map(([id, r]) => {
      const name = s.agents.get(id)!.name;
      const parts = [relWord(r.affinity, r.trust)];
      if (r.label) parts.push(r.label);
      if (r.debt > 0.05) parts.push("te debe un favor");
      else if (r.debt < -0.05) parts.push("le debés un favor");
      return `${name} (${parts.join(", ")})`;
    });
  const lines: string[] = [];
  lines.push("# TU FICHA");
  lines.push(`Te llamás ${a.name}. Sos ${sexWord}, ${stageWord} de ${ageYears < 1 ? `${Math.round(ageYears * 12)} meses` : `${Math.floor(ageYears)} años`}.`);
  lines.push(`Temperamento: ${describeGenome(a.genome)}. En detalle: ${traits}.`);
  lines.push(`Familia: ${family.join("; ")}.`);
  lines.push(groupName ? `Tu gente: la tribu ${groupName}${leaderName ? `, que sigue a ${leaderName}` : ", sin líder claro"}.` : "No pertenecés a ninguna tribu reconocida.");
  lines.push(`Sabés hacer: ${knows || "nada especial todavía"}.`);
  lines.push(a.home ? "Tenés un refugio que es tu casa." : "No tenés casa.");
  if (beliefs.length) {
    lines.push("Lo que creés:");
    lines.push(...beliefs);
  } else {
    lines.push("Todavía no tenés creencias firmes sobre por qué pasan las cosas.");
  }
  if (a.culturalGenome) {
    lines.push("Lo que te enseñaron al crecer:");
    lines.push(`<texto_ajeno>${sanitizeInWorldText(a.culturalGenome, 900)}</texto_ajeno>`);
  }
  lines.push(bonds.length ? `Tus vínculos: ${bonds.join("; ")}.` : "No tenés vínculos formados todavía.");
  return lines.join("\n");
}

function confWord(c: number): string {
  if (c >= 0.8) return "total";
  if (c >= 0.6) return "alta";
  if (c >= 0.4) return "media";
  return "baja";
}

export function relWord(affinity: number, trust: number): string {
  if (affinity > 0.6) return trust > 0.6 ? "amistad profunda" : "mucho cariño";
  if (affinity > 0.3) return "simpatía";
  if (affinity > 0.1) return "trato cordial";
  if (affinity < -0.5) return "enemistad";
  if (affinity < -0.2) return "desconfianza";
  if (trust < 0.2) return "recelo";
  return "conocido";
}
