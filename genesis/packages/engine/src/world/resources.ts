import { RESOURCES, type ResourceKind, type Season } from "@genesis/protocol";
import type { GenesisConfig } from "../config.ts";
import type { Rng } from "../rng.ts";
import { T, distanceField, type WorldGrid } from "./grid.ts";
import { waterCells } from "./terrain.ts";

/** Coloca los recursos iniciales según terreno y fertilidad. */
export function initResources(grid: WorldGrid, cfg: GenesisConfig, rng: Rng): void {
  const { size, terrain, fertility, moisture } = grid;
  const ab = cfg.world.abundance;
  const mx = cfg.resources.maxPerCell;
  for (let i = 0; i < size * size; i++) {
    const t = terrain[i]!;
    const f = fertility[i]! / 255;
    const m = moisture[i]! / 255;
    let comida = 0;
    let madera = 0;
    let piedra = 0;
    let mineral = 0;
    let gema = 0;
    switch (t) {
      case T.pradera:
        comida = mx.comida * f;
        if (rng.chance(0.08)) madera = mx.madera * 0.15;
        if (rng.chance(0.03)) piedra = mx.piedra * 0.1;
        break;
      case T.bosque:
        comida = mx.comida * 0.7 * f;
        madera = mx.madera * (0.5 + 0.5 * m);
        break;
      case T.arena:
        comida = mx.comida * 0.25 * f;
        if (rng.chance(0.1)) piedra = mx.piedra * 0.15;
        break;
      case T.colinas:
        comida = mx.comida * 0.2 * f;
        piedra = mx.piedra * 0.6;
        if (m > 0.6 && rng.chance(0.3)) madera = mx.madera * 0.3;
        if (rng.chance(0.15)) mineral = mx.mineral * 0.35;
        if (rng.chance(0.02)) gema = mx.gema;
        break;
      case T.montaña:
        piedra = mx.piedra;
        if (rng.chance(0.3)) mineral = mx.mineral;
        if (rng.chance(0.05)) gema = mx.gema;
        break;
      case T.nieve:
        piedra = mx.piedra * 0.5;
        if (rng.chance(0.1)) mineral = mx.mineral * 0.5;
        break;
      default:
        break;
    }
    const maxes: Record<ResourceKind, number> = {
      comida: comida * ab,
      madera: madera * ab,
      piedra: piedra * ab,
      mineral: mineral * ab,
      gema: gema * ab,
    };
    for (const r of RESOURCES) {
      grid.resourceMax[r][i] = maxes[r];
      grid.resources[r][i] = maxes[r] * (0.6 + 0.4 * rng.float());
    }
  }
}

/** Regeneración logística; se llama una vez por hora simulada. */
export function regrowResources(
  grid: WorldGrid,
  cfg: GenesisConfig,
  season: Season,
  drought: boolean,
  rng: Rng,
  changed: Set<number>,
): void {
  const n = grid.size * grid.size;
  const seasonF = cfg.resources.seasonFactor[season];
  const droughtF = drought ? cfg.climate.droughtRegrowthFactor : 1;
  for (const r of RESOURCES) {
    const rate = cfg.resources.regrowthPerHour[r] * (r === "comida" || r === "madera" ? seasonF * droughtF : 1);
    if (rate <= 0) continue;
    const cur = grid.resources[r];
    const max = grid.resourceMax[r];
    const renewable = r === "comida" || r === "madera";
    for (let i = 0; i < n; i++) {
      const m = max[i]!;
      if (m <= 0) continue;
      const c = cur[i]!;
      if (c >= m) continue;
      let next: number;
      if (c < 0.05 * m) {
        // celda agotada: puede recolonizarse desde vecinas (solo renovables)
        if (renewable && rng.chance(cfg.resources.reseedChancePerHour * seasonF)) next = Math.min(m, c + 0.15 * m);
        else next = c + rate * m * 0.1;
      } else {
        next = c + rate * m * (1 - c / m) * 4;
      }
      next = Math.min(m, next);
      if (next - c > 0.02) {
        cur[i] = next;
        changed.add(i);
      }
    }
  }
}

const THRESHOLD: Record<ResourceKind, number> = { comida: 1, madera: 1, piedra: 1, mineral: 1, gema: 0.5 };

/** Recalcula los campos de distancia hacia agua y recursos útiles. */
export function recomputeResourceFields(grid: WorldGrid): void {
  distanceField(grid, waterCells(grid), grid.distWater);
  const n = grid.size * grid.size;
  for (const r of RESOURCES) {
    const sources: number[] = [];
    const cur = grid.resources[r];
    const th = THRESHOLD[r];
    for (let i = 0; i < n; i++) if (cur[i]! >= th) sources.push(i);
    distanceField(grid, sources, grid.dist[r]);
  }
}

export function recomputeShelterField(grid: WorldGrid, shelterCells: ArrayLike<number>): void {
  distanceField(grid, shelterCells, grid.distShelter);
}

/** Cuánto de un recurso hay en total (para métricas). */
export function totalResource(grid: WorldGrid, r: ResourceKind): number {
  const arr = grid.resources[r];
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i]!;
  return s;
}
