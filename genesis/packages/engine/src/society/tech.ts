import type { ItemKind, StructureKind } from "@genesis/protocol";
import { inv, type Agent } from "../agents/agent.ts";
import type { Rng } from "../rng.ts";

export interface TechSpec {
  id: string;
  name: string;
  requires: string[];
  /** ingredientes que hay que tener para intentarlo (se consumen al lograrlo) */
  ingredients: Partial<Record<ItemKind, number>>;
  near: StructureKind | "agua" | null;
  unlocks: string[];
  /** 0 fácil … 1 casi imposible */
  difficulty: number;
  keywords: RegExp;
}

/** El árbol tecnológico: oculto para los seres, que solo conocen los nombres. */
export const TECH_TREE: TechSpec[] = [
  { id: "fuego", name: "el fuego", requires: [], ingredients: { madera: 1 }, near: null, unlocks: ["fogata", "ceramica", "metalurgia"], difficulty: 0.3, keywords: /fuego|chispa|encender|frotar|brasa|llama/i },
  { id: "herramientas", name: "las herramientas de piedra", requires: [], ingredients: { piedra: 1, madera: 1 }, near: null, unlocks: ["herramienta", "arma", "caza", "construccion", "rueda"], difficulty: 0.4, keywords: /herramienta|hacha|cuchillo|filo|tallar|martillo|arma|lanza|punta|golpear piedra/i },
  { id: "caza", name: "la caza", requires: ["herramientas"], ingredients: {}, near: null, unlocks: ["arma"], difficulty: 0.4, keywords: /caza|cazar|trampa|presa|animal/i },
  { id: "ceramica", name: "la cerámica", requires: ["fuego"], ingredients: { madera: 1 }, near: "agua", unlocks: ["cantaro", "horno", "tablilla"], difficulty: 0.5, keywords: /c[aá]ntaro|cer[aá]mica|barro|arcilla|vasija|olla|cocer/i },
  { id: "tejido", name: "el tejido", requires: [], ingredients: { madera: 1 }, near: null, unlocks: ["ropa"], difficulty: 0.5, keywords: /ropa|tejido|tejer|abrigo|manta|fibra|hilo|trenzar/i },
  { id: "agricultura", name: "la agricultura", requires: [], ingredients: { semilla: 1 }, near: null, unlocks: ["granja"], difficulty: 0.5, keywords: /sembrar|semilla|cultiv|granja|huerta|plantar|cosech/i },
  { id: "construccion", name: "la construcción con piedra", requires: ["herramientas"], ingredients: { piedra: 2 }, near: null, unlocks: ["muro", "almacen", "taller", "templo", "mercado", "monumento"], difficulty: 0.6, keywords: /muro|pared|apilar piedra|construir con piedra|casa de piedra|cimiento|templo|almac[eé]n/i },
  { id: "metalurgia", name: "la metalurgia", requires: ["fuego", "ceramica"], ingredients: { mineral: 1 }, near: "horno", unlocks: ["metal"], difficulty: 0.8, keywords: /metal|fundir|horno|mineral|forja|bronce|cobre|hierro/i },
  { id: "escritura", name: "la escritura", requires: ["ceramica"], ingredients: {}, near: null, unlocks: ["tablilla", "libro"], difficulty: 0.7, keywords: /escrib|tablilla|marca|signo|letra|s[ií]mbolo|contar con marcas|anotar|dibujar palabras/i },
  { id: "medicina", name: "la medicina de hierbas", requires: [], ingredients: { comida: 1 }, near: null, unlocks: [], difficulty: 0.6, keywords: /hierba|curar|medicina|remedio|sanar|enfermo|herida/i },
  { id: "rueda", name: "la rueda", requires: ["herramientas"], ingredients: { madera: 2 }, near: null, unlocks: [], difficulty: 0.7, keywords: /rueda|rodar|tronco que gira|carro|girar/i },
  { id: "navegacion", name: "la navegación", requires: ["herramientas"], ingredients: { madera: 3 }, near: "agua", unlocks: [], difficulty: 0.8, keywords: /balsa|canoa|navegar|barca|flotar|remo/i },
];

export const TECH_BY_ID: Record<string, TechSpec> = Object.fromEntries(TECH_TREE.map((t) => [t.id, t]));

export function techDisplayName(id: string): string {
  return TECH_BY_ID[id]?.name ?? id;
}

/** Identifica la técnica que un intento de invención está buscando. */
export function matchTech(text: string): TechSpec | null {
  for (const t of TECH_TREE) if (t.keywords.test(text)) return t;
  return null;
}

export interface InventionResult {
  tech: string | null;
  reason: "ok" | "ya_sabe" | "faltan_tecnicas" | "faltan_ingredientes" | "lejos" | "fallo" | "sin_idea";
}

/**
 * Un intento de invención: la receta propuesta se compara con el árbol oculto,
 * se verifican prerrequisitos, ingredientes y lugar, y se tira el dado.
 */
export function attemptInvention(
  a: Agent,
  recipe: { resultado: string; ingredientes: string[]; proceso: string },
  rng: Rng,
  nearStructure: (kind: StructureKind | "agua") => boolean,
): InventionResult {
  const text = `${recipe.resultado} ${recipe.ingredientes.join(" ")} ${recipe.proceso}`;
  const tech = matchTech(text);
  if (!tech) return { tech: null, reason: "sin_idea" };
  if (a.knows.has(tech.id)) return { tech: tech.id, reason: "ya_sabe" };
  if (tech.requires.some((r) => !a.knows.has(r))) return { tech: tech.id, reason: "faltan_tecnicas" };
  for (const [item, n] of Object.entries(tech.ingredients)) if (inv(a, item as ItemKind) < (n ?? 0)) return { tech: tech.id, reason: "faltan_ingredientes" };
  if (tech.near && !nearStructure(tech.near)) return { tech: tech.id, reason: "lejos" };
  const chance = (1 - tech.difficulty) * (0.3 + 0.7 * a.genome.inteligencia) + 0.1 * a.genome.curiosidad;
  if (!rng.chance(chance)) return { tech: tech.id, reason: "fallo" };
  return { tech: tech.id, reason: "ok" };
}

export function techPrerequisitesAcyclic(): boolean {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    for (const r of TECH_BY_ID[id]?.requires ?? []) if (!visit(r)) return false;
    visiting.delete(id);
    done.add(id);
    return true;
  };
  return TECH_TREE.every((t) => visit(t.id));
}

/** Recetas de fabricación (System 1): qué se puede hacer con qué. */
export interface CraftRecipe {
  item: ItemKind;
  tech: string;
  ingredients: Partial<Record<ItemKind, number>>;
  work: number;
  near: StructureKind | null;
}

export const CRAFT_RECIPES: CraftRecipe[] = [
  { item: "herramienta", tech: "herramientas", ingredients: { piedra: 1, madera: 1 }, work: 6, near: null },
  { item: "arma", tech: "herramientas", ingredients: { piedra: 1, madera: 1 }, work: 8, near: null },
  { item: "ropa", tech: "tejido", ingredients: { madera: 1 }, work: 8, near: null },
  { item: "cantaro", tech: "ceramica", ingredients: { madera: 1 }, work: 8, near: "fogata" },
  { item: "tablilla", tech: "escritura", ingredients: { madera: 1 }, work: 4, near: null },
  { item: "metal", tech: "metalurgia", ingredients: { mineral: 1, madera: 1 }, work: 10, near: "horno" },
];

export function craftRecipeFor(item: string): CraftRecipe | null {
  const n = item.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return CRAFT_RECIPES.find((r) => r.item === n) ?? null;
}
