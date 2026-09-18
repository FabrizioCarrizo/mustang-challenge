import type { ItemKind, StructureKind } from "@genesis/protocol";

export interface Structure {
  id: number;
  kind: StructureKind;
  x: number;
  y: number;
  ownerId: number | null;
  groupId: number | null;
  /** 0..1 */
  progress: number;
  hp: number;
  builtTick: number;
  lit: boolean;
  /** ticks de combustible restantes (fogata, horno) */
  fuel: number;
  dedication: string | null;
  /** creencia a la que está dedicado (templo) */
  beliefId: number | null;
  contents: Map<ItemKind, number>;
  /** cultivo: progreso hacia la cosecha (granja) */
  growth: number;
  /** último tick en que cambió de estado (encendido/apagado, daño) */
  lastChangeTick: number;
}

export interface StructureSpec {
  materials: Partial<Record<ItemKind, number>>;
  /** ticks de trabajo para completarla */
  work: number;
  tech: string | null;
  /** abrigo que provee (grados) */
  warmth: number;
  capacity: number;
  hp: number;
}

export const STRUCTURE_SPECS: Record<StructureKind, StructureSpec> = {
  refugio: { materials: { madera: 4 }, work: 18, tech: "refugio", warmth: 10, capacity: 3, hp: 60 },
  fogata: { materials: { madera: 2 }, work: 2, tech: "fuego", warmth: 12, capacity: 6, hp: 10 },
  muro: { materials: { piedra: 3 }, work: 12, tech: "construccion", warmth: 0, capacity: 0, hp: 200 },
  granja: { materials: { semilla: 2, madera: 2 }, work: 24, tech: "agricultura", warmth: 0, capacity: 0, hp: 40 },
  almacen: { materials: { madera: 8, piedra: 2 }, work: 36, tech: "construccion", warmth: 4, capacity: 0, hp: 120 },
  taller: { materials: { madera: 6, piedra: 4 }, work: 36, tech: "herramientas", warmth: 4, capacity: 2, hp: 100 },
  horno: { materials: { piedra: 6 }, work: 30, tech: "ceramica", warmth: 14, capacity: 4, hp: 100 },
  templo: { materials: { piedra: 10, madera: 6 }, work: 96, tech: "construccion", warmth: 6, capacity: 12, hp: 300 },
  mercado: { materials: { madera: 10 }, work: 48, tech: "construccion", warmth: 2, capacity: 12, hp: 120 },
  tumba: { materials: { piedra: 2 }, work: 6, tech: null, warmth: 0, capacity: 0, hp: 500 },
  monumento: { materials: { piedra: 12 }, work: 72, tech: "construccion", warmth: 0, capacity: 0, hp: 800 },
};

export function createStructure(id: number, kind: StructureKind, x: number, y: number, ownerId: number | null, tick: number): Structure {
  return {
    id,
    kind,
    x,
    y,
    ownerId,
    groupId: null,
    progress: 0,
    hp: STRUCTURE_SPECS[kind].hp,
    builtTick: tick,
    lit: false,
    fuel: 0,
    dedication: null,
    beliefId: null,
    contents: new Map(),
    growth: 0,
    lastChangeTick: tick,
  };
}

export function providesWarmth(s: Structure): boolean {
  if (s.progress < 1) return false;
  if (s.kind === "fogata" || s.kind === "horno") return s.lit && s.fuel > 0;
  return STRUCTURE_SPECS[s.kind].warmth > 0;
}
