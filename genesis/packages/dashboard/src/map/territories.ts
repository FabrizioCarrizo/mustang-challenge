import type { AgentSummary, GroupInfo } from "@genesis/protocol";

export interface Territory {
  groupId: number;
  name: string;
  color: string;
  hull: Array<[number, number]>;
  centroid: [number, number];
}

type Pt = [number, number];

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Cierre convexo (cadena monótona de Andrew). */
export function convexHull(points: Pt[]): Pt[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Un miembro más lejos que esto del hogar anda de viaje: no estira el territorio. */
const HOME_RADIUS = 16;

/**
 * Territorio aproximado de cada tribu: el cierre convexo de las posiciones de
 * los miembros vivos cercanos al hogar (o a la mediana del grupo si no hay
 * hogar), para que un explorador lejano no estire el polígono por todo el mapa.
 */
export function computeTerritories(groups: GroupInfo[], agents: Map<number, AgentSummary>): Territory[] {
  const out: Territory[] = [];
  for (const g of groups) {
    const all: Pt[] = [];
    for (const id of g.members) {
      const a = agents.get(id);
      if (a && a.alive) all.push([a.x + 0.5, a.y + 0.5]);
    }
    if (all.length === 0) continue;
    let anchor: Pt;
    if (g.home) anchor = [g.home.x + 0.5, g.home.y + 0.5];
    else {
      const xs = all.map((p) => p[0]).sort((a, b) => a - b);
      const ys = all.map((p) => p[1]).sort((a, b) => a - b);
      anchor = [xs[Math.floor(xs.length / 2)]!, ys[Math.floor(ys.length / 2)]!];
    }
    const pts = all.filter((p) => Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) <= HOME_RADIUS);
    pts.push(anchor);
    // un hogar con pocos vecinos igual merece un pequeño claro alrededor
    if (pts.length < 3) {
      const r = 2.5;
      pts.push([anchor[0] - r, anchor[1] - r], [anchor[0] + r, anchor[1] - r], [anchor[0] + r, anchor[1] + r], [anchor[0] - r, anchor[1] + r]);
    }
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    let cx = 0;
    let cy = 0;
    for (const p of hull) {
      cx += p[0];
      cy += p[1];
    }
    out.push({ groupId: g.id, name: g.name, color: g.color || "#8ab4f8", hull, centroid: [cx / hull.length, cy / hull.length] });
  }
  return out;
}
