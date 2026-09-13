import type { Database } from 'sql.js';
import { MIGRATIONS, type Migration, SCHEMA_SQL } from '@social-auto/shared';

/**
 * Run base schema (creates tables + schema_migrations ledger) then apply pending
 * migrations in order. Safe to call on every startup.
 *
 * SQLite ALTER TABLE ADD COLUMN has no IF NOT EXISTS — we swallow the "duplicate
 * column" error per statement since migrations may be partially applied from a
 * previous run.
 */
export function runMigrations(db: Database): { applied: string[]; skipped: string[] } {
  // Apply base schema (CREATE TABLE IF NOT EXISTS — always safe).
  db.exec(SCHEMA_SQL);

  // Load already-applied migration IDs.
  const applied = new Set<string>();
  try {
    const res = db.exec('SELECT id FROM schema_migrations');
    const rows = res[0]?.values ?? [];
    for (const r of rows) applied.add(String(r[0]));
  } catch {
    // schema_migrations may not exist yet (first run after base schema).
  }

  const justApplied: string[] = [];
  const skipped: string[] = [];

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) {
      skipped.push(m.id);
      continue;
    }
    applyMigration(db, m);
    recordMigration(db, m.id);
    justApplied.push(m.id);
  }

  return { applied: justApplied, skipped };
}

function applyMigration(db: Database, m: Migration): void {
  for (const stmt of m.statements) {
    try {
      db.run(stmt);
    } catch (err) {
      // SQLite "duplicate column name" — column was added in a previous partial run.
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate column name/i.test(msg)) continue;
      throw new Error(`Migration ${m.id} failed: ${msg}`);
    }
  }
}

function recordMigration(db: Database, id: string): void {
  try {
    db.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [id, Date.now()]);
  } catch {
    // Already recorded; ignore.
  }
}
