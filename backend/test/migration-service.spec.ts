import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { MigrationService } from '../src/database/migration.service';

// Pin the SQL hashes from the verified pre-008 source archive. Published
// migrations must remain byte-for-byte compatible with existing ledgers.
const legacy = [
  { version: '001_auth_sessions_email', checksum: '794e4fe6a8ecbd525143ae9dacfd6f5f79edbffd155a3ab18d1df970c93ed564' },
  { version: '002_login_protection', checksum: '3c3cf671cd2976a6670ed9ed029992014bf0a6e9a4c33ddbfbec1ca1ecb0da69' },
  { version: '003_forced_password_change', checksum: 'b61127cc863cf076e1a1cb42807dbaf13b4984aae8138f6f29a19fe77af34a33' },
  { version: '004_reconciliation_status', checksum: '8860d9f4a22df294a119b5e30e7b1736bdb96dcbbd7cb982f4fec3fc29b53753' },
  { version: '005_provider_operations', checksum: '3d70d90fe1c6a9ce6a72fdf0ea3a5f3e7bb442861e4541a7ee836fc0364782bf' },
  { version: '006_email_reconciliation', checksum: '577ac2f4bc639430ce198add8165d8fc67a30b6a838998e1de141585ac15fd57' },
  { version: '007_asset_history_indexes', checksum: '2f037c0974d020388906ce3e085f44a300fa9a71f68a9157d7c3615582b9f319' },
];
const published = [...legacy, { version: '008_policy_versions_immutable', checksum: '247caefebea40b495377915e71d5212e3c7b348055390152a5951ad6a504efcb' }];
const pre010 = [...published, { version: '009_request_drafts', checksum: '8aa84185280d01378421e585bc0ed91880886ac09b59fd0f49fc2a5ca271f2bc' }];
const pre011 = [...pre010, { version: '010_execution_notifications', checksum: '1386259bfb8a56ac293690986b1f02209071ac98db73deea4e8488316350c6c4' }];
const pre012 = [...pre011, { version: '011_department_administration', checksum: '7669c56669b3165b56bc6d67c9f077f9b7d42357b2aea9e0bac1bb9fa5abfc88' }];
const pre013 = [...pre012, { version: '012_account_actions', checksum: '977c9ed1941724c8cb9b4ce8470bea362053fd68a883b41d59fb57b43b07792a' }];
const pre014 = [...pre013, { version: '013_provider_recovery', checksum: '0e6186486b3647def6625aaeb39eb3be8216c52d06abeb76dccfa7e526665d84' }];
const pre015 = [...pre014, { version: '014_asset_provider_scope', checksum: '725b8a163c1ae81a503b850a5c1af0167bb3626738a29a7af1258b4c72ecb246' }];
const pre016 = [...pre015, { version: '015_demo_asset_provider_scope', checksum: '2ad3c0908f9f93c9d0e6deb6b9652ed4cd4995401331eb9ac33095b1828d5496' }];

const pre017 = [...pre016, { version: '016_demo_certificate_provider_scope', checksum: '823418af9c276262fc31b68d05f2c3acbff4dfcc41c0dd88e17bc7acec81113f' }];
const pre018 = [...pre017, { version: '017_audit_search_trigram', checksum: '226133eb4396b03db7d555aedee04bbc9a0c490048639d8b71afc1347c6e8418' }];
const pre019 = [...pre018, { version: '018_key_asset_identity', checksum: 'a963f6062d80880206078880ec17c68adb1d50fbfd2668f734e2a6f1efa6c0a3' }];
const pre020 = [...pre019, { version: '019_auth_mfa', checksum: 'd90bda2d3a7fab6fd187d60ed5833e6bff55080aacc73f3d1b47dc6ecf5c0643' }];
const pre021 = [...pre020, { version: '020_two_stage_approval', checksum: '2b6b127ab5774d9412ff9148a9026aadf4bcce204f87b002d63820893f30f76f' }];
const pre022 = [...pre021, { version: '021_auth_oidc', checksum: '534c0d57f3c3ab55f4e83525a9d23c433d3507ec54ecdc8ccddd655366048554' }];
const complete = [...pre022, { version: '022_report_exports', checksum: 'ec6352049f1d8e081821c9f3d495e01f0b5b37eae537f0fe77003d3ce9729481' }];

function setup(rows: Array<{version:string;checksum:string|null}> = []) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => /^SELECT version,checksum FROM (public\.)?schema_migrations$/.test(sql) ? { rows } : { rows: [], rowCount: 1 });
  const release = vi.fn();
  const service = new MigrationService({ connect: vi.fn(async () => ({ query, release })) } as unknown as Pool);
  return { service, query, release };
}

describe('database migrations', () => {
  it('initializes the operator role on the same connection before migration locking and DDL', async () => {
    const { service, query, release } = setup();
    await service.applyPending(async client => { await client.query('SET ROLE "crypta_owner"'); });
    expect(query.mock.calls.slice(0, 3).map(([sql]) => sql)).toEqual(['SET ROLE "crypta_owner"', 'BEGIN', 'SELECT pg_advisory_xact_lock(17232,2)']);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');expect(release).toHaveBeenCalledOnce();
  });
  it('does not touch the ledger when operator role initialization fails', async () => {
    const { service, query, release } = setup();
    await expect(service.applyPending(async () => { throw new Error('OWNER_ROLE_FORBIDDEN'); })).rejects.toThrow('OWNER_ROLE_FORBIDDEN');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['ROLLBACK']);expect(release).toHaveBeenCalledOnce();
  });
  it('locks the migration ledger before reading or applying it', async () => {
    const { service, query, release } = setup();
    await service.applyPending();
    const calls = query.mock.calls.map(([sql]) => sql);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('pg_advisory_xact_lock');
    const insertions = query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO schema_migrations'));
    expect(insertions.map(([, values]) => ({ version: values?.[0], checksum: values?.[1] }))).toEqual(complete);
    expect(calls.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects an unknown database version without applying older code', async () => {
    const { service, query } = setup([{ version: '999_future', checksum: 'a'.repeat(64) }]);
    await expect(service.applyPending()).rejects.toThrow('UNKNOWN_DATABASE_MIGRATION');
    const calls = query.mock.calls.map(([sql]) => sql);
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(calls.some((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toBe(false);
  });

  it('rejects a changed applied migration', async () => {
    const { service, query } = setup([{ version: '001_auth_sessions_email', checksum: 'a'.repeat(64) }]);
    await expect(service.applyPending()).rejects.toThrow('DATABASE_MIGRATION_CHANGED');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('adds 009–022 to an existing eight-version ledger without replaying previous migrations', async () => {
    const { service, query, release } = setup(published);
    await service.applyPending();
    const insertions = query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO schema_migrations'));
    expect(insertions).toHaveLength(14);
    expect(insertions[0][1]?.[0]).toBe('009_request_drafts');
    expect(insertions[1][1]?.[0]).toBe('010_execution_notifications');
    expect(query.mock.calls.some(([sql]) => sql.includes('POLICY_VERSION_IMMUTABLE'))).toBe(false);
    expect(query.mock.calls.filter(([sql]) => sql.includes('ck_requests_submission'))).toHaveLength(1);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });
  it('upgrades a fourteen-version ledger through key identity protection', async () => {
    const { service, query } = setup(pre015);
    await service.applyPending();
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO schema_migrations')).map(([, values]) => values?.[0])).toEqual(['015_demo_asset_provider_scope', '016_demo_certificate_provider_scope', '017_audit_search_trigram', '018_key_asset_identity', '019_auth_mfa', '020_two_stage_approval', '021_auth_oidc', '022_report_exports']);
    expect(query.mock.calls.some(([sql]) => sql.includes('ck_requests_submission'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('AND a.provider_scope IS NULL'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('ADD COLUMN provider_scope'))).toBe(false);
  });

  it('adds two-stage approval and OIDC without touching an existing nineteen-version ledger', async () => {
    const { service, query } = setup(pre020);
    await service.applyPending();
    const insertions = query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO schema_migrations'));
    expect(insertions.map(([, values]) => values?.[0])).toEqual(['020_two_stage_approval', '021_auth_oidc', '022_report_exports']);
    expect(query.mock.calls.some(([sql]) => sql.includes('TWO_APPROVALS_REQUIRED'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE schema_migrations'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('rejects a changed applied 008 before replacing its immutability guard', async () => {
    const { service, query, release } = setup([...legacy, { version: '008_policy_versions_immutable', checksum: 'a'.repeat(64) }]);
    await expect(service.applyPending()).rejects.toThrow('DATABASE_MIGRATION_CHANGED:008_policy_versions_immutable');
    expect(query.mock.calls.some(([sql]) => sql.includes('POLICY_VERSION_IMMUTABLE'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO schema_migrations'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('runtime migration validation', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('defaults to a read-only consistent ledger check without DDL or checksum backfill', async () => {
    vi.stubEnv('DATABASE_MIGRATION_MODE', undefined);
    const { service, query, release } = setup(complete);
    await service.onModuleInit();
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'SELECT version,checksum FROM public.schema_migrations', 'COMMIT',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
  it('rejects a pending migration rather than applying it', async () => {
    const { service, query } = setup(published);
    await expect(service.validateApplied()).rejects.toThrow('DATABASE_MIGRATION_PENDING:009_request_drafts');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'SELECT version,checksum FROM public.schema_migrations', 'ROLLBACK',
    ]);
  });
  it('requires the identity guard before accepting an existing seventeen-version database', async () => {
    const { service, query } = setup(pre018);
    await expect(service.validateApplied()).rejects.toThrow('DATABASE_MIGRATION_PENDING:018_key_asset_identity');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'SELECT version,checksum FROM public.schema_migrations', 'ROLLBACK',
    ]);
  });
  it.each([null, '', 'invalid-checksum'])('rejects missing or malformed checksum %s without repairing it', async checksum => {
    const { service, query, release } = setup([{ ...complete[0], checksum }, ...complete.slice(1)]);
    await expect(service.validateApplied()).rejects.toThrow('DATABASE_MIGRATION_CHECKSUM_REQUIRED');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => /UPDATE|INSERT|ALTER|CREATE/.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
  it('rejects a changed known checksum', async () => {
    const { service } = setup([{ ...complete[0], checksum: 'a'.repeat(64) }, ...complete.slice(1)]);
    await expect(service.validateApplied()).rejects.toThrow('DATABASE_MIGRATION_CHANGED');
  });
  it('rejects unknown future migration instead of starting older runtime', async () => {
    const { service } = setup([...complete, { version: '999_future', checksum: 'a'.repeat(64) }]);
    await expect(service.validateApplied()).rejects.toThrow('UNKNOWN_DATABASE_MIGRATION:999_future');
  });
  it.each(['42P01', '42703'])('maps absent ledger/schema %s to migration-required without attempting bootstrap', async code => {
    const { service, query, release } = setup();
    query.mockImplementation(async sql => {
      if (sql.startsWith('SELECT version')) throw Object.assign(new Error('database details'), { code });
      return { rows: [], rowCount: 1 };
    });
    await expect(service.validateApplied()).rejects.toThrow('DATABASE_MIGRATIONS_REQUIRED');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');expect(release).toHaveBeenCalledOnce();
  });
  it('rejects invalid startup mode before touching the database', async () => {
    vi.stubEnv('DATABASE_MIGRATION_MODE', 'skip');const { service, query } = setup(complete);
    await expect(service.onModuleInit()).rejects.toThrow('INVALID_DATABASE_MIGRATION_MODE');
    expect(query).not.toHaveBeenCalled();
  });
  it('applies pending schema only when local/demo mode explicitly opts in', async () => {
    vi.stubEnv('DATABASE_MIGRATION_MODE', 'apply');const { service, query } = setup();
    await service.onModuleInit();expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(complete.length);
  });
});
