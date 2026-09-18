import type { Agent } from "../agents/agent.ts";

/** Hash espacial con celdas de 8×8 para consultas de vecindad. */
export class SpatialHash {
  private readonly cells = new Map<number, number[]>();
  private readonly cellSize = 8;
  private readonly cols: number;

  constructor(private readonly size: number) {
    this.cols = Math.ceil(size / this.cellSize);
  }

  clear(): void {
    this.cells.clear();
  }

  insert(a: Agent): void {
    const key = this.key(a.x, a.y);
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push(a.id);
  }

  private key(x: number, y: number): number {
    return Math.floor(y / this.cellSize) * this.cols + Math.floor(x / this.cellSize);
  }

  /** Ids de seres dentro de radio Chebyshev `r` (incluye al propio ser si está). */
  query(x: number, y: number, r: number, agents: Map<number, Agent>, out: number[] = []): number[] {
    out.length = 0;
    const c0 = Math.max(0, Math.floor((x - r) / this.cellSize));
    const c1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cellSize));
    const r0 = Math.max(0, Math.floor((y - r) / this.cellSize));
    const r1 = Math.min(this.cols - 1, Math.floor((y + r) / this.cellSize));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const list = this.cells.get(cy * this.cols + cx);
        if (!list) continue;
        for (const id of list) {
          const a = agents.get(id);
          if (!a) continue;
          if (Math.abs(a.x - x) <= r && Math.abs(a.y - y) <= r) out.push(id);
        }
      }
    }
    return out;
  }
}
