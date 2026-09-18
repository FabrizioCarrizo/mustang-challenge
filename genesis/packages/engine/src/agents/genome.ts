import { TRAITS, type Trait } from "@genesis/protocol";
import type { Rng } from "../rng.ts";

export type Genome = Record<Trait, number>;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Genoma aleatorio: cada rasgo es el promedio de tres uniformes (campana suave). */
export function randomGenome(rng: Rng): Genome {
  const g = {} as Genome;
  for (const t of TRAITS) g[t] = clamp01((rng.float() + rng.float() + rng.float()) / 3);
  return g;
}

/** Mezcla de dos genomas con mutación gaussiana. */
export function mixGenomes(a: Genome, b: Genome, rng: Rng, mutation = 0.08): Genome {
  const g = {} as Genome;
  for (const t of TRAITS) {
    const from = rng.chance(0.5) ? a[t] : b[t];
    const blend = 0.7 * from + 0.3 * (a[t] + b[t]) / 2;
    g[t] = clamp01(blend + rng.normal(0, mutation));
  }
  return g;
}

const LEVELS = ["muy baja", "baja", "media", "alta", "muy alta"] as const;

export function traitLevel(v: number): (typeof LEVELS)[number] {
  if (v < 0.2) return LEVELS[0];
  if (v < 0.4) return LEVELS[1];
  if (v < 0.6) return LEVELS[2];
  if (v < 0.8) return LEVELS[3];
  return LEVELS[4];
}

/** Describe el temperamento en prosa corta (para la ficha del ser). */
export function describeGenome(g: Genome): string {
  const parts: string[] = [];
  if (g.curiosidad > 0.7) parts.push("una curiosidad que no se apaga");
  else if (g.curiosidad < 0.3) parts.push("poco interés por lo desconocido");
  if (g.agresion > 0.7) parts.push("un temperamento que se enciende rápido");
  else if (g.agresion < 0.3) parts.push("una calma que rara vez se rompe");
  if (g.empatia > 0.7) parts.push("sensibilidad por el sufrimiento ajeno");
  else if (g.empatia < 0.3) parts.push("cierta frialdad con los demás");
  if (g.riesgo > 0.7) parts.push("gusto por el peligro");
  else if (g.riesgo < 0.3) parts.push("prudencia extrema");
  if (g.inteligencia > 0.75) parts.push("una mente rápida y reflexiva");
  else if (g.inteligencia < 0.25) parts.push("una mente lenta pero terca");
  if (g.fuerza > 0.75) parts.push("un cuerpo fuerte");
  else if (g.fuerza < 0.25) parts.push("un cuerpo frágil");
  if (parts.length === 0) parts.push("un carácter equilibrado");
  return parts.join(", ");
}
