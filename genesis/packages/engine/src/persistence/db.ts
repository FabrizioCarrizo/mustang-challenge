import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MetricsPoint } from "@genesis/protocol";
import type { Agent, Memory } from "../agents/agent.ts";
import type { GenesisConfig } from "../config.ts";
import type { WorldEvent } from "../sim/events.ts";
import type { SnapshotData } from "../sim/snapshot.ts";
import { openDriver, type SqlDriver } from "./driver.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

export interface SnapshotRow {
  tick: number;
  path: string;
  bytes: number;
  agents: number;
  state_hash: string;
  created_at: string;
}

export interface EventRow {
  seq: number;
  tick: number;
  kind: string;
  agent_id: number | null;
  target_id: number | null;
  x: number | null;
  y: number | null;
  importance: number;
  label: string;
  tags: string[];
  payload: Record<string, unknown>;
}

export interface LlmCallRow {
  tick: number;
  agentId: number | null;
  callType: string;
  provider: string;
  model: string;
  inTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outTokens: number;
  usd: number;
  latencyMs: number;
  status: string;
  promptHash: string | null;
  volatileText: string | null;
  responseJson: string | null;
}

export function worldPaths(worldsDir: string, name: string): { dir: string; db: string; snapshots: string } {
  const dir = join(worldsDir, name);
  return { dir, db: join(dir, "world.sqlite"), snapshots: join(dir, "snapshots") };
}

/** Base de datos de un mundo: eventos, memorias, snapshots y proyecciones. */
export class WorldDb {
  private constructor(
    readonly driver: SqlDriver,
    readonly dir: string,
  ) {}

  static open(dbPath: string): WorldDb {
    mkdirSync(dirname(dbPath), { recursive: true });
    const driver = openDriver(dbPath);
    driver.exec(SCHEMA_SQL);
    const db = new WorldDb(driver, dirname(dbPath));
    const v = db.getMeta("schema_version");
    if (v === null) db.setMeta("schema_version", String(SCHEMA_VERSION));
    return db;
  }

  static exists(dbPath: string): boolean {
    return existsSync(dbPath);
  }

  close(): void {
    this.driver.close();
  }

  transaction<T>(fn: () => T): T {
    return this.driver.transaction(fn);
  }

  // ---------------------------------------------------------------- meta

  getMeta(key: string): string | null {
    const row = this.driver.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row ? (row.value as string) : null;
  }

  setMeta(key: string, value: string): void {
    this.driver.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  initWorld(info: { name: string; seed: number; config: GenesisConfig }): void {
    this.setMeta("world_name", info.name);
    this.setMeta("seed", String(info.seed));
    this.setMeta("config", JSON.stringify(info.config));
    this.setMeta("created_at", new Date().toISOString());
  }

  worldInfo(): { name: string; seed: number; config: GenesisConfig } | null {
    const name = this.getMeta("world_name");
    const seed = this.getMeta("seed");
    const config = this.getMeta("config");
    if (!name || !seed || !config) return null;
    return { name, seed: Number(seed), config: JSON.parse(config) as GenesisConfig };
  }

  // ---------------------------------------------------------------- eventos

  insertEvents(events: WorldEvent[]): number[] {
    const st = this.driver.prepare(
      "INSERT INTO events(tick, kind, agent_id, target_id, x, y, importance, label, tags, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const seqs: number[] = [];
    for (const e of events) {
      if (!e.persist) {
        seqs.push(-1);
        continue;
      }
      const r = st.run(e.tick, e.kind, e.agentId, e.targetId, e.x, e.y, e.importance, e.label, JSON.stringify(e.tags), JSON.stringify(e.data));
      seqs.push(Number(r.lastInsertRowid));
    }
    return seqs;
  }

  events(opts: { from?: number; to?: number; kind?: string; agentId?: number; minImportance?: number; limit?: number; order?: "asc" | "desc" } = {}): EventRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.from !== undefined) {
      where.push("tick >= ?");
      params.push(opts.from);
    }
    if (opts.to !== undefined) {
      where.push("tick <= ?");
      params.push(opts.to);
    }
    if (opts.kind) {
      where.push("kind = ?");
      params.push(opts.kind);
    }
    if (opts.agentId !== undefined) {
      where.push("(agent_id = ? OR target_id = ?)");
      params.push(opts.agentId, opts.agentId);
    }
    if (opts.minImportance !== undefined) {
      where.push("importance >= ?");
      params.push(opts.minImportance);
    }
    const sql = `SELECT * FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq ${opts.order === "desc" ? "DESC" : "ASC"} LIMIT ?`;
    params.push(opts.limit ?? 500);
    return this.driver.prepare(sql).all(...params).map(rowToEvent);
  }

  countEvents(): number {
    return Number(this.driver.prepare("SELECT COUNT(*) AS n FROM events").get()!.n);
  }

  deleteAfterTick(tick: number): void {
    this.transaction(() => {
      this.driver.prepare("DELETE FROM events WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM memories WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM metrics WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM conversations WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM trades WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM milestones WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM llm_calls WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM texts WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM beliefs WHERE tick > ?").run(tick);
      this.driver.prepare("DELETE FROM chronicle WHERE tick_to > ?").run(tick);
    });
  }

  // ---------------------------------------------------------------- memorias

  insertMemories(items: Array<{ agentId: number; memory: Memory }>): void {
    if (items.length === 0) return;
    const st = this.driver.prepare(
      "INSERT OR REPLACE INTO memories(id, agent_id, tick, kind, text, importance, tags, refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const { agentId, memory: m } of items) {
      st.run(m.id, agentId, m.tick, m.kind, m.text, m.importance, JSON.stringify(m.tags), JSON.stringify(m.refs));
    }
  }

  memoriesOf(agentId: number, opts: { limit?: number; kind?: string; query?: string; before?: number } = {}): Memory[] {
    const limit = opts.limit ?? 100;
    let rows: Record<string, unknown>[];
    if (opts.query) {
      rows = this.driver
        .prepare(
          `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid
           WHERE f.memories_fts MATCH ? AND m.agent_id = ? ORDER BY m.tick DESC LIMIT ?`,
        )
        .all(ftsQuery(opts.query), agentId, limit);
    } else if (opts.kind) {
      rows = this.driver
        .prepare("SELECT * FROM memories WHERE agent_id = ? AND kind = ? AND tick <= ? ORDER BY tick DESC LIMIT ?")
        .all(agentId, opts.kind, opts.before ?? Number.MAX_SAFE_INTEGER, limit);
    } else {
      rows = this.driver
        .prepare("SELECT * FROM memories WHERE agent_id = ? AND tick <= ? ORDER BY tick DESC LIMIT ?")
        .all(agentId, opts.before ?? Number.MAX_SAFE_INTEGER, limit);
    }
    return rows.map(rowToMemory);
  }

  // ---------------------------------------------------------------- proyecciones

  upsertAgents(agents: Iterable<Agent>, tick: number): void {
    const st = this.driver.prepare(
      `INSERT INTO agents(id, name, sex, born_tick, died_tick, cause_of_death, parents, genome, cultural_genome, group_id, last_state, updated_tick)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET died_tick = excluded.died_tick, cause_of_death = excluded.cause_of_death,
         cultural_genome = excluded.cultural_genome, group_id = excluded.group_id, last_state = excluded.last_state, updated_tick = excluded.updated_tick`,
    );
    for (const a of agents) {
      const lastState = {
        x: a.x,
        y: a.y,
        health: a.health,
        needs: a.needs,
        inventory: [...a.inventory.entries()],
        home: a.home,
        knows: [...a.knows],
        children: a.children,
        bondedTo: a.bondedTo,
      };
      st.run(
        a.id,
        a.name,
        a.sex,
        a.bornTick,
        a.diedTick,
        a.causeOfDeath,
        JSON.stringify(a.parents),
        JSON.stringify(a.genome),
        a.culturalGenome,
        a.groupId,
        JSON.stringify(lastState),
        tick,
      );
    }
  }

  agentRows(): Record<string, unknown>[] {
    return this.driver.prepare("SELECT id, name, sex, born_tick, died_tick, cause_of_death, parents, group_id FROM agents ORDER BY id").all();
  }

  insertMetrics(point: MetricsPoint): void {
    this.driver.prepare("INSERT OR REPLACE INTO metrics(tick, json) VALUES (?, ?)").run(point.tick, JSON.stringify(point));
  }

  metrics(opts: { from?: number; to?: number; limit?: number } = {}): MetricsPoint[] {
    const rows = this.driver
      .prepare("SELECT json FROM metrics WHERE tick >= ? AND tick <= ? ORDER BY tick DESC LIMIT ?")
      .all(opts.from ?? 0, opts.to ?? Number.MAX_SAFE_INTEGER, opts.limit ?? 288);
    return rows.map((r) => JSON.parse(r.json as string) as MetricsPoint).reverse();
  }

  insertLlmCall(row: LlmCallRow): void {
    this.driver
      .prepare(
        `INSERT INTO llm_calls(tick, agent_id, call_type, provider, model, in_tokens, cache_read, cache_write, out_tokens, usd, latency_ms, status, prompt_hash, volatile_text, response_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.tick,
        row.agentId,
        row.callType,
        row.provider,
        row.model,
        row.inTokens,
        row.cacheRead,
        row.cacheWrite,
        row.outTokens,
        row.usd,
        row.latencyMs,
        row.status,
        row.promptHash,
        row.volatileText,
        row.responseJson,
        new Date().toISOString(),
      );
  }

  llmCallsOf(agentId: number, limit = 20): Record<string, unknown>[] {
    return this.driver.prepare("SELECT * FROM llm_calls WHERE agent_id = ? ORDER BY id DESC LIMIT ?").all(agentId, limit);
  }

  llmTotals(): { calls: number; usd: number; inTokens: number; cacheRead: number; outTokens: number } {
    const r = this.driver
      .prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(usd),0) AS usd, COALESCE(SUM(in_tokens),0) AS i, COALESCE(SUM(cache_read),0) AS c, COALESCE(SUM(out_tokens),0) AS o FROM llm_calls")
      .get()!;
    return { calls: Number(r.calls), usd: Number(r.usd), inTokens: Number(r.i), cacheRead: Number(r.c), outTokens: Number(r.o) };
  }

  // ---------------------------------------------------------------- snapshots

  saveSnapshot(data: SnapshotData, stateHash: string): SnapshotRow {
    const dir = join(this.dir, "snapshots");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `tick-${String(data.tick).padStart(9, "0")}.snap.gz`);
    const buf = gzipSync(Buffer.from(JSON.stringify(data)));
    writeFileSync(path, buf);
    const row: SnapshotRow = {
      tick: data.tick,
      path,
      bytes: buf.byteLength,
      agents: data.agents.filter((a) => a.diedTick === null).length,
      state_hash: stateHash,
      created_at: new Date().toISOString(),
    };
    this.driver
      .prepare("INSERT OR REPLACE INTO snapshots(tick, path, bytes, agents, state_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.tick, row.path, row.bytes, row.agents, row.state_hash, row.created_at);
    return row;
  }

  loadSnapshot(tick: number): SnapshotData {
    const row = this.driver.prepare("SELECT * FROM snapshots WHERE tick = ?").get(tick) as SnapshotRow | undefined;
    if (!row) throw new Error(`No hay snapshot en el tick ${tick}`);
    return JSON.parse(gunzipSync(readFileSync(row.path)).toString("utf8")) as SnapshotData;
  }

  latestSnapshot(): SnapshotRow | null {
    return (this.driver.prepare("SELECT * FROM snapshots ORDER BY tick DESC LIMIT 1").get() as SnapshotRow | undefined) ?? null;
  }

  snapshotAtOrBefore(tick: number): SnapshotRow | null {
    return (this.driver.prepare("SELECT * FROM snapshots WHERE tick <= ? ORDER BY tick DESC LIMIT 1").get(tick) as SnapshotRow | undefined) ?? null;
  }

  listSnapshots(): SnapshotRow[] {
    return this.driver.prepare("SELECT * FROM snapshots ORDER BY tick ASC").all() as unknown as SnapshotRow[];
  }

  /** Conserva los últimos `keepDaily` snapshots y, más atrás, uno de cada `every`. */
  thinSnapshots(keepDaily: number, every: number, ticksPerDay: number): number {
    const rows = this.listSnapshots();
    const cutoff = rows.length - keepDaily;
    let removed = 0;
    for (let i = 0; i < cutoff; i++) {
      const r = rows[i]!;
      const day = Math.floor(r.tick / ticksPerDay);
      if (r.tick === 0 || day % every === 0) continue;
      try {
        unlinkSync(r.path);
      } catch {
        /* ya no existe */
      }
      this.driver.prepare("DELETE FROM snapshots WHERE tick = ?").run(r.tick);
      removed++;
    }
    return removed;
  }

  // ---------------------------------------------------------------- hitos y crónica

  insertMilestone(m: { id: number; tick: number; key: string; title: string; description: string; agentIds: number[]; epoch: string | null }): void {
    this.driver
      .prepare("INSERT OR IGNORE INTO milestones(id, tick, key, title, description, agent_ids, epoch) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(m.id, m.tick, m.key, m.title, m.description, JSON.stringify(m.agentIds), m.epoch);
  }

  milestones(limit = 200): Array<{ id: number; tick: number; key: string; title: string; description: string; agentIds: number[]; epoch: string | null }> {
    return this.driver
      .prepare("SELECT * FROM milestones ORDER BY tick DESC LIMIT ?")
      .all(limit)
      .map((r) => ({
        id: Number(r.id),
        tick: Number(r.tick),
        key: String(r.key),
        title: String(r.title),
        description: String(r.description),
        agentIds: JSON.parse(String(r.agent_ids)) as number[],
        epoch: (r.epoch as string | null) ?? null,
      }))
      .reverse();
  }

  insertChronicle(c: { tickFrom: number; tickTo: number; title: string; body: string; kind: string; themes: string[]; protagonists: string[] }): void {
    this.driver
      .prepare("INSERT INTO chronicle(tick_from, tick_to, title, body, kind, themes, protagonists, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(c.tickFrom, c.tickTo, c.title, c.body, c.kind, JSON.stringify(c.themes), JSON.stringify(c.protagonists), new Date().toISOString());
  }

  chronicle(limit = 100): Record<string, unknown>[] {
    return this.driver.prepare("SELECT * FROM chronicle ORDER BY tick_to DESC LIMIT ?").all(limit).reverse();
  }

  /** Tamaño aproximado en bytes de las tablas grandes. */
  sizes(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of ["events", "memories", "llm_calls", "conversations", "texts", "trades", "metrics"]) {
      out[t] = Number(this.driver.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()!.n);
    }
    return out;
  }
}

function rowToEvent(r: Record<string, unknown>): EventRow {
  return {
    seq: Number(r.seq),
    tick: Number(r.tick),
    kind: String(r.kind),
    agent_id: r.agent_id === null ? null : Number(r.agent_id),
    target_id: r.target_id === null ? null : Number(r.target_id),
    x: r.x === null ? null : Number(r.x),
    y: r.y === null ? null : Number(r.y),
    importance: Number(r.importance),
    label: String(r.label),
    tags: JSON.parse(String(r.tags)) as string[],
    payload: JSON.parse(String(r.payload)) as Record<string, unknown>,
  };
}

function rowToMemory(r: Record<string, unknown>): Memory {
  return {
    id: Number(r.id),
    tick: Number(r.tick),
    kind: r.kind as Memory["kind"],
    text: String(r.text),
    importance: Number(r.importance),
    tags: JSON.parse(String(r.tags)) as string[],
    refs: JSON.parse(String(r.refs)) as number[],
  };
}

/** Convierte una búsqueda libre en una consulta FTS5 tolerante. */
export function ftsQuery(q: string): string {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  if (words.length === 0) return '""';
  return words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" OR ");
}
