/**
 * PRNG determinista (xoshiro128**) con streams con nombre.
 * Toda la aleatoriedad del motor pasa por acá: nunca Math.random.
 */

export type RngState = [number, number, number, number];

/** FNV-1a de 32 bits sobre una cadena. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a incremental para hashes de estado. */
export class Fnv {
  private h = 0x811c9dc5;
  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i);
      this.h = Math.imul(this.h, 0x01000193);
    }
    return this;
  }
  num(n: number): this {
    // redondeo a 1e-4 para que flotantes casi iguales no rompan el hash
    return this.str(String(Math.round(n * 10000) / 10000) + "|");
  }
  int(n: number): this {
    this.h ^= n & 0xff;
    this.h = Math.imul(this.h, 0x01000193);
    this.h ^= (n >>> 8) & 0xff;
    this.h = Math.imul(this.h, 0x01000193);
    this.h ^= (n >>> 16) & 0xff;
    this.h = Math.imul(this.h, 0x01000193);
    this.h ^= (n >>> 24) & 0xff;
    this.h = Math.imul(this.h, 0x01000193);
    return this;
  }
  bytes(arr: ArrayLike<number>): this {
    for (let i = 0; i < arr.length; i++) {
      this.h ^= arr[i]! & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
    }
    return this;
  }
  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, "0");
  }
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number | string, stream = "") {
    const base = typeof seed === "string" ? hashString(seed) : seed >>> 0;
    const mix = splitmix32((base ^ hashString(stream)) >>> 0);
    this.s0 = mix();
    this.s1 = mix();
    this.s2 = mix();
    this.s3 = mix();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  static fromState(state: RngState): Rng {
    const r = new Rng(0);
    r.setState(state);
    return r;
  }

  state(): RngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  setState(state: RngState): void {
    [this.s0, this.s1, this.s2, this.s3] = state;
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Flotante uniforme en [0, 1). */
  float(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Entero uniforme en [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }

  /** Normal estándar por Box-Muller. */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.float();
    while (v === 0) v = this.float();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }
}

export const STREAM_NAMES = [
  "terrain",
  "climate",
  "resources",
  "life",
  "actions",
  "s1",
  "social",
  "names",
  "genome",
  "detectors",
  "god",
  "misc",
] as const;
export type StreamName = (typeof STREAM_NAMES)[number];

export class RngStreams {
  private readonly streams = new Map<StreamName, Rng>();

  constructor(public readonly seed: number) {
    for (const name of STREAM_NAMES) this.streams.set(name, new Rng(seed, name));
  }

  get(name: StreamName): Rng {
    return this.streams.get(name)!;
  }

  state(): Record<string, RngState> {
    const out: Record<string, RngState> = {};
    for (const [name, rng] of this.streams) out[name] = rng.state();
    return out;
  }

  restore(state: Record<string, RngState>): void {
    for (const [name, s] of Object.entries(state)) {
      const rng = this.streams.get(name as StreamName);
      if (rng) rng.setState(s);
    }
  }

  hash(f: Fnv): void {
    for (const name of STREAM_NAMES) {
      const s = this.streams.get(name)!.state();
      f.int(s[0]).int(s[1]).int(s[2]).int(s[3]);
    }
  }
}
