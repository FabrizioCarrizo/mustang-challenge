import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng.ts";
import type { GenesisConfig } from "../config.ts";
import { T, type WorldGrid } from "./grid.ts";

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // [-1, 1]
}

/**
 * Genera terreno, elevación, humedad y fertilidad. Determinista para un rng dado.
 * Es un continente con costa: la elevación cae hacia los bordes.
 */
export function generateTerrain(grid: WorldGrid, cfg: GenesisConfig, rng: Rng): void {
  const { size } = grid;
  const elevNoise = createNoise2D(() => rng.float());
  const moistNoise = createNoise2D(() => rng.float());
  const detailNoise = createNoise2D(() => rng.float());
  const scale = 0.035 * (128 / size);
  const sea = cfg.world.seaLevel;
  const mountain = cfg.world.mountainLevel;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const nx = x * scale;
      const ny = y * scale;
      let e = (fbm(elevNoise, nx, ny, 5) + 1) / 2; // [0,1]
      // máscara radial suave para tener costa
      const cx = (x / size) * 2 - 1;
      const cy = (y / size) * 2 - 1;
      const r = Math.sqrt(cx * cx + cy * cy);
      e = e * (1 - 0.55 * Math.pow(Math.max(0, r - 0.15) / 0.85, 2));
      e += 0.04 * detailNoise(nx * 4, ny * 4);
      e = Math.min(1, Math.max(0, e));
      const m = Math.min(1, Math.max(0, (fbm(moistNoise, nx * 0.8 + 100, ny * 0.8 + 100, 4) + 1) / 2));
      let terrain: number;
      if (e < sea - 0.06) terrain = T.agua_profunda;
      else if (e < sea) terrain = T.agua;
      else if (e < sea + 0.03) terrain = T.arena;
      else if (e > mountain + 0.1) terrain = T.nieve;
      else if (e > mountain) terrain = T.montaña;
      else if (e > mountain - 0.12) terrain = T.colinas;
      else if (m > cfg.world.forestMoisture) terrain = T.bosque;
      else terrain = T.pradera;
      grid.terrain[i] = terrain;
      grid.elevation[i] = Math.round(e * 255);
      grid.moisture[i] = Math.round(m * 255);
      // fertilidad: alta en praderas húmedas de baja altura, nula en agua y montaña
      let f = 0;
      if (terrain === T.pradera || terrain === T.bosque || terrain === T.arena) {
        const heightPenalty = Math.max(0, (e - sea) / (mountain - sea));
        f = (0.35 + 0.65 * m) * (1 - 0.7 * heightPenalty);
        if (terrain === T.arena) f *= 0.3;
        if (terrain === T.bosque) f *= 0.8;
      } else if (terrain === T.colinas) {
        f = 0.25 * m;
      }
      grid.fertility[i] = Math.round(Math.min(1, Math.max(0, f)) * 255);
    }
  }
  ensureWater(grid, rng);
}

/** Si el mundo salió sin agua (seed rara), cava un lago en el centro. */
function ensureWater(grid: WorldGrid, rng: Rng): void {
  const { size, terrain } = grid;
  let water = 0;
  for (let i = 0; i < terrain.length; i++) if (terrain[i] === T.agua || terrain[i] === T.agua_profunda) water++;
  if (water >= size * size * 0.02) return;
  const cx = Math.floor(size / 2) + rng.int(9) - 4;
  const cy = Math.floor(size / 2) + rng.int(9) - 4;
  const rad = Math.max(3, Math.floor(size / 20));
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) terrain[y * size + x] = d < rad - 1.5 ? T.agua_profunda : T.agua;
    }
  }
}

/** Índices de todas las celdas de agua. */
export function waterCells(grid: WorldGrid): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < grid.terrain.length; i++) {
    if (grid.terrain[i] === T.agua) out.push(i);
  }
  return Int32Array.from(out);
}
