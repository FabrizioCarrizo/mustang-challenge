import type { Sex } from "@genesis/protocol";
import type { Rng } from "../rng.ts";

const ONSETS = ["", "k", "t", "n", "m", "r", "s", "l", "x", "ch", "y", "v", "b", "d", "g", "p", "z", "th", "qu"];
const NUCLEI = ["a", "e", "i", "o", "u", "ai", "au", "ei", "ia", "io", "ua", "ue"];
const CODAS = ["", "", "", "n", "r", "l", "s", "k", "m", "t"];
const FEM_END = ["a", "e", "i", "ia", "is", "ë"];
const MASC_END = ["o", "u", "ar", "or", "an", "ek", "ur", "il"];

/** Nombres inventados, pronunciables en español. */
export function generateName(rng: Rng, sex: Sex, taken: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const syllables = 1 + rng.int(2);
    let name = "";
    for (let i = 0; i < syllables; i++) {
      name += rng.pick(ONSETS) + rng.pick(NUCLEI) + (i < syllables - 1 ? rng.pick(CODAS) : "");
    }
    name += rng.pick(sex === "f" ? FEM_END : MASC_END);
    name = name.charAt(0).toUpperCase() + name.slice(1);
    if (name.length < 3 || name.length > 9) continue;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  let i = 2;
  let base = "Ser";
  while (taken.has(base + i)) i++;
  taken.add(base + i);
  return base + i;
}

const PLACE_A = ["Valle", "Río", "Colina", "Bosque", "Costa", "Llano", "Peña", "Laguna", "Arroyo", "Cumbre"];
const PLACE_B = ["Claro", "Negro", "Alto", "Manso", "Rojo", "Viejo", "Dorado", "Frío", "Verde", "Callado"];

export function generatePlaceName(rng: Rng): string {
  return `${rng.pick(PLACE_A)} ${rng.pick(PLACE_B)}`;
}
