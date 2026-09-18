import { RESOURCES, TERRAINS, type ResourceKind, type Terrain } from "@genesis/protocol";

export const T = Object.fromEntries(TERRAINS.map((t, i) => [t, i])) as Record<Terrain, number>;

export function terrainName(code: number): Terrain {
  return TERRAINS[code] ?? "pradera";
}

export interface WorldGrid {
  size: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  moisture: Uint8Array;
  fertility: Uint8Array;
  resources: Record<ResourceKind, Float32Array>;
  resourceMax: Record<ResourceKind, Float32Array>;
  /** cantidad de seres en la celda */
  occupants: Uint8Array;
  /** id de estructura o -1 */
  structureAt: Int32Array;
  /** id del ser o grupo que reclama la celda, -1 si nadie */
  owner: Int32Array;
  /** peligro percibido (0..1), decae con el tiempo */
  danger: Float32Array;
  /** distancia en pasos hasta el agua más cercana */
  distWater: Uint16Array;
  /** distancia en pasos hasta el recurso más cercano con cantidad útil */
  dist: Record<ResourceKind, Uint16Array>;
  /** distancia hasta el refugio o fuego más cercano */
  distShelter: Uint16Array;
}

export const NO_PATH = 65535;

export function createGrid(size: number): WorldGrid {
  const n = size * size;
  const res = {} as Record<ResourceKind, Float32Array>;
  const resMax = {} as Record<ResourceKind, Float32Array>;
  const dist = {} as Record<ResourceKind, Uint16Array>;
  for (const r of RESOURCES) {
    res[r] = new Float32Array(n);
    resMax[r] = new Float32Array(n);
    dist[r] = new Uint16Array(n).fill(NO_PATH);
  }
  return {
    size,
    terrain: new Uint8Array(n),
    elevation: new Uint8Array(n),
    moisture: new Uint8Array(n),
    fertility: new Uint8Array(n),
    resources: res,
    resourceMax: resMax,
    occupants: new Uint8Array(n),
    structureAt: new Int32Array(n).fill(-1),
    owner: new Int32Array(n).fill(-1),
    danger: new Float32Array(n),
    distWater: new Uint16Array(n).fill(NO_PATH),
    dist,
    distShelter: new Uint16Array(n).fill(NO_PATH),
  };
}

export function idx(size: number, x: number, y: number): number {
  return y * size + x;
}

export function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

export function isWater(code: number): boolean {
  return code === T.agua || code === T.agua_profunda;
}

export function isWalkable(code: number): boolean {
  return code !== T.agua_profunda && code !== T.agua;
}

/** Costo de movimiento en ticks por celda según terreno. */
export function moveCost(code: number): number {
  switch (code) {
    case T.pradera:
    case T.arena:
      return 1;
    case T.bosque:
    case T.colinas:
      return 2;
    case T.montaña:
    case T.nieve:
      return 3;
    default:
      return 99;
  }
}

export const NEIGHBORS4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const NEIGHBORS8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function chebyshev(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

export function manhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * BFS multi-fuente sobre celdas caminables. `sources` son índices de celdas
 * objetivo (pueden ser agua: se computa la distancia hasta pisar una celda
 * adyacente al objetivo si el objetivo no es caminable).
 */
export function distanceField(grid: WorldGrid, sources: ArrayLike<number>, out: Uint16Array): Uint16Array {
  const { size, terrain } = grid;
  out.fill(NO_PATH);
  const queue = new Int32Array(size * size);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]!;
    if (isWalkable(terrain[s]!)) {
      if (out[s] !== 0) {
        out[s] = 0;
        queue[tail++] = s;
      }
    } else {
      // objetivo no caminable (agua): las celdas caminables vecinas son distancia 0
      const sx = s % size;
      const sy = (s - sx) / size;
      for (const [dx, dy] of NEIGHBORS8) {
        const nx = sx + dx;
        const ny = sy + dy;
        if (!inBounds(size, nx, ny)) continue;
        const ni = ny * size + nx;
        if (isWalkable(terrain[ni]!) && out[ni] !== 0) {
          out[ni] = 0;
          queue[tail++] = ni;
        }
      }
    }
  }
  while (head < tail) {
    const cur = queue[head++]!;
    const cx = cur % size;
    const cy = (cur - cx) / size;
    const d = out[cur]! + 1;
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(size, nx, ny)) continue;
      const ni = ny * size + nx;
      if (out[ni]! <= d) continue;
      if (!isWalkable(terrain[ni]!)) continue;
      out[ni] = d;
      queue[tail++] = ni;
    }
  }
  return out;
}

/** Devuelve la celda vecina que más reduce la distancia en el campo, o -1 si ya está en el objetivo o no hay camino. */
export function descend(grid: WorldGrid, field: Uint16Array, x: number, y: number): number {
  const { size } = grid;
  const here = field[idx(size, x, y)]!;
  if (here === 0 || here === NO_PATH) return -1;
  let best = -1;
  let bestD = here;
  for (const [dx, dy] of NEIGHBORS8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(size, nx, ny)) continue;
    const ni = ny * size + nx;
    const d = field[ni]!;
    if (d < bestD) {
      bestD = d;
      best = ni;
    }
  }
  return best;
}
