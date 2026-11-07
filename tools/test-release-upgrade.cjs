// T46. Rehearse a real Git baseline upgrade and restore in a retained test stack.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const baseline = '105d104c41b0804410b12782434b89d522c341d6';
const sourceDatabase = 'crypta_t30_test';
const legacyVersions = ['001_auth_sessions_email', '002_login_protection', '003_forced_password_change'];
const legacyTables = ['departments', 'roles', 'policies', 'users', 'auth_sessions', 'user_roles', 'approver_scopes',
  'policy_versions', 'crypto_assets', 'cryptographic_keys', 'certificates', 'requests', 'request_decisions', 'audit_logs', 'notifications'];
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(executable, args, { reportSqlState = false, ...options } = {}) {
  const result = spawnSync(executable, args, { cwd: root, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], ...options });
  if (result.status !== 0) {
    const state = reportSqlState && /^ERROR:\s+([0-9A-Z]{5})\s*$/m.exec(result.stderr?.toString() ?? '')?.[1];
    throw new Error(`${executable} ${args[0]} failed (${result.error?.code ?? result.status ?? result.signal})${state ? `, SQLSTATE ${state}` : ''}.`);
  }
  return result.stdout;
}

async function main(argument) {
  assert(argument, 'Pass a retained isolated-stack report.json.');
  const artifacts = fs.realpathSync(path.join(__dirname, 'test-artifacts', 'integration'));
  const reportPath = fs.realpathSync(argument);
  assert(reportPath.startsWith(artifacts + path.sep) && path.basename(reportPath) === 'report.json');
  const directory = path.dirname(reportPath);
  const stack = JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(directory), stack.project);
  assert.equal(stack.database, sourceDatabase);
  assert.equal(stack.provider, 'MOCK');
  assert.equal(stack.smtpEnabled, false);
  assert.equal(stack.fixtureOnly, false);
  assert.equal(stack.started, true);
  assert.equal(stack.keptStack, true);
  assert.equal(stack.cleanupCompleted, false);
  const origin = new URL(stack.origin);
  assert.equal(origin.protocol, 'http:');
  assert.equal(origin.hostname, '127.0.0.1');
  assert(origin.port && origin.port !== '8080');
  const envFile = fs.realpathSync(path.join(directory, 'test.env'));
  assert.equal(path.dirname(envFile), directory);
  const compose = ['compose', '--project-name', stack.project, '--env-file', envFile,
    '--file', path.join(__dirname, 'testing', 'compose.t30.yml')];
  const docker = (args, options) => run('docker', args, options);
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json']));
  assert.equal(config.name, stack.project);
  assert.equal(config.volumes.test_postgres.name, `${stack.project}_test_postgres`);
  assert.notEqual(config.volumes.test_postgres.external, true);
  assert.equal(config.services.postgres.environment.POSTGRES_DB, sourceDatabase);
  assert.equal(config.services.backend.environment.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(String(config.services.backend.environment.SMTP_ENABLED), 'false');
  const ids = docker([...compose, 'ps', '-q']).toString().trim().split(/\s+/);
  assert.equal(ids.length, 3);
  const services = JSON.parse(docker(['inspect', ...ids]));
  for (const container of services) {
    assert.equal(container.Config.Labels['com.docker.compose.project'], stack.project);
    assert.equal(container.State.Running, true);
  }
  const byService = Object.fromEntries(services.map(container => [container.Config.Labels['com.docker.compose.service'], container]));
  assert.deepEqual(Object.keys(byService).sort(), ['backend', 'frontend', 'postgres']);
  const network = `${stack.project}_default`;
  assert(byService.backend.NetworkSettings.Networks[network] && byService.postgres.NetworkSettings.Networks[network]);
  const [networkInfo] = JSON.parse(docker(['network', 'inspect', network]));
  assert.equal(networkInfo.Labels['com.docker.compose.project'], stack.project);
  assert(byService.postgres.Mounts.some(mount => mount.Name === `${stack.project}_test_postgres`));
  const binding = byService.frontend.NetworkSettings.Ports['80/tcp'];
  assert.equal(binding.length, 1);
  assert.equal(binding[0].HostIp, '127.0.0.1');
  assert.equal(binding[0].HostPort, origin.port);
  const databaseSetting = byService.backend.Config.Env.find(value => value.startsWith('DATABASE_URL='));
  const baseUrl = new URL(databaseSetting.slice('DATABASE_URL='.length));
  assert.equal(baseUrl.protocol, 'postgresql:');
  assert.equal(baseUrl.hostname, 'postgres');
  assert.equal(baseUrl.username, sourceDatabase);
  assert.equal(baseUrl.pathname, `/${sourceDatabase}`);

  function inventory() {
    const rows = docker(['ps', '-a', '--no-trunc', '--format', '{{json .ID}} {{json .Names}}']).toString().trim().split('\n').filter(Boolean);
    return rows.map(row => {
      const [_, id, name] = /^"([a-f0-9]{64})" "([a-zA-Z0-9_.-]+)"\s*$/.exec(row) ?? [];
      assert(id && name);
      return { id, name };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  const before = inventory();
  assert(services.every(container => before.some(item => item.id === container.Id)));
  const stamp = randomBytes(6).toString('hex');
  const output = path.join(directory, `release-upgrade-${stamp}`);
  fs.mkdirSync(output);
  const upgradeDatabase = `crypta_upgrade_test_${stamp}`;
  const restoredDatabase = `crypta_upgrade_restore_${stamp}`;
  const candidateRestore = `crypta_candidate_restore_${stamp}`;
  const runtimeRole = `crypta_upgrade_runtime_${stamp}`;
  const restoreOwner = `crypta_restore_owner_${stamp}`;
  const baselineImage = `${stack.project}-upgrade-baseline:${stamp}`;
  const runLabel = `org.crypta.upgrade-test=${stamp}`;
  const jwt = randomBytes(32).toString('hex');
  const runtimePassword = randomBytes(32).toString('hex');
  const testDatabases = [upgradeDatabase, restoredDatabase, candidateRestore];
  const dbResources = new Set(), roleResources = new Set();
  const testContainers = new Set();
  let imageCreated = false;
  const report = { project: stack.project, baseline, baselineVersions: legacyVersions, candidateBackendImage: byService.backend.Image,
    candidateFrontendImage: byService.frontend.Image, fixtureOnly: false, provider: 'MOCK', smtpEnabled: false,
    upgradeDatabase, restoredDatabase, candidateRestore, createdUtc: new Date().toISOString(), tests: [], success: false };

  function pg(command, database, flags = [], options) {
    assert(database === sourceDatabase || testDatabases.includes(database));
    return docker([...compose, 'exec', '-T', 'postgres', command, '-U', sourceDatabase, '-d', database, ...flags], options);
  }
  function sql(database, statement, flags = []) {
    return pg('psql', database, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', ...flags],
      { input: statement, reportSqlState: true }).toString().trim();
  }
  function allocate(database, owner = sourceDatabase) {
    assert(testDatabases.includes(database));
    assert([sourceDatabase, restoreOwner].includes(owner));
    assert.equal(sql(sourceDatabase, `SELECT count(*) FROM pg_database WHERE datname='${database}';`), '0');
    sql(sourceDatabase, `CREATE DATABASE "${database}" OWNER "${owner}" ALLOW_CONNECTIONS false;`);
    dbResources.add(database);
    sql(sourceDatabase, `BEGIN; REVOKE CONNECT ON DATABASE "${database}" FROM PUBLIC;
      ALTER DATABASE "${database}" ALLOW_CONNECTIONS true; COMMIT;`);
    assert.equal(sql(database, 'SELECT current_database();'), database);
    assert.equal(sql(database, "SELECT count(*) FROM pg_tables WHERE schemaname='public';"), '0');
  }
  function fingerprint(database, projection = 'full', tables = legacyTables) {
    const ignored = projection === 'full' ? {} : { crypto_assets: 'updated_at', ...(projection === 'candidate' && {
      departments: 'version', users: 'invitation_pending', crypto_assets: 'provider_scope,updated_at',
      auth_sessions: 'mfa_token_version,oidc_session_id', requests: 'cancellation_reason',
      request_decisions: 'approval_level', notifications: 'claimed_at,account_action_id',
    }) };
    const queries = tables.map(table => {
      assert.match(table, /^[a-z][a-z0-9_]*$/);
      const fields = ignored[table] ? `to_jsonb(t)-ARRAY[${ignored[table].split(',').map(field => `'${field}'`).join(',')}]` : 'to_jsonb(t)';
      return `SELECT '${table}' AS name,count(*)||':'||md5(COALESCE(string_agg(row_text,'|' ORDER BY row_text),'')) AS fingerprint
        FROM (SELECT (${fields})::text AS row_text FROM public.${table} t) source`;
    });
    const snapshot = JSON.parse(sql(database, `SELECT json_object_agg(name,fingerprint) FROM (${queries.join(' UNION ALL ')}) snapshots;`));
    assert.deepEqual(Object.keys(snapshot).sort(), [...tables].sort());
    for (const result of Object.values(snapshot)) assert.match(result, /^\d+:[a-f0-9]{32}$/);
    return snapshot;
  }
  function ledger(database, checksummed = false) {
    return JSON.parse(sql(database, `SELECT json_agg(row_to_json(l) ORDER BY version) FROM (SELECT version,applied_at${checksummed ? ',checksum' : ''} FROM schema_migrations) l;`));
  }
  function gitFile(file) {
    return run('git', ['show', `${baseline}:${file}`]);
  }
  function containerOptions(database, name, mode, runtime = false) {
    assert(testDatabases.includes(database));
    assert(name.startsWith(`${stack.project}-upgrade-${stamp}-`));
    const url = new URL(baseUrl.href);
    url.pathname = `/${database}`;
    if (runtime) { url.username = runtimeRole; url.password = runtimePassword; }
    const variables = { DATABASE_URL: url.href, JWT_ACCESS_SECRET: jwt, PORT: '3000', DATABASE_MIGRATION_MODE: mode,
      CRYPTO_PROVIDER_MODE: 'MOCK', SMTP_ENABLED: 'false', ACCOUNT_ACTIONS_ENABLED: 'false', COOKIE_SECURE: 'false' };
    const args = ['run', '--name', name, '--network', network, '--label', runLabel,
      ...Object.keys(variables).flatMap(key => ['--env', key])];
    testContainers.add(name);
    return { args, env: { ...process.env, ...variables } };
  }
  function removeContainer(name) {
    const remaining = docker(['ps', '-a', '--filter', `label=${runLabel}`, '--format', '{{.Names}}']).toString().split(/\r?\n/);
    if (remaining.includes(name)) {
      const [container] = JSON.parse(docker(['inspect', name]));
      assert.equal(container.Name, `/${name}`);
      assert.equal(container.Config.Labels['org.crypta.upgrade-test'], stamp);
      docker(['rm', '--force', container.Id]);
    }
    testContainers.delete(name);
  }
  function oneOff(name, database, image, command, expected) {
    const { args, env } = containerOptions(database, name, 'validate');
    try {
      const result = spawnSync('docker', [...args, image, ...command], { cwd: root, env, timeout: 55_000,
        stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
      if (result.status !== expected) throw new Error(`Unexpected API/CLI exit code (${result.status ?? result.error?.code}).`);
      return Buffer.concat([result.stdout, result.stderr]).toString('utf8');
    } finally { removeContainer(name); }
  }
  const name = phase => `${stack.project}-upgrade-${stamp}-${phase}`;
  function startApi(phase, database, image, runtime = false) {
    const service = name(phase);
    assert(service.length <= 63, 'Test API service name must fit in a DNS label.');
    const { args, env } = containerOptions(database, service, 'validate', runtime);
    docker([...args, '--detach', image], { env });
    return service;
  }
  function probe(service, readyPath, smoke = false) {
    const script = `
      const assert=require('node:assert/strict');
      const [host,readyPath,smoke]=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
      const base='http://'+host+':3000/api/v1';
      async function request(endpoint,expected,token,body){
        const response=await fetch(base+endpoint,{method:body?'POST':'GET',headers:{...(token&&{Authorization:'Bearer '+token}),...(body&&{'Content-Type':'application/json'})},...(body&&{body:JSON.stringify(body)}),signal:AbortSignal.timeout(4000)});
        assert.equal(response.status,expected);return (await response.json()).data;
      }
      (async()=>{
        const ready=await request(readyPath,200);assert.equal(ready.status,'ok');
        if(smoke){
          const user=await request('/auth/login',200,null,{email:'dev.nguyen@congty.com',password:'Password@123'});
          assert.equal((await request('/auth/me',200,user.accessToken)).id,user.user.id);
          const asset=await request('/assets/a1111113-1111-1111-1111-111111111113',200,user.accessToken);
          assert.equal(asset.code,'KEY-DEV-NEW');
          if(readyPath.endsWith('/ready')){
            assert.equal(asset.providerMode,'MOCK');
            const history=await request('/assets/'+asset.id+'/history?page=1&pageSize=10',200,user.accessToken);
            assert(history.lineage.assets.some(item=>item.relation==='predecessor'&&item.code==='KEY-DEV-OLD'));
          }
          const admin=await request('/auth/login',200,null,{email:'admin@congty.com',password:'Password@123'});
          const audit=await request('/audit-logs?limit=50',200,admin.accessToken);assert(Array.isArray(audit)&&audit.length>0);
        }
        process.stdout.write('PASS');
      })().catch(()=>{process.exitCode=1});`;
    // Use -e for code so stdin can carry the parameters. The test HTTP connection stays inside the validated Docker network.
    return docker([...compose, 'exec', '-T', 'backend', 'node', '-e', script], { input: JSON.stringify([service, readyPath, smoke]) }).toString();
  }
  async function waitReady(service, readyPath) {
    const until = Date.now() + 25_000;
    while (Date.now() < until) {
      try { if (probe(service, readyPath) === 'PASS') return; } catch { /* Startup is still pending. */ }
      const [container] = JSON.parse(docker(['inspect', service]));
      assert(container.State.Running, 'Test API exited before readiness.');
      await sleep(250);
    }
    throw new Error('Timed out waiting for test API readiness.');
  }
  async function check(test, work) {
    try { report.tests.push({ name: test, passed: true, evidence: await work() }); console.log(`PASS ${test}`); }
    catch (error) { report.tests.push({ name: test, passed: false, error: String(error.message).slice(0, 350) }); throw error; }
  }
  function applyRuntimeGrants(database) {
    assert(dbResources.has(database));
    sql(database, fs.readFileSync(path.join(__dirname, 'testing/runtime-grants.sql')),
      ['-v', `database=${database}`, '-v', `runtime_role=${runtimeRole}`]);
  }

  function runtimeGrants(database) {
    return JSON.parse(sql(database, `WITH grants AS (
      SELECT c.relname AS object_name,a.attname AS column_name,acl.privilege_type,acl.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl
      WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee='${runtimeRole}'::regrole
      UNION ALL
      SELECT c.relname,NULL,acl.privilege_type,acl.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) acl
      WHERE n.nspname='public' AND acl.grantee='${runtimeRole}'::regrole
    ) SELECT json_agg(grants ORDER BY object_name,column_name,privilege_type) FROM grants;`));
  }

  try {
    await check('Git baseline builds and serves the seeded legacy database', async () => {
      assert.equal(run('git', ['rev-parse', `${baseline}^{commit}`]).toString().trim(), baseline);
      const archive = run('git', ['archive', '--format=tar', `${baseline}:backend`]);
      docker(['build', '--file', 'Dockerfile', '--label', runLabel, '--label', `org.opencontainers.image.revision=${baseline}`,
        '--tag', baselineImage, '-'], { input: archive, timeout: 180_000 });
      imageCreated = true;
      const [built] = JSON.parse(docker(['image', 'inspect', baselineImage]));
      assert.equal(built.Config.Labels['org.opencontainers.image.revision'], baseline);
      report.baselineBackendImage = built.Id;
      allocate(upgradeDatabase);
      sql(upgradeDatabase, gitFile('database_schema.sql'));
      sql(upgradeDatabase, gitFile('seed_data.sql'));
      const old = startApi('legacy', upgradeDatabase, baselineImage);
      try { await waitReady(old, '/health'); assert.equal(probe(old, '/health', true), 'PASS'); }
      finally { removeContainer(old); }
      const applied = ledger(upgradeDatabase);
      assert.deepEqual(applied.map(entry => entry.version), legacyVersions);
      const sessionCount = Number(sql(upgradeDatabase, 'SELECT count(*) FROM auth_sessions;'));
      assert(sessionCount >= 2);
      sql(upgradeDatabase, `INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at,provider_reference)
        SELECT gen_random_uuid(),'LEGACY-IMPORT-T46',asset_type,owner_id,department_id,policy_version_id,'Unverified legacy import',status,valid_from,expires_at,'unverified-import-t46'
        FROM crypto_assets WHERE asset_code='KEY-DEV-001';`);
      return { gitArchiveSha256: hash(archive), legacyVersions: applied.map(entry => entry.version), sessionCount };
    });

    const originalLedger = ledger(upgradeDatabase);
    const original = fingerprint(upgradeDatabase);
    const originalProjected = fingerprint(upgradeDatabase, 'baseline');
    const originalAssetTimestamps = JSON.parse(sql(upgradeDatabase, 'SELECT json_object_agg(id,updated_at) FROM crypto_assets;'));
    const beforeSeq = sql(upgradeDatabase, 'SELECT last_value,is_called FROM audit_logs_id_seq;');
    const dump = pg('pg_dump', upgradeDatabase, ['--format=custom', '--no-owner', '--no-acl']);
    assert(dump.length > 0 && dump.subarray(0, 5).toString() === 'PGDMP');
    report.backup = { bytes: dump.length, sha256: hash(dump), persisted: false };

    await check('Candidate startup rejects the old ledger before the operator runs migration', () => {
      const log = oneOff(name('preflight'), upgradeDatabase, byService.backend.Image, ['node', 'dist/main.js'], 1);
      assert(log.includes('DATABASE_MIGRATIONS_REQUIRED'), 'Startup must identify the legacy migration ledger.');
      assert.deepEqual(ledger(upgradeDatabase), originalLedger);
      assert.deepEqual(fingerprint(upgradeDatabase), original);
      return { rejectedLegacyLedger: true, businessDataUnchanged: true };
    });

    await check('A late DDL conflict rolls back earlier migrations and the legacy checksum change', () => {
      sql(upgradeDatabase, 'ALTER TABLE requests ADD COLUMN cancellation_reason text;');
      try {
        const log = oneOff(name('migration-fault'), upgradeDatabase, byService.backend.Image, ['node', 'dist/database/migrate.js'], 1);
        assert(log.includes('Database migration failed'), 'The migration CLI must report the failure.');
        assert.equal(sql(upgradeDatabase, "SELECT to_regclass('public.provider_operations') IS NULL;"), 't');
        assert.equal(sql(upgradeDatabase, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations' AND column_name='checksum';"), '0');
        assert.deepEqual(ledger(upgradeDatabase), originalLedger);
      } finally { sql(upgradeDatabase, 'ALTER TABLE requests DROP COLUMN cancellation_reason;'); }
      assert.deepEqual(fingerprint(upgradeDatabase), original);
      return { originalLedgerPreserved: true, migration005RolledBack: true, legacyTablesPreserved: legacyTables.length };
    });

    await check('Operator upgrade to migration 025 preserves historical rows and is idempotent', () => {
      const sourceKey = sql(upgradeDatabase, 'SELECT asset_id FROM cryptographic_keys ORDER BY asset_id LIMIT 1;');
      const destinationAsset = sql(upgradeDatabase, "SELECT id FROM crypto_assets WHERE asset_type='CERTIFICATE' ORDER BY id LIMIT 1;");
      for (const id of [sourceKey, destinationAsset]) assert.match(id, /^[a-f0-9-]{36}$/);
      // Demonstrate the old capability inside a rolled-back fixture transaction.
      sql(upgradeDatabase, `BEGIN; UPDATE cryptographic_keys SET asset_id='${destinationAsset}' WHERE asset_id='${sourceKey}'; ROLLBACK;`);
      assert.deepEqual(fingerprint(upgradeDatabase), original);
      const started = Date.now();
      oneOff(name('migration'), upgradeDatabase, byService.backend.Image, ['node', 'dist/database/migrate.js'], 0);
      const migrationMs = Date.now() - started;
      const upgraded = ledger(upgradeDatabase, true);
      assert.equal(upgraded.length, 25);
      const recentVersions = ['018_key_asset_identity', '019_auth_mfa', '020_two_stage_approval',
        '021_auth_oidc', '022_report_exports', '023_audit_anchor_source', '024_asset_expiry_page_index', '025_expiry_scan_status'];
      assert.deepEqual(upgraded.slice(-recentVersions.length).map(item => item.version), recentVersions);
      assert.equal(sql(upgradeDatabase, "SELECT indisvalid FROM pg_index WHERE indexrelid='public.idx_audit_text_trgm'::regclass;"), 't');
      assert.equal(sql(upgradeDatabase, "SELECT indisvalid FROM pg_index WHERE indexrelid='public.idx_assets_expiry_page'::regclass;"), 't');
      assert.equal(sql(upgradeDatabase, "SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.cryptographic_keys'::regclass AND tgname='trg_key_asset_identity';"), 'O');
      sql(upgradeDatabase, `DO $identity_test$ BEGIN
        BEGIN
          UPDATE cryptographic_keys SET asset_id='${destinationAsset}' WHERE asset_id='${sourceKey}';
          RAISE EXCEPTION 'KEY_REASSIGNMENT_WAS_ALLOWED';
        EXCEPTION WHEN check_violation THEN
          IF SQLERRM <> 'KEY_ASSET_LINK_IMMUTABLE' THEN RAISE; END IF;
        END;
      END; $identity_test$;`);
      assert(upgraded.every(entry => /^[a-f0-9]{64}$/.test(entry.checksum)));
      assert.deepEqual(upgraded.slice(0, legacyVersions.length).map(({ version, applied_at }) => ({ version, applied_at })), originalLedger);
      assert.deepEqual(fingerprint(upgradeDatabase, 'candidate'), originalProjected);
      assert.equal(sql(upgradeDatabase, 'SELECT count(*) FROM auth_sessions WHERE mfa_token_version IS NOT NULL OR oidc_session_id IS NOT NULL;'), '0');
      assert.equal(sql(upgradeDatabase, 'SELECT count(*) FROM request_decisions WHERE approval_level<>1;'), '0');
      assert.equal(sql(upgradeDatabase, 'SELECT last_value,is_called FROM audit_logs_id_seq;'), beforeSeq);
      assert.equal(sql(upgradeDatabase, "SELECT count(*) FROM crypto_assets WHERE provider_scope='MOCK' AND asset_code IN ('KEY-DEV-001','KEY-DEV-OLD','KEY-DEV-NEW');"), '3');
      const updatedAssets = JSON.parse(sql(upgradeDatabase, 'SELECT json_agg(row_to_json(a)) FROM (SELECT id,asset_code,provider_scope,updated_at FROM crypto_assets) a;'));
      for (const asset of updatedAssets) {
        const imported = asset.asset_code === 'LEGACY-IMPORT-T46';
        assert.equal(asset.provider_scope, imported ? null : 'MOCK');
        if (imported) assert.equal(asset.updated_at, originalAssetTimestamps[asset.id]);
        else assert(Date.parse(asset.updated_at) > Date.parse(originalAssetTimestamps[asset.id]));
      }
      const migrated = fingerprint(upgradeDatabase);
      oneOff(name('migration-repeat'), upgradeDatabase, byService.backend.Image, ['node', 'dist/database/migrate.js'], 0);
      assert.deepEqual(ledger(upgradeDatabase, true), upgraded);
      assert.deepEqual(fingerprint(upgradeDatabase), migrated);
      return { migrationMs, versions: upgraded.map(entry => entry.version), legacyTablesPreserved: legacyTables.length,
        auditSequencePreserved: true, providerScopeBackfillTouchedSeedTimestamps: true, unverifiedImportUnchanged: true,
        legacyKeyReassignmentDemonstratedInRollback: true, migratedKeyReassignmentDenied: true };
    });

    await check('Candidate serves migrated data with a restricted runtime LOGIN', async () => {
      assert.equal(sql(sourceDatabase, `SELECT count(*) FROM pg_roles WHERE rolname='${runtimeRole}';`), '0');
      sql(sourceDatabase, `CREATE ROLE "${runtimeRole}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${runtimePassword}';`);
      roleResources.add(runtimeRole);
      applyRuntimeGrants(upgradeDatabase);
      const candidate = startApi('candidate', upgradeDatabase, byService.backend.Image, true);
      try {
        await waitReady(candidate, '/health/ready');
        assert.equal(probe(candidate, '/health/ready', true), 'PASS');
        assert.equal(sql(upgradeDatabase, `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='${runtimeRole}' AND application_name='crypta-api';`) !== '0', true);
        assert.equal(sql(upgradeDatabase, `SELECT has_table_privilege('${runtimeRole}','audit_logs','UPDATE') OR has_table_privilege('${runtimeRole}','audit_logs','DELETE');`), 'f');
      } finally { removeContainer(candidate); }
      return { readiness: true, ownerLineage: true, adminAudit: true, runtimeCannotUpdateOrDeleteAudit: true };
    });

    await check('Restore the original dump in a separate database and restart the baseline API', async () => {
      const started = Date.now();
      allocate(restoredDatabase);
      assert.equal(hash(dump), report.backup.sha256);
      pg('pg_restore', restoredDatabase, ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl'], { input: dump });
      assert.deepEqual(fingerprint(restoredDatabase), original);
      assert.deepEqual(ledger(restoredDatabase), originalLedger);
      assert.equal(sql(restoredDatabase, 'SELECT last_value,is_called FROM audit_logs_id_seq;'), beforeSeq);
      const restored = startApi('restored', restoredDatabase, baselineImage);
      try {
        await waitReady(restored, '/health');
        assert.equal(probe(restored, '/health', true), 'PASS');
        return { restoreThroughSmokeMs: Date.now() - started, legacyTablesMatched: legacyTables.length, auditSequenceMatched: true };
      } finally { removeContainer(restored); }
    });

    await check('Restore the candidate under a new owner and reapply restricted runtime grants', async () => {
      const tables = JSON.parse(sql(upgradeDatabase, `SELECT json_agg(tablename ORDER BY tablename)
        FROM pg_tables WHERE schemaname='public';`));
      assert(tables.includes('schema_migrations') && tables.includes('report_exports'));
      const snapshot = fingerprint(upgradeDatabase, 'full', tables);
      const checksummedLedger = ledger(upgradeDatabase, true);
      const auditSequence = sql(upgradeDatabase, 'SELECT last_value,is_called FROM audit_logs_id_seq;');
      const expectedGrants = runtimeGrants(upgradeDatabase);
      assert(expectedGrants.length > tables.length);
      const candidateDump = pg('pg_dump', upgradeDatabase, ['--format=custom', '--no-owner', '--no-acl']);
      assert.equal(candidateDump.subarray(0, 5).toString(), 'PGDMP');
      const started = Date.now();
      assert.equal(sql(sourceDatabase, `SELECT count(*) FROM pg_roles WHERE rolname='${restoreOwner}';`), '0');
      sql(sourceDatabase, `CREATE ROLE "${restoreOwner}" NOLOGIN;`);
      roleResources.add(restoreOwner);
      allocate(candidateRestore, restoreOwner);
      pg('pg_restore', candidateRestore, ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
        `--role=${restoreOwner}`], { input: candidateDump });

      assert.deepEqual(fingerprint(candidateRestore, 'full', tables), snapshot);
      assert.deepEqual(ledger(candidateRestore, true), checksummedLedger);
      assert.equal(sql(candidateRestore, 'SELECT last_value,is_called FROM audit_logs_id_seq;'), auditSequence);
      assert.equal(sql(candidateRestore, `SELECT datdba='${restoreOwner}'::regrole FROM pg_database WHERE datname=current_database();`), 't');
      assert.equal(sql(candidateRestore, `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m') AND c.relowner<>'${restoreOwner}'::regrole;`), '0');
      assert.equal(sql(candidateRestore, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proowner<>'${restoreOwner}'::regrole AND NOT EXISTS(
          SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');`), '0');
      assert.equal(sql(candidateRestore, `SELECT has_table_privilege('${runtimeRole}','audit_logs','SELECT');`), 'f');
      assert.equal(sql(candidateRestore, `SELECT has_database_privilege('${runtimeRole}',current_database(),'CONNECT');`), 'f');
      const anchorExecution = `SELECT has_function_privilege('${runtimeRole}','public.capture_audit_anchor_rows(bigint,integer)','EXECUTE');`;
      // --no-acl recreates the default grant. The isolated DB is still closed to runtime.
      assert.equal(sql(candidateRestore, anchorExecution), 't');
      applyRuntimeGrants(candidateRestore);
      assert.equal(sql(candidateRestore, anchorExecution), 'f');
      assert.deepEqual(runtimeGrants(candidateRestore), expectedGrants);
      assert.equal(sql(candidateRestore, `SELECT has_database_privilege('${runtimeRole}',current_database(),'CONNECT')
        AND NOT has_database_privilege('${runtimeRole}',current_database(),'CREATE,TEMP')
        AND has_schema_privilege('${runtimeRole}','public','USAGE')
        AND NOT has_schema_privilege('${runtimeRole}','public','CREATE');`), 't');
      sql(candidateRestore, `BEGIN; SET LOCAL ROLE "${runtimeRole}";
        DO $denials$ BEGIN
          BEGIN UPDATE audit_logs SET outcome=outcome WHERE false;
            RAISE EXCEPTION 'AUDIT_UPDATE_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN DELETE FROM audit_logs WHERE false;
            RAISE EXCEPTION 'AUDIT_DELETE_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN CREATE TABLE public.crypta_acl_fixture(id integer);
            RAISE EXCEPTION 'DDL_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN PERFORM * FROM public.capture_audit_anchor_rows(0,1);
            RAISE EXCEPTION 'ANCHOR_EXECUTE_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        END $denials$; ROLLBACK;`);

      const candidate = startApi('restore-rc', candidateRestore, byService.backend.Image, true);
      try {
        await waitReady(candidate, '/health/ready');
        assert.equal(probe(candidate, '/health/ready', true), 'PASS');
        assert.notEqual(sql(candidateRestore, `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
          AND usename='${runtimeRole}' AND application_name='crypta-api';`), '0');
      } finally { removeContainer(candidate); }
      return { restoreThroughSmokeMs: Date.now() - started, tablesMatched: tables.length, auditSequenceMatched: true,
        ledgerVersions: checksummedLedger.length, backupSha256: hash(candidateDump), ownershipReassigned: true,
        runtimeGrantsMatched: expectedGrants.length, runtimeDdlAndAuditMutationDenied: true, runtimeAnchorExecuteDenied: true };
    });
  } catch (error) {
    report.error = String(error.message).slice(0, 350);
  } finally {
    const cleanupErrors = [];
    const clean = operation => { try { operation(); } catch (error) { cleanupErrors.push(String(error.message).slice(0, 150)); } };
    for (const container of [...testContainers]) clean(() => removeContainer(container));
    for (const database of dbResources) clean(() => sql(sourceDatabase, `DROP DATABASE "${database}" WITH (FORCE);`));
    for (const role of roleResources) clean(() => sql(sourceDatabase, `DROP ROLE "${role}";`));
    if (imageCreated) clean(() => docker(['image', 'rm', baselineImage]));
    clean(() => {
      assert.equal(sql(sourceDatabase, `SELECT count(*) FROM pg_database WHERE datname IN ('${upgradeDatabase}','${restoredDatabase}','${candidateRestore}');`), '0');
      assert.equal(sql(sourceDatabase, `SELECT count(*) FROM pg_roles WHERE rolname IN ('${runtimeRole}','${restoreOwner}');`), '0');
      assert.deepEqual(inventory(), before);
      report.containerIdentitiesPreserved = before.length;
    });
    report.cleanupCompleted = cleanupErrors.length === 0;
    if (cleanupErrors.length) report.cleanupErrors = cleanupErrors;
    report.success = report.tests.length === 7 && report.tests.every(test => test.passed) && report.cleanupCompleted;
    report.finishedUtc = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(`Upgrade report: ${path.join(output, 'results.json')}`);
    if (!report.success) process.exitCode = 1;
  }
}

main(process.argv[2]).catch(error => { console.error(String(error.message).slice(0, 400)); process.exitCode = 1; });
