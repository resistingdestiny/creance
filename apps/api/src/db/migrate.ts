import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { GROUP_DEFINITIONS, loadSeriesMap } from '@creance/index-model';
import type { Pool } from 'pg';

/// The migration runner.
///
/// Plain SQL files applied in name order, each inside its own transaction, with
/// the applied versions recorded in `schema_migrations`. Re-running is a no-op.
/// An ORM would own the schema, and apps/oracle writes to the same database
/// from T12, so the schema has to be readable by something that is not this
/// process.

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

async function appliedVersions(pool: Pool): Promise<Set<string>> {
  const exists = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('schema_migrations') IS NOT NULL AS present",
  );
  if (exists.rows[0]?.present !== true) return new Set();
  const rows = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(rows.rows.map((row) => row.version));
}

/** Apply every migration that has not run yet, then seed the reference data. */
export async function migrate(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const applied = await appliedVersions(pool);
  const ran: string[] = [];
  for (const file of migrationFiles(dir)) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    // Each file carries its own BEGIN and COMMIT, so a partly applied schema is
    // never left behind by a statement in the middle failing.
    await pool.query(readFileSync(join(dir, file), 'utf8'));
    ran.push(version);
  }
  await seedGroups(pool);
  return ran;
}

/**
 * The fifteen bindable occupation groups, from the frozen series mapping rather
 * than from a list written out twice. The picker order is the mapping order,
 * which puts office and administrative support first.
 */
export async function seedGroups(pool: Pool): Promise<number> {
  const map = loadSeriesMap();
  const byKey = new Map(map.series.map((entry) => [entry.group_key, entry]));
  let written = 0;
  let order = 0;
  for (const definition of GROUP_DEFINITIONS) {
    if (!definition.bindable) continue;
    const entry = byKey.get(definition.groupKey);
    if (entry === undefined) continue;
    order += 1;
    await pool.query(
      `INSERT INTO groups (group_key, label, bls_series, picker_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_key) DO UPDATE
         SET label = EXCLUDED.label,
             bls_series = EXCLUDED.bls_series,
             picker_order = EXCLUDED.picker_order`,
      [definition.groupKey, definition.label, entry.bls_series_id, order],
    );
    written += 1;
  }
  return written;
}
