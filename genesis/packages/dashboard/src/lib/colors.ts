import type { AgentStatus, ResourceKind } from "@genesis/protocol";

/** Paleta de terreno, indexada como TERRAINS (agua_profunda … nieve). */
export const TERRAIN_RGB: Array<[number, number, number]> = [
  [0x12, 0x30, 0x4a], // agua_profunda
  [0x2a, 0x5d, 0x8f], // agua
  [0xd6, 0xc4, 0x8a], // arena
  [0x5f, 0x8f, 0x3e], // pradera
  [0x2f, 0x6b, 0x2f], // bosque
  [0x8b, 0x7a, 0x4f], // colinas
  [0x6f, 0x6a, 0x66], // montaña
  [0xe8, 0xec, 0xef], // nieve
];

/** Color de superposición por recurso: rgb + alpha máxima. */
export const RESOURCE_RGBA: Record<ResourceKind, [number, number, number, number]> = {
  comida: [0xc6, 0xf5, 0x6a, 0.6],
  madera: [0x9a, 0x5c, 0x22, 0.6],
  piedra: [0xd0, 0xd0, 0xd0, 0.65],
  mineral: [0x7e, 0xb6, 0xff, 0.9],
  gema: [0xff, 0x7a, 0xe0, 0.95],
};

export const RESOURCE_CSS: Record<ResourceKind, string> = {
  comida: "#a8dd4a",
  madera: "#b5773a",
  piedra: "#c8c8c8",
  mineral: "#7eb6ff",
  gema: "#ff7ae0",
};

export const STATUS_FILL: Record<AgentStatus, string> = {
  activo: "#f6d98f",
  durmiendo: "#7f8ca9",
  conversando: "#3ec9c0",
  peleando: "#e5484d",
  herido: "#b78ae0",
  enfermo: "#9b6fc9",
  muerto: "#7a7a7a",
};

/** Verde ≥ 0.6, ámbar ≥ 0.3, rojo por debajo. */
export function needColor(v: number): string {
  if (v >= 0.6) return "var(--good)";
  if (v >= 0.3) return "var(--warn)";
  return "var(--bad)";
}

export function importanceClass(importance: number): string {
  if (importance >= 8) return "imp imp--epic";
  if (importance >= 6) return "imp imp--high";
  if (importance >= 4) return "imp imp--mid";
  return "imp imp--low";
}

/** Lee un token CSS del :root (los gráficos lo necesitan como hex). */
export function cssVar(name: string, fallback = "#888"): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
