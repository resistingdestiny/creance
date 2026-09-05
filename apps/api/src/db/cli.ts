import { createPool } from './postgres.js';
import { migrate } from './migrate.js';

/// `pnpm --filter @creance/api migrate`.
///
/// Applies every migration that has not run and seeds the fifteen occupation
/// groups. Idempotent: running it twice prints that there was nothing to do.

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === '') {
  console.error('DATABASE_URL is not set. Copy the example environment file and fill it in.');
  process.exit(1);
}

const pool = createPool(connectionString);
try {
  const ran = await migrate(pool);
  console.log(ran.length === 0 ? 'nothing to do' : `applied ${ran.join(', ')}`);
} finally {
  await pool.end();
}
