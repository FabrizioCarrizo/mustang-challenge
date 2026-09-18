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

/**
 * Territorio aproximado de cada tribu: el cierre convexo de las posiciones de
 * sus miembros vivos (más adelante el servidor podrá mandar territorios reales).
 */
export function computeTerritories(groups: GroupInfo[], agents: Map<number, AgentSummary>): Territory[] {
  const out: Territory[] = [];
  for (const g of groups) {
    const pts: Pt[] = [];
    for (const id of g.members) {
      const a = agents.get(id);
      if (a && a.alive) pts.push([a.x + 0.5, a.y + 0.5]);
    }
    if (g.home) pts.push([g.home.x + 0.5, g.home.y + 0.5]);
    if (pts.length < 3) continue;
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
