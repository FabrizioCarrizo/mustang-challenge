import { mkdirSync } from "node:fs";
import { Engine } from "../sim/engine.ts";
import type { GenesisConfig } from "../config.ts";
import { WorldDb, worldPaths } from "./db.ts";

export interface PruneReport {
  memoriesFolded: number;
  memoriesDeleted: number;
  eventsDeleted: number;
  llmBodiesTrimmed: number;
}

/**
 * Poda: pliega observaciones viejas y poco importantes en resúmenes diarios,
 * borra eventos triviales anteriores a un snapshot viejo y recorta los cuerpos
 * de las llamadas al modelo.
 */
export function pruneWorld(db: WorldDb, cfg: GenesisConfig, nowTick: number): PruneReport {
  const tpd = cfg.time.ticksPerDay;
  const foldBefore = nowTick - cfg.persistence.memoryFoldDays * tpd;
  const report: PruneReport = { memoriesFolded: 0, memoriesDeleted: 0, eventsDeleted: 0, llmBodiesTrimmed: 0 };
  db.transaction(() => {
    // 1. memorias: observaciones viejas y triviales → un resumen por ser y día
    const rows = db.driver
      .prepare("SELECT id, agent_id, tick, text FROM memories WHERE kind = 'observacion' AND importance < ? AND tick < ? AND pruned = 0 ORDER BY agent_id, tick")
      .all(cfg.persistence.memoryFoldImportance, foldBefore) as Array<{ id: number; agent_id: number; tick: number; text: string }>;
    const groups = new Map<string, Array<{ id: number; tick: number; text: string }>>();
    for (const r of rows) {
      const key = `${r.agent_id}:${Math.floor(r.tick / tpd)}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    const insert = db.driver.prepare("INSERT INTO memories(id, agent_id, tick, kind, text, importance, tags, refs, pruned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)");
    const del = db.driver.prepare("DELETE FROM memories WHERE id = ?");
    let nextId = Number(db.driver.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM memories").get()!.n);
    for (const [key, list] of groups) {
      if (list.length < 3) continue;
      const agentId = Number(key.split(":")[0]);
      const day = Number(key.split(":")[1]);
      const summary = `Resumen del día ${day + 1}: ${list
        .slice(0, 6)
        .map((m) => m.text)
        .join("; ")}${list.length > 6 ? ` (y ${list.length - 6} cosas más)` : ""}`;
      insert.run(nextId++, agentId, list[list.length - 1]!.tick, "resumen", summary.slice(0, 600), 2, JSON.stringify(["resumen"]), "[]");
      for (const m of list) del.run(m.id);
      report.memoriesFolded++;
      report.memoriesDeleted += list.length;
    }
    // 2. eventos triviales anteriores a la retención, si hay un snapshot posterior
    const retentionTick = nowTick - cfg.persistence.retentionDays * tpd;
    const snap = db.snapshotAtOrBefore(nowTick);
    if (snap && retentionTick > 0 && snap.tick > retentionTick) {
      const r = db.driver.prepare("DELETE FROM events WHERE tick < ? AND importance < 3 AND kind NOT IN ('intent', 'god', 'state.hash', 'milestone', 'epoch')").run(retentionTick);
      report.eventsDeleted = Number(r.changes);
    }
    // 3. cuerpos de llamadas viejas
    const trimBefore = nowTick - 30 * tpd;
    const t = db.driver.prepare("UPDATE llm_calls SET response_json = NULL, volatile_text = NULL WHERE tick < ? AND response_json IS NOT NULL").run(trimBefore);
    report.llmBodiesTrimmed = Number(t.changes);
  });
  try {
    db.driver.exec("PRAGMA incremental_vacuum");
  } catch {
    /* sin auto_vacuum incremental (node:sqlite): se ignora */
  }
  return report;
}

/**
 * Bifurca un mundo en un tick: copia el snapshot anterior y los eventos hasta
 * ese tick a un mundo nuevo con una seed derivada. Desde ahí vive con su
 * propio cerebro.
 */
export function forkWorld(db: WorldDb, worldsDir: string, newName: string, atTick: number): { tick: number; name: string; dir: string } {
  const info = db.worldInfo();
  if (!info) throw new Error("El mundo de origen no tiene metadatos");
  const row = db.snapshotAtOrBefore(atTick);
  if (!row) throw new Error(`No hay snapshot anterior al tick ${atTick}`);
  const paths = worldPaths(worldsDir, newName);
  if (WorldDb.exists(paths.db)) throw new Error(`Ya existe un mundo llamado "${newName}"`);
  mkdirSync(paths.dir, { recursive: true });
  const data = db.loadSnapshot(row.tick);
  data.worldName = newName;
  data.seed = (info.seed ^ (row.tick * 2654435761)) >>> 0;
  // el nuevo mundo sigue con el mismo estado del PRNG pero distinta identidad
  const engine = Engine.fromSnapshot(data);
  engine.s.worldName = newName;
  const out = WorldDb.open(paths.db);
  out.initWorld({ name: newName, seed: data.seed, config: info.config });
  out.setMeta("forked_from", `${info.name}@${row.tick}`);
  out.transaction(() => {
    const events = db.events({ to: row.tick, limit: 5_000_000, order: "asc" });
    const st = out.driver.prepare("INSERT INTO events(tick, kind, agent_id, target_id, x, y, importance, label, tags, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const e of events) st.run(e.tick, e.kind, e.agent_id, e.target_id, e.x, e.y, e.importance, e.label, JSON.stringify(e.tags), JSON.stringify(e.payload));
    for (const a of engine.s.agents.values()) {
      const mems = db.memoriesOf(a.id, { limit: 400, before: row.tick });
      out.insertMemories(mems.map((memory) => ({ agentId: a.id, memory })));
    }
    for (const m of db.milestones(1000)) if (m.tick <= row.tick) out.insertMilestone(m);
    for (const c of db.chronicle(1000)) if (Number(c.tick_to) <= row.tick) {
      out.insertChronicle({ tickFrom: Number(c.tick_from), tickTo: Number(c.tick_to), title: String(c.title), body: String(c.body), kind: String(c.kind), themes: JSON.parse(String(c.themes)) as string[], protagonists: JSON.parse(String(c.protagonists)) as string[] });
    }
    out.upsertAgents(engine.s.agents.values(), row.tick);
    out.saveSnapshot(engine.snapshot(), engine.hash());
    out.setMeta("last_tick", String(row.tick));
  });
  out.close();
  return { tick: row.tick, name: newName, dir: paths.dir };
}
