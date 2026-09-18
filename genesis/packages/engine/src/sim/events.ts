/**
 * Eventos semánticos del mundo. Son la fuente de verdad de la historia:
 * se graban en la base, alimentan la memoria de los seres, los detectores,
 * la Crónica y el dashboard. El movimiento NO es un evento.
 */

export type EventKind =
  | "season"
  | "weather"
  | "storm"
  | "drought"
  | "agent.born"
  | "agent.died"
  | "agent.suffering"
  | "agent.sick"
  | "agent.healed"
  | "agent.first"
  | "structure.built"
  | "structure.destroyed"
  | "fire.lit"
  | "fire.out"
  | "smalltalk"
  | "discovery"
  | "gift"
  | "trade"
  | "theft"
  | "attack"
  | "punish"
  | "claim"
  | "harvest"
  | "teach"
  | "read"
  | "write"
  | "pray"
  | "ritual"
  | "create"
  | "speech"
  | "dialogue"
  | "bond"
  | "pregnancy"
  | "belief"
  | "law"
  | "crime"
  | "group"
  | "leader"
  | "currency"
  | "milestone"
  | "epoch"
  | "war"
  | "treaty"
  | "god"
  | "intent"
  | "thought"
  | "state.hash";

export interface WorldEvent {
  kind: EventKind;
  tick: number;
  agentId: number | null;
  targetId: number | null;
  x: number | null;
  y: number | null;
  /** 0..10 */
  importance: number;
  /** subtipo o etiqueta corta (causa de muerte, nombre de tecnología, etc.) */
  label: string;
  data: Record<string, unknown>;
  /** si es falso no se persiste (eventos triviales de alta frecuencia) */
  persist: boolean;
  /** etiquetas para creencias/explicaciones (tormenta, muerte, hambre...) */
  tags: string[];
}

export interface EventInput {
  kind: EventKind;
  tick: number;
  agentId?: number | null;
  targetId?: number | null;
  x?: number | null;
  y?: number | null;
  importance?: number;
  label?: string;
  data?: Record<string, unknown>;
  persist?: boolean;
  tags?: string[];
}

export function makeEvent(input: EventInput): WorldEvent {
  return {
    kind: input.kind,
    tick: input.tick,
    agentId: input.agentId ?? null,
    targetId: input.targetId ?? null,
    x: input.x ?? null,
    y: input.y ?? null,
    importance: input.importance ?? defaultImportance(input.kind),
    label: input.label ?? "",
    data: input.data ?? {},
    persist: input.persist ?? true,
    tags: input.tags ?? [],
  };
}

export function defaultImportance(kind: EventKind): number {
  switch (kind) {
    case "agent.died":
      return 8;
    case "agent.born":
      return 8;
    case "attack":
      return 7;
    case "theft":
      return 6;
    case "storm":
    case "drought":
      return 6;
    case "discovery":
      return 9;
    case "structure.built":
      return 4;
    case "fire.lit":
      return 3;
    case "gift":
      return 5;
    case "trade":
      return 4;
    case "agent.suffering":
      return 4;
    case "milestone":
      return 9;
    case "god":
      return 9;
    case "smalltalk":
      return 1;
    case "season":
      return 2;
    case "weather":
      return 1;
    default:
      return 3;
  }
}

export interface NameResolver {
  name(id: number | null): string;
}

const TECH_NAMES: Record<string, string> = {
  fuego: "cómo hacer fuego",
  refugio: "cómo levantar un refugio",
  herramientas: "cómo tallar herramientas",
  agricultura: "cómo sembrar y cosechar",
  ceramica: "cómo cocer barro",
  escritura: "cómo escribir",
  metalurgia: "cómo fundir metal",
  construccion: "cómo construir con piedra",
  rueda: "la rueda",
  medicina: "cómo curar con hierbas",
  tejido: "cómo tejer ropa",
  caza: "cómo cazar",
  navegacion: "cómo navegar",
};

export function techName(tech: string): string {
  return TECH_NAMES[tech] ?? tech;
}

/**
 * Texto en español para el dashboard y la memoria de los seres. Si `selfId`
 * coincide con el actor, el texto sale en primera persona.
 */
export function describeEvent(e: WorldEvent, names: NameResolver, selfId: number | null = null): string {
  const self = selfId !== null && e.agentId === selfId;
  const a = names.name(e.agentId);
  const t = e.targetId === selfId && selfId !== null ? "mí" : names.name(e.targetId);
  const d = e.data as Record<string, string | number | undefined>;
  const v = (first: string, third: string): string => (self ? first : `${a} ${third}`);
  switch (e.kind) {
    case "season":
      return `Empezó ${e.label} del año ${d.year}`;
    case "weather":
      return `El cielo cambió: ${e.label}`;
    case "storm":
      return e.label === "inicio" ? "Una tormenta azota la región" : "La tormenta amainó";
    case "drought":
      return e.label === "inicio" ? `Comenzó una sequía (${d.days} días)` : "Terminó la sequía";
    case "agent.born":
      return self
        ? "Nací"
        : `Nació ${a}, hijo de ${names.name((d.motherId as number) ?? null)} y ${names.name((d.fatherId as number) ?? null)}`;
    case "agent.died":
      return v(`Muero de ${e.label}`, `murió de ${e.label}`);
    case "agent.suffering":
      return v(`Sufro ${e.label}`, `sufre ${e.label}`);
    case "agent.sick":
      return v("Enfermé", "enfermó");
    case "agent.healed":
      return v("Me recuperé", "se recuperó");
    case "agent.first":
      return v(`Hice algo por primera vez: ${e.label}`, `hizo algo por primera vez: ${e.label}`);
    case "structure.built":
      return v(`Terminé de construir un ${e.label}`, `terminó de construir un ${e.label}`);
    case "structure.destroyed":
      return `Se destruyó ${e.label}`;
    case "fire.lit":
      return v("Encendí un fuego", "encendió un fuego");
    case "fire.out":
      return "Un fuego se apagó";
    case "smalltalk":
      return v(`Charlé con ${t}`, `charló con ${t}`);
    case "discovery":
      return v(`Descubrí ${techName(e.label)}${d.how ? ` ${d.how}` : ""}`, `descubrió ${techName(e.label)}`);
    case "gift":
      return v(`Le regalé ${d.cantidad} de ${e.label} a ${t}`, `le regaló ${d.cantidad} de ${e.label} a ${t}`);
    case "trade":
      return v(`Intercambié ${d.dio} por ${d.recibio} con ${t}`, `y ${t} intercambiaron ${d.dio} por ${d.recibio}`);
    case "theft":
      return v(`Le robé ${e.label} a ${t}`, `le robó ${e.label} a ${t}`);
    case "attack":
      return v(`Ataqué a ${t}`, `atacó a ${t}`);
    case "punish":
      return v(`Castigué a ${t}`, `castigó a ${t}`);
    case "claim":
      return v("Reclamé un lugar como propio", "reclamó un lugar como propio");
    case "harvest":
      return v(`Coseché ${e.label}`, `cosechó ${e.label}`);
    case "teach":
      return v(`Le enseñé ${techName(e.label)} a ${t}`, `le enseñó ${techName(e.label)} a ${t}`);
    case "read":
      return v(`Leí "${e.label}"`, `leyó "${e.label}"`);
    case "write":
      return v(`Escribí "${e.label}"`, `escribió "${e.label}"`);
    case "pray":
      return v("Recé", "rezó");
    case "ritual":
      return v(`Celebré un ritual: ${e.label}`, `celebró un ritual: ${e.label}`);
    case "create":
      return v(`Creé ${e.label}`, `creó ${e.label}`);
    case "speech":
      return v(`Dije: "${d.texto}"`, `dijo: "${d.texto}"`);
    case "dialogue":
      return v(`Conversé con ${t}`, `conversó con ${t}`);
    case "bond":
      return v(`Formé un vínculo con ${t}`, `y ${t} formaron un vínculo`);
    case "pregnancy":
      return v("Espero un hijo", "espera un hijo");
    case "belief":
      return v(`${e.label}`, `${e.label}`);
    case "law":
      return v(`Decreté: ${d.enunciado}`, `decretó: ${d.enunciado}`);
    case "crime":
      return v(`Violé una ley: ${e.label}`, `violó una ley: ${e.label}`);
    case "group":
      return `Se formó la tribu ${e.label}`;
    case "leader":
      return v(`Ahora lidero ${e.label}`, `lidera ${e.label}`);
    case "currency":
      return `${e.label} se convirtió en moneda`;
    case "milestone":
      return `${d.title ?? e.label}`;
    case "epoch":
      return `Comienza una nueva época: ${e.label}`;
    case "war":
      return `Estalló una guerra: ${e.label}`;
    case "treaty":
      return `Se firmó un tratado: ${e.label}`;
    case "god":
      return `Voz del cielo: ${e.label}`;
    case "intent":
      return v(`Decidí ${e.label}`, `decidió ${e.label}`);
    case "thought":
      return v("Pensé", "pensó");
    case "state.hash":
      return `hash ${e.label}`;
    default:
      return e.label;
  }
}
