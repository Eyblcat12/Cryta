// Runs only inside the validated backend container, in a new worker-test DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

async function crashWorker(database, clock, boundary) {
  const assert = require('node:assert/strict');
  assert.match(database, /^crypta_worker_test_[a-f0-9]{12}$/);
  assert.ok(['CLAIMED', 'SENT', 'BEFORE_COMMIT'].includes(boundary));
  assert.equal(process.env.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(process.env.SMTP_ENABLED, 'false');
  const connection = new URL(process.env.DATABASE_URL);
  assert.equal(connection.hostname, 'postgres');
  assert.equal(connection.username, 'crypta_t30_test');
  assert.equal(connection.pathname, '/crypta_t30_test');
  connection.pathname = `/${database}`;
  require('/app/node_modules/reflect-metadata');
  const { Pool } = require('/app/node_modules/pg');
  const { AssetProcessingService } = require('/app/dist/jobs/asset-processing.service.js');
  const { CryptoProviderService } = require('/app/dist/jobs/crypto-provider.service.js');
  const { NotificationsService } = require('/app/dist/notifications/notifications.service.js');
  const pool = new Pool({ connectionString: connection.href, max: 2, statement_timeout: 10000,
    application_name: `crypta-crash-fixture-${boundary}` });
  const connect = async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('TimeZone','UTC',false),set_config('search_path','worker_test_clock,public,pg_catalog',false),set_config('crypta.worker_test_now',$1,false)", [new Date(clock).toISOString()]);
      return client;
    } catch (error) { client.release(); throw error; }
  };
  const workerPool = { connect, async query(text, values) {
    const client = await connect();
    try { return await client.query(text, values); } finally { client.release(); }
  } };
  process.on('message', nextClock => { clock = nextClock; });
  let providerCalls = 0;
  const park = (operationId, evidence) => {
    process.send({ operationId, providerCalls, evidence });
    return new Promise(() => {});
  };
  const mock = new CryptoProviderService();
  const provider = { async provision(input) {
    providerCalls++;
    if (boundary === 'SENT') return park(input.operationId);
    return mock.provision(input);
  } };
  const worker = new AssetProcessingService(workerPool, provider, new NotificationsService(workerPool));
  if (boundary === 'CLAIMED') {
    worker.prepareProviderCall = job => park(job.id);
  } else if (boundary === 'BEFORE_COMMIT') {
    const complete = worker.complete.bind(worker);
    worker.complete = async (client, job, prepared, result) => {
      await complete(client, job, prepared, result);
      const { rows: [evidence] } = await client.query(`SELECT r.status, r.result_asset_id IS NOT NULL AS "hasAsset",
        (SELECT count(*)::int FROM audit_logs WHERE request_id=r.id AND action='ASSET_CREATED') AS audits,
        (SELECT count(*)::int FROM notifications WHERE request_id=r.id AND type='REQUEST_COMPLETED') AS notifications
        FROM requests r WHERE r.id=$1`, [job.id]);
      await park(job.id, evidence);
    };
  }
  await worker.run();
  await pool.end();
}

async function main(options) {
  assert.match(options.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.match(options.database, /^crypta_worker_test_[a-f0-9]{12}$/);
  assert.ok(['before', 'after'].includes(options.mode));
  assert.equal(process.env.CRYPTO_PROVIDER_MODE, 'MOCK'); assert.equal(process.env.SMTP_ENABLED, 'false');
  const connection = new URL(process.env.DATABASE_URL);
  assert.equal(connection.protocol, 'postgresql:'); assert.equal(connection.hostname, 'postgres');
  assert.equal(connection.username, 'crypta_t30_test'); assert.equal(connection.pathname, '/crypta_t30_test');
  connection.pathname = `/${options.database}`;
  require('/app/node_modules/reflect-metadata');
  const { Pool } = require('/app/node_modules/pg');
  const { Logger } = require('/app/node_modules/@nestjs/common'); Logger.overrideLogger([]);
  const { AssetProcessingService } = require('/app/dist/jobs/asset-processing.service.js');
  const { CryptoProviderService } = require('/app/dist/jobs/crypto-provider.service.js');
  const { NotificationsService } = require('/app/dist/notifications/notifications.service.js');
  const { MigrationService } = require('/app/dist/database/migration.service.js');
  const pool = new Pool({ connectionString: connection.href, max: 8, statement_timeout: 10000, application_name: 'crypta-worker-recovery-integration' });
  const results = [], diagnostics = [];
  const report = {
    database: options.database, mode: options.mode, fixtureOnly: false, provider: 'MOCK', smtpEnabled: false,
    plannedTotal: options.mode === 'before' ? 3 : 36, results, diagnostics,
    clockMethod: 'Schema-local now() with explicit search_path and per-session UTC clock; service SQL and original timestamp trigger remain installed.',
    actualServiceInstances: ['AssetProcessingService', 'CryptoProviderService', 'NotificationsService', 'MigrationService'],
    compiledServiceHashes: Object.fromEntries(['jobs/asset-processing.service.js', 'jobs/crypto-provider.service.js',
      ...(options.mode === 'after' ? ['jobs/crypto-provider-config.js'] : []),
      'notifications/notifications.service.js', 'database/migration.service.js', 'requests/request-policy.js'].map(relative => [relative,
      crypto.createHash('sha256').update(fs.readFileSync(`/app/dist/${relative}`)).digest('hex')])),
    limitations: ['Three SIGKILL cases stop a disposable worker inside the isolated backend container. The 15-minute lease expiry uses a synthetic PostgreSQL clock.',
      'MOCK reference determinism does not validate a real provider idempotency or lookup contract.',
      'HTTP cases use a loopback fixture and a self-signed public certificate. Vendor integration, CA chain trust, and provider lookup remain external.'],
  };
  const base = Date.parse('2032-01-01T12:00:00.000Z'), minute = 60000;
  let now = base, provisionCalls = 0, revokeCalls = 0, connectFailure = false, pauseConnect;
  const provisionInputs = [], revokeInputs = [];
  const id = () => crypto.randomUUID(), department = id(), otherDepartment = id(), owner = id(), otherOwner = id(), policy = id(), policyVersion = id();
  async function connect() {
    if (connectFailure) { connectFailure = false; throw new Error('WORKER_TEST_CONNECT_FAILURE'); }
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('TimeZone','UTC',false),set_config('search_path','worker_test_clock,public,pg_catalog',false),set_config('crypta.worker_test_now',$1,false)", [new Date(now).toISOString()]);
      assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, options.database);
      if (pauseConnect) await pauseConnect();
    } catch (error) { client.release(); throw error; }
    return client;
  }
  let loseReceiptAcknowledgment = false;
  const workerPool = { connect, async query(text, values) {
    const client = await connect();
    try {
      const result = await client.query(text, values);
      if (loseReceiptAcknowledgment && text.includes('receipt=$4::jsonb')) {
        loseReceiptAcknowledgment = false;
        throw new Error('Synthetic disconnect after PostgreSQL committed the receipt');
      }
      return result;
    } finally { client.release(); }
  } };
  const sql = (text, values) => workerPool.query(text, values);
  const actualProvider = new CryptoProviderService();
  let pauseProvider;
  const provider = {
    async provision(input) { provisionCalls += 1; provisionInputs.push(structuredClone(input)); const result = await actualProvider.provision(input); if (pauseProvider) await pauseProvider(); return result; },
    async revoke(reference, operationId) { revokeCalls += 1; revokeInputs.push({ reference, operationId }); const result = await actualProvider.revoke(reference, operationId); if (pauseProvider) await pauseProvider(); return result; },
  };
  const notifications = new NotificationsService(workerPool);
  const worker = () => new AssetProcessingService(workerPool, provider, notifications);
  async function reset() {
    pauseConnect = undefined; pauseProvider = undefined; connectFailure = false; loseReceiptAcknowledgment = false; now = base;
    assert.equal((await sql('SELECT current_database() AS name')).rows[0].name, options.database);
    await sql('TRUNCATE public.notifications,public.audit_logs,public.provider_operations,public.requests,public.crypto_assets CASCADE');
    await sql('UPDATE policies SET is_active=TRUE WHERE id=$1', [policy]);
    provisionCalls = 0; revokeCalls = 0; provisionInputs.length = 0; revokeInputs.length = 0;
  }
  async function approved(ageMinutes = 0, values = {}) {
    const requestId = id();
    await sql(`INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,target_asset_id,status,reason,requested_parameters,submitted_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'APPROVED','Worker isolated recovery',$7::jsonb,$8,$8)`,
    [requestId, values.type ?? 'CREATE', owner, department, values.policyVersion ?? policyVersion, values.target ?? null,
      JSON.stringify(values.parameters ?? {assetType:'KEY',algorithm:'RSA',keySize:2048,usage:'SIGNING',validityDays:90}), new Date(now - ageMinutes * minute)]);
    return requestId;
  }
  async function targetAsset() {
    const assetId = id();
    await sql(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at,provider_reference,provider_scope)
      VALUES($1,$2,'KEY',$3,$4,$5,'Worker target guard','ACTIVE',$6,$7,$8,'MOCK')`,
    [assetId, `WORKER-${assetId}`, owner, department, policyVersion, new Date(base-minute), new Date(base+90*24*60*minute), `original-${assetId}`]);
    await sql("INSERT INTO cryptographic_keys(asset_id,algorithm,key_size,usage,public_key_fingerprint) VALUES($1,'RSA',2048,'SIGNING',$2)", [assetId, `fingerprint-${assetId}`]);
    return assetId;
  }
  async function targetState(assetId) {
    return (await sql(`SELECT a.*,k.algorithm,k.key_size,k.usage FROM crypto_assets a LEFT JOIN cryptographic_keys k ON k.asset_id=a.id WHERE a.id=$1`, [assetId])).rows[0];
  }
  async function freshPolicy(configuration, effectiveFrom = new Date(base-minute)) {
    const policyId=id(), versionId=id();
    await sql('INSERT INTO policies(id,code,name) VALUES($1,$2,$3)', [policyId, `WORKER-${policyId}`, 'Worker guard policy']);
    await sql('INSERT INTO policy_versions(id,policy_id,version,configuration,effective_from) VALUES($1,$2,1,$3::jsonb,$4)', [versionId, policyId, JSON.stringify(configuration), effectiveFrom]);
    return { policyId, versionId };
  }
  async function withHttpFixture(run) {
    const certificate = new crypto.X509Certificate(options.certificatePem);
    const validFrom = new Date(+certificate.validFromDate - minute).toISOString();
    const expiresAt = new Date(+certificate.validFromDate + 10 * 24 * 60 * minute).toISOString();
    const previousClock = Date.now;
    const token = crypto.randomBytes(24).toString('hex');
    const calls = [];
    const privateMarker = 'discarded-provider-fixture-field';
    let invalid = false;
    const server = http.createServer(async (request, response) => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}` ||
            request.headers['idempotency-key'] !== body.operationId) {
          response.writeHead(400).end(); return;
        }
        calls.push({ path: request.url, operationId: body.operationId, target: body.providerReference ?? body.replacesProviderReference });
        const result = request.url === '/assets/revoke' ? { revoked: true, providerReference: body.providerReference }
          : { assetType: body.assetType, status: 'ACTIVE', providerReference: `fixture-${body.operationId}`,
              ...(body.assetType === 'CERTIFICATE' ? { certificatePem: options.certificatePem } : {
                algorithm: body.algorithm, keySize: body.keySize, usage: body.usage,
                publicKeyFingerprint: `SHA256:${crypto.createHash('sha256').update(body.operationId).digest('hex')}`, validFrom, expiresAt,
              }) };
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...result,
          operationId: invalid ? 'mismatched-operation' : body.operationId, privateKey: privateMarker }));
      } catch { response.writeHead(400).end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const overrides = { NODE_ENV: 'test', CRYPTO_PROVIDER_MODE: 'HTTP', CRYPTO_PROVIDER_URL: `http://127.0.0.1:${server.address().port}`,
      CRYPTO_PROVIDER_TOKEN: token, CRYPTO_PROVIDER_SCOPE: 'isolated-fixture', CRYPTO_PROVIDER_TIMEOUT_MS: '2000' };
    const previousEnv = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, overrides);
      now = +certificate.validFromDate + minute;
      Date.now = () => now;
      return await run({ certificate, validFrom, expiresAt, calls, privateMarker, rejectResult: () => { invalid = true; } });
    } finally {
      Date.now = previousClock;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
  async function persistBoundary(stage = 'CLAIMED') {
    const requestId = await approved(), instance = worker(), job = await instance.claim();
    assert.equal(job.id, requestId);
    let reference = null;
    const prepared = stage === 'CLAIMED' ? null : await instance.prepareProviderCall(job);
    if (stage === 'PROVIDER_SUCCEEDED') {
      const result = await instance.callProvider(job, prepared);
      reference = result.providerReference; await instance.markProviderSucceeded(job, result);
    }
    return { requestId, instance, reference };
  }
  async function snapshot(requestId) {
    const request = (await sql('SELECT id,status,version,updated_at,result_asset_id FROM requests WHERE id=$1', [requestId])).rows[0];
    const operation = (await sql('SELECT status,attempt_count,provider_reference,last_error_code FROM provider_operations WHERE request_id=$1', [requestId])).rows[0];
    const audit = (await sql('SELECT action,outcome,metadata FROM audit_logs WHERE request_id=$1 ORDER BY id', [requestId])).rows;
    const assets = Number((await sql('SELECT COUNT(*)::int AS count FROM crypto_assets')).rows[0].count);
    return { request, operation, audit, assets, provisionCalls, revokeCalls };
  }
  async function withParkedWorker(boundary, requestId, inspect) {
    const input = JSON.stringify([options.database, base, boundary]);
    const child = spawn(process.execPath, ['-e', `(${crashWorker})(...${input}).catch(() => process.exit(1))`],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = once(child, 'exit');
    try {
      const [message] = await Promise.race([
        once(child, 'message', { signal: AbortSignal.timeout(10000) }),
        exited.then(() => { throw new Error('Crash fixture exited before reaching the boundary'); }),
      ]);
      assert.equal(message.operationId, requestId);
      await inspect(message, child);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      assert.deepEqual(await exited, [null, 'SIGKILL']);
    }
    // Wait for PostgreSQL to observe the closed socket and roll back the child's transaction.
    const deadline = Date.now() + 5000;
    do {
      const { rows: [{ active }] } = await sql(`SELECT count(*)::int AS active FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=$1`, [`crypta-crash-fixture-${boundary}`]);
      if (active === 0) return;
      await delay(50);
    } while (Date.now() < deadline);
    throw new Error('The killed worker still has a PostgreSQL session');
  }
  function reconciliation(snapshotValue, prior, reference, attempts) {
    assert.equal(snapshotValue.request.status, 'RECONCILIATION_REQUIRED');
    assert.equal(snapshotValue.request.version, prior.request.version + 1);
    assert.equal(snapshotValue.operation.status, 'RECONCILIATION_REQUIRED');
    assert.equal(snapshotValue.operation.provider_reference, reference);
    assert.equal(snapshotValue.operation.attempt_count, attempts);
    assert.equal(snapshotValue.audit.filter(item => item.action === 'REQUEST_RECONCILIATION_REQUIRED').length, 1);
    assert.equal(snapshotValue.assets, 0);
    assert.equal(snapshotValue.provisionCalls, prior.provisionCalls);
  }
  async function test(name, run) {
    try { results.push({ name, passed: true, evidence: await run() ?? null }); }
    catch (error) { results.push({ name, passed: false, error: error instanceof assert.AssertionError ? error.message : `${error.name}: ${String(error.message).slice(0, 300)}` }); }
  }
  async function installAuditFailure(action) {
    assert.ok(['REQUEST_RECONCILIATION_REQUIRED', 'ASSET_CREATED'].includes(action));
    await sql(`CREATE FUNCTION worker_test_clock.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'WORKER_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER worker_test_reject_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION worker_test_clock.reject_audit();`);
  }
  async function removeAuditFailure() {
    await sql('DROP TRIGGER IF EXISTS worker_test_reject_audit ON public.audit_logs;DROP FUNCTION IF EXISTS worker_test_clock.reject_audit();');
  }
  try {
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, options.database);
    await new MigrationService(pool).applyPending();
    await pool.query(`CREATE SCHEMA worker_test_clock;CREATE FUNCTION worker_test_clock.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT current_setting('crypta.worker_test_now')::timestamptz $$`);
    await sql('INSERT INTO departments(id,code,name) VALUES($1,\'WORKER_TEST\',\'Worker recovery integration\')', [department]);
    await sql('INSERT INTO departments(id,code,name) VALUES($1,\'WORKER_OTHER\',\'Worker other department\')', [otherDepartment]);
    await sql(`INSERT INTO users(id,department_id,email,password_hash,display_name) VALUES($1,$2,'worker-owner@example.test','not-a-login-credential','Worker metadata owner')`, [owner, department]);
    await sql(`INSERT INTO users(id,department_id,email,password_hash,display_name) VALUES($1,$2,'worker-other@example.test','not-a-login-credential','Worker other owner')`, [otherOwner, otherDepartment]);
    await sql("INSERT INTO policies(id,code,name) VALUES($1,'WORKER_TEST','Worker recovery policy')", [policy]);
    await sql(`INSERT INTO policy_versions(id,policy_id,version,configuration) VALUES($1,$2,1,'{"algorithm":"RSA","minimum_key_size":2048,"maximum_validity_days":90}')`, [policyVersion, policy]);
    report.originalRequestTimestampTriggerPresent = Number((await sql("SELECT COUNT(*)::int AS count FROM pg_trigger WHERE tgname='trg_requests_updated' AND NOT tgisinternal AND tgenabled<>'D'")).rows[0].count) === 1;
    assert.equal(report.originalRequestTimestampTriggerPresent, true);
    await test('Claim refreshes an old Approved request timestamp through the original DB trigger', async () => {
      await reset(); const requestId = await approved(30), before = (await sql('SELECT updated_at FROM requests WHERE id=$1', [requestId])).rows[0];
      await worker().claim(); const after = await snapshot(requestId);
      diagnostics.push({ name: 'Existing claim timestamp safeguard', before, after });
      assert.equal(after.request.updated_at.getTime(), base); assert.equal(after.request.status, 'PROCESSING');
      await worker().markStaleForReconciliation(); assert.equal((await snapshot(requestId)).request.status, 'PROCESSING');
      return { originalTimestampTriggerRetained: true, claimedAt: after.request.updated_at, providerCalls: provisionCalls };
    });
    let pending, young;
    await test('Startup sweep preserves a young persisted provider-success boundary', async () => {
      await reset(); pending = await persistBoundary('PROVIDER_SUCCEEDED'); young = await snapshot(pending.requestId);
      await worker().markStaleForReconciliation(); const after = await snapshot(pending.requestId);
      assert.deepEqual(after, young); assert.equal(after.request.status, 'PROCESSING');
      return after;
    });
    await test('Later poll reconciles the same persisted boundary after 15 minutes without replay', async () => {
      now = base + 16 * minute; await worker().run(); const after = await snapshot(pending.requestId);
      diagnostics.push({ name: 'Young startup then later stale poll', before: young, after });
      reconciliation(after, young, pending.reference, 1); return after;
    });
    if (options.mode === 'after') {
      for (const stage of ['CLAIMED', 'SENT']) await test(`${stage} crash boundary is reconciled without increasing attempt count or replay`, async () => {
        await reset(); const pendingState = await persistBoundary(stage), before = await snapshot(pendingState.requestId);
        now = base + 16 * minute; const instance = worker(); await instance.run(); const after = await snapshot(pendingState.requestId);
        reconciliation(after, before, null, stage === 'CLAIMED' ? 0 : 1); await instance.run(); assert.deepEqual(await snapshot(pendingState.requestId), after); return after;
      });
      await test('Two concurrent sweeps create exactly one reconciliation audit and version increment', async () => {
        await reset(); const boundary = await persistBoundary('PROVIDER_SUCCEEDED'), before = await snapshot(boundary.requestId);
        now = base + 16 * minute; await Promise.all([worker().run(), worker().run()]); const after = await snapshot(boundary.requestId);
        reconciliation(after, before, boundary.reference, 1); return after;
      });
      await test('A locked stale request does not block another worker from claiming unrelated work', async () => {
        await reset();
        const locked = await persistBoundary('SENT');
        const next = await approved();
        now = base + 16 * minute;
        const blocker = await connect();
        try {
          await blocker.query('BEGIN');
          await blocker.query('SELECT id FROM requests WHERE id=$1 FOR UPDATE', [locked.requestId]);
          const before = await snapshot(locked.requestId);
          await worker().run();
          const completed = await snapshot(next);
          assert.equal(completed.request.status, 'COMPLETED');
          assert.equal(completed.operation.attempt_count, 1);
          assert.equal((await snapshot(locked.requestId)).request.status, 'PROCESSING');
          assert.equal(provisionCalls, 1);
          await blocker.query('ROLLBACK');
          await worker().run();
          const after = await snapshot(locked.requestId);
          assert.equal(after.request.status, 'RECONCILIATION_REQUIRED');
          assert.equal(after.request.version, before.request.version + 1);
          assert.equal(after.audit.length, 1);
          assert.equal(after.operation.attempt_count, 1);
          assert.equal(provisionCalls, 1);
          return { unrelatedCompleted: true, staleReconciledAfterUnlock: true, providerCalls: provisionCalls };
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
        }
      });
      await test('An expired worker cannot renew its claim or call the provider before the next sweep', async () => {
        await reset();
        const requestId = await approved(), instance = worker(), job = await instance.claim();
        const before = await snapshot(requestId);
        now = base + 16 * minute;
        await instance.renewClaim(job);
        assert.deepEqual(await snapshot(requestId), before);
        await instance.process(job);
        const after = await snapshot(requestId);
        reconciliation(after, before, null, 0);
        assert.equal((await sql('SELECT failure_class FROM provider_operations WHERE request_id=$1', [requestId])).rows[0].failure_class, 'UNSENT_TRANSIENT');
        return { expiredClaimFenced: true, providerCalls: provisionCalls };
      });
      await test('A second process honors a real heartbeat, then reconciles once after SIGKILL without replay', async () => {
        await reset();
        const requestId = await approved();
        let renewed;
        await withParkedWorker('SENT', requestId, async (message, child) => {
          assert.equal(message.providerCalls, 1);
          const claimed = await snapshot(requestId);
          assert.equal(claimed.operation.status, 'SENT');
          child.send(base + 14 * minute);
          const deadline = Date.now() + 38_000;
          renewed = claimed;
          while (renewed.request.updated_at.getTime() === base && Date.now() < deadline) {
            await delay(250);
            renewed = await snapshot(requestId);
          }
          assert.equal(renewed.request.updated_at.getTime(), base + 14 * minute);
          assert.equal(renewed.request.version, claimed.request.version);
          now = base + 16 * minute;
          await worker().run();
          assert.deepEqual(await snapshot(requestId), renewed);
        });
        now = base + 30 * minute;
        await Promise.all([worker().run(), worker().run()]);
        const after = await snapshot(requestId);
        reconciliation(after, renewed, null, 1);
        assert.equal((await sql('SELECT failure_class FROM provider_operations WHERE request_id=$1', [requestId])).rows[0].failure_class, 'OUTCOME_UNKNOWN');
        await worker().run();
        assert.deepEqual(await snapshot(requestId), after);
        return { heartbeatObserved: true, exitSignal: 'SIGKILL', attempts: 1, reconciliations: 1, replayCalls: provisionCalls };
      });
      await test('Audit failure rolls back request and operation together, then the next poll recovers', async () => {
        await reset(); const boundary = await persistBoundary('PROVIDER_SUCCEEDED'), before = await snapshot(boundary.requestId);
        now = base + 16 * minute; await installAuditFailure('REQUEST_RECONCILIATION_REQUIRED'); const instance = worker();
        try { await instance.run(); assert.deepEqual(await snapshot(boundary.requestId), before); } finally { await removeAuditFailure(); }
        await instance.run(); const after = await snapshot(boundary.requestId); reconciliation(after, before, boundary.reference, 1); return { rollbackPreserved: before, recovered: after };
      });
      await test('Connection failure releases the run guard and a subsequent poll recovers', async () => {
        await reset(); const boundary = await persistBoundary('CLAIMED'), before = await snapshot(boundary.requestId);
        now = base + 16 * minute; connectFailure = true; const instance = worker(); await instance.run();
        assert.deepEqual(await snapshot(boundary.requestId), before); await instance.run(); const after = await snapshot(boundary.requestId);
        reconciliation(after, before, null, 0); return after;
      });
      await test('The same instance ignores an overlapping poll while its first connection is pending', async () => {
        await reset(); const boundary = await persistBoundary('CLAIMED'), before = await snapshot(boundary.requestId); now = base + 16 * minute;
        let entered, release; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
        pauseConnect = async () => { entered(); await gate; }; const instance = worker(), first = instance.run();
        await started; await instance.run(); pauseConnect = undefined; release(); await first;
        const after = await snapshot(boundary.requestId); reconciliation(after, before, null, 0); return after;
      });
      await test('Normal Approved work still completes once after the periodic sweep', async () => {
        await reset(); const requestId = await approved(30), instance = worker(); await instance.run(); const after = await snapshot(requestId);
        assert.equal(after.request.status, 'COMPLETED'); assert.equal(after.operation.status, 'COMPLETED');
        assert.equal(after.operation.attempt_count, 1); assert.equal(after.assets, 1); assert.equal(provisionCalls, 1);
        assert.equal(after.operation.provider_reference, `mock-key-${requestId}`); assert.equal(after.audit.filter(item => item.action === 'ASSET_CREATED').length, 1);
        await instance.run(); assert.deepEqual(await snapshot(requestId), after); return after;
      });
      await test('Transient preflight failures retry at 15s and 60s and stop without sending after the budget', async () => {
        await reset(); const requestId=await approved(), instance=worker();
        const state=async()=> (await sql(`SELECT r.status,op.retry_count,op.attempt_count,op.retry_after,op.failure_class
          FROM requests r JOIN provider_operations op ON op.request_id=r.id WHERE r.id=$1`,[requestId])).rows[0];
        await sql(`CREATE FUNCTION worker_test_clock.reject_send() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.status='SENT' THEN RAISE EXCEPTION 'transient fixture' USING ERRCODE='55P03'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER worker_test_reject_send BEFORE UPDATE ON provider_operations FOR EACH ROW EXECUTE FUNCTION worker_test_clock.reject_send()`);
        try {
          await instance.run(); const first=await state();
          assert.equal(first.status,'APPROVED');assert.equal(first.retry_count,1);assert.equal(+first.retry_after,base+15_000);
          now=base+14_999;await instance.run();assert.deepEqual(await state(),first);
          now=base+15_000;await Promise.all([instance.run(),worker().run()]);const second=await state();
          assert.equal(second.status,'APPROVED');assert.equal(second.retry_count,2);assert.equal(+second.retry_after,base+75_000);
          now=base+75_000;await instance.run();const last=await state();
          assert.equal(last.status,'RECONCILIATION_REQUIRED');assert.equal(last.failure_class,'UNSENT_TRANSIENT');
          assert.equal(last.retry_count,2);assert.equal(last.attempt_count,0);assert.equal(last.retry_after,null);
          now+=600_000;await instance.run();assert.deepEqual(await state(),last);assert.equal(provisionCalls,0);
          const actions=(await snapshot(requestId)).audit.map(row=>row.action);
          assert.deepEqual(actions,['PROVIDER_RETRY_SCHEDULED','PROVIDER_RETRY_SCHEDULED','REQUEST_RECONCILIATION_REQUIRED']);
          return { first,second,last,actions };
        } finally {
          await sql('DROP TRIGGER worker_test_reject_send ON provider_operations; DROP FUNCTION worker_test_clock.reject_send()');
        }
      });
      await test('HTTP failure after dispatch stays unknown and never schedules replay',async()=>{
        await reset();const requestId=await approved(),instance=worker();
        pauseProvider=async()=>{throw new Error('CRYPTO_PROVIDER_HTTP_503');};
        await instance.run();const before=await snapshot(requestId);
        now=base+600_000;await instance.run();assert.deepEqual(await snapshot(requestId),before);
        assert.equal(before.request.status,'RECONCILIATION_REQUIRED');assert.equal(before.operation.attempt_count,1);
        assert.equal(before.operation.last_error_code,'CRYPTO_PROVIDER_HTTP_503');assert.equal(provisionCalls,1);
        assert.equal((await sql('SELECT failure_class FROM provider_operations WHERE request_id=$1',[requestId])).rows[0].failure_class,'OUTCOME_UNKNOWN');
        return before;
      });
      await test('A late provider result cannot commit an asset after another worker reconciles the request', async () => {
        await reset(); const requestId = await approved(); let entered, release;
        const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
        pauseProvider = async () => { entered(); await gate; }; const first = worker().run(); await started;
        const processing = await snapshot(requestId); now = base + 16 * minute; await worker().run();
        pauseProvider = undefined; release(); await first; const after = await snapshot(requestId);
        reconciliation(after, processing, `mock-key-${requestId}`, 1); assert.equal(after.request.result_asset_id, null); return after;
      });
      async function assertCompletedFromReceipt(instance, requestId) {
        await instance.run();
        const after = await snapshot(requestId);
        assert.equal(after.request.status, 'COMPLETED');
        assert.equal(after.operation.status, 'COMPLETED');
        assert.equal(after.operation.provider_reference, `mock-key-${requestId}`);
        assert.equal(after.operation.attempt_count, 1);
        assert.equal(after.assets, 1);
        assert.equal(provisionCalls, 1);
        assert.deepEqual(after.audit.map(entry => entry.action), ['ASSET_CREATED']);
        await instance.run();
        assert.deepEqual(await snapshot(requestId), after);
        return { providerCalls: provisionCalls, assets: after.assets, audits: after.audit.length };
      }
      for (const failures of [1, 2]) await test(`Receipt persistence handles ${failures} PostgreSQL rollbacks without repeating the provider call`, async () => {
        await reset();
        const requestId = await approved();
        await sql(`CREATE SEQUENCE worker_test_clock.receipt_writes;
          CREATE FUNCTION worker_test_clock.reject_first_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF OLD.receipt IS NULL AND NEW.receipt IS NOT NULL AND nextval('worker_test_clock.receipt_writes')<=${failures} THEN
              RAISE EXCEPTION 'transient receipt fixture' USING ERRCODE='40001';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER worker_test_receipt_fault BEFORE UPDATE ON provider_operations
            FOR EACH ROW EXECUTE FUNCTION worker_test_clock.reject_first_receipt()`);
        try {
          const instance = worker();
          let evidence;
          if (failures === 1) {
            evidence = await assertCompletedFromReceipt(instance, requestId);
          } else {
            await instance.run();
            const after = await snapshot(requestId);
            assert.equal(after.request.status, 'RECONCILIATION_REQUIRED');
            assert.equal(after.operation.attempt_count, 1);
            assert.equal(after.operation.provider_reference, null);
            assert.equal(after.assets, 0);
            assert.equal(provisionCalls, 1);
            assert.deepEqual(after.audit.map(entry => entry.action), ['REQUEST_RECONCILIATION_REQUIRED']);
            assert.equal((await sql('SELECT failure_class FROM provider_operations WHERE request_id=$1', [requestId])).rows[0].failure_class, 'OUTCOME_UNKNOWN');
            await instance.run();
            assert.deepEqual(await snapshot(requestId), after);
            evidence = { providerCalls: provisionCalls, outcome: 'OUTCOME_UNKNOWN', assets: after.assets };
          }
          assert.equal((await sql('SELECT last_value FROM worker_test_clock.receipt_writes')).rows[0].last_value, '2');
          return { ...evidence, receiptWrites: 2 };
        } finally {
          await sql('DROP TRIGGER worker_test_receipt_fault ON provider_operations; DROP FUNCTION worker_test_clock.reject_first_receipt(); DROP SEQUENCE worker_test_clock.receipt_writes;');
        }
      });
      await test('A committed receipt with a lost acknowledgment is accepted only once', async () => {
        await reset();
        const requestId = await approved();
        loseReceiptAcknowledgment = true;
        const evidence = await assertCompletedFromReceipt(worker(), requestId);
        assert.equal(loseReceiptAcknowledgment, false);
        return { ...evidence, acknowledgmentLost: true };
      });
      await test('A different stored receipt cannot be accepted or overwritten', async () => {
        await reset();
        const requestId = await approved();
        const stored = { providerReference: `mock-key-${requestId}`, providerScope: 'MOCK', keySize: 4096 };
        pauseProvider = async () => {
          await sql(`UPDATE provider_operations SET status='PROVIDER_SUCCEEDED',provider_reference=$2,
            receipt=$3::jsonb,receipt_at=NOW(),failure_class='RESULT_RECORDED' WHERE request_id=$1`,
          [requestId, stored.providerReference, JSON.stringify(stored)]);
        };
        await worker().run();
        const after = await snapshot(requestId);
        assert.equal(after.request.status, 'RECONCILIATION_REQUIRED');
        assert.equal(after.operation.attempt_count, 1);
        assert.equal(after.assets, 0);
        assert.equal(provisionCalls, 1);
        const operation = (await sql('SELECT receipt,failure_class FROM provider_operations WHERE request_id=$1', [requestId])).rows[0];
        assert.deepEqual(operation.receipt, stored);
        assert.equal(operation.failure_class, 'RESULT_RECORDED');
        return { mismatchedReceiptPreserved: true, providerCalls: provisionCalls, assets: after.assets };
      });
      await test('Final transaction failure preserves the provider receipt and rolls back the asset before reconciliation', async () => {
        await reset(); const requestId = await approved(); await installAuditFailure('ASSET_CREATED'); const instance = worker();
        try { await instance.run(); } finally { await removeAuditFailure(); }
        const after = await snapshot(requestId); assert.equal(after.request.status, 'RECONCILIATION_REQUIRED');
        assert.equal(after.operation.status, 'RECONCILIATION_REQUIRED'); assert.equal(after.operation.provider_reference, `mock-key-${requestId}`);
        assert.equal(after.operation.attempt_count, 1); assert.equal(after.assets, 0); assert.equal(provisionCalls, 1);
        assert.equal(after.audit.length, 1); assert.equal(after.audit[0].action, 'REQUEST_RECONCILIATION_REQUIRED');
        await instance.run(); assert.deepEqual(await snapshot(requestId), after); return after;
      });
      for (const type of ['RENEW', 'REVOKE']) await test(`${type} target guards reject owner, terminal state, policy and missing reference before any provider attempt`, async () => {
        const evidence=[];
        const otherPolicy=await freshPolicy({algorithm:'RSA',maximum_validity_days:90});
        const mutations=[['owner','UPDATE crypto_assets SET owner_id=$2 WHERE id=$1',otherOwner],
          ...['REGISTERED','EXPIRED','REVOKED','SUPERSEDED'].map(state=>[state,'UPDATE crypto_assets SET status=$2 WHERE id=$1',state]),
          ['elapsed validity before scan','UPDATE crypto_assets SET expires_at=$2 WHERE id=$1',new Date(base)],
          ['policy','UPDATE crypto_assets SET policy_version_id=$2 WHERE id=$1',otherPolicy.versionId],
          ['reference','UPDATE crypto_assets SET provider_reference=$2 WHERE id=$1',null]];
        for(const [name,mutation,value] of mutations){
          await reset();const assetId=await targetAsset(),requestId=await approved(0,{type,target:assetId,parameters:{}});
          await sql(mutation,[assetId,value]);const before=await targetState(assetId),instance=worker();await instance.run();const after=await snapshot(requestId);
          assert.equal(after.request.status,'RECONCILIATION_REQUIRED');assert.equal(after.operation.status,'RECONCILIATION_REQUIRED');
          assert.equal(after.operation.attempt_count,0);assert.equal(after.operation.provider_reference,null);
          assert.equal(provisionCalls+revokeCalls,0);assert.equal(after.assets,1);assert.deepEqual(await targetState(assetId),before);
          assert.equal(after.audit.length,1);assert.equal(after.audit[0].action,'REQUEST_RECONCILIATION_REQUIRED');
          await instance.run();assert.deepEqual(await snapshot(requestId),after);evidence.push({guard:name,...after});
        }return evidence;
      });
      await test('A stale claimed request version or input is rejected before the provider attempt is marked SENT',async()=>{
        const evidence=[];
        for(const mutation of ["UPDATE requests SET version=version+1 WHERE id=$1","UPDATE requests SET reason='Changed after claim' WHERE id=$1"]){
          await reset();const requestId=await approved(),instance=worker(),job=await instance.claim();
          await sql(mutation,[requestId]);await instance.process(job);const after=await snapshot(requestId);
          assert.equal(after.request.status,'RECONCILIATION_REQUIRED');assert.equal(after.operation.attempt_count,0);
          assert.equal(provisionCalls+revokeCalls,0);assert.equal(after.assets,0);evidence.push(after);
        }return evidence;
      });
      await test('Future versions block provider calls while deactivation preserves previously approved work',async()=>{
        const evidence=[];
        for(const type of ['CREATE','RENEW','REVOKE'])for(const condition of ['inactive','future']){
          await reset();const selected=await freshPolicy({algorithm:'RSA',maximum_validity_days:90},new Date(condition==='future'?base+minute:base-minute));
          const assetId=type==='CREATE'?null:await targetAsset();
          if(assetId)await sql('UPDATE crypto_assets SET policy_version_id=$2 WHERE id=$1',[assetId,selected.versionId]);
          const requestId=await approved(0,{type,target:assetId,policyVersion:selected.versionId,parameters:{}});
          if(condition==='inactive')await sql('UPDATE policies SET is_active=FALSE WHERE id=$1',[selected.policyId]);
          await worker().run();const after=await snapshot(requestId);
          const executed=condition==='inactive';
          assert.equal(after.request.status,executed?'COMPLETED':'RECONCILIATION_REQUIRED');
          assert.equal(after.operation.attempt_count,Number(executed));
          assert.equal(provisionCalls+revokeCalls,Number(executed));
          assert.equal(after.assets,Number(Boolean(assetId))+Number(executed&&type!=='REVOKE'));
          evidence.push({type,condition,...after});
        }return evidence;
      });
      await test('Shared AES, ED25519 and ECDSA policy defaults reach the actual provider and stored key metadata',async()=>{
        const evidence=[];
        for(const algorithm of ['AES','ED25519','ECDSA']){
          await reset();const selected=await freshPolicy({algorithm,maximum_validity_days:90});
          const requestId=await approved(0,{policyVersion:selected.versionId,parameters:{}});await worker().run();const after=await snapshot(requestId);
          assert.equal(after.request.status,'COMPLETED');assert.equal(after.operation.attempt_count,1);assert.equal(provisionCalls,1);
          assert.equal(provisionInputs[0].algorithm,algorithm);assert.equal(provisionInputs[0].keySize,256);
          assert.equal(provisionInputs[0].usage,algorithm==='AES'?'ENCRYPTION':'SIGNING');
          const key=(await sql('SELECT algorithm,key_size,usage FROM cryptographic_keys WHERE asset_id=$1',[after.request.result_asset_id])).rows[0];
          assert.deepEqual(key,{algorithm,key_size:256,usage:algorithm==='AES'?'ENCRYPTION':'SIGNING'});evidence.push({algorithm,input:provisionInputs[0],key,...after});
        }return evidence;
      });
      await test('Normal RENEW completes once with its approved old version, target lineage and original provider reference',async()=>{
        await reset();const assetId=await targetAsset(),before=await targetState(assetId),requestId=await approved(0,{type:'RENEW',target:assetId,parameters:{}});
        await sql('INSERT INTO policy_versions(id,policy_id,version,configuration,effective_from) VALUES($1,$2,2,$3::jsonb,$4)',
          [id(),policy,JSON.stringify({algorithm:'RSA',minimum_key_size:4096,maximum_validity_days:30}),new Date(base-minute)]);
        const instance=worker();await instance.run();const after=await snapshot(requestId),old=await targetState(assetId),created=await targetState(after.request.result_asset_id);
        assert.equal(after.request.status,'COMPLETED');assert.equal(after.operation.status,'COMPLETED');assert.equal(after.operation.attempt_count,1);
        assert.equal(after.assets,2);assert.equal(provisionCalls,1);assert.equal(revokeCalls,0);assert.equal(old.status,'SUPERSEDED');assert.equal(old.version,before.version+1);
        assert.equal(created.replaces_asset_id,assetId);assert.equal(created.policy_version_id,policyVersion);assert.equal(created.status,'ACTIVE');
        assert.equal(provisionInputs[0].replacesProviderReference,before.provider_reference);assert.equal(provisionInputs[0].keySize,2048);
        assert.equal(after.audit.filter(item=>item.action==='ASSET_RENEWED').length,1);await instance.run();assert.deepEqual(await snapshot(requestId),after);
        return {before,after,old,created,input:provisionInputs[0]};
      });
      await test('Normal REVOKE completes once with one audit and exactly two owner notification channels',async()=>{
        await reset();const assetId=await targetAsset(),before=await targetState(assetId),requestId=await approved(0,{type:'REVOKE',target:assetId,parameters:{}}),instance=worker();
        await instance.run();const after=await snapshot(requestId),target=await targetState(assetId);
        assert.equal(after.request.status,'COMPLETED');assert.equal(after.request.result_asset_id,assetId);assert.equal(after.operation.status,'COMPLETED');
        assert.equal(after.operation.attempt_count,1);assert.equal(after.operation.provider_reference,before.provider_reference);assert.equal(target.status,'REVOKED');assert.equal(target.version,before.version+1);
        assert.equal(provisionCalls,0);assert.equal(revokeCalls,1);assert.deepEqual(revokeInputs,[{reference:before.provider_reference,operationId:requestId}]);
        const queued=(await sql('SELECT recipient_id,type,channel FROM notifications WHERE asset_id=$1 ORDER BY channel',[assetId])).rows;
        assert.deepEqual(queued,[{recipient_id:owner,type:'ASSET_REVOKED',channel:'EMAIL'},{recipient_id:owner,type:'ASSET_REVOKED',channel:'IN_APP'}]);
        assert.equal(after.audit.filter(item=>item.action==='ASSET_REVOKED').length,1);await instance.run();assert.deepEqual(await snapshot(requestId),after);
        return {before,target,after,queued};
      });
      for(const type of ['RENEW','REVOKE'])await test(`${type} target drift during the provider call preserves the receipt and never overwrites the changed target`,async()=>{
        const evidence=[];
        const mutations=[['owner','UPDATE crypto_assets SET owner_id=$2 WHERE id=$1',otherOwner],
          ['state','UPDATE crypto_assets SET status=$2 WHERE id=$1','EXPIRED'],
          ['version','UPDATE crypto_assets SET version=version+$2 WHERE id=$1',1],
          ['reference','UPDATE crypto_assets SET provider_reference=$2 WHERE id=$1',`changed-${id()}`],
          ['department','UPDATE crypto_assets SET department_id=$2 WHERE id=$1',otherDepartment],
          ['type','UPDATE crypto_assets SET asset_type=$2 WHERE id=$1','CERTIFICATE'],
          ['key inputs','UPDATE cryptographic_keys SET key_size=$2 WHERE asset_id=$1',3072]];
        for(const [name,mutation,value]of mutations){
          await reset();const assetId=await targetAsset(),before=await targetState(assetId),requestId=await approved(0,{type,target:assetId,parameters:{}}),instance=worker();
          let changed;pauseProvider=async()=>{await sql(mutation,[assetId,value]);changed=await targetState(assetId);};
          await instance.run();pauseProvider=undefined;const after=await snapshot(requestId);
          assert.equal(after.request.status,'RECONCILIATION_REQUIRED');assert.equal(after.request.result_asset_id,null);
          assert.equal(after.operation.status,'RECONCILIATION_REQUIRED');assert.equal(after.operation.attempt_count,1);
          assert.equal(after.operation.provider_reference,type==='RENEW'?`mock-key-${requestId}`:before.provider_reference);
          assert.equal(after.assets,1);assert.deepEqual(await targetState(assetId),changed);assert.equal(provisionCalls+revokeCalls,1);
          assert.equal(after.audit.length,1);assert.equal(after.audit[0].action,'REQUEST_RECONCILIATION_REQUIRED');
          assert.equal(Number((await sql('SELECT count(*)::int AS count FROM notifications WHERE asset_id IS NOT NULL')).rows[0].count),0);
          await instance.run();assert.deepEqual(await snapshot(requestId),after);evidence.push({field:name,changed,after});
        }return evidence;
      });
      await test('Policy deactivation during the provider call lets approved work commit once',async()=>{
        await reset();const requestId=await approved(),instance=worker();
        pauseProvider=async()=>{await sql('UPDATE policies SET is_active=FALSE WHERE id=$1',[policy]);};
        await instance.run();pauseProvider=undefined;const after=await snapshot(requestId);
        assert.equal(after.request.status,'COMPLETED');assert.equal(after.operation.provider_reference,`mock-key-${requestId}`);
        assert.equal(after.operation.attempt_count,1);assert.equal(after.assets,1);assert.equal(provisionCalls,1);
        await instance.run();assert.deepEqual(await snapshot(requestId),after);return after;
      });
      await test('Changed request input during the provider call retains the receipt and commits no asset',async()=>{
        await reset();const requestId=await approved(),instance=worker();
        pauseProvider=async()=>{await sql("UPDATE requests SET reason='Changed while provider pending',version=version+1 WHERE id=$1",[requestId]);};
        await instance.run();pauseProvider=undefined;const after=await snapshot(requestId);
        assert.equal(after.request.status,'RECONCILIATION_REQUIRED');assert.equal(after.operation.provider_reference,`mock-key-${requestId}`);
        assert.equal(after.operation.attempt_count,1);assert.equal(after.assets,0);assert.equal(provisionCalls,1);
        await instance.run();assert.deepEqual(await snapshot(requestId),after);return after;
      });
      await test('Loopback HTTP keys preserve provider dates, lineage and revocation and block a different provider scope',async()=>{
        await reset();
        return withHttpFixture(async ({ validFrom, expiresAt, calls, privateMarker })=>{
          const current=await freshPolicy({algorithm:'RSA',minimum_key_size:2048,maximum_validity_days:90},new Date(now-minute));
          const instance=worker();
          const create=await approved(0,{policyVersion:current.versionId});await instance.run();
          const first=await snapshot(create);assert.equal(first.request.status,'COMPLETED',`CREATE ${first.operation?.last_error_code??''}`);
          const key=await targetState(first.request.result_asset_id);
          assert.match(key.provider_scope,/^[a-f0-9]{64}$/);assert.equal(key.valid_from.toISOString(),validFrom);assert.equal(key.expires_at.toISOString(),expiresAt);
          const renew=await approved(0,{type:'RENEW',target:key.id,policyVersion:current.versionId,parameters:{}});await instance.run();
          const second=await snapshot(renew);assert.equal(second.request.status,'COMPLETED',`RENEW ${second.operation?.last_error_code??''}`);
          const renewed=await targetState(second.request.result_asset_id);
          assert.equal(renewed.replaces_asset_id,key.id);assert.equal(renewed.provider_scope,key.provider_scope);
          assert.equal((await targetState(key.id)).status,'SUPERSEDED');
          process.env.CRYPTO_PROVIDER_SCOPE='different-account';
          const wrong=await approved(0,{type:'REVOKE',target:renewed.id,policyVersion:current.versionId,parameters:{}});await instance.run();
          const blocked=await snapshot(wrong);assert.equal(blocked.request.status,'RECONCILIATION_REQUIRED');
          assert.equal(blocked.operation.attempt_count,0);assert.equal(blocked.operation.last_error_code,'CRYPTO_PROVIDER_SCOPE_MISMATCH');
          assert.equal(calls.length,2);assert.equal((await targetState(renewed.id)).status,'ACTIVE');
          process.env.CRYPTO_PROVIDER_SCOPE='isolated-fixture';
          const revoke=await approved(0,{type:'REVOKE',target:renewed.id,policyVersion:current.versionId,parameters:{}});await instance.run();
          assert.equal((await snapshot(revoke)).request.status,'COMPLETED');assert.equal((await targetState(renewed.id)).status,'REVOKED');
          assert.deepEqual(calls,[{path:'/assets',operationId:create,target:null},{path:'/assets',operationId:renew,target:key.provider_reference},
            {path:'/assets/revoke',operationId:revoke,target:renewed.provider_reference}]);
          const receipts=(await sql('SELECT receipt FROM provider_operations WHERE receipt IS NOT NULL')).rows;
          assert.equal(receipts.length,3);assert(!JSON.stringify(receipts).includes(privateMarker));
          return { operationIdsMatched:true, networkCalls:calls.length, scopeMismatchBlocked:true, validFrom, expiresAt };
        });
      });
      await test('Loopback HTTP stores the certificate validity from the public leaf and quarantines a mismatched receipt',async()=>{
        await reset();
        return withHttpFixture(async ({ certificate, calls, privateMarker, rejectResult })=>{
          const current=await freshPolicy({certificate_profile:'TLS_SERVER',maximum_validity_days:3650},new Date(now-minute));
          const instance=worker(),parameters={assetType:'CERTIFICATE',validityDays:3650};
          const create=await approved(0,{policyVersion:current.versionId,parameters});await instance.run();
          const first=await snapshot(create);assert.equal(first.request.status,'COMPLETED');
          const saved=(await sql(`SELECT a.valid_from,a.expires_at,c.serial_number,c.fingerprint,op.receipt
            FROM requests r JOIN crypto_assets a ON a.id=r.result_asset_id JOIN certificates c ON c.asset_id=a.id
            JOIN provider_operations op ON op.request_id=r.id WHERE r.id=$1`,[create])).rows[0];
          assert.equal(+saved.valid_from,+certificate.validFromDate);assert.equal(+saved.expires_at,+certificate.validToDate);
          assert.equal(saved.serial_number,certificate.serialNumber);assert.equal(saved.fingerprint,`SHA256:${certificate.fingerprint256.replaceAll(':','').toLowerCase()}`);
          assert(!JSON.stringify(saved.receipt).includes(privateMarker));assert.equal(saved.receipt.certificatePem,undefined);
          rejectResult();const invalid=await approved(0,{policyVersion:current.versionId,parameters});await instance.run();
          const second=await snapshot(invalid);assert.equal(second.request.status,'RECONCILIATION_REQUIRED');
          assert.equal(second.operation.attempt_count,1);assert.equal(second.operation.last_error_code,'CRYPTO_PROVIDER_RESPONSE_INVALID');
          assert.equal(second.assets,1);await instance.run();assert.equal(calls.length,2);
          return { validFrom:saved.valid_from,expiresAt:saved.expires_at,receiptContainsPublicMetadataOnly:true,invalidResultReplayed:false };
        });
      });
      await sql("INSERT INTO roles(code,name) VALUES('ADMIN','Worker recovery administrator') ON CONFLICT (code) DO NOTHING");
      await sql("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='ADMIN'", [otherOwner]);
      const admin = { id: otherOwner, tokenVersion: 1 };
      const completionNotices = async requestId => (await sql(`SELECT channel FROM notifications
        WHERE request_id=$1 AND type='REQUEST_COMPLETED' ORDER BY channel`, [requestId])).rows.map(row => row.channel);
      await test('SIGKILL after claim permits one proven-unsent retry by an administrator', async () => {
        await reset();
        const requestId = await approved();
        let claimed;
        await withParkedWorker('CLAIMED', requestId, async message => {
          assert.equal(message.providerCalls, 0);
          claimed = await snapshot(requestId);
          assert.equal(claimed.request.status, 'PROCESSING');
          assert.equal(claimed.operation.status, 'CLAIMED');
          assert.equal(claimed.operation.attempt_count, 0);
        });
        now = base + 16 * minute;
        await Promise.all([worker().run(), worker().run()]);
        const stale = await snapshot(requestId);
        reconciliation(stale, claimed, null, 0);
        assert.equal((await sql('SELECT failure_class FROM provider_operations WHERE request_id=$1', [requestId])).rows[0].failure_class, 'UNSENT_TRANSIENT');
        await worker().recover(admin, requestId, stale.request.version, 'RETRY', 'Verified unsent after worker crash');
        await worker().run();
        assert.equal(provisionCalls, 0);
        now += minute;
        await Promise.all([worker().run(), worker().run()]);
        const completed = await snapshot(requestId);
        assert.equal(completed.request.status, 'COMPLETED');
        assert.equal(completed.operation.attempt_count, 1);
        assert.equal(completed.assets, 1);
        assert.equal(provisionCalls, 1);
        assert.equal(provisionInputs[0].operationId, requestId);
        assert.deepEqual(completed.audit.map(row => row.action), ['REQUEST_RECONCILIATION_REQUIRED', 'PROVIDER_RETRY_SCHEDULED', 'ASSET_CREATED']);
        assert.deepEqual(await completionNotices(requestId), ['EMAIL', 'IN_APP']);
        return { exitSignal: 'SIGKILL', providerCallsBeforeCrash: 0, providerCallsAfterRetry: 1, completedAssets: 1 };
      });
      await test('SIGKILL before commit rolls back staged writes and the saved receipt is applied exactly once', async () => {
        await reset();
        const requestId = await approved(), reference = `mock-key-${requestId}`;
        let visible;
        await withParkedWorker('BEFORE_COMMIT', requestId, async message => {
          assert.equal(message.providerCalls, 1);
          assert.deepEqual(message.evidence, { status: 'COMPLETED', hasAsset: true, audits: 1, notifications: 2 });
          visible = await snapshot(requestId);
          assert.equal(visible.request.status, 'PROCESSING');
          assert.equal(visible.operation.status, 'PROVIDER_SUCCEEDED');
          assert.equal(visible.operation.provider_reference, reference);
          assert.equal(visible.assets, 0);
          assert.equal(visible.audit.length, 0);
          assert.deepEqual(await completionNotices(requestId), []);
        });
        assert.deepEqual(await snapshot(requestId), visible);
        assert.deepEqual(await completionNotices(requestId), []);
        now = base + 16 * minute;
        await Promise.all([worker().run(), worker().run()]);
        const stale = await snapshot(requestId);
        reconciliation(stale, visible, reference, 1);
        const confirm = () => worker().recover(admin, requestId, stale.request.version, 'CONFIRM', 'Verified receipt after worker crash');
        const attempts = await Promise.allSettled([confirm(), confirm()]);
        assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
        assert.equal(attempts.find(attempt => attempt.status === 'rejected')?.reason?.getResponse()?.code, 'VERSION_CONFLICT');
        const completed = await snapshot(requestId);
        assert.equal(completed.request.status, 'COMPLETED');
        assert.equal(completed.operation.attempt_count, 1);
        assert.equal(completed.assets, 1);
        assert.equal(provisionCalls, 0);
        assert.deepEqual(completed.audit.map(row => row.action), ['REQUEST_RECONCILIATION_REQUIRED', 'ASSET_CREATED', 'PROVIDER_RESULT_CONFIRMED']);
        assert.deepEqual(await completionNotices(requestId), ['EMAIL', 'IN_APP']);
        return { exitSignal: 'SIGKILL', transactionRolledBack: true, providerCallsBeforeCrash: 1, replayCalls: 0, completedAssets: 1 };
      });
    }
  } finally {
    pauseProvider = undefined; pauseConnect = undefined;
    await removeAuditFailure().catch(() => {});
    report.temporaryFailureTriggerCount = Number((await sql("SELECT COUNT(*)::int AS count FROM pg_trigger WHERE tgname='worker_test_reject_audit' AND NOT tgisinternal")).rows[0].count);
    await pool.end();
  }
  return report;
}
