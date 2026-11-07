// Executed only by the validated isolated-policy host in a newly allocated DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

async function main(options) {
  assert.match(options.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.match(options.database, /^crypta_policy_test_[a-f0-9]{12}$/);
  assert.ok(['before', 'after'].includes(options.phase));
  assert.equal(process.env.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(process.env.SMTP_ENABLED, 'false');
  const connection = new URL(process.env.DATABASE_URL);
  assert.equal(connection.hostname, 'postgres');
  assert.equal(connection.pathname, '/crypta_t30_test');
  assert.equal(connection.username, 'crypta_t30_test');
  connection.pathname = `/${options.database}`;
  require('/app/node_modules/reflect-metadata');
  const { Pool } = require('/app/node_modules/pg');
  const { Logger, ValidationPipe } = require('/app/node_modules/@nestjs/common');
  const { PoliciesController, PolicyVersionDto } = require('/app/dist/policies/policies.controller.js');
  const { MigrationService } = require('/app/dist/database/migration.service.js');
  Logger.overrideLogger([]);
  const pool = new Pool({ connectionString: connection.href, max: 5,
    statement_timeout: 10000, application_name: 'crypta-policy-integration' });
  const report = { database: options.database, phase: options.phase, fixtureOnly: false,
    actualServiceInstances: ['PoliciesController', 'ValidationPipe', 'MigrationService'],
    compiledServiceHashes: Object.fromEntries(['policies/policies.controller.js',
      'database/migration.service.js'].map(relative => [relative,
      crypto.createHash('sha256').update(fs.readFileSync(`/app/dist/${relative}`)).digest('hex')])),
    results: [], diagnostics: {} };
  const uuid = () => crypto.randomUUID();
  const department = uuid(), owner = uuid(), admin = uuid(), policy = uuid();
  const usedVersion = uuid(), unusedVersion = uuid(), asset = uuid(), request = uuid();
  const actor = { id: admin, roles: ['ADMIN'] };
  const dto = { expectedVersion: 2, algorithm: 'RSA', minimumKeySize: 2048,
    maximumValidityDays: 365, warningDays: [30, 7, 1] };
  const controller = new PoliciesController(pool);
  const validation = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const latest = async () => Number((await pool.query('SELECT MAX(version) AS value FROM policy_versions WHERE policy_id=$1', [policy])).rows[0].value);
  const versions = async () => Number((await pool.query('SELECT COUNT(*)::int AS value FROM policy_versions WHERE policy_id=$1', [policy])).rows[0].value);
  const audits = async () => Number((await pool.query("SELECT COUNT(*)::int AS value FROM audit_logs WHERE entity_id=$1 AND action='POLICY_VERSION_CREATED'", [policy])).rows[0].value);
  const configuration = async () => (await pool.query('SELECT configuration FROM policy_versions WHERE id=$1', [usedVersion])).rows[0].configuration;
  async function binding() {
    return (await pool.query(`SELECT a.policy_version_id AS asset_version,r.policy_version_id AS request_version,
      pa.configuration AS asset_configuration,pr.configuration AS request_configuration
      FROM crypto_assets a JOIN policy_versions pa ON pa.id=a.policy_version_id
      CROSS JOIN requests r JOIN policy_versions pr ON pr.id=r.policy_version_id
      WHERE a.id=$1 AND r.id=$2`, [asset, request])).rows[0];
  }
  async function test(name, run) {
    try { report.results.push({ name, passed: true, evidence: await run() ?? null }); }
    catch (error) { report.results.push({ name, passed: false, evidence: report.diagnostics[name] ?? null,
      error: error instanceof assert.AssertionError ? error.message : `${error.name}: ${String(error.message).slice(0, 300)}` }); }
  }
  try {
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, options.database);
    await new MigrationService(pool).applyPending();
    report.immutableMigrationApplied = (await pool.query("SELECT COUNT(*)::int AS value FROM schema_migrations WHERE version='008_policy_versions_immutable'")).rows[0].value === 1;
    assert.equal(report.immutableMigrationApplied, options.phase === 'after', 'Phase must match the actual compiled migrations.');
    await pool.query("INSERT INTO departments(id,code,name) VALUES($1,'POLICY_TEST','Policy integration')", [department]);
    for (const [id, name] of [[owner, 'owner'], [admin, 'admin']]) await pool.query(`INSERT INTO users(id,department_id,email,password_hash,display_name)
      VALUES($1,$2,$3,'not-a-login-credential',$4)`, [id, department, `${name}@policy.example.test`, `Policy ${name}`]);
    await pool.query("INSERT INTO policies(id,code,name) VALUES($1,'POLICY_TEST','Published snapshot test')", [policy]);
    const config = { algorithm: 'RSA', minimum_key_size: 2048, maximum_validity_days: 365, warning_days: [30, 7, 1] };
    await pool.query(`INSERT INTO policy_versions(id,policy_id,version,configuration,changed_by)
      VALUES($1,$3,1,$4::jsonb,$5),($2,$3,2,$4::jsonb,$5)`, [usedVersion, unusedVersion, policy, JSON.stringify(config), admin]);
    await pool.query(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at)
      VALUES($1,'POLICY_BOUND_ASSET','KEY',$2,$3,$4,'Policy version binding','ACTIVE',NOW(),NOW()+INTERVAL '90 days')`, [asset, owner, department, usedVersion]);
    await pool.query(`INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,status,reason,requested_parameters)
      VALUES($1,'CREATE',$2,$3,$4,'PENDING','Policy snapshot integration','{"assetType":"KEY","algorithm":"RSA","keySize":2048,"validityDays":90}')`, [request, owner, department, usedVersion]);
    await test('Production ValidationPipe rejects malformed warning days without touching PostgreSQL', async () => {
      const before = await versions();
      const cases = [undefined, null, '7', ['7'], [7.5], [0], [-1], [3651], [2147483648], [null], {}, [[7]], [7, 7]];
      for (const warningDays of cases) {
        const value = { ...dto, ...(warningDays === undefined ? {} : { warningDays }) };
        if (warningDays === undefined) delete value.warningDays;
        await assert.rejects(validation.transform(value, { type: 'body', metatype: PolicyVersionDto }),
          error => error.getStatus?.() === 400);
      }
      for (const warningDays of [[], [1, 3650], [30, 7, 1]]) {
        const value = await validation.transform({ ...dto, maximumValidityDays: 3650, warningDays }, { type: 'body', metatype: PolicyVersionDto });
        assert.deepEqual(value.warningDays, warningDays);
      }
      assert.equal(await versions(), before);
      return { invalidCases: cases.length, acceptedEmptyAndValidBounds: true, databaseWrites: 0 };
    });
    await test('Warning threshold above validity is rejected before pool.connect', async () => {
      let connects = 0;
      const preflight = new PoliciesController({ connect() { connects += 1; throw new Error('Unexpected connection'); } });
      await assert.rejects(preflight.version(actor, policy, { ...dto, maximumValidityDays: 6, warningDays: [7] }),
        error => error.getStatus?.() === 409 && error.getResponse?.().code === 'POLICY_CONFIGURATION_INVALID');
      assert.equal(connects, 0);
      return { conflict: 'POLICY_CONFIGURATION_INVALID', connected: false };
    });
    const updateName = 'Published version configuration UPDATE is denied and existing asset/request snapshots stay unchanged';
    await test(updateName, async () => {
      const before = await configuration();
      let failure;
      try { await pool.query("UPDATE policy_versions SET configuration=jsonb_set(configuration,'{warning_days}','[5]'::jsonb) WHERE id=$1", [usedVersion]); }
      catch (error) { failure = error; }
      const after = await configuration(), bound = await binding();
      report.diagnostics[updateName] = { updateAllowed: !failure, errorCode: failure?.code ?? null,
        beforeWarningDays: before.warning_days, afterWarningDays: after.warning_days,
        assetStillReferencesSameId: bound.asset_version === usedVersion,
        requestStillReferencesSameId: bound.request_version === usedVersion,
        boundConfigurationChanged: JSON.stringify(bound.asset_configuration) !== JSON.stringify(before) };
      assert.equal(failure?.code, '23514', 'Published configuration UPDATE must be denied by the immutable trigger.');
      assert.match(failure.message, /POLICY_VERSION_IMMUTABLE/);
      assert.deepEqual(after, before);
      assert.deepEqual(bound.asset_configuration, before);
      assert.deepEqual(bound.request_configuration, before);
      return report.diagnostics[updateName];
    });
    const deleteName = 'Published version DELETE is denied even before any asset or request references it';
    await test(deleteName, async () => {
      let failure;
      try { await pool.query('DELETE FROM policy_versions WHERE id=$1', [unusedVersion]); }
      catch (error) { failure = error; }
      const remaining = (await pool.query('SELECT COUNT(*)::int AS value FROM policy_versions WHERE id=$1', [unusedVersion])).rows[0].value;
      report.diagnostics[deleteName] = { deleteAllowed: !failure, errorCode: failure?.code ?? null, versionRowsRemaining: remaining };
      assert.equal(failure?.code, '23514', 'All published versions are append-only, including currently unreferenced versions.');
      assert.match(failure.message, /POLICY_VERSION_IMMUTABLE/);
      assert.equal(remaining, 1);
      return report.diagnostics[deleteName];
    });
    await test('Actual controller appends a new policy snapshot and audit while existing bindings remain on the previous ID', async () => {
      const before = await binding(), count = await versions(), auditCount = await audits(), current = await latest();
      const result = await controller.version(actor, policy, { ...dto, expectedVersion: current, warningDays: [14, 2] });
      assert.equal(result.version, current + 1);
      assert.notEqual(result.id, usedVersion);
      assert.deepEqual(result.configuration.warning_days, [14, 2]);
      assert.equal(await versions(), count + 1);
      assert.equal(await audits(), auditCount + 1);
      assert.deepEqual(await binding(), before);
      return { newVersion: result.version, assetAndRequestBindingUnchanged: true, versionRowsAdded: 1, auditRowsAdded: 1 };
    });
    await test('Two actual controller writers with the same expectedVersion commit one append and one audit', async () => {
      const before = await versions(), auditCount = await audits(), current = await latest();
      const second = new PoliciesController(pool);
      const outcomes = await Promise.allSettled([
        controller.version(actor, policy, { ...dto, expectedVersion: current, warningDays: [10] }),
        second.version(actor, policy, { ...dto, expectedVersion: current, warningDays: [20] }),
      ]);
      const success = outcomes.filter(result => result.status === 'fulfilled');
      const rejected = outcomes.filter(result => result.status === 'rejected');
      assert.equal(success.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.getResponse().code, 'VERSION_CONFLICT');
      assert.equal(await versions(), before + 1);
      assert.equal(await audits(), auditCount + 1);
      assert.equal(await latest(), current + 1);
      return { outcomes: ['success', 'VERSION_CONFLICT'], committedVersionRows: 1, committedAuditRows: 1 };
    });
    await test('A stale append rolls back without adding a version or audit', async () => {
      const before = await versions(), auditCount = await audits(), current = await latest();
      await assert.rejects(controller.version(actor, policy, { ...dto, expectedVersion: current - 1 }),
        error => error.getResponse?.().code === 'VERSION_CONFLICT');
      assert.equal(await versions(), before);
      assert.equal(await audits(), auditCount);
      return { staleWrite: 'VERSION_CONFLICT', versionRowsAdded: 0, auditRowsAdded: 0 };
    });
    await test('A real audit INSERT failure rolls back the appended policy version', async () => {
      const before = await versions(), auditCount = await audits(), current = await latest();
      // Fault trigger exists only in this allocated test DB and disappears with it.
      await pool.query(`CREATE FUNCTION policy_test_fail_audit() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN IF NEW.action='POLICY_VERSION_CREATED' THEN RAISE EXCEPTION 'POLICY_TEST_AUDIT_FAILURE' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER policy_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION policy_test_fail_audit()`);
      await assert.rejects(controller.version(actor, policy, { ...dto, expectedVersion: current }), error => error.code === 'P0001');
      assert.equal(await versions(), before);
      assert.equal(await audits(), auditCount);
      assert.equal(await latest(), current);
      return { faultAfterVersionInsert: true, versionInsertRolledBack: true, auditRowsAdded: 0 };
    });
    report.success = report.results.every(test => test.passed);
  } catch {
    report.success = false;
    report.results.push({ name: 'Harness initialization', passed: false, error: 'Policy harness initialization failed without exposing connection data.' });
  } finally { await pool.end(); }
  return report;
}

if (typeof module !== 'undefined') module.exports = { main };
