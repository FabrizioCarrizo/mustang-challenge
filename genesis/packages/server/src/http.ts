import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { ClientMessage, CostInfo, SnapshotListItem } from "@genesis/protocol";
import { describeEvent, type WorldEvent } from "@genesis/engine";
import { Broadcaster, type WsClient } from "./broadcaster.ts";
import { agentDetail, agentSummary, climateInfo, clockInfo, memoryInfo, worldInfo } from "./mappers.ts";
import type { Runner } from "./runner.ts";

export interface ServerExtensions {
  /** manejador de acciones de dios (fase 5) */
  god?: (action: Extract<ClientMessage, { t: "god" }>["action"]) => { ok: boolean; message?: string };
  /** rutas adicionales (sociedad, crónica, costo) */
  routes?: (app: FastifyInstance) => void;
  cost?: () => CostInfo;
  replay?: (toTick: number | null) => void;
}

const here = dirname(fileURLToPath(import.meta.url));

export async function createHttpServer(runner: Runner, broadcaster: Broadcaster, ext: ServerExtensions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  const dist = join(here, "..", "..", "dashboard", "dist");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: "/" });
  } else {
    app.get("/", async () => "GÉNESIS server. El dashboard no está compilado: corré `npm run dev` (Vite) o `npm run build`.");
  }
  const e = () => runner.engine;

  app.get("/api/health", async () => ({ ok: true, tick: runner.tick }));

  app.get("/api/world", async () => ({
    world: worldInfo(e()),
    clock: clockInfo(e().s.clock),
    climate: climateInfo(e()),
    pacing: runner.pacing(),
    budget: runner.budget(),
    epoch: e().s.epoch,
    population: e().s.alive.length,
    totals: e().s.totals,
    clients: broadcaster.clientCount,
  }));

  app.get<{ Querystring: { alive?: string } }>("/api/agents", async (req) => {
    const onlyAlive = req.query.alive !== "0";
    const out = [];
    for (const a of e().s.agents.values()) {
      if (onlyAlive && a.diedTick !== null) continue;
      out.push(agentSummary(a, e()));
    }
    return out;
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const a = e().s.agents.get(Number(req.params.id));
    if (!a) return reply.code(404).send({ error: "no existe ese ser" });
    return agentDetail(a, e(), broadcaster.groupNameOf?.(a.id) ?? null);
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string; q?: string; kind?: string } }>("/api/agents/:id/memories", async (req, reply) => {
    const id = Number(req.params.id);
    const a = e().s.agents.get(id);
    if (!a) return reply.code(404).send({ error: "no existe ese ser" });
    const limit = Math.min(500, Number(req.query.limit ?? 100));
    if (req.query.q || req.query.kind) {
      return runner.db.memoriesOf(id, { limit, query: req.query.q, kind: req.query.kind }).map(memoryInfo);
    }
    // memoria de trabajo viva + lo persistido más antiguo
    const live = a.memories.slice(-limit).reverse().map(memoryInfo);
    if (live.length >= limit) return live;
    const minId = live.length ? Math.min(...live.map((m) => m.id)) : Number.MAX_SAFE_INTEGER;
    const older = runner.db.memoriesOf(id, { limit: limit - live.length }).filter((m) => m.id < minId).map(memoryInfo);
    return live.concat(older);
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/agents/:id/events", async (req) => {
    const id = Number(req.params.id);
    const rows = runner.db.events({ agentId: id, limit: Math.min(500, Number(req.query.limit ?? 100)), order: "desc" });
    return rows.map((r) => ({
      seq: r.seq,
      tick: r.tick,
      kind: r.kind,
      importance: r.importance,
      text: describeEvent(rowToEvent(r), e().names),
      agentId: r.agent_id,
      targetId: r.target_id,
      x: r.x,
      y: r.y,
    }));
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/agents/:id/llm-calls", async (req) => {
    const id = Number(req.params.id);
    return runner.db.llmCallsOf(id, Math.min(100, Number(req.query.limit ?? 20))).map((r) => ({
      id: Number(r.id),
      tick: Number(r.tick),
      callType: String(r.call_type),
      model: String(r.model),
      status: String(r.status),
      usd: Number(r.usd),
      inTokens: Number(r.in_tokens),
      cacheRead: Number(r.cache_read),
      outTokens: Number(r.out_tokens),
      latencyMs: Number(r.latency_ms),
      volatileText: (r.volatile_text as string | null) ?? null,
      responseJson: (r.response_json as string | null) ?? null,
    }));
  });

  app.get<{ Querystring: { from?: string; to?: string; kind?: string; min?: string; limit?: string; agent?: string } }>("/api/events", async (req) => {
    const rows = runner.db.events({
      from: req.query.from !== undefined ? Number(req.query.from) : undefined,
      to: req.query.to !== undefined ? Number(req.query.to) : undefined,
      kind: req.query.kind,
      minImportance: req.query.min !== undefined ? Number(req.query.min) : undefined,
      agentId: req.query.agent !== undefined ? Number(req.query.agent) : undefined,
      limit: Math.min(1000, Number(req.query.limit ?? 200)),
      order: "desc",
    });
    return rows.map((r) => ({
      seq: r.seq,
      tick: r.tick,
      kind: r.kind,
      importance: r.importance,
      text: describeEvent(rowToEvent(r), e().names),
      agentId: r.agent_id,
      targetId: r.target_id,
      x: r.x,
      y: r.y,
    }));
  });

  app.get("/api/events/recent", async () => broadcaster.recentEvents.slice(-200));

  app.get<{ Querystring: { from?: string; to?: string; limit?: string } }>("/api/metrics", async (req) =>
    runner.db.metrics({
      from: req.query.from !== undefined ? Number(req.query.from) : undefined,
      to: req.query.to !== undefined ? Number(req.query.to) : undefined,
      limit: Math.min(5000, Number(req.query.limit ?? 288)),
    }),
  );

  app.get("/api/milestones", async () => runner.society.milestonesInfo());

  app.get("/api/society/groups", async () => runner.society.groupsInfo());
  app.get("/api/society/leaders", async () =>
    runner.society
      .groupsInfo()
      .filter((g) => g.leaderId !== null)
      .map((g) => ({ groupId: g.id, groupName: g.name, leaderId: g.leaderId, leaderName: e().names.name(g.leaderId), members: g.members.length })),
  );
  app.get("/api/society/economy", async () => runner.society.economyInfo());
  app.get("/api/society/beliefs", async () => runner.society.beliefsInfo());
  app.get("/api/society/tech", async () => runner.society.techInfo());
  app.get("/api/society/laws", async () => runner.society.lawsInfo());
  app.get<{ Querystring: { limit?: string } }>("/api/society/texts", async (req) => runner.society.textsInfo(Math.min(500, Number(req.query.limit ?? 100))));
  app.get("/api/society/crimes", async () =>
    runner.society.crimes.slice(-100).map((c) => ({
      id: c.id,
      tick: c.tick,
      criminalId: c.criminalId,
      criminalName: e().names.name(c.criminalId),
      victimId: c.victimId,
      victimName: c.victimId !== null ? e().names.name(c.victimId) : null,
      verb: c.verb,
      punished: c.punished,
      lawId: c.lawId,
      groupId: c.groupId,
    })),
  );

  app.get("/api/snapshots", async (): Promise<SnapshotListItem[]> =>
    runner.db.listSnapshots().map((r) => ({ tick: r.tick, bytes: r.bytes, agents: r.agents, hash: r.state_hash, createdAt: r.created_at })),
  );

  app.get("/api/cost", async () => ext.cost?.() ?? runner.brain?.costInfo() ?? emptyCost());

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/agents/:id/conversations", async (req) => {
    const id = Number(req.params.id);
    return runner.db.conversationsOf(id, Math.min(100, Number(req.query.limit ?? 20))).map((r) => ({
      id: Number(r.id),
      tick: Number(r.tick),
      aId: Number(r.a_id),
      bId: Number(r.b_id),
      aName: e().names.name(Number(r.a_id)),
      bName: e().names.name(Number(r.b_id)),
      turns: JSON.parse(String(r.turns)),
      outcomes: JSON.parse(String(r.outcomes)),
    }));
  });

  app.post<{ Body: { action: string; value?: number | string } }>("/api/control", async (req) => {
    applyControl(runner, req.body.action, req.body.value);
    return { ok: true, pacing: runner.pacing() };
  });

  app.post<{ Body: { action: Extract<ClientMessage, { t: "god" }>["action"] } }>("/api/god", async (req, reply) => {
    if (!ext.god) return reply.code(501).send({ ok: false, message: "los poderes divinos llegan en la fase 5" });
    return ext.god(req.body.action);
  });

  ext.routes?.(app);

  app.get("/ws", { websocket: true }, (socket) => {
    const client: WsClient = {
      send: (data) => {
        if (socket.readyState === 1) socket.send(data);
      },
      focusAgentId: null,
      alive: true,
      bufferedAmount: () => socket.bufferedAmount,
    };
    broadcaster.addClient(client);
    socket.on("message", (raw: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        client.send(JSON.stringify({ t: "error", message: "mensaje inválido" }));
        return;
      }
      switch (msg.t) {
        case "hello":
          client.send(JSON.stringify(broadcaster.snapshotMessage()));
          break;
        case "ping":
          client.send(JSON.stringify({ t: "pong" }));
          break;
        case "control":
          applyControl(runner, msg.action, msg.value);
          break;
        case "subscribe":
          client.focusAgentId = msg.agentId;
          break;
        case "god": {
          const r = ext.god?.(msg.action) ?? { ok: false, message: "los poderes divinos llegan en la fase 5" };
          client.send(JSON.stringify({ t: "notice", level: r.ok ? "info" : "warn", text: r.message ?? (r.ok ? "Hecho" : "No se pudo") }));
          break;
        }
        case "replay":
          ext.replay?.(msg.toTick);
          break;
      }
    });
    socket.on("close", () => {
      client.alive = false;
      broadcaster.removeClient(client);
    });
  });

  return app;
}

export function applyControl(runner: Runner, action: string, value?: number | string): void {
  switch (action) {
    case "pause":
      runner.pause();
      break;
    case "play":
      runner.start();
      break;
    case "speed":
      runner.setMultiplier(Number(value ?? 1));
      if (runner.paused) runner.start();
      break;
    case "preset":
      runner.setPreset(String(value ?? "cronica"));
      break;
  }
}

function emptyCost(): CostInfo {
  return { totalUsd: 0, calls: 0, inTokens: 0, cacheRead: 0, outTokens: 0, cacheHitRate: 0, usdPerSimDay: 0, byType: [] };
}

function rowToEvent(r: { tick: number; kind: string; agent_id: number | null; target_id: number | null; x: number | null; y: number | null; importance: number; label: string; tags: string[]; payload: Record<string, unknown> }): WorldEvent {
  return {
    kind: r.kind as WorldEvent["kind"],
    tick: r.tick,
    agentId: r.agent_id,
    targetId: r.target_id,
    x: r.x,
    y: r.y,
    importance: r.importance,
    label: r.label,
    data: r.payload,
    persist: true,
    tags: r.tags,
  };
}
