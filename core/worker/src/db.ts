import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './migrations.js';

let SQL: SqlJsStatic | null = null;

async function getSQL(): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

export interface DB {
  /**
   * The underlying sql.js Database instance. May be swapped at runtime if the
   * on-disk file changes (other processes writing through their own DB handle).
   * Repositories reference `db.raw` at call time, so a swap is picked up.
   */
  raw: Database;
  /**
   * Force-write the current in-memory state to disk. The worker calls this at
   * the end of each poll cycle (NOT on every write) to avoid racing the API
   * process that also persists per-write. End-of-poll is the natural serial
   * point — the worker holds no other writes in flight then.
   */
  flush(): void;
  close(): void;
  /**
   * If the on-disk file has been modified since this DB was opened, reload it
   * from disk into a fresh Database instance. Returns true if a reload happened.
   * No-op for in-memory DBs.
   */
  refreshIfChanged(): boolean;
}

/**
 * Wrap run/exec to track dirty state. We do NOT auto-persist on every write —
 * see `flush()` for the rationale.
 */
const READ_ONLY_SQL = /^\s*select\b/i;

function instrumentWrites(raw: Database, onWrite: () => void): void {
  const origRun = raw.run.bind(raw) as Database['run'];
  raw.run = ((...args: unknown[]) => {
    const r = origRun(...(args as Parameters<Database['run']>));
    // Skip statements that touched no rows (e.g. unstickUploading matching
    // nothing on an idle poll) — marking dirty for those would make every
    // flush rewrite the file and race the API's writes.
    if (raw.getRowsModified() > 0) onWrite();
    return r;
  }) as Database['run'];
  const origExec = raw.exec.bind(raw);
  raw.exec = ((...args: unknown[]) => {
    const r = origExec(...(args as Parameters<Database['exec']>));
    if (!READ_ONLY_SQL.test(args[0] as string)) onWrite();
    return r;
  }) as Database['exec'];
}

export async function openDB(path: string): Promise<DB> {
  const sql = await getSQL();
  let raw: Database;
  let knownMtime: number | null = null;
  if (path === ':memory:') {
    raw = new sql.Database();
  } else {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      raw = new sql.Database(readFileSync(path));
      knownMtime = statSync(path).mtimeMs;
    } else {
      raw = new sql.Database();
    }
  }
  raw.exec('PRAGMA foreign_keys = ON;');

  let closed = false;
  let dirty = false;
  let lastRefreshCheck = 0;
  const REFRESH_THROTTLE_MS = 1000; // Check at most once per second

  const persist = (): void => {
    if (path === ':memory:' || closed) return;
    writeFileSync(path, Buffer.from(raw.export()));
    knownMtime = statSync(path).mtimeMs;
    dirty = false;
  };

  // Run migrations BEFORE instrumenting writes. The migration statements
  // produce writes that would otherwise be tracked by the wrapper, but
  // because the API process also opens this file we need the schema
  // mutations to be on disk before the API process's next openDB picks
  // them up. Persist unconditionally right after — :memory: is a no-op.
  runMigrations(raw);
  if (path !== ':memory:') persist();

  instrumentWrites(raw, () => {
    dirty = true;
  });

  const handle: DB = {
    get raw() {
      return raw;
    },
    flush() {
      // Only export when this process actually wrote. An idle poll still
      // runs SELECTs and a no-op unstick UPDATE — persisting an unchanged
      // snapshot every cycle would clobber whatever the API wrote in the
      // meantime (sql.js exports the whole in-memory DB, not a diff).
      if (dirty) persist();
    },
    close() {
      if (closed) return;
      if (dirty) persist();
      raw.close();
      closed = true;
    },
    refreshIfChanged() {
      if (path === ':memory:' || knownMtime === null) return false;
      const now = Date.now();
      if (now - lastRefreshCheck < REFRESH_THROTTLE_MS) {
        return false; // Throttled - skip this check
      }
      lastRefreshCheck = now;
      const mtime = statSync(path).mtimeMs;
      if (knownMtime !== null && mtime <= knownMtime) return false;
      if (dirty) persist();
      raw.close();
      raw = new sql.Database(readFileSync(path));
      raw.exec('PRAGMA foreign_keys = ON;');
      // Re-run migrations on reload — same reason as openDB. A peer
      // process may have closed a stale schema or partially-applied
      // migration, and the worker shouldn't keep serving requests
      // against the stale snapshot.
      runMigrations(raw);
      instrumentWrites(raw, () => {
        dirty = true;
      });
      knownMtime = mtime;
      dirty = false;
      return true;
    },
  };

  return handle;
}