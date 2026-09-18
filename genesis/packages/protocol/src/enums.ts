/**
 * Vocabulario público del mundo. Los valores están en español porque son
 * los que ven los seres (en sus prompts) y el dashboard. Los identificadores
 * de código quedan en inglés.
 */

export const TERRAINS = [
  "agua_profunda",
  "agua",
  "arena",
  "pradera",
  "bosque",
  "colinas",
  "montaña",
  "nieve",
] as const;
export type Terrain = (typeof TERRAINS)[number];

export const RESOURCES = ["comida", "madera", "piedra", "mineral", "gema"] as const;
export type ResourceKind = (typeof RESOURCES)[number];

export const ITEMS = [
  "comida",
  "madera",
  "piedra",
  "mineral",
  "gema",
  "metal",
  "herramienta",
  "arma",
  "ropa",
  "cantaro",
  "agua",
  "semilla",
  "tablilla",
  "libro",
  "arte",
] as const;
export type ItemKind = (typeof ITEMS)[number];

export const STRUCTURES = [
  "refugio",
  "fogata",
  "muro",
  "granja",
  "almacen",
  "taller",
  "horno",
  "templo",
  "mercado",
  "tumba",
  "monumento",
] as const;
export type StructureKind = (typeof STRUCTURES)[number];

export const SEASONS = ["primavera", "verano", "otoño", "invierno"] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ["despejado", "nublado", "lluvia", "tormenta", "nieve", "sequia"] as const;
export type Weather = (typeof WEATHERS)[number];

export const NEEDS = [
  "sed",
  "hambre",
  "calor",
  "descanso",
  "seguridad",
  "social",
  "estima",
  "sentido",
] as const;
export type Need = (typeof NEEDS)[number];

export const TRAITS = [
  "fuerza",
  "curiosidad",
  "agresion",
  "empatia",
  "riesgo",
  "fertilidad",
  "longevidad",
  "inteligencia",
  "metabolismo",
] as const;
export type Trait = (typeof TRAITS)[number];

export const SEXES = ["m", "f"] as const;
export type Sex = (typeof SEXES)[number];

export const LIFE_STAGES = ["infancia", "juventud", "adultez", "vejez"] as const;
export type LifeStage = (typeof LIFE_STAGES)[number];

/** Verbos que entienden System 1 y System 2. */
export const VERBS = [
  "descansar",
  "dormir",
  "comer",
  "beber",
  "recolectar",
  "cazar",
  "juntar",
  "ir_a",
  "huir",
  "seguir",
  "refugiarse",
  "encender_fuego",
  "construir",
  "fabricar",
  "ofrecer_trueque",
  "regalar",
  "robar",
  "atacar",
  "castigar",
  "reclamar",
  "sembrar",
  "cuidar",
  "enseñar",
  "leer",
  "escribir",
  "rezar",
  "ritual",
  "crear",
  "conversar",
  "explorar",
  "acopiar",
  "cargar_agua",
] as const;
export type Verb = (typeof VERBS)[number];
