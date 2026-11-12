const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { AlertTracker, collect } = require('../monitor-operations.cjs');

async function verifyMonitorLoad({ origin, postgresId, backendEnvironment, artifactRoot, sql, read, routes, summarize }) {
  const tokenFile = fs.realpathSync(process.env.CRYPTA_CAPACITY_MONITOR_TOKEN_FILE);
  assert.ok(tokenFile.startsWith(path.dirname(artifactRoot) + path.sep), 'Expected an isolated monitor token file.');
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  assert.ok(/^[a-f0-9]{64}$/.test(token) && backendEnvironment.includes(`OPERATIONS_MONITOR_TOKEN_SHA256=${tokenHash}`),
    'Monitor credential must match the isolated stack.');

  const id = randomUUID();
  const tracker = new AlertTracker();
  const code = 'ASSET_QUEUE_DELAYED';
  const concurrency = 32;
  const phases = [];
  async function observeUnderLoad(name, active, expectedEvent) {
    let running = true;
    let next = 0;
    let completed = 0;
    let loadError;
    const load = Promise.all(Array.from({ length: concurrency }, async () => {
      while (running) {
        try {
          await read(routes[next++ % routes.length]);
          completed++;
        } catch (error) {
          loadError = error;
          running = false;
        }
      }
    }));
    const durations = [];
    const events = [];
    try {
      for (let i = 0; i < 12; i++) {
        const started = performance.now();
        const sample = await collect({ origin, tokenFile });
        durations.push(performance.now() - started);
        assert.deepEqual(Object.keys(sample).filter(key => sample[key]), active ? [code] : [], name);
        assert.equal(sample[code], active, name);
        const observed = tracker.observe(sample).map(event => event.event);
        assert.deepEqual(observed, i === 1 && expectedEvent ? [expectedEvent] : [], name);
        events.push(...observed);
      }
    } finally {
      running = false;
      await load;
    }
    if (loadError) throw loadError;
    assert.ok(completed >= concurrency, 'Business load did not run alongside monitor probes.');
    phases.push({ name, active, events, concurrentBusinessClients: concurrency, completedBusinessRequests: completed,
      collectionMs: summarize(durations) });
  }

  sql(`BEGIN;
    INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,status,reason,updated_at)
    SELECT '${id}','CREATE',creator_id,department_id,policy_version_id,'APPROVED','monitor load fixture',now()-interval '10 minutes'
    FROM requests WHERE id='0eeeeeee-1111-1111-1111-111111111111';
    INSERT INTO provider_operations(request_id,operation_type,status,claim_version,retry_after)
    VALUES ('${id}','CREATE','CLAIMED',1,now()+interval '15 minutes');
    COMMIT;`);
  const lock = spawn('docker', ['exec', '-i', postgresId, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'crypta_t30_test', '-d', 'crypta_t30_test'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => lock.once('close', resolve));
  lock.once('error', () => {});
  lock.stdin.on('error', () => {});
  lock.stderr.resume();
  const lines = createInterface({ input: lock.stdout });
  const ready = once(lines, 'line', { signal: AbortSignal.timeout(8_000) });
  lock.stdin.write(`BEGIN; SET LOCAL idle_in_transaction_session_timeout='120s';
    SELECT 'locked' FROM requests WHERE id='${id}' FOR UPDATE;\n`);
  try {
    assert.deepEqual(await ready, ['locked']);
    // The worker skips this locked request. Only retry_after changes between phases.
    await observeUnderLoad('future-retry', false);
    sql(`UPDATE provider_operations SET retry_after=now()-interval '5 seconds' WHERE request_id='${id}';`);
    await observeUnderLoad('recently-due-retry', false);
    sql(`UPDATE provider_operations SET retry_after=now()-interval '125 seconds' WHERE request_id='${id}';`);
    await observeUnderLoad('overdue-retry', true, 'operations.alert_opened');
    sql(`UPDATE provider_operations SET retry_after=now()+interval '15 minutes' WHERE request_id='${id}';`);
    await observeUnderLoad('rescheduled-retry', false, 'operations.alert_resolved');
    return { phases };
  } finally {
    try {
      sql(`UPDATE provider_operations SET retry_after=now()+interval '15 minutes' WHERE request_id='${id}';`);
    } finally {
      lock.stdin.end('ROLLBACK;\n');
      await closed;
      lines.close();
    }
    sql(`BEGIN; DELETE FROM provider_operations WHERE request_id='${id}'; DELETE FROM requests WHERE id='${id}'; COMMIT;`);
  }
}

module.exports = { verifyMonitorLoad };
