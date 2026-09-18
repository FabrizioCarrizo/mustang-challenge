import type { AgentStatus, Need, ResourceKind, StructureKind, Trait, Weather } from "@genesis/protocol";

export const NEED_LABELS: Record<Need, string> = {
  sed: "Sed",
  hambre: "Hambre",
  calor: "Calor",
  descanso: "Descanso",
  seguridad: "Seguridad",
  social: "Social",
  estima: "Estima",
  sentido: "Sentido",
};

export const TRAIT_LABELS: Record<Trait, string> = {
  fuerza: "Fuerza",
  curiosidad: "Curiosidad",
  agresion: "Agresión",
  empatia: "Empatía",
  riesgo: "Riesgo",
  fertilidad: "Fertilidad",
  longevidad: "Longevidad",
  inteligencia: "Inteligencia",
  metabolismo: "Metabolismo",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  activo: "activo",
  durmiendo: "durmiendo",
  conversando: "conversando",
  peleando: "peleando",
  herido: "herido",
  enfermo: "enfermo",
  muerto: "muerto",
};

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  comida: "Comida",
  madera: "Madera",
  piedra: "Piedra",
  mineral: "Mineral",
  gema: "Gemas",
};

export const STRUCTURE_LABELS: Record<StructureKind, string> = {
  refugio: "refugio",
  fogata: "fogata",
  muro: "muro",
  granja: "granja",
  almacen: "almacén",
  taller: "taller",
  horno: "horno",
  templo: "templo",
  mercado: "mercado",
  tumba: "tumba",
  monumento: "monumento",
};

export const WEATHER_LABELS: Record<Weather, { icon: string; label: string }> = {
  despejado: { icon: "☀", label: "despejado" },
  nublado: { icon: "☁", label: "nublado" },
  lluvia: { icon: "☂", label: "lluvia" },
  tormenta: { icon: "⚡", label: "tormenta" },
  nieve: { icon: "❄", label: "nieve" },
  sequia: { icon: "☀", label: "sequía" },
};

export const SEX_LABELS: Record<string, string> = { m: "masculino", f: "femenino" };

export const MEMORY_KIND_LABELS: Record<string, string> = {
  observacion: "observación",
  dialogo: "diálogo",
  reflexion: "reflexión",
  creencia: "creencia",
  diario: "diario",
  sueño: "sueño",
  resumen: "resumen",
  texto: "texto",
  voz_divina: "voz divina",
};

export function memoryKindLabel(kind: string): string {
  return MEMORY_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

export function verbLabel(verb: string): string {
  return verb.replace(/_/g, " ");
}

export const DISASTERS: Array<{ value: "tormenta" | "sequia" | "plaga" | "terremoto" | "eclipse" | "diluvio"; label: string }> = [
  { value: "tormenta", label: "tormenta" },
  { value: "sequia", label: "sequía" },
  { value: "plaga", label: "plaga" },
  { value: "terremoto", label: "terremoto" },
  { value: "eclipse", label: "eclipse" },
  { value: "diluvio", label: "diluvio" },
];
