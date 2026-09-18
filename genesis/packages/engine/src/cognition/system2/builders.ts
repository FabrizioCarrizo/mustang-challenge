import type { Agent } from "../../agents/agent.ts";
import { describeGenome } from "../../agents/genome.ts";
import type { MockContext } from "../../brain/mock.ts";
import type { SystemBlock } from "../../brain/provider.ts";
import type { Retriever } from "../../memory/retrieval.ts";
import { hashString } from "../../rng.ts";
import { describeEvent, type WorldEvent } from "../../sim/events.ts";
import type { EngineState } from "../../sim/state.ts";
import type { SpatialHash } from "../../sim/spatial.ts";
import { beliefsOf } from "../../society/beliefs.ts";
import { buildAgentCard, relWord } from "./prompts/card.ts";
import { GUIDES } from "./prompts/guides.ts";
import { buildSituation, joinSituation, memoryLine, sanitizeInWorldText, tickToDayLabel } from "./prompts/situation.ts";
import type { CallType } from "./schemas.ts";

export interface BuildContext {
  s: EngineState;
  spatial: SpatialHash;
  retriever: Retriever;
  laws: string;
  groupNameOf: (agentId: number) => string | null;
  leaderNameOf: (agentId: number) => string | null;
  names: { name(id: number | null): string };
}

export interface BuiltPrompt {
  system: SystemBlock[];
  user: string;
  meta: { mock: MockContext; summary: string };
  promptHash: string;
}

export function agentCard(a: Agent, ctx: BuildContext): string {
  const day = ctx.s.clock.day;
  if (a.cardCache && a.cardCache.day === day) return a.cardCache.text;
  const text = buildAgentCard(a, ctx.s, ctx.groupNameOf(a.id), ctx.leaderNameOf(a.id));
  a.cardCache = { day, text };
  return text;
}

function systemBlocks(type: CallType, a: Agent | null, ctx: BuildContext, cacheCard: boolean): { blocks: SystemBlock[]; hash: string } {
  const blocks: SystemBlock[] = [
    { text: ctx.laws, cache: true },
    { text: GUIDES[type], cache: true },
  ];
  if (a) blocks.push({ text: agentCard(a, ctx), cache: cacheCard });
  const hash = hashString(blocks.map((b) => b.text).join("\n")).toString(16);
  return { blocks, hash };
}

function nearbyIds(a: Agent, ctx: BuildContext, radius: number): number[] {
  return ctx.spatial.query(a.x, a.y, radius, ctx.s.agents).filter((id) => id !== a.id);
}

function mockContext(a: Agent, ctx: BuildContext, near: number[], extra: Partial<MockContext> = {}): MockContext {
  const s = ctx.s;
  const cfg = s.config;
  const age = (s.tick - a.bornTick) / (cfg.time.ticksPerDay * cfg.time.daysPerSeason * cfg.time.seasonsPerYear);
  return {
    tick: s.tick,
    seed: s.seed,
    agentName: a.name,
    sex: a.sex,
    isChild: age < cfg.life.adultAgeYears,
    hasHome: a.home !== null,
    knows: [...a.knows],
    inventory: Object.fromEntries(a.inventory),
    needs: { ...a.needs },
    season: s.clock.season,
    nearby: near
      .map((id) => s.agents.get(id))
      .filter((o): o is Agent => !!o && o.diedTick === null)
      .slice(0, 8)
      .map((o) => ({ id: o.id, name: o.name, affinity: a.relationships.get(o.id)?.affinity ?? 0, knows: [...o.knows], inventory: Object.fromEntries(o.inventory) })),
    beliefs: beliefsOf(s, a).map((b) => b.belief.statement),
    recentMemories: a.memories.slice(-12).map((m) => m.text),
    groupName: ctx.groupNameOf(a.id),
    ...extra,
  };
}

export function buildDailyPlan(a: Agent, ctx: BuildContext): BuiltPrompt {
  const s = ctx.s;
  const near = nearbyIds(a, ctx, s.config.social.perceptionRadius);
  const sit = buildSituation(a, s, ctx.retriever, `${s.clock.season} comida madera frío casa amigos plan promesa`, s.config.brain.retrievalK, near);
  const parts = [joinSituation(sit)];
  if (a.intention) parts.push(`Anoche te dormiste pensando: ${sanitizeInWorldText(a.intention, 200)}`);
  if (a.diaryPending.length) parts.push(`Desde tu último diario pasó: ${a.diaryPending.slice(-6).map((t) => sanitizeInWorldText(t, 160)).join("; ")}.`);
  parts.push("# LA LLAMADA\nAcabás de despertar. Armá tu plan para hoy como indica la guía.");
  const { blocks, hash } = systemBlocks("daily_plan", a, ctx, true);
  return { system: blocks, user: parts.join("\n\n"), meta: { mock: mockContext(a, ctx, near), summary: sit.body }, promptHash: hash };
}

export function buildReflection(a: Agent, ctx: BuildContext): BuiltPrompt {
  const s = ctx.s;
  const near = nearbyIds(a, ctx, s.config.social.perceptionRadius);
  const recent = a.memories.slice(-10);
  const tags = [...new Set(recent.flatMap((m) => m.tags))].slice(0, 8).join(" ");
  const sit = buildSituation(a, s, ctx.retriever, tags || "hoy", Math.min(24, s.config.brain.retrievalK + 8), near);
  const today = a.memories.filter((m) => s.tick - m.tick <= s.config.time.ticksPerDay).slice(-12);
  const parts = [
    "# AHORA",
    sit.now,
    sit.body,
    "",
    "# LO QUE PASÓ ÚLTIMAMENTE",
    today.length ? today.map((m) => `- (${tickToDayLabel(m.tick, s)}) ${memoryLine(m)}`).join("\n") : "- (un día sin nada notable)",
    "",
    "# LO QUE YA SABÍAS O CREÍAS",
    sit.memories,
    "",
    "# LA CALLADA\nTe estás durmiendo. Reflexioná como indica la guía.".replace("LA CALLADA", "LA LLAMADA"),
  ];
  const { blocks, hash } = systemBlocks("reflection", a, ctx, true);
  return { system: blocks, user: parts.join("\n"), meta: { mock: mockContext(a, ctx, near), summary: tags }, promptHash: hash };
}

export function buildDialogue(a: Agent, b: Agent, motives: string[], ctx: BuildContext): BuiltPrompt {
  const s = ctx.s;
  const near = nearbyIds(a, ctx, s.config.social.perceptionRadius);
  const sit = buildSituation(a, s, ctx.retriever, `${b.name} ${motives.join(" ")}`, s.config.brain.retrievalK, near);
  const rel = a.relationships.get(b.id);
  const relText = rel ? `${relWord(rel.affinity, rel.trust)}${rel.label ? `, ${rel.label}` : ""}${rel.debt > 0.05 ? ", te debe un favor" : rel.debt < -0.05 ? ", le debés un favor" : ""}` : "no lo conocés";
  const aboutB = ctx.retriever.retrieve(a, b.name, 6, s.tick, s.config.time.ticksPerDay).filter((m) => m.text.includes(b.name));
  const bItems = [...b.inventory.entries()].filter(([, n]) => n >= 1).map(([k]) => k);
  const bKnows = [...b.knows].filter((k) => k !== "refugio");
  const partner = [
    `# CON QUIÉN HABLÁS`,
    `B es ${b.name}, ${b.sex === "f" ? "mujer" : "varón"}, ${ageWord(b, s)}. Te parece alguien con ${describeGenome(b.genome)}. Para vos es: ${relText}.`,
    `Ahora ${b.asleep ? "está medio dormido" : b.current ? `está ${b.current.verb.replace("_", " ")}` : "no hace nada"}${bItems.length ? ` y lleva ${bItems.join(", ")}` : ""}.${bKnows.length ? ` Sabés que sabe: ${bKnows.join(", ")}.` : ""}`,
    aboutB.length ? `Lo que recordás de ${b.name}:\n${aboutB.map((m) => `- (${tickToDayLabel(m.tick, s)}) ${memoryLine(m)}`).join("\n")}` : `No recordás nada en particular de ${b.name}.`,
  ].join("\n");
  const parts = [joinSituation(sit), partner, `# POR QUÉ HABLAN\n${motives.length ? motives.join("; ") : "se cruzaron y hay ganas de hablar"}.`, "# LA LLAMADA\nEscribí la conversación completa y sus acuerdos como indica la guía."];
  const { blocks, hash } = systemBlocks("dialogue", a, ctx, true);
  const mock = mockContext(a, ctx, near, {
    partner: { id: b.id, name: b.name, affinity: rel?.affinity ?? 0, knows: [...b.knows], inventory: Object.fromEntries(b.inventory), beliefs: beliefsOf(s, b).map((x) => x.belief.statement) },
  });
  return { system: blocks, user: parts.join("\n\n"), meta: { mock, summary: `con ${b.name}: ${motives.join("; ")}` }, promptHash: hash };
}

export function buildReaction(a: Agent, event: WorldEvent, ctx: BuildContext): BuiltPrompt {
  const s = ctx.s;
  const near = nearbyIds(a, ctx, s.config.social.perceptionRadius);
  const text = describeEvent(event, ctx.names, a.id);
  const sit = buildSituation(a, s, ctx.retriever, `${text} ${event.tags.join(" ")}`, s.config.brain.retrievalK, near);
  const parts = [joinSituation(sit), `# LO QUE ACABA DE PASAR\n${text}.`, "# LA LLAMADA\nReaccioná como indica la guía."];
  const { blocks, hash } = systemBlocks("reaction", a, ctx, true);
  const mock = mockContext(a, ctx, near, { event: { kind: event.kind, tags: event.tags, text } });
  return { system: blocks, user: parts.join("\n\n"), meta: { mock, summary: text }, promptHash: hash };
}

export function buildCreate(a: Agent, ctx: BuildContext, hint: string | null = null): BuiltPrompt {
  const s = ctx.s;
  const near = nearbyIds(a, ctx, s.config.social.perceptionRadius);
  const sit = buildSituation(a, s, ctx.retriever, "arte canto relato sentido invento fuego herramienta", s.config.brain.retrievalK, near);
  const ask =
    hint === "texto"
      ? `# LA LLAMADA\nQuerés dejar algo escrito${a.knows.has("escritura") ? " en una tablilla" : ", aunque solo sepas tallar marcas"}: una receta, una ley, un mito, un aviso. Creá un texto como indica la guía (tipo texto).`
      : "# LA LLAMADA\nTenés un rato libre y algo por dentro. Creá como indica la guía.";
  const parts = [joinSituation(sit), ask];
  const { blocks, hash } = systemBlocks("create", a, ctx, false);
  return { system: blocks, user: parts.join("\n\n"), meta: { mock: mockContext(a, ctx, near), summary: hint ?? "crear" }, promptHash: hash };
}

export interface GovernContext {
  groupName: string;
  members: number;
  leaderSinceDays: number;
  norms: string[];
  rituals: string[];
  wars: string[];
  treaties: string[];
  recentCrimes: string[];
  issue: string;
  otherGroups: string[];
}

export function buildGovern(leader: Agent, gctx: GovernContext, ctx: BuildContext): BuiltPrompt {
  const s = ctx.s;
  const near = nearbyIds(leader, ctx, s.config.social.perceptionRadius);
  const sit = buildSituation(leader, s, ctx.retriever, `${gctx.issue} tribu ley norma crimen`, s.config.brain.retrievalK, near);
  const lines = [
    joinSituation(sit),
    `# TU GENTE\nLa tribu ${gctx.groupName}: ${gctx.members} seres. Te siguen desde hace ${gctx.leaderSinceDays} días.`,
    gctx.norms.length ? `Normas y decisiones vigentes:\n${gctx.norms.map((n) => `- <texto_ajeno>${sanitizeInWorldText(n, 160)}</texto_ajeno>`).join("\n")}` : "Todavía no hay normas ni ritos declarados.",
    gctx.rituals.length ? `Ritos: ${gctx.rituals.join("; ")}.` : "",
    gctx.wars.length ? `En guerra con: ${gctx.wars.join(", ")}.` : "",
    gctx.treaties.length ? `En paz con: ${gctx.treaties.join(", ")}.` : "",
    gctx.otherGroups.length ? `Otras tribus conocidas: ${gctx.otherGroups.join(", ")}.` : "No se conocen otras tribus.",
    gctx.recentCrimes.length ? `Crímenes recientes entre los tuyos:\n${gctx.recentCrimes.map((c) => `- ${sanitizeInWorldText(c, 160)}`).join("\n")}` : "",
    `# EL ASUNTO\n${sanitizeInWorldText(gctx.issue, 300)}`,
    "# LA LLAMADA\nDecidí y anunciá como indica la guía.",
  ].filter(Boolean);
  const { blocks, hash } = systemBlocks("govern", leader, ctx, false);
  return { system: blocks, user: lines.join("\n\n"), meta: { mock: mockContext(leader, ctx, near, { groupName: gctx.groupName }), summary: gctx.issue }, promptHash: hash };
}

export function buildHeritage(child: Agent, parents: Agent[], ctx: BuildContext, groupNorms: string[]): BuiltPrompt {
  const s = ctx.s;
  const lines: string[] = ["# LO QUE TUS PADRES Y TU GENTE TE DEJARON"];
  for (const p of parents) {
    const refl = p.memories.filter((m) => m.kind === "reflexion").slice(-10);
    const bel = beliefsOf(s, p).slice(0, 8);
    lines.push(`## ${p.name} (${p.sex === "f" ? "madre" : "padre"})`);
    lines.push(refl.length ? refl.map((m) => `- <texto_ajeno>${sanitizeInWorldText(m.text, 200)}</texto_ajeno>`).join("\n") : "- (no dejó reflexiones que recuerdes)");
    if (bel.length) lines.push(`Creía: ${bel.map((b) => `<texto_ajeno>${sanitizeInWorldText(b.belief.statement, 160)}</texto_ajeno>`).join("; ")}`);
  }
  if (groupNorms.length) lines.push(`## Normas y ritos de tu gente\n${groupNorms.map((n) => `- <texto_ajeno>${sanitizeInWorldText(n, 200)}</texto_ajeno>`).join("\n")}`);
  lines.push("# LA LLAMADA\nEscribí tu legado como indica la guía.");
  const { blocks, hash } = systemBlocks("heritage", child, ctx, false);
  const mock = mockContext(child, ctx, [], { beliefs: parents.flatMap((p) => beliefsOf(s, p).map((b) => b.belief.statement)) });
  return { system: blocks, user: lines.join("\n"), meta: { mock, summary: "herencia" }, promptHash: hash };
}

export function buildHistorian(facts: string[], previous: string | null, epoch: string, ctx: BuildContext, type: "historian" | "bard" = "historian"): BuiltPrompt {
  const lines = [
    `# LA ÉPOCA ACTUAL\n${epoch}`,
    previous ? `# CÓMO TERMINABA EL CAPÍTULO ANTERIOR\n<texto_ajeno>${sanitizeInWorldText(previous, 600)}</texto_ajeno>` : "# NO HAY CAPÍTULOS ANTERIORES",
    `# LOS HECHOS DEL PERÍODO\n${facts.length ? facts.map((f) => `- ${sanitizeInWorldText(f, 240)}`).join("\n") : "- (un período sin hechos registrados)"}`,
    type === "historian" ? "# LA LLAMADA\nEscribí el capítulo como indica la guía." : "# LA LLAMADA\nComponé el poema como indica la guía.",
  ];
  const { blocks, hash } = systemBlocks(type, null, ctx, false);
  const mock: MockContext = {
    tick: ctx.s.tick,
    seed: ctx.s.seed,
    agentName: "el historiador",
    sex: "m",
    isChild: false,
    hasHome: true,
    knows: [],
    inventory: {},
    needs: {},
    season: ctx.s.clock.season,
    nearby: ctx.s.alive.slice(0, 5).map((id) => ({ id, name: ctx.s.agents.get(id)!.name, affinity: 0, knows: [], inventory: {} })),
    beliefs: [],
    recentMemories: [],
    facts,
  };
  return { system: blocks, user: lines.join("\n\n"), meta: { mock, summary: "crónica" }, promptHash: hash };
}

function ageWord(a: Agent, s: EngineState): string {
  const cfg = s.config;
  const age = (s.tick - a.bornTick) / (cfg.time.ticksPerDay * cfg.time.daysPerSeason * cfg.time.seasonsPerYear);
  if (age < cfg.life.adultAgeYears) return "joven";
  if (age >= cfg.life.elderAgeYears) return "de edad avanzada";
  return "adulto";
}
