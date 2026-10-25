import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from 'node:fs';
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
 * Wrap run/exec so every write persists to disk immediately and marks the DB
 * dirty. The wrappers are re-installed on the new instance after a reload.
 */
const READ_ONLY_SQL = /^\s*select\b/i;

function instrumentWrites(raw: Database, onWrite: () => void): void {
  // onWrite may persist() → raw.export() → resets sqlite3_changes(), so the
  // count must be captured BEFORE onWrite runs. Repos reading
  // getRowsModified() after a write (e.g. claimDuePosts' claim check) would
  // otherwise always see 0 — in embedded-worker mode that silently dropped
  // every claimed post into a permanent 'uploading' state.
  let lastModified = 0;
  const origGetRowsModified = raw.getRowsModified.bind(raw);
  const origRun = raw.run.bind(raw) as Database['run'];
  raw.run = ((...args: unknown[]) => {
    const r = origRun(...(args as Parameters<Database['run']>));
    lastModified = origGetRowsModified();
    // Skip statements that touched no rows (e.g. an UPDATE matching
    // nothing) — persisting an unchanged snapshot just churns the file
    // and races the peer process holding this same DB file.
    if (lastModified > 0) onWrite();
    return r;
  }) as Database['run'];
  const origExec = raw.exec.bind(raw);
  raw.exec = ((...args: unknown[]) => {
    const r = origExec(...(args as Parameters<Database['exec']>));
    // Repos run every SELECT through exec — persisting after each read
    // would rewrite the whole DB file on every GET request.
    if (!READ_ONLY_SQL.test(args[0] as string)) {
      lastModified = origGetRowsModified();
      onWrite();
    }
    return r;
  }) as Database['exec'];
  raw.getRowsModified = () => lastModified;
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
  // Hoist state so the post-migration persist can use them. Migrations
  // run BEFORE instrumentWrites — the wrapper would not observe their
  // writes, so the schema changes would be lost on the next process
  // opening the same file. Force a flush immediately after.
  let closed = false;
  let dirty = false;
  let lastRefreshCheck = 0;
  const REFRESH_THROTTLE_MS = 1000; // Check at most once per second

  const persist = (): void => {
    if (path === ':memory:' || closed) return;
    // Write-then-rename so a crash mid-write can't leave a truncated DB
    // file — rename is atomic on POSIX filesystems.
    const tmpPath = `${path}.tmp-${process.pid}`;
    writeFileSync(tmpPath, Buffer.from(raw.export()));
    renameSync(tmpPath, path);
    knownMtime = statSync(path).mtimeMs;
    dirty = false;
  };
  runMigrations(raw);
  if (path !== ':memory:') persist();

  instrumentWrites(raw, () => {
    dirty = true;
    if (path !== ':memory:') persist();
  });

  // Mutable holder so refreshIfChanged can swap the underlying Database while
  // repositories continue to access `db.raw` per call.
  const handle: DB = {
    get raw() {
      return raw;
    },
    flush() {
      if (dirty) persist();
    },
    close() {
      if (closed) return;
      persist();
      raw.close();
      closed = true;
    },
    refreshIfChanged() {
      if (path === ':memory:' || closed) return false;
      if (!existsSync(path)) return false;
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
      // Re-run migrations on reload. If the file on disk is from a
      // peer that opened the DB before this process did (or before a
      // newer migration landed in our code), we want this process to
      // catch up before serving the next request. Without this, a
      // reload from a stale peer would clobber our correct in-memory
      // schema with whatever the peer last persisted.
      runMigrations(raw);
      instrumentWrites(raw, () => {
        dirty = true;
        if (path !== ':memory:') persist();
      });
      knownMtime = mtime;
      dirty = false;
      return true;
    },
  };

  return handle;
}