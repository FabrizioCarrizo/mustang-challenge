import type { WorldEvent } from "../sim/events.ts";
import type { EngineState } from "../sim/state.ts";

export interface MilestoneSpec {
  key: string;
  title: string;
  description: string;
  /** época que inaugura, si alguna */
  epoch: string | null;
  /** predicado sobre un evento; devuelve los protagonistas o null */
  onEvent?: (e: WorldEvent, s: EngineState) => number[] | null;
  /** predicado diario sobre el estado */
  daily?: (s: EngineState, ctx: DailyContext) => number[] | null;
}

export interface DailyContext {
  groups: number;
  religions: number;
  currency: string | null;
  hungerDeathsLast3Days: number;
  sickLast3Days: number;
  writtenTexts: number;
  laws: number;
}

export const EPOCH_ORDER = [
  "Edad del Hambre",
  "Edad del Fuego",
  "Edad de las Tribus",
  "Edad de la Fe",
  "Edad de la Palabra",
  "Edad de la Ley",
  "Edad de la Moneda",
  "Edad del Metal",
] as const;

const actor = (e: WorldEvent) => (e.agentId !== null ? [e.agentId] : []);
const both = (e: WorldEvent) => [e.agentId, e.targetId].filter((v): v is number => v !== null);

export const MILESTONES: MilestoneSpec[] = [
  { key: "first_shelter", title: "El primer refugio", description: "Alguien levantó un techo por primera vez.", epoch: null, onEvent: (e) => (e.kind === "structure.built" && e.label === "refugio" ? actor(e) : null) },
  { key: "first_fire", title: "El primer fuego", description: "El fuego cambió las noches para siempre.", epoch: "Edad del Fuego", onEvent: (e) => (e.kind === "discovery" && e.label === "fuego" ? actor(e) : null) },
  { key: "first_tool", title: "La primera herramienta", description: "Una piedra tallada, y el mundo se volvió más blando.", epoch: null, onEvent: (e) => (e.kind === "discovery" && e.label === "herramientas" ? actor(e) : null) },
  { key: "first_trade", title: "El primer trueque", description: "Dos seres cambiaron una cosa por otra y los dos ganaron.", epoch: null, onEvent: (e) => (e.kind === "trade" ? both(e) : null) },
  { key: "first_gift", title: "El primer regalo", description: "Alguien dio sin pedir nada a cambio.", epoch: null, onEvent: (e) => (e.kind === "gift" ? both(e) : null) },
  { key: "first_belief", title: "La primera creencia", description: "Una mente fabricó una explicación para lo inexplicable.", epoch: null, onEvent: (e) => (e.kind === "belief" && e.data.first === true ? actor(e) : null) },
  { key: "first_art", title: "La primera obra", description: "Algo hecho para nada más que para sentir.", epoch: null, onEvent: (e) => (e.kind === "create" && (e.data.tipo === "arte" || e.data.tipo === "canto" || e.data.tipo === "relato") ? actor(e) : null) },
  { key: "first_teaching", title: "La primera enseñanza", description: "Un saber pasó de una cabeza a otra.", epoch: null, onEvent: (e) => (e.kind === "teach" ? both(e) : null) },
  { key: "first_death", title: "La primera muerte", description: "El mundo aprendió que se acaba.", epoch: null, onEvent: (e) => (e.kind === "agent.died" ? actor(e) : null) },
  { key: "first_birth", title: "El primer nacimiento", description: "Una vida nueva, con todo por aprender.", epoch: null, onEvent: (e) => (e.kind === "agent.born" ? actor(e) : null) },
  { key: "first_violence", title: "La primera sangre", description: "Alguien golpeó a alguien.", epoch: null, onEvent: (e) => (e.kind === "attack" ? both(e) : null) },
  { key: "first_theft", title: "El primer robo", description: "Lo ajeno cambió de manos sin permiso.", epoch: null, onEvent: (e) => (e.kind === "theft" ? both(e) : null) },
  { key: "first_union", title: "La primera pareja", description: "Dos seres decidieron seguir juntos.", epoch: null, onEvent: (e) => (e.kind === "bond" && e.label === "pareja" ? both(e) : null) },
  { key: "first_farm", title: "La primera siembra", description: "Alguien entendió que la comida se puede esperar.", epoch: null, onEvent: (e) => (e.kind === "structure.built" && e.label === "granja" ? actor(e) : null) },
  { key: "first_pottery", title: "La primera vasija", description: "El barro cocido guarda agua y granos.", epoch: null, onEvent: (e) => (e.kind === "discovery" && e.label === "ceramica" ? actor(e) : null) },
  { key: "first_tribe", title: "La primera tribu", description: "Varios seres empezaron a ser un nosotros.", epoch: "Edad de las Tribus", onEvent: (e) => (e.kind === "group" && e.data.first === true ? (e.data.members as number[]) : null) },
  { key: "first_leader", title: "El primer líder", description: "Alguien habla y los demás escuchan.", epoch: null, onEvent: (e) => (e.kind === "leader" ? actor(e) : null) },
  { key: "first_ritual", title: "El primer rito", description: "Un gesto repetido para calmar lo que no se entiende.", epoch: null, onEvent: (e) => (e.kind === "ritual" ? actor(e) : null) },
  { key: "first_religion", title: "La primera religión", description: "Una creencia compartida, con ritos y adeptos.", epoch: "Edad de la Fe", daily: (_s, c) => (c.religions > 0 ? [] : null) },
  { key: "first_temple", title: "El primer templo", description: "Piedra sobre piedra para algo que no se ve.", epoch: null, onEvent: (e) => (e.kind === "structure.built" && e.label === "templo" ? actor(e) : null) },
  { key: "first_writing", title: "La escritura", description: "Lo dicho ya no muere con quien lo dijo.", epoch: "Edad de la Palabra", onEvent: (e) => (e.kind === "discovery" && e.label === "escritura" ? actor(e) : null) },
  { key: "first_written_text", title: "El primer texto escrito", description: "Alguien dejó marcas que otros podrán leer.", epoch: null, onEvent: (e) => (e.kind === "write" && e.data.medium === "escrito" ? actor(e) : null) },
  { key: "first_law", title: "La primera ley", description: "Un líder dijo lo que no se hace, y la gente asintió.", epoch: "Edad de la Ley", onEvent: (e) => (e.kind === "law" ? actor(e) : null) },
  { key: "first_punishment", title: "El primer castigo", description: "La norma tuvo dientes.", epoch: null, onEvent: (e) => (e.kind === "punish" ? both(e) : null) },
  { key: "first_currency", title: "La primera moneda", description: "Un bien que vale porque todos lo aceptan.", epoch: "Edad de la Moneda", onEvent: (e) => (e.kind === "currency" ? [] : null) },
  { key: "first_market", title: "El primer mercado", description: "Un lugar para cambiar cosas por cosas.", epoch: null, onEvent: (e) => (e.kind === "structure.built" && e.label === "mercado" ? actor(e) : null) },
  { key: "first_metal", title: "El primer metal", description: "La piedra que se derrite y vuelve a endurecer.", epoch: "Edad del Metal", onEvent: (e) => (e.kind === "discovery" && e.label === "metalurgia" ? actor(e) : null) },
  { key: "first_war", title: "La primera guerra", description: "Dos tribus se pelearon como tribus.", epoch: null, onEvent: (e) => (e.kind === "war" ? [] : null) },
  { key: "first_treaty", title: "El primer tratado", description: "Dos tribus prefirieron la palabra a la sangre.", epoch: null, onEvent: (e) => (e.kind === "treaty" ? [] : null) },
  { key: "first_exile", title: "El primer exilio", description: "Alguien fue expulsado de los suyos.", epoch: null, onEvent: (e) => (e.kind === "punish" && e.label === "exilio" ? both(e) : null) },
  { key: "great_famine", title: "La gran hambruna", description: "Murieron de hambre cinco o más en tres días.", epoch: null, daily: (_s, c) => (c.hungerDeathsLast3Days >= 5 ? [] : null) },
  { key: "plague", title: "La peste", description: "La enfermedad recorrió las casas.", epoch: null, daily: (_s, c) => (c.sickLast3Days >= 6 ? [] : null) },
  { key: "population_100", title: "Cien seres", description: "La gente se multiplicó hasta el centenar.", epoch: null, daily: (s) => (s.alive.length >= 100 ? [] : null) },
  { key: "first_legend", title: "La primera leyenda", description: "Un muerto siguió vivo en lo que se cuenta de él.", epoch: null, onEvent: (e) => (e.kind === "milestone" && e.label === "legend" ? actor(e) : null) },
];

export function epochRank(name: string): number {
  const i = (EPOCH_ORDER as readonly string[]).indexOf(name);
  return i < 0 ? 0 : i;
}
