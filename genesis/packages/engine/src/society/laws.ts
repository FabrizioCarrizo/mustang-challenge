import type { Verb } from "@genesis/protocol";

export type Punishment = "exilio" | "multa" | "golpe" | "nada";

export interface Law {
  id: number;
  groupId: number;
  declarerId: number;
  tick: number;
  statement: string;
  prohibits: Verb[];
  punishment: Punishment;
  active: boolean;
  violations: number;
  enforcements: number;
  lastEnforcedTick: number;
  /** creencia "norma" sembrada por el discurso */
  beliefId: number | null;
}

export interface Crime {
  id: number;
  tick: number;
  lawId: number;
  groupId: number;
  criminalId: number;
  victimId: number | null;
  verb: Verb;
  punished: boolean;
  witnesses: number[];
}

const EVENT_VERB: Record<string, Verb> = {
  attack: "atacar",
  theft: "robar",
  punish: "castigar",
};

export function verbOfEvent(kind: string): Verb | null {
  return EVENT_VERB[kind] ?? null;
}

/** ¿Alguna ley activa del grupo prohíbe este verbo? */
export function lawBroken(laws: Iterable<Law>, groupId: number, verb: Verb): Law | null {
  for (const l of laws) if (l.active && l.groupId === groupId && l.prohibits.includes(verb)) return l;
  return null;
}
