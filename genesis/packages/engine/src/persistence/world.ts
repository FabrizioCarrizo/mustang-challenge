import { mkdirSync } from "node:fs";
import type { GenesisConfigInput } from "../config.ts";
import { Engine } from "../sim/engine.ts";
import { WorldDb, worldPaths } from "./db.ts";
import { PersistenceWriter } from "./writer.ts";

export interface OpenedWorld {
  engine: Engine;
  db: WorldDb;
  writer: PersistenceWriter;
  resumedFromTick: number;
}

/** Crea un mundo nuevo en disco: génesis + snapshot inicial. */
export function createWorld(worldsDir: string, name: string, seed: number, config: GenesisConfigInput): OpenedWorld {
  const paths = worldPaths(worldsDir, name);
  if (WorldDb.exists(paths.db)) throw new Error(`Ya existe un mundo llamado "${name}" en ${paths.dir}`);
  mkdirSync(paths.dir, { recursive: true });
  const engine = Engine.genesis({ ...config, world: { ...(config.world ?? {}), name } }, seed);
  const db = WorldDb.open(paths.db);
  db.initWorld({ name, seed, config: engine.config });
  const writer = new PersistenceWriter(db, engine);
  db.transaction(() => {
    db.upsertAgents(engine.s.agents.values(), 0);
  });
  writer.snapshot();
  return { engine, db, writer, resumedFromTick: 0 };
}

/**
 * Abre un mundo existente desde su último snapshot. Los registros posteriores
 * al snapshot se descartan: el mundo los vuelve a generar de forma determinista
 * (y, con cerebro, desde los intents grabados por ReplayBrain).
 */
export function openWorld(worldsDir: string, name: string, opts: { atTick?: number } = {}): OpenedWorld {
  const paths = worldPaths(worldsDir, name);
  if (!WorldDb.exists(paths.db)) throw new Error(`No existe el mundo "${name}" en ${paths.dir}. Crealo con: genesis new --name ${name}`);
  const db = WorldDb.open(paths.db);
  const row = opts.atTick !== undefined ? db.snapshotAtOrBefore(opts.atTick) : db.latestSnapshot();
  if (!row) {
    db.close();
    throw new Error(`El mundo "${name}" no tiene snapshots`);
  }
  const data = db.loadSnapshot(row.tick);
  const engine = Engine.fromSnapshot(data);
  const writer = new PersistenceWriter(db, engine);
  return { engine, db, writer, resumedFromTick: row.tick };
}

export function worldExists(worldsDir: string, name: string): boolean {
  return WorldDb.exists(worldPaths(worldsDir, name).db);
}
