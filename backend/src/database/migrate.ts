import 'reflect-metadata';
import { Pool } from 'pg';
import { MigrationService } from './migration.service';

// Run as a separate operator process. The API never reads a migrator URL.
export function migrationOwnerRole(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('INVALID_MIGRATION_OWNER_ROLE');
  return value;
}

export async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const owner = migrationOwnerRole(process.env.DATABASE_MIGRATION_OWNER_ROLE);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1,
    statement_timeout: 30_000, connectionTimeoutMillis: 10_000, application_name: 'crypta-migrator' });
  pool.on('error', () => { process.stderr.write('Migration database connection failed.\n'); });
  try { await new MigrationService(pool).applyPending(owner ? async client => {
    await client.query(`SET ROLE "${owner}"`);
  } : undefined); }
  finally { await pool.end(); }
}

if (require.main === module) void migrate().catch(() => {
  process.stderr.write('Database migration failed. Inspect schema/version and database access before retrying.\n');
  process.exitCode = 1;
});
