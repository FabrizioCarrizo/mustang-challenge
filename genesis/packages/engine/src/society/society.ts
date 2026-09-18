import type { BeliefInfo, EconomyInfo, GroupInfo, LawInfo, MilestoneInfo, TechInfo, TextInfo } from "@genesis/protocol";
import type { Verb } from "@genesis/protocol";
import { remember, type Agent } from "../agents/agent.ts";
import { clamp01 } from "../agents/needs.ts";
import { gini, wealthOf } from "../metrics/collector.ts";
import type { WorldDb } from "../persistence/db.ts";
import type { Engine, TickOutput } from "../sim/engine.ts";
import { makeEvent, type WorldEvent } from "../sim/events.ts";
import type { EngineState } from "../sim/state.ts";
import { generatePlaceName } from "../agents/naming.ts";
import { holdBelief } from "./beliefs.ts";
import { cpi, detectCurrency, priceIndex, type TradeRecord } from "./economy.ts";
import { createGroup, deference, detectCommunities, groupHome, jaccard, membersAlive, pairKey, type Group, type GroupCandidate } from "./groups.ts";
import { lawBroken, verbOfEvent, type Crime, type Law } from "./laws.ts";
import { EPOCH_ORDER, MILESTONES, epochRank, type DailyContext } from "./milestones.ts";
import { TECH_TREE } from "./tech.ts";

export interface GovernIssue {
  groupId: number;
  leaderId: number;
  kind: "crimen" | "hambruna" | "amenaza" | "guerra" | "semanal" | "disputa";
  detail: string;
  tick: number;
}

export interface Religion {
  beliefId: number;
  groupId: number;
  tick: number;
  name: string;
}

interface SerializedSociety {
  groups: Array<Omit<Group, "members" | "wars" | "treaties" | "leaderStreak"> & { members: number[]; wars: number[]; treaties: number[]; leaderStreak: Array<[number, number]> }>;
  laws: Law[];
  crimes: Crime[];
  candidates: GroupCandidate[];
  interactions: Array<[string, { w: number; lastTick: number }]>;
  trades: TradeRecord[];
  consumed: Array<{ day: number; items: Record<string, number> }>;
  rituals: Array<{ tick: number; cell: number; agentId: number }>;
  attacks: Array<{ tick: number; from: number; to: number }>;
  sleepLog: Array<[number, number[]]>;
  netGifts: Array<[number, number]>;
  speeches: Array<[number, number]>;
  religions: Religion[];
  currency: { item: string; sinceTick: number } | null;
  priceBaseline: Array<[string, number]>;
  prices: Array<[string, number]>;
  cpi: number;
  issues: GovernIssue[];
  milestoneRows: MilestoneInfo[];
  hungerDeaths: number[];
  sick: number[];
  counters: { law: number; crime: number };
}

/**
 * La sociedad: no crea instituciones, las reconoce. Detecta tribus, líderes,
 * moneda, precios, religiones, crímenes y hitos, y persiste todo eso.
 */
export class Society {
  readonly groups = new Map<number, Group>();
  readonly laws = new Map<number, Law>();
  crimes: Crime[] = [];
  private candidates: GroupCandidate[] = [];
  private interactions = new Map<string, { w: number; lastTick: number }>();
  private trades: TradeRecord[] = [];
  private consumed: Array<{ day: number; items: Record<string, number> }> = [];
  private rituals: Array<{ tick: number; cell: number; agentId: number }> = [];
  private attacks: Array<{ tick: number; from: number; to: number }> = [];
  private sleepLog = new Map<number, number[]>();
  private netGifts = new Map<number, number>();
  private speeches = new Map<number, number>();
  readonly religions = new Map<number, Religion>();
  currency: { item: string; sinceTick: number } | null = null;
  private priceBaseline = new Map<string, number>();
  prices = new Map<string, number>();
  cpiValue = 1;
  issues: GovernIssue[] = [];
  milestoneRows: MilestoneInfo[] = [];
  private hungerDeaths: number[] = [];
  private sick: number[] = [];
  private lawCounter = 1;
  private crimeCounter = 1;
  private readonly s: EngineState;

  constructor(
    readonly engine: Engine,
    readonly db: WorldDb | null,
  ) {
    this.s = engine.s;
    if (db) this.milestoneRows = db.milestones(500);
  }

  install(): void {
    const prev = this.engine.hooks;
    this.engine.hooks = {
      ...prev,
      afterTick: (e, out) => {
        prev.afterTick?.(e, out);
        this.onTick(out);
      },
    };
    this.engine.attachSystem("society", { serialize: () => this.serialize(), restore: (d) => this.restore(d as SerializedSociety) });
  }

  // ------------------------------------------------------------ consultas

  activeGroupCount(): number {
    let n = 0;
    for (const g of this.groups.values()) if (g.dissolvedTick === null) n++;
    return n;
  }

  groupOf(agentId: number): Group | null {
    const a = this.s.agents.get(agentId);
    if (!a || a.groupId === null) return null;
    const g = this.groups.get(a.groupId);
    return g && g.dissolvedTick === null ? g : null;
  }

  groupNameOf(agentId: number): string | null {
    return this.groupOf(agentId)?.name ?? null;
  }

  leaderNameOf(agentId: number): string | null {
    const g = this.groupOf(agentId);
    if (!g || g.leaderId === null) return null;
    return this.s.agents.get(g.leaderId)?.name ?? null;
  }

  groupByName(name: string): Group | null {
    const n = name.trim().toLowerCase();
    for (const g of this.groups.values()) if (g.dissolvedTick === null && g.name.toLowerCase() === n) return g;
    return null;
  }

  isLeader(agentId: number): Group | null {
    const g = this.groupOf(agentId);
    return g && g.leaderId === agentId ? g : null;
  }

  /** Crimen pendiente que este ser podría castigar (misma tribu, criminal vivo, no castigado, reciente). */
  pendingCrimeFor(agentId: number): Crime | null {
    const g = this.groupOf(agentId);
    if (!g) return null;
    const a = this.s.agents.get(agentId)!;
    const recent = this.s.tick - this.s.config.time.ticksPerDay * 5;
    for (let i = this.crimes.length - 1; i >= 0; i--) {
      const c = this.crimes[i]!;
      if (c.punished || c.tick < recent || c.groupId !== g.id || c.criminalId === agentId) continue;
      const criminal = this.s.agents.get(c.criminalId);
      if (!criminal || criminal.diedTick === null === false) continue;
      const law = this.laws.get(c.lawId);
      if (!law || !law.active || law.punishment === "nada") continue;
      const willing = g.leaderId === agentId || a.genome.agresion > 0.5 || c.victimId === agentId || (law.beliefId !== null && (a.beliefs.get(law.beliefId) ?? 0) > 0.5);
      if (willing) return c;
    }
    return null;
  }

  punish(crime: Crime, by: Agent): { punishment: Law["punishment"]; victimId: number | null } | null {
    const law = this.laws.get(crime.lawId);
    if (!law) return null;
    crime.punished = true;
    law.enforcements++;
    law.lastEnforcedTick = this.s.tick;
    if (law.punishment === "exilio") {
      const g = this.groups.get(crime.groupId);
      const criminal = this.s.agents.get(crime.criminalId);
      if (g && criminal) {
        g.members.delete(criminal.id);
        criminal.groupId = null;
        for (const m of g.members) {
          const other = this.s.agents.get(m);
          if (other) {
            const rel = other.relationships.get(criminal.id);
            if (rel) rel.label = "exiliado";
          }
        }
      }
    }
    void by;
    return { punishment: law.punishment, victimId: crime.victimId };
  }

  pendingIssues(): GovernIssue[] {
    return this.issues;
  }

  takeIssue(leaderId: number): GovernIssue | null {
    const i = this.issues.findIndex((x) => x.leaderId === leaderId);
    if (i < 0) return null;
    return this.issues.splice(i, 1)[0]!;
  }

  // ------------------------------------------------------------ por tick

  private onTick(out: TickOutput): void {
    const s = this.s;
    const tick = s.tick;
    // los eventos que la propia sociedad emite durante el tick (tribus, líderes, hitos) también se procesan
    for (let i = 0; i < out.events.length; i++) this.onEvent(out.events[i]!);
    const seen = out.events.length;
    // registro de dónde pasa la noche cada uno (a las 3 de la mañana)
    if (s.clock.hour >= 3 && s.clock.hour < 3 + s.config.time.minutesPerTick / 60) {
      for (const id of s.alive) {
        const a = s.agents.get(id)!;
        const cell = a.y * s.grid.size + a.x;
        const log = this.sleepLog.get(id) ?? [];
        log.push(cell);
        if (log.length > 7) log.shift();
        this.sleepLog.set(id, log);
      }
    }
    if (out.newDay) this.daily();
    for (let i = seen; i < out.events.length; i++) this.onEvent(out.events[i]!);
  }

  private onEvent(e: WorldEvent): void {
    const s = this.s;
    switch (e.kind) {
      case "dialogue":
      case "trade":
      case "gift":
      case "teach":
      case "bond":
        if (e.agentId !== null && e.targetId !== null) this.bump(e.agentId, e.targetId, e.kind === "gift" || e.kind === "bond" ? 2 : 1);
        if (e.kind === "gift" && e.agentId !== null && e.targetId !== null) {
          this.netGifts.set(e.agentId, (this.netGifts.get(e.agentId) ?? 0) + 1);
          this.netGifts.set(e.targetId, (this.netGifts.get(e.targetId) ?? 0) - 1);
        }
        if (e.kind === "trade" && e.agentId !== null && e.targetId !== null) {
          this.trades.push({ tick: e.tick, aId: e.agentId, bId: e.targetId, gave: (e.data.gave as Record<string, number>) ?? {}, got: (e.data.got as Record<string, number>) ?? {} });
        }
        break;
      case "speech":
        if (e.agentId !== null) this.speeches.set(e.agentId, (this.speeches.get(e.agentId) ?? 0) + 1);
        break;
      case "pray":
      case "ritual":
        if (e.agentId !== null && e.x !== null && e.y !== null) this.rituals.push({ tick: e.tick, cell: e.y * s.grid.size + e.x, agentId: e.agentId });
        break;
      case "attack":
      case "theft":
      case "punish": {
        if (e.kind === "attack") s.today.violence++;
        if (e.kind === "attack" && e.agentId !== null && e.targetId !== null) {
          const ga = this.groupOf(e.agentId);
          const gb = this.groupOf(e.targetId);
          if (ga && gb && ga.id !== gb.id) {
            this.attacks.push({ tick: e.tick, from: ga.id, to: gb.id });
            this.checkWar(ga, gb);
            if (gb.leaderId !== null) this.raiseIssue(gb, "amenaza", `${s.agents.get(e.agentId)?.name} de ${ga.name} atacó a ${s.agents.get(e.targetId)?.name}`);
          }
        }
        const verb = verbOfEvent(e.kind);
        if (verb && e.agentId !== null && e.kind !== "punish") this.checkCrime(e, verb);
        if (e.kind === "punish" && e.data.lawId) {
          // ya contabilizado en punish()
        }
        break;
      }
      case "agent.died":
        if (e.label === "hambre" || e.label === "sed") this.hungerDeaths.push(e.tick);
        if (e.agentId !== null) {
          const g = this.groupOf(e.agentId);
          if (g && (e.label === "hambre" || e.label === "sed")) {
            const recent = this.hungerDeaths.filter((t) => t > e.tick - s.config.time.ticksPerDay * 3).length;
            if (recent >= 2 && g.leaderId !== null) this.raiseIssue(g, "hambruna", `murieron de hambre ${recent} en tres días`);
          }
          this.sleepLog.delete(e.agentId);
          for (const gr of this.groups.values()) gr.members.delete(e.agentId);
        }
        break;
      case "agent.sick":
        this.sick.push(e.tick);
        break;
      default:
        break;
    }
    // hitos por evento
    for (const spec of MILESTONES) {
      if (!spec.onEvent || s.milestones.has(spec.key)) continue;
      const who = spec.onEvent(e, s);
      if (who) this.fireMilestone(spec.key, who);
    }
  }

  private bump(a: number, b: number, w: number): void {
    const key = pairKey(a, b);
    const cur = this.interactions.get(key) ?? { w: 0, lastTick: 0 };
    cur.w += w;
    cur.lastTick = this.s.tick;
    this.interactions.set(key, cur);
  }

  private raiseIssue(g: Group, kind: GovernIssue["kind"], detail: string): void {
    if (g.leaderId === null) return;
    if (this.issues.some((i) => i.groupId === g.id && i.kind === kind)) return;
    this.issues.push({ groupId: g.id, leaderId: g.leaderId, kind, detail, tick: this.s.tick });
  }

  private checkCrime(e: WorldEvent, verb: Verb): void {
    const s = this.s;
    const criminal = e.agentId!;
    const g = this.groupOf(criminal);
    if (!g) return;
    const victimGroup = e.targetId !== null ? this.groupOf(e.targetId) : null;
    if (victimGroup && victimGroup.id !== g.id) return; // contra extraños no es delito para los propios
    const law = lawBroken(this.laws.values(), g.id, verb);
    if (!law) return;
    law.violations++;
    const crime: Crime = {
      id: this.crimeCounter++,
      tick: e.tick,
      lawId: law.id,
      groupId: g.id,
      criminalId: criminal,
      victimId: e.targetId,
      verb,
      punished: false,
      witnesses: [],
    };
    this.crimes.push(crime);
    if (this.crimes.length > 500) this.crimes.shift();
    this.engine.emit(
      makeEvent({
        kind: "crime",
        tick: e.tick,
        agentId: criminal,
        targetId: e.targetId,
        x: e.x,
        y: e.y,
        label: law.statement,
        importance: 6,
        data: { lawId: law.id, crimeId: crime.id, verb },
        tags: ["crimen", "norma"],
      }),
    );
    this.raiseIssue(g, "crimen", `${s.agents.get(criminal)?.name} violó la ley: ${law.statement}`);
  }

  private checkWar(ga: Group, gb: Group): void {
    if (ga.wars.has(gb.id)) return;
    const since = this.s.tick - this.s.config.time.ticksPerDay * 2;
    let ab = 0;
    let ba = 0;
    for (const at of this.attacks) {
      if (at.tick < since) continue;
      if (at.from === ga.id && at.to === gb.id) ab++;
      if (at.from === gb.id && at.to === ga.id) ba++;
    }
    if (ab >= 3 && ba >= 3) this.declareWar(ga, gb, "la sangre llamó a la sangre");
  }

  declareWar(ga: Group, gb: Group, why: string): void {
    ga.wars.add(gb.id);
    gb.wars.add(ga.id);
    ga.treaties.delete(gb.id);
    gb.treaties.delete(ga.id);
    this.engine.emit(makeEvent({ kind: "war", tick: this.s.tick, label: `${ga.name} contra ${gb.name}`, importance: 9, data: { groups: [ga.id, gb.id], why }, tags: ["guerra", "violencia"] }));
    if (ga.leaderId !== null) this.raiseIssue(ga, "guerra", `guerra con ${gb.name}`);
    if (gb.leaderId !== null) this.raiseIssue(gb, "guerra", `guerra con ${ga.name}`);
  }

  makePeace(ga: Group, gb: Group, text: string): void {
    ga.wars.delete(gb.id);
    gb.wars.delete(ga.id);
    ga.treaties.add(gb.id);
    gb.treaties.add(ga.id);
    this.engine.emit(makeEvent({ kind: "treaty", tick: this.s.tick, label: `${ga.name} y ${gb.name}: ${text}`, importance: 8, data: { groups: [ga.id, gb.id] }, tags: ["paz", "tratado"] }));
  }

  // ------------------------------------------------------------ diario

  private daily(): void {
    const s = this.s;
    const tpd = s.config.time.ticksPerDay;
    const tick = s.tick;
    // ventanas
    const keep14 = tick - tpd * 14;
    this.trades = this.trades.filter((t) => t.tick >= keep14);
    this.rituals = this.rituals.filter((r) => r.tick >= keep14);
    this.attacks = this.attacks.filter((a) => a.tick >= tpd * 2 && a.tick >= tick - tpd * 8);
    this.hungerDeaths = this.hungerDeaths.filter((t) => t >= tick - tpd * 3);
    this.sick = this.sick.filter((t) => t >= tick - tpd * 3);
    this.consumed.push({ day: s.clock.day - 1, items: { ...s.yesterday.consumed } });
    if (this.consumed.length > 14) this.consumed.shift();
    for (const [key, v] of this.interactions) {
      v.w *= 0.85;
      if (v.w < 0.05) this.interactions.delete(key);
    }
    for (const [id, n] of this.speeches) this.speeches.set(id, n * 0.7);
    for (const [id, n] of this.netGifts) this.netGifts.set(id, n * 0.9);
    this.issues = this.issues.filter((i) => i.tick >= tick - tpd * 7);

    this.detectGroups();
    this.detectLeaders();
    this.detectEconomy();
    this.detectReligions();
    this.expireLaws();
    this.scheduleRituals();
    this.weeklyIssues();
    this.dailyMilestones();
    this.persist();
  }

  private detectGroups(): void {
    const s = this.s;
    const weights = new Map<string, number>();
    const ids = s.alive;
    const logs = ids.map((id) => [id, this.sleepLog.get(id) ?? []] as const);
    const size = s.grid.size;
    for (let i = 0; i < logs.length; i++) {
      const [ia, la] = logs[i]!;
      for (let j = i + 1; j < logs.length; j++) {
        const [ib, lb] = logs[j]!;
        let co = 0;
        const n = Math.min(la.length, lb.length);
        for (let k = 0; k < n; k++) {
          const ca = la[la.length - 1 - k]!;
          const cb = lb[lb.length - 1 - k]!;
          const dx = (ca % size) - (cb % size);
          const dy = Math.floor(ca / size) - Math.floor(cb / size);
          if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) co++;
        }
        const coSleep = n ? co / Math.max(3, n) : 0;
        const key = pairKey(ia, ib);
        const inter = Math.min(1, (this.interactions.get(key)?.w ?? 0) / 5);
        const ra = s.agents.get(ia)!.relationships.get(ib);
        const rb = s.agents.get(ib)!.relationships.get(ia);
        const kin = Math.max(ra?.kinship ?? 0, rb?.kinship ?? 0);
        const w = 0.5 * Math.min(1, coSleep) + 0.3 * inter + 0.2 * kin;
        if (w > 0.05) weights.set(key, w);
      }
    }
    const communities = detectCommunities(s, weights);
    const matched = new Set<number>();
    const nextCandidates: GroupCandidate[] = [];
    for (const members of communities) {
      let best: Group | null = null;
      let bestJ = 0.5;
      for (const g of this.groups.values()) {
        if (g.dissolvedTick !== null || matched.has(g.id)) continue;
        const j = jaccard(members, g.members);
        if (j >= bestJ) {
          bestJ = j;
          best = g;
        }
      }
      if (best) {
        matched.add(best.id);
        for (const m of members) {
          if (!best.members.has(m)) {
            best.members.add(m);
            const a = s.agents.get(m);
            if (a && a.groupId !== null && a.groupId !== best.id) this.groups.get(a.groupId)?.members.delete(m);
            if (a) a.groupId = best.id;
          }
        }
        best.home = groupHome(s, best);
        continue;
      }
      const cand = this.candidates.find((c) => jaccard(c.members, members) >= 0.5);
      const streak = (cand?.streak ?? 0) + 1;
      if (streak >= 3) {
        const g = createGroup(s.counters.group++, generatePlaceName(s.rng.get("detectors")), members, s.tick);
        g.home = groupHome(s, g);
        this.groups.set(g.id, g);
        for (const m of members) {
          const a = s.agents.get(m);
          if (a) a.groupId = g.id;
        }
        const first = !s.milestones.has("first_tribe");
        this.engine.emit(makeEvent({ kind: "group", tick: s.tick, label: g.name, importance: 7, data: { groupId: g.id, members, first }, tags: ["tribu"] }));
        for (const m of members) {
          const a = s.agents.get(m);
          if (a) remember(s, a, "observacion", `Somos una tribu: ${g.name}`, 6, ["tribu"]);
        }
      } else nextCandidates.push({ members, streak });
    }
    this.candidates = nextCandidates;
    // tribus que se vaciaron
    for (const g of this.groups.values()) {
      if (g.dissolvedTick !== null) continue;
      const alive = membersAlive(s, g);
      if (alive.length < 3) {
        g.dissolvedTick = s.tick;
        for (const a of alive) a.groupId = null;
        this.engine.emit(makeEvent({ kind: "group", tick: s.tick, label: `${g.name} se disolvió`, importance: 5, data: { groupId: g.id, dissolved: true }, tags: ["tribu"] }));
      }
    }
  }

  private detectLeaders(): void {
    const s = this.s;
    for (const g of this.groups.values()) {
      if (g.dissolvedTick !== null) continue;
      const alive = membersAlive(s, g);
      if (alive.length < 3) continue;
      const d = deference(s, g, this.netGifts, this.speeches);
      const sorted = [...d.entries()].filter(([id]) => s.agents.get(id)?.diedTick === null).sort((p, q) => q[1] - p[1]);
      const [top, second] = [sorted[0], sorted[1]];
      if (!top) continue;
      const qualifies = top[1] >= 1.3 * (second?.[1] ?? 0) && top[1] >= 0.2 * alive.length;
      const streak = qualifies ? (g.leaderStreak.get(top[0]) ?? 0) + 1 : 0;
      g.leaderStreak.clear();
      if (qualifies) g.leaderStreak.set(top[0], streak);
      if (qualifies && streak >= 2 && g.leaderId !== top[0]) {
        g.leaderId = top[0];
        g.leaderSinceTick = s.tick;
        this.engine.emit(makeEvent({ kind: "leader", tick: s.tick, agentId: top[0], label: g.name, importance: 6, data: { groupId: g.id }, tags: ["lider", "tribu"] }));
        const leader = s.agents.get(top[0]);
        if (leader) {
          leader.needs.estima = clamp01(leader.needs.estima + 0.3);
          remember(s, leader, "observacion", `Los de ${g.name} me siguen: soy su líder`, 8, ["lider"]);
        }
      } else if (!qualifies && g.leaderId !== null && s.tick - g.leaderSinceTick > s.config.time.ticksPerDay * 5) {
        const still = d.get(g.leaderId) ?? 0;
        if (still < 0.4 * alive.length * 0.5) {
          g.leaderId = null;
          g.leaderSinceTick = -1;
        }
      }
    }
  }

  private detectEconomy(): void {
    const s = this.s;
    const holders = new Map<string, number>();
    for (const id of s.alive) for (const [item, n] of s.agents.get(id)!.inventory) if (n >= 1) holders.set(item, (holders.get(item) ?? 0) + 1);
    const consumed = new Map<string, number>();
    for (const day of this.consumed) for (const [item, n] of Object.entries(day.items)) consumed.set(item, (consumed.get(item) ?? 0) + n);
    const verdict = detectCurrency(this.trades, holders, s.alive.length, consumed);
    if (verdict.item && (!this.currency || this.currency.item !== verdict.item)) {
      this.currency = { item: verdict.item, sinceTick: s.tick };
      this.engine.emit(makeEvent({ kind: "currency", tick: s.tick, label: verdict.item, importance: 8, data: { ...verdict }, tags: ["moneda", "trueque"] }));
    } else if (!verdict.item && this.currency) {
      const appearances = this.trades.filter((t) => this.currency!.item in t.gave || this.currency!.item in t.got).length;
      if (this.trades.length >= 10 && appearances / this.trades.length < 0.1) this.currency = null;
    }
    const week = this.trades.filter((t) => t.tick >= s.tick - s.config.time.ticksPerDay * 7);
    if (week.length >= 5) {
      this.prices = priceIndex(week, this.currency?.item ?? "comida");
      if (this.priceBaseline.size === 0) this.priceBaseline = new Map(this.prices);
      this.cpiValue = cpi(this.prices, this.priceBaseline);
    }
  }

  private detectReligions(): void {
    const s = this.s;
    const tpd = s.config.time.ticksPerDay;
    for (const g of this.groups.values()) {
      if (g.dissolvedTick !== null) continue;
      const members = membersAlive(s, g);
      if (members.length < 4) continue;
      const count = new Map<number, number>();
      for (const a of members) for (const [bid, conf] of a.beliefs) {
        const b = s.beliefs.get(bid);
        if (!b || conf < 0.4 || (b.kind !== "cosmologia" && b.kind !== "mito")) continue;
        count.set(bid, (count.get(bid) ?? 0) + 1);
      }
      let best: [number, number] | null = null;
      for (const [bid, n] of count) if (n / members.length >= 0.3 && (!best || n > best[1])) best = [bid, n];
      if (!best || this.religions.has(best[0])) continue;
      // institución ritual: decreto, o rezos repetidos en un mismo lugar
      const hasDecree = g.rituals.length > 0;
      let hasPlace = false;
      if (!hasDecree) {
        const memberIds = new Set(members.map((m) => m.id));
        const byCell = new Map<number, Map<number, Set<number>>>(); // celda → día → seres
        for (const r of this.rituals) {
          if (!memberIds.has(r.agentId)) continue;
          const day = Math.floor(r.tick / tpd);
          const cx = r.cell % s.grid.size;
          const cy = Math.floor(r.cell / s.grid.size);
          const key = Math.floor(cy / 4) * s.grid.size + Math.floor(cx / 4);
          const days = byCell.get(key) ?? byCell.set(key, new Map()).get(key)!;
          (days.get(day) ?? days.set(day, new Set()).get(day)!).add(r.agentId);
        }
        for (const days of byCell.values()) {
          const people = new Set<number>();
          for (const set of days.values()) for (const id of set) people.add(id);
          if (days.size >= 3 && people.size >= 5) hasPlace = true;
        }
      }
      if (!hasDecree && !hasPlace) continue;
      const belief = s.beliefs.get(best[0])!;
      const name = `la fe de ${g.name}`;
      this.religions.set(best[0], { beliefId: best[0], groupId: g.id, tick: s.tick, name });
      this.engine.emit(
        makeEvent({ kind: "religion", tick: s.tick, label: `${name}, que sostiene que ${belief.statement}`, importance: 9, data: { beliefId: best[0], groupId: g.id }, tags: ["religion", "fe", ...belief.explains] }),
      );
      for (const m of members) if ((m.beliefs.get(best[0]) ?? 0) >= 0.4) m.needs.sentido = clamp01(m.needs.sentido + 0.2);
    }
  }

  private expireLaws(): void {
    const s = this.s;
    const limit = s.config.time.ticksPerDay * 30;
    for (const law of this.laws.values()) {
      if (!law.active) continue;
      const g = this.groups.get(law.groupId);
      const declarerLeads = g && g.leaderId === law.declarerId && g.dissolvedTick === null;
      const unenforced = law.violations > law.enforcements && s.tick - Math.max(law.tick, law.lastEnforcedTick) > limit;
      if (!g || g.dissolvedTick !== null || (!declarerLeads && unenforced)) {
        law.active = false;
        this.engine.emit(makeEvent({ kind: "law", tick: s.tick, agentId: law.declarerId, label: `cayó en desuso: ${law.statement}`, importance: 4, data: { lawId: law.id, expired: true, enunciado: law.statement }, tags: ["norma"] }));
      }
    }
  }

  private scheduleRituals(): void {
    const s = this.s;
    for (const g of this.groups.values()) {
      if (g.dissolvedTick !== null) continue;
      for (const r of g.rituals) {
        if (s.clock.day - r.lastHeldDay < r.everyDays) continue;
        r.lastHeldDay = s.clock.day;
        const home = g.home ?? groupHome(s, g);
        if (!home) continue;
        for (const m of membersAlive(s, g)) {
          if (m.plan.some((p) => p.verbo === "ritual" && !p.done)) continue;
          m.plan.unshift({
            verbo: "ritual",
            objetivo: r.name,
            objetivoTipo: "lugar",
            targetId: null,
            targetX: home.x,
            targetY: home.y,
            cantidad: null,
            hastaHora: null,
            prioridad: 3,
            motivo: `hoy es ${r.name}`,
            done: false,
            attempts: 0,
            startAmount: null,
          });
        }
      }
    }
  }

  private weeklyIssues(): void {
    const s = this.s;
    for (const g of this.groups.values()) {
      if (g.dissolvedTick !== null || g.leaderId === null) continue;
      if ((s.clock.day + g.id) % 7 === 0) this.raiseIssue(g, "semanal", "revisar cómo está la tribu");
    }
  }

  private dailyMilestones(): void {
    const s = this.s;
    let written = 0;
    for (const t of s.texts.values()) if (t.medium === "escrito") written++;
    const ctx: DailyContext = {
      groups: [...this.groups.values()].filter((g) => g.dissolvedTick === null).length,
      religions: this.religions.size,
      currency: this.currency?.item ?? null,
      hungerDeathsLast3Days: this.hungerDeaths.length,
      sickLast3Days: this.sick.length,
      writtenTexts: written,
      laws: [...this.laws.values()].filter((l) => l.active).length,
    };
    for (const spec of MILESTONES) {
      if (!spec.daily || s.milestones.has(spec.key)) continue;
      const who = spec.daily(s, ctx);
      if (who) this.fireMilestone(spec.key, who);
    }
  }

  fireMilestone(key: string, agentIds: number[]): void {
    const s = this.s;
    const spec = MILESTONES.find((m) => m.key === key);
    if (!spec || s.milestones.has(key)) return;
    s.milestones.set(key, s.tick);
    const id = s.counters.milestone++;
    let epoch: string | null = null;
    if (spec.epoch && epochRank(spec.epoch) > epochRank(s.epoch)) {
      s.epoch = spec.epoch;
      epoch = spec.epoch;
    }
    const row: MilestoneInfo = { id, tick: s.tick, key, title: spec.title, description: spec.description, agentIds, epoch: epoch ?? s.epoch };
    this.milestoneRows.push(row);
    this.db?.insertMilestone({ id, tick: s.tick, key, title: spec.title, description: spec.description, agentIds, epoch: row.epoch });
    this.engine.emit(
      makeEvent({ kind: "milestone", tick: s.tick, agentId: agentIds[0] ?? null, label: key, importance: 9, data: { key, title: spec.title, description: spec.description, agentIds }, tags: ["hito"] }),
    );
    if (epoch) this.engine.emit(makeEvent({ kind: "epoch", tick: s.tick, label: epoch, importance: 9, data: { epoch, order: EPOCH_ORDER.indexOf(epoch as never) }, tags: ["epoca"] }));
  }

  // ------------------------------------------------------------ gobierno

  addLaw(g: Group, leader: Agent, statement: string, prohibits: Verb[], punishment: Law["punishment"], beliefId: number | null): Law {
    const law: Law = {
      id: this.lawCounter++,
      groupId: g.id,
      declarerId: leader.id,
      tick: this.s.tick,
      statement,
      prohibits,
      punishment,
      active: true,
      violations: 0,
      enforcements: 0,
      lastEnforcedTick: this.s.tick,
      beliefId,
    };
    this.laws.set(law.id, law);
    g.norms.push(statement);
    return law;
  }

  // ------------------------------------------------------------ info

  groupsInfo(): GroupInfo[] {
    return [...this.groups.values()]
      .filter((g) => g.dissolvedTick === null)
      .map((g) => ({ id: g.id, name: g.name, members: [...g.members], leaderId: g.leaderId, foundedTick: g.foundedTick, color: g.color, home: g.home }));
  }

  beliefsInfo(): BeliefInfo[] {
    const s = this.s;
    return [...s.beliefs.values()]
      .map((b) => ({
        id: b.id,
        statement: b.statement,
        kind: b.kind,
        founderId: b.founderId,
        founderName: b.founderId !== null ? (s.agents.get(b.founderId)?.name ?? null) : null,
        tick: b.tick,
        adherents: b.holders.size,
        religion: this.religions.has(b.id),
      }))
      .sort((p, q) => q.adherents - p.adherents);
  }

  lawsInfo(): LawInfo[] {
    const s = this.s;
    return [...this.laws.values()].map((l) => ({
      id: l.id,
      groupId: l.groupId,
      groupName: this.groups.get(l.groupId)?.name ?? "?",
      declarerId: l.declarerId,
      declarerName: s.agents.get(l.declarerId)?.name ?? "?",
      tick: l.tick,
      statement: l.statement,
      prohibits: l.prohibits,
      punishment: l.punishment,
      active: l.active,
      enforcements: l.enforcements,
    }));
  }

  techInfo(): TechInfo[] {
    const s = this.s;
    const known = new Map<string, number>();
    for (const id of s.alive) for (const t of s.agents.get(id)!.knows) known.set(t, (known.get(t) ?? 0) + 1);
    return TECH_TREE.map((t) => ({
      id: t.id,
      name: t.name,
      requires: t.requires,
      discoveredTick: s.milestones.get(`tech:${t.id}`) ?? null,
      discovererId: null,
      knownBy: known.get(t.id) ?? 0,
    }));
  }

  textsInfo(limit = 100): TextInfo[] {
    const s = this.s;
    return [...s.texts.values()]
      .sort((p, q) => q.tick - p.tick)
      .slice(0, limit)
      .map((t) => ({ id: t.id, authorId: t.authorId, authorName: t.authorId !== null ? (s.agents.get(t.authorId)?.name ?? "?") : "?", tick: t.tick, title: t.title, body: t.body, medium: t.medium, kind: t.kind, reads: t.reads }));
  }

  economyInfo(): EconomyInfo {
    const s = this.s;
    const week = s.tick - s.config.time.ticksPerDay * 7;
    const wealth = s.alive.map((id) => ({ id, name: s.agents.get(id)!.name, wealth: Math.round(wealthOf(s.agents.get(id)!.inventory as Map<string, number>) * 10) / 10 }));
    return {
      currency: this.currency?.item ?? null,
      currencySinceTick: this.currency?.sinceTick ?? null,
      prices: [...this.prices.entries()].map(([good, price]) => ({ good, price: Math.round(price * 100) / 100 })),
      cpi: Math.round(this.cpiValue * 100) / 100,
      gini: Math.round(gini(wealth.map((w) => w.wealth)) * 1000) / 1000,
      tradesLast7Days: this.trades.filter((t) => t.tick >= week).length,
      giftsLast7Days: [...this.netGifts.values()].filter((v) => v > 0).length,
      topHolders: wealth.sort((p, q) => q.wealth - p.wealth).slice(0, 5),
    };
  }

  milestonesInfo(): MilestoneInfo[] {
    return this.milestoneRows.slice(-100);
  }

  // ------------------------------------------------------------ persistencia

  private persist(): void {
    if (!this.db) return;
    const s = this.s;
    this.db.transaction(() => {
      for (const g of this.groups.values()) this.db!.upsertGroup({ id: g.id, name: g.name, foundedTick: g.foundedTick, dissolvedTick: g.dissolvedTick, leaderId: g.leaderId, members: [...g.members], color: g.color, data: { home: g.home, norms: g.norms, rituals: g.rituals } });
      for (const b of s.beliefs.values()) this.db!.upsertBelief({ id: b.id, founderId: b.founderId, tick: b.tick, statement: b.statement, kind: b.kind, parentId: b.parentId, explains: b.explains, active: b.holders.size > 0, data: { holders: b.holders.size, transmissions: b.transmissions, religion: this.religions.has(b.id) } });
    });
  }

  serialize(): SerializedSociety {
    return {
      groups: [...this.groups.values()].map((g) => ({ ...g, members: [...g.members], wars: [...g.wars], treaties: [...g.treaties], leaderStreak: [...g.leaderStreak.entries()], rituals: g.rituals.map((r) => ({ ...r })), norms: g.norms.slice() })),
      laws: [...this.laws.values()].map((l) => ({ ...l, prohibits: l.prohibits.slice() })),
      crimes: this.crimes.slice(-200),
      candidates: this.candidates,
      interactions: [...this.interactions.entries()],
      trades: this.trades,
      consumed: this.consumed,
      rituals: this.rituals,
      attacks: this.attacks,
      sleepLog: [...this.sleepLog.entries()],
      netGifts: [...this.netGifts.entries()],
      speeches: [...this.speeches.entries()],
      religions: [...this.religions.values()],
      currency: this.currency,
      priceBaseline: [...this.priceBaseline.entries()],
      prices: [...this.prices.entries()],
      cpi: this.cpiValue,
      issues: this.issues,
      milestoneRows: this.milestoneRows,
      hungerDeaths: this.hungerDeaths,
      sick: this.sick,
      counters: { law: this.lawCounter, crime: this.crimeCounter },
    };
  }

  restore(d: SerializedSociety): void {
    this.groups.clear();
    for (const g of d.groups) this.groups.set(g.id, { ...g, members: new Set(g.members), wars: new Set(g.wars), treaties: new Set(g.treaties), leaderStreak: new Map(g.leaderStreak) });
    this.laws.clear();
    for (const l of d.laws) this.laws.set(l.id, l);
    this.crimes = d.crimes;
    this.candidates = d.candidates;
    this.interactions = new Map(d.interactions);
    this.trades = d.trades;
    this.consumed = d.consumed;
    this.rituals = d.rituals;
    this.attacks = d.attacks;
    this.sleepLog = new Map(d.sleepLog);
    this.netGifts = new Map(d.netGifts);
    this.speeches = new Map(d.speeches);
    this.religions.clear();
    for (const r of d.religions) this.religions.set(r.beliefId, r);
    this.currency = d.currency;
    this.priceBaseline = new Map(d.priceBaseline);
    this.prices = new Map(d.prices);
    this.cpiValue = d.cpi;
    this.issues = d.issues;
    if (d.milestoneRows.length) this.milestoneRows = d.milestoneRows;
    this.hungerDeaths = d.hungerDeaths;
    this.sick = d.sick;
    this.lawCounter = d.counters.law;
    this.crimeCounter = d.counters.crime;
  }
}

/** Sembrar una norma como creencia en la mente del líder y de quienes lo oyen. */
export function seedNorm(s: EngineState, leader: Agent, statement: string, listeners: Agent[]): number {
  const { belief } = holdBelief(s, leader, { statement, kind: "norma", confidence: 0.8, explains: ["norma", "crimen"] });
  for (const l of listeners) {
    const trust = l.relationships.get(leader.id)?.trust ?? 0.3;
    holdBelief(s, l, { statement: belief.statement, kind: "norma", confidence: 0.3 + 0.5 * trust, explains: belief.explains, founderId: leader.id });
  }
  return belief.id;
}
