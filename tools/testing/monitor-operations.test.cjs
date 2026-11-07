const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { AlertTracker, collect, monitorOrigin } = require('../monitor-operations.cjs');

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
