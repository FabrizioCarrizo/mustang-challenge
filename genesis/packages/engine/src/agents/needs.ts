import { NEEDS, type Need } from "@genesis/protocol";
import type { GenesisConfig } from "../config.ts";

export type Needs = Record<Need, number>;

export function initialNeeds(): Needs {
  return {
    sed: 0.9,
    hambre: 0.85,
    calor: 0.9,
    descanso: 0.9,
    seguridad: 0.8,
    social: 0.7,
    estima: 0.5,
    sentido: 0.6,
  };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Urgencia cuadrática con salto cuando la necesidad vital está casi en cero. */
export function urgency(needs: Needs, cfg: GenesisConfig): Record<Need, number> {
  const out = {} as Record<Need, number>;
  for (const n of NEEDS) {
    const s = needs[n];
    let u = cfg.needs.weights[n] * (1 - s) * (1 - s);
    if (s < 0.2 && (n === "hambre" || n === "sed" || n === "calor" || n === "seguridad")) u += 1;
    out[n] = u;
  }
  return out;
}

export function mostUrgent(u: Record<Need, number>): Need {
  let best: Need = "hambre";
  let bestV = -1;
  for (const n of NEEDS) {
    if (u[n] > bestV) {
      bestV = u[n];
      best = n;
    }
  }
  return best;
}

export function averageNeeds(list: Iterable<Needs>): Needs {
  const acc = {} as Needs;
  for (const n of NEEDS) acc[n] = 0;
  let count = 0;
  for (const needs of list) {
    for (const n of NEEDS) acc[n] += needs[n];
    count++;
  }
  if (count > 0) for (const n of NEEDS) acc[n] /= count;
  return acc;
}
