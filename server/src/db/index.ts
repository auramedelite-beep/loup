import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

// Loaded through `process.getBuiltinModule` so bundlers/test runners never try
// to resolve `node:sqlite` (it is a Node builtin, not an npm package).
const sqlite = (process as unknown as { getBuiltinModule: (id: string) => typeof import('node:sqlite') }).getBuiltinModule(
  'node:sqlite',
);
const DatabaseSync = sqlite.DatabaseSync;

const dbPath = path.isAbsolute(config.databasePath)
  ? config.databasePath
  : path.resolve(process.cwd(), config.databasePath);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

type SqliteDatabase = InstanceType<typeof sqlite.DatabaseSync>;

export const db: SqliteDatabase = new sqlite.DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

const schemaPath = path.resolve(__dirname, 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

const cache = new Map<string, ReturnType<SqliteDatabase['prepare']>>();

function stmt(sql: string): ReturnType<SqliteDatabase['prepare']> {
  let prepared = cache.get(sql);
  if (!prepared) {
    prepared = db.prepare(sql);
    cache.set(sql, prepared);
  }
  return prepared;
}

export type SqlParam = string | number | null | bigint;

/** Run a write statement. All values must already be SQLite-safe. */
export function run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number | bigint } {
  const result = stmt(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
}

/** Fetch a single row. */
export function get<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T | undefined {
  return stmt(sql).get(...params) as T | undefined;
}

/** Fetch all rows. */
export function all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[] {
  return stmt(sql).all(...params) as T[];
}

let txDepth = 0;

/** Runs fn inside a transaction (nested calls join the outer transaction). */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  txDepth += 1;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    throw error;
  } finally {
    txDepth -= 1;
  }
}

export function getSetting(key: string, fallback: string | null = null): string | null {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function int(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function closeDb(): void {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}

export { dbPath };
