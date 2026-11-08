// Exercise the independent monitor against a generated, loopback-only Compose stack.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { AlertTracker, MonitorJournal, collect, monitorOrigin } = require('./monitor-operations.cjs');

function docker(args, input, includeStderr = false) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('Isolated Docker command failed.');
  return (result.stdout + (includeStderr ? result.stderr : '')).trim();
}

async function main(reportArg, tokenArg) {
  const artifacts = await fs.realpath(path.join(__dirname, 'test-artifacts'));
  const reportPath = await fs.realpath(reportArg);
  const tokenFile = await fs.realpath(tokenArg);
  assert.ok(reportPath.startsWith(path.join(artifacts, 'integration') + path.sep));
  assert.ok(tokenFile.startsWith(artifacts + path.sep));
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(path.basename(reportPath), 'report.json');
  assert.match(report.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), report.project);
  assert.ok(report.status === 'PASSED' && report.started && report.keptStack && !report.cleanupCompleted);
  assert.ok(report.provider === 'MOCK' && report.smtpEnabled === false && report.database === 'crypta_t30_test');
  assert.match(report.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
  const origin = monitorOrigin(report.origin);
  const token = (await fs.readFile(tokenFile, 'utf8')).trim();
  assert.ok(/^[a-f0-9]{64}$/.test(token), 'Expected a generated monitor credential.');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const ids = docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${report.project}`]).split(/\s+/);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  assert.ok(containers.every(item => item.Config.Labels['com.docker.compose.project'] === report.project && item.State.Running));
  const service = name => containers.find(item => item.Config.Labels['com.docker.compose.service'] === name);
  const backend = service('backend');
  const frontend = service('frontend');
  const postgres = service('postgres');
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK') && backend.Config.Env.includes('SMTP_ENABLED=false'));
  assert.ok(backend.Config.Env.includes(`OPERATIONS_MONITOR_TOKEN_SHA256=${tokenHash}`), 'Monitor credential does not match the isolated backend.');
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(m => m.Type === 'volume' && m.Name === `${report.project}_test_postgres`));
  assert.deepEqual(frontend.NetworkSettings.Ports['80/tcp'], [{ HostIp: '127.0.0.1', HostPort: new URL(origin).port }]);

  const resultFile = path.join(path.dirname(reportPath), 'operations-monitor.json');
  const reportOut = { project: report.project, image: backend.Image, success: false, events: [] };
  await fs.writeFile(resultFile, JSON.stringify(reportOut, null, 2), { flag: 'wx' });
  const sql = query => docker([
    'exec', '-i', postgres.Id, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'crypta_t30_test', '-d', 'crypta_t30_test',
  ], query);
  const probe = (route, credential) => fetch(origin + '/api/v1' + route, {
    headers: credential ? { authorization: `Bearer ${credential}` } : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const sample = () => collect({ origin, tokenFile });
  let tracker = new AlertTracker();
  const journalFile = path.join(path.dirname(reportPath), 'operations-monitor-state.json');
  const journal = new MonitorJournal(journalFile, origin);
  async function restartTracker() {
    await journal.save(tracker.openCodes(), []);
    const saved = await new MonitorJournal(journalFile, origin).load();
    tracker = new AlertTracker(2, saved.openCodes);
    reportOut.collectorStateReloads = (reportOut.collectorStateReloads ?? 0) + 1;
  }
  function observe(value, expected = []) {
    const events = tracker.observe(value);
    assert.deepEqual(events.map(event => [event.event, event.code]), expected);
    reportOut.events.push(...events);
  }
  async function waitForDatabase() {
    for (let i = 0; i < 20; i++) {
      const value = await sample();
      if (value.DATABASE_UNAVAILABLE === false && value.MONITOR_SIGNAL_PROBE_FAILED === false) return value;
      await delay(500);
    }
    throw new Error('Isolated database did not recover.');
  }
  const requestId = randomUUID();
  const notificationId = randomUUID();
  const remove = () => sql(`
    BEGIN;
    DELETE FROM notifications WHERE id = '${notificationId}';
    DELETE FROM provider_operations WHERE request_id = '${requestId}';
    DELETE FROM requests WHERE id = '${requestId}';
    COMMIT;
  `);
  let fixturesInserted = false;
  try {
    const [guest, invalid, adminRoute, authorized] = await Promise.all([
      probe('/operations/signals'), probe('/operations/signals', '0'.repeat(64)),
      probe('/operations/metrics', token), probe('/operations/signals', token),
    ]);
    reportOut.authStatuses = [guest.status, invalid.status, adminRoute.status, authorized.status];
    assert.deepEqual(reportOut.authStatuses, [401, 401, 401, 200]);
    assert.equal(authorized.headers.get('cache-control'), 'no-store');
    const initial = await authorized.json();
    assert.deepEqual(Object.keys(initial.data).sort(), ['collectedAt', 'signals']);
    assert.deepEqual(initial.data.signals, []);
    for (const response of [guest, invalid, adminRoute]) await response.body?.cancel();
    observe(await sample());
    observe(await sample());

    sql(`
      BEGIN;
      INSERT INTO requests(id, request_type, creator_id, department_id, policy_version_id, status, reason)
      SELECT '${requestId}', 'CREATE', creator_id, department_id, policy_version_id,
        'RECONCILIATION_REQUIRED', 'monitor test fixture'
      FROM requests WHERE id = '0eeeeeee-1111-1111-1111-111111111111';
      INSERT INTO provider_operations(request_id, operation_type, status, last_error_code)
      VALUES ('${requestId}', 'CREATE', 'RECONCILIATION_REQUIRED', 'CRYPTO_PROVIDER_HTTP_503');
      INSERT INTO notifications(id, recipient_id, request_id, type, channel, delivery_status, deduplication_key)
      SELECT '${notificationId}', creator_id, id, 'REQUEST_APPROVED', 'EMAIL',
        'RECONCILIATION_REQUIRED', 'monitor-test:${notificationId}' FROM requests WHERE id = '${requestId}';
      COMMIT;
    `);
    fixturesInserted = true;
    observe(await sample());
    observe(await sample(), [
      ['operations.alert_opened', 'PROVIDER_RECONCILIATION_REQUIRED'],
      ['operations.alert_opened', 'EMAIL_RECONCILIATION_REQUIRED'],
    ]);
    await restartTracker();
    observe(await sample());

    try {
      docker(['stop', '--time', '10', postgres.Id]);
      assert.equal(docker(['inspect', '--format', '{{.State.Running}}', postgres.Id]), 'false');
      const marker = `audit-fallback-${randomUUID()}`;
      const denied = await probe(`/users/reference-data?probe=${marker}`, marker);
      assert.equal(denied.status, 401);
      const correlationId = denied.headers.get('x-request-id');
      assert.match(correlationId, /^req_[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
      await denied.arrayBuffer();
      const logs = docker(['logs', '--tail', '300', backend.Id], undefined, true);
      assert.ok(!logs.includes(marker), 'Synthetic sensitive value was found in the audit fallback logs.');
      const fallback = logs.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line).message)
        .find(message => message?.event === 'audit.http_failure_not_persisted' && message.correlationId === correlationId);
      assert.deepEqual(fallback, { event: 'audit.http_failure_not_persisted', correlationId, method: 'GET',
        route: '/api/v1/users/reference-data', httpStatus: 401 });
      reportOut.auditFallback = { status: 401, correlationMatched: true, syntheticValueExcluded: true };
      const outage = await sample();
      assert.equal(outage.API_UNAVAILABLE, false);
      assert.equal(outage.DATABASE_UNAVAILABLE, true);
      assert.equal(outage.EMAIL_RECONCILIATION_REQUIRED, undefined);
      observe(outage);
      observe(await sample(), [['operations.alert_opened', 'DATABASE_UNAVAILABLE']]);
      await restartTracker();
      observe(await sample());
    } finally {
      docker(['start', postgres.Id]);
    }

    observe(await waitForDatabase());
    observe(await sample(), [['operations.alert_resolved', 'DATABASE_UNAVAILABLE']]);
    remove();
    fixturesInserted = false;
    observe(await sample());
    observe(await sample(), [
      ['operations.alert_resolved', 'PROVIDER_RECONCILIATION_REQUIRED'],
      ['operations.alert_resolved', 'EMAIL_RECONCILIATION_REQUIRED'],
    ]);
    observe(await sample());
    const finalBackend = JSON.parse(docker(['inspect', backend.Id]))[0];
    assert.equal(finalBackend.State.Pid, backend.State.Pid);
    assert.equal(finalBackend.State.StartedAt, backend.State.StartedAt);
    assert.equal(finalBackend.RestartCount, backend.RestartCount);
    assert.ok(![backend.Id, frontend.Id].some(id => docker(['logs', id], undefined, true).includes(token)), 'Credential found in logs.');
    assert.ok(!JSON.stringify(reportOut).includes(token), 'Credential found in alert data.');
    Object.assign(reportOut, { backendUnchanged: true, fixturesRemoved: true, secretAbsent: true, success: true });
  } finally {
    if (fixturesInserted) remove();
    await fs.unlink(journalFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.writeFile(resultFile, JSON.stringify(reportOut, null, 2));
  }
  process.stdout.write(`PASS operations monitor: ${resultFile}\n`);
}

main(process.argv[2], process.argv[3]).catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
