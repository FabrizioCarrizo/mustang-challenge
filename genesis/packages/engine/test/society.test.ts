import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine.ts";
import { Society } from "../src/society/society.ts";
import { Brain } from "../src/brain/brain.ts";
import { buildRoutes } from "../src/brain/router.ts";
import { detectCommunities, pairKey } from "../src/society/groups.ts";
import { cpi, detectCurrency, priceIndex, type TradeRecord } from "../src/society/economy.ts";
import { attemptInvention, matchTech, techPrerequisitesAcyclic, TECH_TREE } from "../src/society/tech.ts";
import { Rng } from "../src/rng.ts";
import { applyGovern, type IntentSink } from "../src/cognition/system2/intents.ts";
import type { WorldEvent } from "../src/sim/events.ts";
import { makeEvent } from "../src/sim/events.ts";
import { createGroup } from "../src/society/groups.ts";

describe("detección de tribus", () => {
  it("separa dos comunidades densas y descarta controles barajados", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 12 } }, 3);
    const ids = e.s.alive;
    const weights = new Map<string, number>();
    const A = ids.slice(0, 6);
    const B = ids.slice(6, 12);
    for (const grp of [A, B]) for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) weights.set(pairKey(grp[i]!, grp[j]!), 0.8);
    weights.set(pairKey(A[0]!, B[0]!), 0.4); // un puente débil
    const communities = detectCommunities(e.s, weights, 0.35, 4);
    expect(communities.length).toBe(2);
    expect(communities.map((c) => c.length).sort()).toEqual([6, 6]);
    // control: pesos aleatorios bajos no forman tribus
    const noise = new Map<string, number>();
    const rng = new Rng(5);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) noise.set(pairKey(ids[i]!, ids[j]!), rng.float() * 0.3);
    expect(detectCommunities(e.s, noise, 0.35, 4).length).toBe(0);
  });
});

describe("economía", () => {
  function trades(n: number, item: string): TradeRecord[] {
    const out: TradeRecord[] = [];
    const goods = ["comida", "madera", "piedra"];
    for (let i = 0; i < n; i++) {
      const g = goods[i % goods.length]!;
      out.push({ tick: i, aId: 1 + (i % 5), bId: 6 + (i % 5), gave: { [item]: 1 }, got: { [g]: 2 } });
    }
    return out;
  }

  it("detecta una moneda cuando un bien no consumido media muchos trueques", () => {
    const holders = new Map([["gema", 8], ["comida", 20]]);
    const consumed = new Map([["gema", 0], ["comida", 300]]);
    const verdict = detectCurrency(trades(30, "gema"), holders, 20, consumed);
    expect(verdict.item).toBe("gema");
    expect(verdict.distinctGoods).toBeGreaterThanOrEqual(2);
    // la comida se consume: no es moneda
    const v2 = detectCurrency(trades(30, "comida"), new Map([["comida", 20]]), 20, new Map([["comida", 500]]));
    expect(v2.item).toBeNull();
    // pocos trueques: nada
    expect(detectCurrency(trades(5, "gema"), holders, 20, consumed).item).toBeNull();
  });

  it("calcula precios implícitos con un salto y el índice", () => {
    const t: TradeRecord[] = [
      { tick: 1, aId: 1, bId: 2, gave: { madera: 2 }, got: { comida: 1 } },
      { tick: 2, aId: 1, bId: 2, gave: { madera: 4 }, got: { comida: 2 } },
      { tick: 3, aId: 3, bId: 4, gave: { piedra: 1 }, got: { madera: 2 } },
    ];
    const prices = priceIndex(t, "comida");
    expect(prices.get("comida")).toBe(1);
    expect(prices.get("madera")).toBeCloseTo(0.5, 5);
    expect(prices.get("piedra")).toBeCloseTo(1, 5);
    const later = new Map(prices);
    later.set("madera", 1);
    expect(cpi(later, prices)).toBeGreaterThan(1);
  });
});

describe("tecnología", () => {
  it("el árbol es acíclico y todas las dependencias existen", () => {
    expect(techPrerequisitesAcyclic()).toBe(true);
    const ids = new Set(TECH_TREE.map((t) => t.id));
    for (const t of TECH_TREE) for (const r of t.requires) expect(ids.has(r)).toBe(true);
  });

  it("una invención respeta prerrequisitos e ingredientes", () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 3 } }, 8);
    const a = e.s.agents.get(e.s.alive[0]!)!;
    a.genome.inteligencia = 1;
    a.genome.curiosidad = 1;
    expect(matchTech("quiero fundir el mineral en un horno")?.id).toBe("metalurgia");
    const rng = new Rng(1);
    const near = () => true;
    expect(attemptInvention(a, { resultado: "metal", ingredientes: ["mineral"], proceso: "fundir" }, rng, near).reason).toBe("faltan_tecnicas");
    a.inventory.clear();
    expect(attemptInvention(a, { resultado: "hacha", ingredientes: ["piedra"], proceso: "tallar" }, rng, near).reason).toBe("faltan_ingredientes");
    a.inventory.set("piedra", 2);
    a.inventory.set("madera", 2);
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) ok = attemptInvention(a, { resultado: "hacha", ingredientes: ["piedra"], proceso: "tallar" }, rng, near).reason === "ok";
    expect(ok).toBe(true);
  });
});

describe("leyes y crímenes", () => {
  it("un decreto crea una ley, un robo se vuelve crimen y alguien lo castiga", async () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 8 } }, 21);
    const society = new Society(e, null);
    society.install();
    e.society = society;
    for (let t = 0; t < 30; t++) e.step();
    const ids = e.s.alive;
    const g = createGroup(1, "Río Manso", ids, e.s.tick);
    society.groups.set(g.id, g);
    for (const id of ids) e.s.agents.get(id)!.groupId = g.id;
    const leader = e.s.agents.get(ids[0]!)!;
    g.leaderId = leader.id;
    g.leaderSinceTick = e.s.tick;
    const events: WorldEvent[] = [];
    const sink: IntentSink = { emit: (ev) => events.push(ev), learn: () => {}, conversation: () => 1, text: () => 1, invent: () => null };
    applyGovern(
      leader,
      g,
      e.s,
      { tipo: "ley", enunciado: "Nadie roba a los suyos", regla: { prohibe: ["robar"], castigo: "multa" }, objetivo_grupo: null, ritual: null, discurso: "Entre nosotros no se roba." },
      society,
      sink,
    );
    expect(society.lawsInfo().length).toBe(1);
    expect(events.some((ev) => ev.kind === "law")).toBe(true);
    // el crimen: un robo detectado entre miembros
    const thief = e.s.agents.get(ids[1]!)!;
    const victim = e.s.agents.get(ids[2]!)!;
    const prevHooks = e.hooks;
    e.hooks = {
      ...prevHooks,
      beforeWorld: (eng) => {
        prevHooks.beforeWorld?.(eng);
        eng.emit(makeEvent({ kind: "theft", tick: eng.s.tick, agentId: thief.id, targetId: victim.id, x: thief.x, y: thief.y, label: "1 de comida", importance: 6, tags: ["robo"] }));
      },
    };
    const out = e.step();
    e.hooks = prevHooks;
    expect(society.crimes.length).toBe(1);
    expect(out.events.some((ev) => ev.kind === "crime")).toBe(true);
    expect(society.pendingCrimeFor(leader.id)?.criminalId).toBe(thief.id);
    // el castigo aplica la multa
    thief.inventory.set("comida", 3);
    const r = society.punish(society.crimes[0]!, leader);
    expect(r?.punishment).toBe("multa");
    expect(society.crimes[0]!.punished).toBe(true);
    expect(society.lawsInfo()[0]!.enforcements).toBe(1);
  });
});

describe("hitos y tribus en una corrida", () => {
  it("con cerebro mock aparecen hitos, y cada uno se dispara una sola vez", async () => {
    const e = Engine.genesis({ world: { size: 64, initialPopulation: 16 } }, 44);
    const society = new Society(e, null);
    society.install();
    e.society = society;
    const brain = new Brain(e, buildRoutes(e.config, "mock")!, null, { density: 1, society });
    brain.install();
    const milestoneEvents: string[] = [];
    for (let t = 0; t < 144 * 8; t++) {
      const out = e.step();
      for (const ev of out.events) if (ev.kind === "milestone") milestoneEvents.push(ev.label);
      await new Promise<void>((r) => setImmediate(r));
    }
    expect(new Set(milestoneEvents).size).toBe(milestoneEvents.length);
    expect(milestoneEvents).toContain("first_shelter");
    expect(milestoneEvents).toContain("first_tribe");
    expect(society.groupsInfo().length).toBeGreaterThan(0);
    expect(e.s.epoch).not.toBe("");
    // el snapshot conserva la sociedad
    const snap = e.snapshot();
    expect((snap.extra as { society?: { groups: unknown[] } }).society?.groups.length).toBe(society.groupsInfo().length);
    const restored = Engine.fromSnapshot(JSON.parse(JSON.stringify(snap)));
    const society2 = new Society(restored, null);
    society2.install();
    expect(society2.groupsInfo().map((g) => g.id)).toEqual(society.groupsInfo().map((g) => g.id));
  });
});
