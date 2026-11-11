const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { AlertTracker, MonitorJournal, collect, monitorOrigin, publishAlerts } = require('../monitor-operations.cjs');

test('requires consecutive observations, keeps open alerts through missing samples and avoids duplicates', () => {
  const tracker = new AlertTracker();
  const open = { EMAIL_RECONCILIATION_REQUIRED: true };
  const closed = { EMAIL_RECONCILIATION_REQUIRED: false };
  assert.deepEqual(tracker.observe(open), []);
  assert.deepEqual(tracker.observe({}), []);
  assert.deepEqual(tracker.observe(open), []);
  assert.equal(tracker.observe(open)[0].event, 'operations.alert_opened');
  assert.deepEqual(tracker.observe(open), []);
  assert.deepEqual(tracker.observe({}), []);
  assert.deepEqual(tracker.observe(closed), []);
  assert.equal(tracker.observe(closed)[0].event, 'operations.alert_resolved');
  assert.deepEqual(tracker.observe(closed), []);
});

test('journal replays an interrupted write with the same ID and resolves after restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'crypta-monitor-journal-'));
  const file = path.join(directory, 'monitor.json');
  const origin = 'https://crypta.example.test';
  const journal = new MonitorJournal(file, origin);
  const sample = { DATABASE_UNAVAILABLE: true };
  const tracker = new AlertTracker();
  try {
    assert.deepEqual(await journal.load(), { openCodes: [], pending: [] });
    tracker.observe(sample);
    const events = tracker.observe(sample);
    await assert.rejects(publishAlerts(events, tracker, journal, async () => { throw new Error('sink closed'); }), /sink closed/);
    const saved = await new MonitorJournal(file, origin).load();
    assert.deepEqual(saved, { openCodes: ['DATABASE_UNAVAILABLE'], pending: events });
    assert.match(events[0].eventId, /^[a-f0-9-]{36}$/);

    const restarted = new AlertTracker(2, saved.openCodes);
    const delivered = [];
    const write = async event => { delivered.push(event); };
    await publishAlerts(saved.pending, restarted, journal, write, true);
    assert.deepEqual(delivered, events);
    assert.deepEqual(restarted.observe(sample), []);
    assert.deepEqual(await journal.load(), { openCodes: saved.openCodes, pending: [] });

    const healthy = { DATABASE_UNAVAILABLE: false };
    assert.deepEqual(restarted.observe(healthy), []);
    await publishAlerts(restarted.observe(healthy), restarted, journal, write);
    assert.equal(delivered[1].event, 'operations.alert_resolved');
    assert.notEqual(delivered[1].eventId, delivered[0].eventId);
    assert.deepEqual(await journal.load(), { openCodes: [], pending: [] });
    assert.deepEqual(await fs.readdir(directory), ['monitor.json']);
  } finally {
    await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(directory);
  }
});

test('journal rejects state from another origin and malformed pending records', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'crypta-monitor-invalid-'));
  const file = path.join(directory, 'monitor.json');
  const origin = 'https://crypta.example.test';
  const journal = new MonitorJournal(file, origin);
  try {
    await journal.save(['DATABASE_UNAVAILABLE'], []);
    await assert.rejects(new MonitorJournal(file, 'https://other.example.test').load(), /MONITOR_INVALID_STATE/);
    await journal.save(['DATABASE_UNAVAILABLE'], [{ code: 'UNRECOGNIZED', eventId: 'fixture-invalid' }]);
    await assert.rejects(journal.load(), /MONITOR_INVALID_STATE/);
    await fs.writeFile(file, '{');
    await assert.rejects(journal.load(), /MONITOR_INVALID_STATE/);
    assert.equal(await fs.readFile(file, 'utf8'), '{');
  } finally {
    await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(directory);
  }
});

test('CLI replays persisted alerts before polling and clears pending after writing', { timeout: 10_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'crypta-monitor-replay-'));
  const stateFile = path.join(directory, 'state.json');
  const origin = 'http://127.0.0.1:1';
  const journal = new MonitorJournal(stateFile, origin);
  const tracker = new AlertTracker(1);
  const events = tracker.observe({ API_UNAVAILABLE: true });
  await journal.save(tracker.openCodes(), events);
  const child = spawn(process.execPath, [path.join(__dirname, '../monitor-operations.cjs')], {
    env: { ...process.env, CRYPTA_MONITOR_ORIGIN: origin, CRYPTA_MONITOR_STATE_FILE: stateFile,
      CRYPTA_MONITOR_TOKEN_FILE: path.join(directory, 'unused.token') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  try {
    const deadline = Date.now() + 5000;
    while ((!stdout.includes('\n') || (await journal.load()).pending.length) && Date.now() < deadline) await delay(25);
    assert.deepEqual(await journal.load(), { openCodes: ['API_UNAVAILABLE'], pending: [] });
    assert.deepEqual(stdout.trim().split('\n').map(JSON.parse), events);
  } finally {
    child.kill();
    await closed;
    for (const entry of await fs.readdir(directory)) await fs.unlink(path.join(directory, entry));
    await fs.rmdir(directory);
  }
});

test('validates origin and treats missing, redirected, oversized and invalid signals as unobserved', async () => {
  for (const origin of ['http://api.example.test', 'https://user:secret@api.example.test', 'https://api.example.test/?token=value']) {
    assert.throws(() => monitorOrigin(origin), { message: 'MONITOR_INVALID_ORIGIN' });
  }
  assert.equal(monitorOrigin('https://api.example.test:8443'), 'https://api.example.test:8443');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crypta-monitor-test-'));
  const tokenFile = path.join(dir, 'token.test');
  let mode = 'redirect';
  let redirectRequests = 0;
  let signalRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('/health/live')) {
      res.writeHead(mode === 'offline' ? 503 : 200).end(JSON.stringify({ data: { status: 'ok' } }));
    } else if (req.url.endsWith('/health/ready')) {
      res.writeHead(mode === 'offline' ? 503 : 200).end(JSON.stringify({ data: { status: 'ok', database: 'connected' } }));
    } else if (req.url.endsWith('/operations/signals')) {
      signalRequests += 1;
      if (mode === 'redirect') res.writeHead(302, { Location: '/do-not-follow' }).end();
      else if (mode === 'invalid') res.writeHead(200).end('{"data":{"signals":["UNEXPECTED_SIGNAL"]}}');
      else if (mode === 'oversized') res.writeHead(200).end('x'.repeat(17_000));
      else if (mode === 'worker-stale') res.writeHead(200).end('{"data":{"signals":["EMAIL_WORKER_STALE"]}}');
      else res.writeHead(401).end('not authorized');
    } else {
      redirectRequests += 1;
      res.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const options = { origin: monitorOrigin(`http://127.0.0.1:${server.address().port}`), tokenFile, timeoutMs: 1000 };
  try {
    assert.equal((await collect(options)).MONITOR_SIGNAL_ACCESS_FAILED, true);
    assert.equal(signalRequests, 0);
    await fs.writeFile(tokenFile, 'a'.repeat(64), { flag: 'wx' });
    for (mode of ['redirect', 'invalid', 'oversized']) {
      const sample = await collect(options);
      assert.equal(sample.MONITOR_SIGNAL_PROBE_FAILED, true);
      assert.equal(sample.EMAIL_QUEUE_DELAYED, undefined);
    }
    assert.equal(redirectRequests, 0);
    mode = 'worker-stale';
    const sample = await collect(options);
    assert.equal(sample.MONITOR_SIGNAL_PROBE_FAILED, false);
    assert.equal(sample.EMAIL_WORKER_STALE, true);
    assert.equal(sample.EMAIL_WORKER_FAILED, false);
    mode = 'unauthorized';
    assert.equal((await collect(options)).MONITOR_SIGNAL_ACCESS_FAILED, true);
    mode = 'offline';
    assert.deepEqual(await collect(options), { API_UNAVAILABLE: true });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(tokenFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(dir);
  }
});

test('CLI emits a JSON alert on stdout after two failed API probes', { timeout: 25_000 }, async () => {
  const fixture = http.createServer((_req, res) => res.writeHead(503).end('{}'));
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const child = spawn(process.execPath, [path.join(__dirname, '../monitor-operations.cjs')], {
    env: {
      ...process.env,
      CRYPTA_MONITOR_ORIGIN: `http://127.0.0.1:${fixture.address().port}`,
      CRYPTA_MONITOR_TOKEN_FILE: path.join(os.tmpdir(), 'unused-while-unavailable.test'),
      CRYPTA_MONITOR_STATE_FILE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const childClosed = once(child, 'close');
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill(), 21_000);
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    stdout += chunk;
    if (stdout.includes('\n')) child.kill();
  });
  try {
    await childClosed;
    const alerts = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(alerts.length, 1);
    const [event] = alerts;
    assert.equal(event.event, 'operations.alert_opened');
    assert.equal(event.code, 'API_UNAVAILABLE');
    assert.equal(event.owner, 'platform');
    assert.equal(stderr, '');
  } finally {
    clearTimeout(timer);
    child.kill();
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
  }
});
