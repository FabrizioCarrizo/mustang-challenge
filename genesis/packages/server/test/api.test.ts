import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createWorld } from "@genesis/engine";
import type { DeltaMessage, SnapshotMessage } from "@genesis/protocol";
import { Broadcaster } from "../src/broadcaster.ts";
import { createHttpServer } from "../src/http.ts";
import { Runner } from "../src/runner.ts";

let dir: string;
let runner: Runner;
let broadcaster: Broadcaster;
let app: Awaited<ReturnType<typeof createHttpServer>>;
let port: number;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "genesis-api-"));
  const w = createWorld(dir, "api", 11, { world: { size: 64, initialPopulation: 12 } });
  runner = new Runner(w, { multiplier: 1, simDayRealSeconds: 10 });
  runner.runDays(1);
  broadcaster = new Broadcaster(runner);
  app = await createHttpServer(runner, broadcaster);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});

afterAll(async () => {
  broadcaster.close();
  await app.close();
  await runner.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("API", () => {
  it("responde el estado del mundo", async () => {
    const res = await app.inject({ method: "GET", url: "/api/world" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.world.size).toBe(64);
    expect(body.population).toBe(12);
    expect(body.clock.day).toBe(1);
  });

  it("lista y detalla seres", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/agents" })).json();
    expect(list.length).toBe(12);
    const id = list[0].id;
    const detail = (await app.inject({ method: "GET", url: `/api/agents/${id}` })).json();
    expect(detail.name).toBe(list[0].name);
    expect(Object.keys(detail.needs)).toContain("sentido");
    const memories = (await app.inject({ method: "GET", url: `/api/agents/${id}/memories?limit=10` })).json();
    expect(Array.isArray(memories)).toBe(true);
    const missing = await app.inject({ method: "GET", url: "/api/agents/99999" });
    expect(missing.statusCode).toBe(404);
  });

  it("devuelve métricas y eventos", async () => {
    const metrics = (await app.inject({ method: "GET", url: "/api/metrics?limit=50" })).json();
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0].population).toBeGreaterThan(0);
    const events = (await app.inject({ method: "GET", url: "/api/events?limit=20" })).json();
    expect(Array.isArray(events)).toBe(true);
  });

  it("controla el ritmo", async () => {
    const res = await app.inject({ method: "POST", url: "/api/control", payload: { action: "speed", value: 4 } });
    expect(res.json().pacing.multiplier).toBe(4);
    runner.pause();
    expect(runner.pacing().paused).toBe(true);
  });

  it("manda un snapshot por WebSocket y luego deltas", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: Array<SnapshotMessage | DeltaMessage> = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("sin mensajes")), 5000);
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.t === "snapshot" || msg.t === "delta") messages.push(msg);
        if (messages.length === 1) {
          ws.send(JSON.stringify({ t: "subscribe", agentId: runner.engine.s.alive[0] }));
          runner.step();
          runner.step();
        }
        if (messages.length >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      });
      ws.on("error", reject);
    });
    ws.close();
    const snap = messages[0] as SnapshotMessage;
    expect(snap.t).toBe("snapshot");
    expect(Buffer.from(snap.terrain, "base64").length).toBe(64 * 64);
    expect(snap.agents.length).toBe(12);
    const delta = messages[1] as DeltaMessage;
    expect(delta.t).toBe("delta");
    expect(delta.focus?.id).toBe(runner.engine.s.alive[0]);
  });
});
