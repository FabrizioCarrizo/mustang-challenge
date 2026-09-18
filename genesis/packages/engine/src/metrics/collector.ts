import type { MetricsPoint } from "@genesis/protocol";
import { averageNeeds } from "../agents/needs.ts";
import type { EngineState } from "../sim/state.ts";

/** Valor aproximado de la mochila de un ser (para el Gini antes de que exista moneda). */
export function wealthOf(inventory: Map<string, number>): number {
  let w = 0;
  for (const [item, n] of inventory) {
    switch (item) {
      case "comida":
        w += n;
        break;
      case "madera":
        w += n * 0.8;
        break;
      case "piedra":
        w += n * 0.6;
        break;
      case "mineral":
        w += n * 2;
        break;
      case "gema":
        w += n * 8;
        break;
      case "metal":
        w += n * 4;
        break;
      case "herramienta":
      case "arma":
        w += n * 5;
        break;
      case "ropa":
        w += n * 3;
        break;
      default:
        w += n;
    }
  }
  return w;
}

export function gini(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    sum += v[i]!;
    weighted += (i + 1) * v[i]!;
  }
  if (sum === 0) return 0;
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

export function collectMetrics(s: EngineState, extra: { groups?: number; beliefs?: number } = {}): MetricsPoint {
  const needsList: Array<typeof s.agents extends Map<number, infer A> ? (A extends { needs: infer N } ? N : never) : never> = [];
  const wealth: number[] = [];
  const techs = new Set<string>();
  for (const id of s.alive) {
    const a = s.agents.get(id)!;
    needsList.push(a.needs as never);
    wealth.push(wealthOf(a.inventory as Map<string, number>));
    for (const t of a.knows) techs.add(t);
  }
  return {
    tick: s.tick,
    population: s.alive.length,
    births: s.today.births,
    deaths: s.today.deaths,
    violence: s.today.violence,
    trades: s.today.trades,
    gini: Math.round(gini(wealth) * 1000) / 1000,
    avgNeeds: averageNeeds(needsList as never),
    usd: s.today.usd,
    llmCalls: s.today.llmCalls,
    groups: extra.groups ?? 0,
    beliefs: extra.beliefs ?? 0,
    techs: techs.size,
  };
}
