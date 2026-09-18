/**
 * Capa mínima sobre SQLite. Usa better-sqlite3 (prebuilds para macOS arm64) y,
 * si el módulo nativo no carga, cae a node:sqlite (Node ≥ 22.13).
 */
import { createRequire } from "node:module";

export interface SqlStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqlDriver {
  readonly backend: "better-sqlite3" | "node:sqlite";
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  transaction<T>(fn: () => T): T;
  close(): void;
}

const require = createRequire(import.meta.url);

class BetterSqliteDriver implements SqlDriver {
  readonly backend = "better-sqlite3" as const;
  private readonly cache = new Map<string, SqlStatement>();
  constructor(private readonly db: {
    exec(sql: string): void;
    prepare(sql: string): SqlStatement;
    transaction<T>(fn: () => T): () => T;
    close(): void;
    pragma(p: string): unknown;
  }) {}
  exec(sql: string): void {
    this.db.exec(sql);
  }
  prepare(sql: string): SqlStatement {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  close(): void {
    this.db.close();
  }
}

class NodeSqliteDriver implements SqlDriver {
  readonly backend = "node:sqlite" as const;
  private readonly cache = new Map<string, SqlStatement>();
  private depth = 0;
  constructor(private readonly db: { exec(sql: string): void; prepare(sql: string): SqlStatement; close(): void }) {}
  exec(sql: string): void {
    this.db.exec(sql);
  }
  prepare(sql: string): SqlStatement {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      this.depth--;
    }
  }
  close(): void {
    this.db.close();
  }
}

export function openDriver(path: string): SqlDriver {
  try {
    const Database = require("better-sqlite3") as new (p: string) => ConstructorParameters<typeof BetterSqliteDriver>[0];
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma("temp_store = MEMORY");
    return new BetterSqliteDriver(db);
  } catch (err) {
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (p: string) => ConstructorParameters<typeof NodeSqliteDriver>[0] };
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;");
    if (process.env.GENESIS_DEBUG) console.warn("better-sqlite3 no disponible, usando node:sqlite:", (err as Error).message);
    return new NodeSqliteDriver(db);
  }
}
