import { RESOURCES } from "@genesis/protocol";
import { Fnv } from "../rng.ts";
import type { EngineState } from "./state.ts";

/** Hash FNV-1a del estado relevante para verificar replays. */
export function stateHash(s: EngineState): string {
  const f = new Fnv();
  f.int(s.tick);
  s.rng.hash(f);
  for (const id of s.alive) {
    const a = s.agents.get(id)!;
    f.int(a.id).int(a.x).int(a.y).num(a.health);
    f.num(a.needs.sed).num(a.needs.hambre).num(a.needs.calor).num(a.needs.descanso);
    let invSum = 0;
    for (const [, n] of a.inventory) invSum += n;
    f.num(invSum);
    f.int(a.asleep ? 1 : 0);
  }
  for (const r of RESOURCES) {
    const arr = s.grid.resources[r];
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i]!;
    f.num(sum);
  }
  f.int(s.structures.size);
  f.int(s.counters.agent).int(s.counters.structure);
  return f.hex();
}
