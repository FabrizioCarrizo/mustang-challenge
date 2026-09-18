import type { AgentSummary, DeltaMessage, EventInfo, MetricsPoint, ResourceKind, ServerMessage, SnapshotMessage, SpeechInfo, StructureInfo } from "@genesis/protocol";
import { RESOURCES } from "@genesis/protocol";
import type { Engine, TickOutput } from "@genesis/engine";
import type { Runner } from "./runner.ts";
import { agentDetail, agentSummary, climateInfo, clockInfo, eventInfo, quantizeCell, quantizeResources, structureInfo, worldInfo } from "./mappers.ts";

export interface WsClient {
  send(data: string): void;
  focusAgentId: number | null;
  alive: boolean;
  /** si está viendo el pasado, no recibe deltas del presente */
  replayTick: number | null;
  bufferedAmount?: () => number;
}

/** Junta lo que cambió entre envíos y lo manda en deltas coalescidos (≤ 10/s). */
export class Broadcaster {
  private clients = new Set<WsClient>();
  private lastSent = new Map<number, string>();
  private pendingAgents = new Set<number>();
  private removed: number[] = [];
  private resourceCells = new Set<number>();
  private structures = new Map<number, StructureInfo>();
  private removedStructures: number[] = [];
  private events: EventInfo[] = [];
  private speech: SpeechInfo[] = [];
  private metrics: MetricsPoint | null = null;
  private milestonesDirty = false;
  private groupsDirty = false;
  private timer: NodeJS.Timeout | null = null;
  private eventSeq = 0;
  /** proveedores opcionales de datos sociales (fases posteriores) */
  groupsProvider: (() => SnapshotMessage["groups"]) | null = null;
  milestonesProvider: (() => SnapshotMessage["milestones"]) | null = null;
  groupNameOf: ((agentId: number) => string | null) | null = null;
  recentEvents: EventInfo[] = [];

  constructor(private readonly runner: Runner) {
    runner.on("tick", (out) => this.onTick(out));
    runner.on("notice", (n) => this.broadcast({ t: "notice", level: n.level, text: n.text }));
    this.groupsProvider = () => runner.society.groupsInfo();
    this.milestonesProvider = () => runner.society.milestonesInfo();
    this.groupNameOf = (id) => runner.society.groupNameOf(id);
    this.timer = setInterval(() => this.flush(), 100);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
  }

  addClient(c: WsClient): void {
    this.clients.add(c);
    c.send(JSON.stringify(this.snapshotMessage()));
  }

  removeClient(c: WsClient): void {
    this.clients.delete(c);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients) if (c.alive) c.send(data);
  }

  markMilestones(): void {
    this.milestonesDirty = true;
  }

  markGroups(): void {
    this.groupsDirty = true;
  }

  pushSpeech(s: SpeechInfo): void {
    this.speech.push(s);
  }

  snapshotMessage(): SnapshotMessage {
    return this.snapshotFrom(this.runner.engine);
  }

  /** Snapshot de cualquier motor (el vivo o uno de replay). */
  snapshotFrom(e: Engine): SnapshotMessage {
    const agents: AgentSummary[] = [];
    for (const a of e.s.agents.values()) {
      if (a.diedTick !== null && e.s.tick - a.diedTick > e.config.time.ticksPerDay) continue;
      agents.push(agentSummary(a, e));
    }
    const structures = [...e.s.structures.values()].map(structureInfo);
    return {
      t: "snapshot",
      world: worldInfo(e),
      clock: clockInfo(e.s.clock),
      climate: climateInfo(e),
      terrain: Buffer.from(e.s.grid.terrain).toString("base64"),
      resources: quantizeResources(e),
      structures,
      agents,
      groups: this.groupsProvider?.() ?? [],
      milestones: this.milestonesProvider?.() ?? [],
      metrics: this.runner.db.metrics({ limit: 288 }),
      budget: this.runner.budget(),
      pacing: this.runner.pacing(),
      epoch: e.s.epoch,
    };
  }

  private onTick(out: TickOutput): void {
    const e = this.runner.engine;
    for (const id of e.s.alive) this.pendingAgents.add(id);
    for (const id of out.deaths) {
      this.pendingAgents.add(id);
      this.removed.push(id);
    }
    for (const c of out.resourceChanges) this.resourceCells.add(c);
    for (const id of out.structuresChanged) {
      const st = e.s.structures.get(id);
      if (st) this.structures.set(id, structureInfo(st));
    }
    for (const id of out.removedStructures) {
      this.structures.delete(id);
      this.removedStructures.push(id);
    }
    for (const ev of out.events) {
      if (ev.kind === "structure.built" || ev.kind === "fire.lit" || ev.kind === "fire.out") {
        const sid = ev.data.structureId as number | undefined;
        const st = sid !== undefined ? e.s.structures.get(sid) : undefined;
        if (st) this.structures.set(st.id, structureInfo(st));
      }
      if (ev.kind === "speech" && ev.agentId !== null) {
        this.speech.push({ agentId: ev.agentId, text: String(ev.data.texto ?? ""), tick: ev.tick });
      }
      if (ev.importance >= 5 || ev.kind === "structure.built" || ev.kind === "discovery") {
        const info = eventInfo(ev, ++this.eventSeq, e);
        this.events.push(info);
        this.recentEvents.push(info);
        if (this.recentEvents.length > 300) this.recentEvents.shift();
      }
      if (ev.kind === "milestone" || ev.kind === "epoch") this.milestonesDirty = true;
      if (ev.kind === "group" || ev.kind === "leader") this.groupsDirty = true;
    }
    if (out.metrics) this.metrics = out.metrics;
    // en la muerte, las estructuras del muerto no cambian; los seres muertos salen del mapa tras un día
  }

  flush(): void {
    if (this.clients.size === 0) {
      this.pendingAgents.clear();
      this.removed = [];
      this.resourceCells.clear();
      this.structures.clear();
      this.removedStructures = [];
      this.events = [];
      this.speech = [];
      this.metrics = null;
      return;
    }
    const e = this.runner.engine;
    const agents: AgentSummary[] = [];
    for (const id of this.pendingAgents) {
      const a = e.s.agents.get(id);
      if (!a) continue;
      const summary = agentSummary(a, e);
      const key = `${summary.x},${summary.y},${summary.st},${summary.act},${summary.hp},${summary.g},${summary.alive}`;
      if (this.lastSent.get(id) !== key) {
        this.lastSent.set(id, key);
        agents.push(summary);
      }
    }
    this.pendingAgents.clear();
    const resources: Array<[number, ResourceKind, number]> = [];
    for (const cell of this.resourceCells) {
      for (const r of RESOURCES) {
        if (e.s.grid.resourceMax[r][cell]! > 0 || e.s.grid.resources[r][cell]! > 0) resources.push([cell, r, quantizeCell(e, cell, r)]);
      }
    }
    this.resourceCells.clear();
    const nothing =
      agents.length === 0 &&
      this.removed.length === 0 &&
      resources.length === 0 &&
      this.structures.size === 0 &&
      this.removedStructures.length === 0 &&
      this.events.length === 0 &&
      this.speech.length === 0 &&
      !this.metrics &&
      !this.milestonesDirty &&
      !this.groupsDirty;
    const base = {
      tick: e.s.tick,
      clock: clockInfo(e.s.clock),
      climate: climateInfo(e),
      agents,
      removed: this.removed,
      resources,
      structures: [...this.structures.values()],
      removedStructures: this.removedStructures,
      events: this.events,
      speech: this.speech,
      metrics: this.metrics,
      groups: this.groupsDirty ? (this.groupsProvider?.() ?? []) : null,
      milestones: this.milestonesDirty ? (this.milestonesProvider?.() ?? []) : [],
      budget: this.runner.budget(),
      pacing: this.runner.pacing(),
      epoch: this.milestonesDirty ? e.s.epoch : null,
    };
    this.removed = [];
    this.structures.clear();
    this.removedStructures = [];
    this.events = [];
    this.speech = [];
    this.metrics = null;
    this.milestonesDirty = false;
    this.groupsDirty = false;
    for (const c of this.clients) {
      if (!c.alive || c.replayTick !== null) continue;
      if (c.bufferedAmount && c.bufferedAmount() > 4_000_000) {
        // cliente saturado: se le manda un snapshot completo cuando se descongestione
        c.send(JSON.stringify({ t: "notice", level: "warn", text: "conexión saturada: resincronizando" }));
        continue;
      }
      let focus: DeltaMessage["focus"] = null;
      if (c.focusAgentId !== null) {
        const a = e.s.agents.get(c.focusAgentId);
        if (a) focus = agentDetail(a, e, this.groupNameOf?.(a.id) ?? null);
      }
      if (nothing && !focus) continue;
      const msg: DeltaMessage = { t: "delta", ...base, focus };
      c.send(JSON.stringify(msg));
    }
  }
}
