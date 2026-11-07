// Runs inside the backend container of a fresh isolated Compose project.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Pool, Client } = require('pg');
const { setTimeout: delay } = require('node:timers/promises');
const { OperationsMetricsService } = require('/app/dist/operations/operations-metrics.service');

const endpoint = '/api/v1/operations/metrics';
const origin = 'http://127.0.0.1:3000';

async function request(path, token, body) {
  const startedAt = performance.now();
  const response = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: await response.json(),
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

async function login(email) {
  const response = await request('/api/v1/auth/login', undefined, { email, password: 'Password@123' });
  assert.equal(response.status, 200);
  assert.ok(response.body.data.accessToken);
  return response.body.data.accessToken;
}

async function readMetrics(admin) {
  const result = await request(endpoint, admin);
  assert.equal(result.status, 200);
  assert.equal(result.cacheControl, 'no-store');
  return result.body.data;
}

async function verifyHttp(admin) {
  const roles = { guest: (await request(endpoint)).status };
  for (const [role, email] of [['user', 'dev.nguyen@congty.com'], ['approver', 'it.manager@congty.com']]) {
    const result = await request(endpoint, await login(email));
    assert.equal(result.body.error.code, 'ADMIN_REQUIRED');
    roles[role] = result.status;
  }
  assert.deepEqual(roles, { guest: 401, user: 403, approver: 403 });
  const before = await readMetrics(admin);
  assert.equal(before.database.status, 'connected');
  assert.equal(before.provider.mode, 'MOCK');
  assert.equal(before.email.enabled, false);
  assert.equal(before.process.jobs.emailDelivery, null);
  assert.equal(before.process.jobs.assetProcessing?.outcome, 'completed');
  assert.equal(before.process.jobs.expiryScan?.outcome, 'completed');
  assert.equal((await request('/api/v1/health/live')).status, 200);
  assert.equal((await request('/api/v1/no-such-metrics-fixture')).status, 404);
  const after = (await readMetrics(admin)).process.http;
  assert.deepEqual(after.statuses, { ...before.process.http.statuses, '4xx': before.process.http.statuses['4xx'] + 1 });
  assert.equal(after.latencyCounts.reduce((a, b) => a + b), Object.values(after.statuses).reduce((a, b) => a + b));
  return { roles, admin: 200, monitoringExcluded: true, completedJobSamples: ['assetProcessing', 'expiryScan'] };
}

async function verifyQueues() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 2000 });
  const originalSmtp = process.env.SMTP_ENABLED;
  try {
    await pool.query(`
      CREATE TEMP TABLE requests (status text, updated_at timestamptz);
      CREATE TEMP TABLE provider_operations (status text, updated_at timestamptz, last_error_code text);
      CREATE TEMP TABLE notifications (channel text, delivery_status text, scheduled_for timestamptz, failed_at timestamptz)
    `);
    const metrics = new OperationsMetricsService(pool);
    const empty = await metrics.snapshot();
    assert.equal(empty.assets.ready, 0);
    assert.equal(empty.assets.oldestReadySeconds, null);
    assert.equal(empty.email.oldestDueSeconds, null);
    assert.deepEqual(empty.signals, []);
    await pool.query(`
      INSERT INTO pg_temp.requests VALUES
        ('APPROVED', now() - interval '180 seconds'), ('APPROVED', now() - interval '5 seconds'),
        ('PROCESSING', now()), ('PENDING', now() - interval '1 day');
      INSERT INTO pg_temp.provider_operations VALUES
        ('RECONCILIATION_REQUIRED', now(), 'CRYPTO_PROVIDER_HTTP_503'),
        ('RECONCILIATION_REQUIRED', now() - interval '1 minute', NULL),
        ('COMPLETED', now() + interval '1 day', 'ignored');
      INSERT INTO pg_temp.notifications VALUES
        ('EMAIL', 'PENDING', now() - interval '360 seconds', NULL),
        ('EMAIL', 'PENDING', now() + interval '1 hour', NULL),
        ('EMAIL', 'SENDING', now(), NULL),
        ('EMAIL', 'FAILED', now(), now()),
        ('EMAIL', 'RECONCILIATION_REQUIRED', now(), NULL),
        ('IN_APP', 'PENDING', now() - interval '1 day', NULL),
        ('IN_APP', 'FAILED', now(), now()),
        ('EMAIL', 'SENT', now(), NULL)
    `);
    const disabled = await metrics.snapshot();
    process.env.SMTP_ENABLED = 'true';
    const enabled = await metrics.snapshot();
    assert.equal(enabled.assets.ready, 2);
    assert.equal(enabled.assets.processing, 1);
    assert.ok(enabled.assets.oldestReadySeconds >= 180 && enabled.assets.oldestReadySeconds < 190);
    assert.equal(enabled.provider.reconciliationRequired, 2);
    assert.ok(Math.abs(Date.parse(enabled.provider.lastRecordedFailureAt) - Date.now()) < 10_000);
    for (const key of ['due', 'scheduled', 'sending', 'failed', 'reconciliationRequired']) {
      assert.equal(enabled.email[key], 1, key);
    }
    assert.ok(enabled.email.oldestDueSeconds >= 360 && enabled.email.oldestDueSeconds < 370);
    assert.ok(enabled.email.lastFailedAt);
    assert.deepEqual(disabled.signals, ['ASSET_QUEUE_DELAYED', 'PROVIDER_RECONCILIATION_REQUIRED', 'EMAIL_RECONCILIATION_REQUIRED']);
    assert.deepEqual(enabled.signals, ['ASSET_QUEUE_DELAYED', 'PROVIDER_RECONCILIATION_REQUIRED', 'EMAIL_QUEUE_DELAYED', 'EMAIL_RECONCILIATION_REQUIRED']);
    return { emptyAgesAreNull: true, databaseTempTables: true, disabledSignals: disabled.signals, enabledSignals: enabled.signals,
      assets: enabled.assets, provider: enabled.provider, email: enabled.email };
  } finally {
    process.env.SMTP_ENABLED = originalSmtp;
    await pool.end();
  }
}

async function verifyDatabaseLock(admin) {
  const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000, statement_timeout: 2000, idle_in_transaction_session_timeout: 8000,
    application_name: 'crypta-test-metrics-lock',
  });
  await connection.connect();
  let results;
  let waiters = 0;
  try {
    await connection.query('BEGIN');
    await connection.query('LOCK TABLE public.notifications IN ACCESS EXCLUSIVE MODE');
    const pending = Promise.all(Array.from({ length: 3 }, () => request(endpoint, admin)));
    pending.catch(() => {});
    for (let i = 0; i < 20 && waiters === 0; i++) {
      await connection.query('SELECT pg_stat_clear_snapshot()');
      const observed = await connection.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE application_name = 'crypta-api' AND wait_event_type = 'Lock' AND query LIKE '%WITH asset_queue%'
        AND pg_backend_pid() = ANY(pg_blocking_pids(pid))`);
      waiters = observed.rows[0].count;
      if (!waiters) await delay(50);
    }
    assert.equal(waiters, 1);
    assert.equal((await request('/api/v1/health/ready')).status, 200);
    results = await pending;
    for (const result of results) {
      assert.equal(result.status, 503);
      assert.equal(result.body.error.code, 'METRICS_UNAVAILABLE');
      assert.ok(result.elapsedMs >= 1700 && result.elapsedMs < 4000);
    }
  } finally {
    await connection.query('ROLLBACK').finally(() => connection.end());
  }
  assert.equal((await readMetrics(admin)).database.status, 'connected');
  return { waiters, readiness: 200, metrics: results.map(({ status, elapsedMs }) => ({ status, elapsedMs })), recovered: 200 };
}

(async () => {
  assert.equal(process.env.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(process.env.SMTP_ENABLED, 'false');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/crypta_t30_test');
  const admin = await login('admin@congty.com');
  const http = await verifyHttp(admin);
  const queues = await verifyQueues();
  const lock = await verifyDatabaseLock(admin);
  process.stdout.write(JSON.stringify({ success: true, http, queues, lock }) + '\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
