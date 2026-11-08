// Bounded HTTP parser and error-envelope probes against a validated test backend.
// No credentials, business endpoint writes, process restart or DB mutation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');

async function containerProbes(port) {
  const http = require('node:http');
  const zlib = require('node:zlib');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const { createHash } = require('node:crypto');
  assert.equal(process.env.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(process.env.SMTP_ENABLED, 'false');
  assert.equal(port, 3000);
  const adapterPackage = require.resolve('@nestjs/platform-express/package.json');
  const expressPackage = require.resolve('express/package.json', { paths: [path.dirname(adapterPackage)] });
  const parserPackage = require.resolve('body-parser/package.json', { paths: [path.dirname(expressPackage)] });
  const parser = JSON.parse(fs.readFileSync(parserPackage, 'utf8'));
  const express = JSON.parse(fs.readFileSync(expressPackage, 'utf8'));
  const [major, minor] = parser.version.split('.').map(Number);
  // This runner deliberately refuses to attempt the regression on an old image.
  assert.ok(/^\d+\.\d+\.\d+$/.test(parser.version) && major === 2 && minor >= 4,
    'Requires a stable patched body-parser 2.4+ runtime.');
  const results = [];
  const endpoint = '/api/v1/__body_parser_regression__';
  const healthPath = '/api/v1/health';
  const invalidUri = '/api/v1/requests/T03TARGET%FF?probe=T03QUERY';
  const unknownRoute = '/api/v1/T03TARGET?probe=T03QUERY';
  const syntheticValues = ['T03BODY', 'T03TARGET', 'T03QUERY'];

  function request(method, target, first, trailing, contentEncoding = 'gzip') {
    assert.ok([endpoint, healthPath, invalidUri, unknownRoute].includes(target));
    const bytes = (first?.length ?? 0) + (trailing?.length ?? 0);
    assert.ok(bytes <= 2048, 'Parser probes are bounded to 2 KiB.');
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    return new Promise((resolve, reject) => {
      let completed = false, responseEnded = false, requestFinished = false, status, requestId;
      let responseBytes = 0, tailTimer, deadline, graceTimer, req;
      const chunks = [];
      const started = Date.now();
      function stop(error) {
        if (completed) return;
        completed = true; clearTimeout(deadline); clearTimeout(tailTimer); clearTimeout(graceTimer);
        req?.destroy(); agent.destroy();
        if (error) reject(error);
        else resolve({ status, requestId, responseText: Buffer.concat(chunks).toString('utf8'),
          requestBytes: bytes, responseBytes,
          requestFinished, responseEnded, elapsedMs: Date.now() - started,
          trailingBytes: trailing?.length ?? 0, requestedTrailerDelayMs: trailing ? 50 : 0,
          postResponseObservationMs: method === 'POST' ? 200 : 0 });
      }
      function finish() {
        if (!requestFinished || !responseEnded || graceTimer) return;
        // Keep the socket alive while late decoder errors could still occur.
        // Closing it as soon as the request flushes could discard the trailer.
        if (method === 'POST') graceTimer = setTimeout(() => stop(), 200);
        else stop();
      }
      const headers = method === 'POST' ? {
        'Content-Type': 'application/json', 'Content-Encoding': contentEncoding,
        'Content-Length': bytes, Connection: 'keep-alive',
      } : { Connection: 'keep-alive' };
      req = http.request({ hostname: '127.0.0.1', port, method, path: target, headers, agent }, response => {
        status = response.statusCode;
        requestId = response.headers['x-request-id'];
        response.on('data', chunk => {
          responseBytes += chunk.length;
          if (responseBytes > 64 * 1024) stop(new Error('Probe response exceeded its bound.'));
          else chunks.push(chunk);
        });
        response.once('end', () => { responseEnded = true; finish(); });
        response.once('aborted', () => stop(new Error('Probe response was aborted.')));
        response.once('error', () => stop(new Error('Probe response failed.')));
      });
      req.once('finish', () => { requestFinished = true; finish(); });
      req.once('error', () => stop(new Error('Bounded HTTP probe failed.')));
      deadline = setTimeout(() => stop(new Error('HTTP probe exceeded its 4 second deadline.')), 4000);
      if (trailing) {
        req.write(first);
        tailTimer = setTimeout(() => req.end(trailing), 50);
      } else req.end(first);
    });
  }
  async function health() {
    const result = await request('GET', healthPath);
    assert.equal(result.status, 200, 'The test backend must remain healthy.');
    return { status: result.status, elapsedMs: result.elapsedMs };
  }
  const beforeHealth = await health();
  const valid = zlib.gzipSync(Buffer.from('{"probe":"crypta"}', 'utf8'));
  assert.ok(valid.length < 128);
  const tests = [
    { name: 'Malformed JSON returns a safe 400 envelope', encoding: 'identity',
      first: Buffer.from('{"probe":T03BODY}'), expected: [400], message: 'Dữ liệu yêu cầu không hợp lệ.' },
    { name: 'Valid small gzip JSON reaches the unknown route without a parser error',
      first: valid, expected: [404] },
    { name: 'A malformed four-byte gzip body is rejected and the backend remains healthy',
      first: Buffer.from([0x1f, 0x8b, 0x08, 0xff]), expected: [400] },
    { name: 'Small delayed trailing bytes after gzip do not interrupt backend health',
      first: Buffer.concat([valid, Buffer.from([0])]), trailing: Buffer.alloc(1024, 0x58), expected: [400, 404] },
    { name: 'Inflated JSON above the parser limit returns a safe 413 envelope',
      first: zlib.gzipSync(Buffer.alloc(101 * 1024, 0x20)), expected: [413], message: 'Dữ liệu yêu cầu vượt quá giới hạn cho phép.' },
    { name: 'Unsupported encoding returns a safe 415 envelope', encoding: 'crypta-unsupported',
      first: Buffer.from('{"probe":"T03BODY"}'), expected: [415], message: 'Định dạng hoặc mã hóa yêu cầu không được hỗ trợ.' },
    { name: 'Invalid route parameter encoding returns a safe 400 envelope', method: 'GET', target: invalidUri,
      expected: [400], message: 'Dữ liệu yêu cầu không hợp lệ.' },
    { name: 'Unknown route returns a safe 404 envelope', method: 'GET', target: unknownRoute,
      expected: [404], message: 'Không tìm thấy đường dẫn API.' },
  ];
  for (const test of tests) {
    try {
      const method = test.method ?? 'POST';
      const { requestId, responseText, ...response } = await request(method, test.target ?? endpoint,
        test.first, test.trailing, test.encoding);
      assert.ok(test.expected.includes(response.status), `Unexpected parser probe status ${response.status}.`);
      assert.ok(syntheticValues.every(value => !responseText.includes(value)), 'Synthetic input was reflected in an error response.');
      const envelope = JSON.parse(responseText);
      assert.match(requestId, /^req_[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
      assert.equal(envelope.requestId, requestId);
      assert.equal(envelope.error.code, `HTTP_${response.status}`);
      assert.deepEqual(envelope.error.details, []);
      assert.equal(envelope.path, '/');
      if (test.message) assert.equal(envelope.error.message, test.message);
      // request() retains the socket for the post-response observation window.
      const afterHealth = await health();
      results.push({ name: test.name, passed: true, evidence: { ...response, method, safeEnvelope: true, healthAfter: afterHealth } });
    } catch (error) {
      const reflectionFailure = 'Synthetic input was reflected in an error response.';
      results.push({ name: test.name, passed: false, error: error.message === reflectionFailure
        ? reflectionFailure : 'Parser status, envelope or health assertion failed.' });
      break; // Never retry a potentially failed parser process.
    }
  }
  return { results, passed: results.filter(item => item.passed).length, total: tests.length,
    success: results.length === tests.length && results.every(item => item.passed), beforeHealth,
    target: 'backend-container IPv4 loopback:3000', bypassesNginxRequestBuffering: true,
    nodeVersion: process.versions.node,
    nestExpressAdapterVersion: JSON.parse(fs.readFileSync(adapterPackage, 'utf8')).version,
    expressVersion: express.version,
    bodyParserVersion: parser.version,
    parserReadSha256: createHash('sha256').update(fs.readFileSync(path.join(path.dirname(parserPackage), 'lib/read.js'))).digest('hex'),
    apiExceptionFilterCompiledSha256: createHash('sha256').update(fs.readFileSync('/app/dist/common/api-exception.filter.js')).digest('hex'),
    maximumWireBodyBytes: 2048, requestDeadlineMs: 4000,
    noAutomaticRetries: true, businessEndpointsCalled: false, credentialsUsed: false };
}

async function main(argument) {
  assert.ok(argument, 'Pass a fresh retained isolated-stack report.json.');
  const root = path.resolve(__dirname, '..');
  const artifactRoot = await fs.realpath(path.join(__dirname, 'test-artifacts', 'integration'));
  const reportPath = await fs.realpath(path.resolve(argument));
  assert.ok(reportPath.startsWith(artifactRoot + path.sep));
  assert.equal(path.basename(reportPath), 'report.json');
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.equal(stack.database, 'crypta_t30_test');
  assert.equal(stack.provider, 'MOCK'); assert.equal(stack.smtpEnabled, false);
  assert.equal(stack.fixtureOnly, false); assert.equal(stack.started, true);
  assert.equal(stack.keptStack, true); assert.equal(stack.cleanupCompleted, false);
  const origin = new URL(stack.origin);
  assert.equal(origin.protocol, 'http:'); assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(origin.username, ''); assert.equal(origin.password, '');
  assert.equal(origin.pathname, '/'); assert.equal(origin.search, ''); assert.equal(origin.hash, '');
  assert.ok(origin.port && origin.port !== '8080');
  const envFile = await fs.realpath(path.join(path.dirname(reportPath), 'test.env'));
  assert.equal(path.dirname(envFile), path.dirname(reportPath));
  const compose = ['compose', '--project-name', stack.project, '--env-file', envFile,
    '--file', path.join(root, 'tools', 'testing', 'compose.t30.yml')];
  function docker(args, input, timeout = 30000) {
    try { return execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      timeout, maxBuffer: 4 * 1024 * 1024 }).trim(); }
    catch { throw new Error('Validated test Docker command failed; configuration and credentials were not printed.'); }
  }
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json']));
  assert.equal(config.name, stack.project);
  assert.equal(config.services.backend.environment.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(String(config.services.backend.environment.SMTP_ENABLED), 'false');
  assert.equal(String(config.services.backend.environment.PORT), '3000');
  assert.equal(config.volumes.test_postgres.name, `${stack.project}_test_postgres`);
  assert.ok(!config.volumes.test_postgres.external);
  const ids = docker([...compose, 'ps', '-q']).split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  for (const item of containers) {
    assert.equal(item.Config.Labels['com.docker.compose.project'], stack.project);
    assert.equal(item.State.Running, true);
  }
  assert.deepEqual(containers.map(item => item.Config.Labels['com.docker.compose.service']).sort(), ['backend', 'frontend', 'postgres']);
  const backend = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'backend');
  const frontend = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'frontend');
  const postgres = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'postgres');
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK'));
  assert.ok(backend.Config.Env.includes('SMTP_ENABLED=false'));
  assert.ok(backend.Config.Env.includes('PORT=3000'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_USER=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(item => item.Type === 'volume' && item.Name === `${stack.project}_test_postgres`));
  const binding = frontend.NetworkSettings.Ports['80/tcp'];
  assert.ok(binding?.length === 1 && binding[0].HostIp === '127.0.0.1' && binding[0].HostPort === origin.port);
  const setting = backend.Config.Env.find(item => item.startsWith('DATABASE_URL='));
  assert.ok(setting);
  const database = new URL(setting.slice('DATABASE_URL='.length));
  assert.equal(database.protocol, 'postgresql:'); assert.equal(database.hostname, 'postgres');
  assert.equal(database.pathname, '/crypta_t30_test'); assert.equal(database.username, 'crypta_t30_test');
  function state(item) { return { containerId: item.Id, imageId: item.Image, pid: item.State.Pid,
    startedAt: item.State.StartedAt, restartCount: item.RestartCount, running: item.State.Running }; }
  function inventory() {
    const raw = docker(['ps', '-a', '--no-trunc', '--format',
      '{"id":{{json .ID}},"name":{{json .Names}},"project":{{json (.Label "com.docker.compose.project")}}}']);
    const items = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const item of items) { assert.match(item.id, /^[a-f0-9]{64}$/); assert.equal(typeof item.name, 'string'); assert.ok(item.name); assert.equal(typeof item.project, 'string'); }
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }
  const beforeInventory = inventory();
  assert.deepEqual(beforeInventory.filter(item => item.project === stack.project).map(item => item.id).sort(), containers.map(item => item.Id).sort());
  const output = path.join(path.dirname(reportPath), `body-parser-${randomBytes(6).toString('hex')}`);
  await fs.mkdir(output, { recursive: false });
  const report = { project: stack.project, createdUtc: new Date().toISOString(), fixtureOnly: false,
    provider: 'MOCK', smtpEnabled: false, operationalEnvironmentRead: false, databaseWrites: false,
    success: false, temporaryResourcesCreated: false, backendBefore: state(backend),
    containerInventoryBefore: beforeInventory, outsideContainerCountBefore: beforeInventory.filter(item => item.project !== stack.project).length,
    sourceHashes: {}, results: [],
    runtimeImages: containers.map(item => ({ service: item.Config.Labels['com.docker.compose.service'], imageId: item.Image })),
    limitations: ['Bounded HTTP regression requests, not a stress test or a full reproduction of every decoder timing.',
      'The 1 KiB delayed trailer is smaller than upstream coverage; writable/request completion is not proof of each decoder event order.',
      'Requests run directly against the validated backend loopback, so Nginx buffering cannot hide the delayed trailer; this suite does not test proxy behavior.',
      'No old-image crash attempt, automatic retry, business DB write, real provider or SMTP delivery.'] };
  for (const relative of ['tools/test-real-body-parser.cjs', 'backend/package.json', 'backend/package-lock.json',
    'backend/src/common/api-exception.filter.ts', 'backend/src/main.ts']) {
    report.sourceHashes[relative] = createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex');
  }
  try {
    const invocation = `(${containerProbes.toString()})(3000).then(result=>process.stdout.write(JSON.stringify(result))).catch(()=>{process.stderr.write('Bounded parser runner failed before emitting credentials.');process.exitCode=1;});`;
    const result = JSON.parse(docker([...compose, 'exec', '-T', 'backend', 'node', '-'], invocation, 45000));
    Object.assign(report, result);
    assert.equal(result.total, 8);
    report.success = result.success === true && result.results.length === result.total && result.results.every(item => item.passed);
  } catch (error) {
    report.success = false;
    report.error = error instanceof assert.AssertionError ? 'Parser runner result assertion failed.' : String(error.message).slice(0, 250);
  } finally {
    try {
      const after = JSON.parse(docker(['inspect', backend.Id]))[0];
      report.backendAfter = state(after);
      report.backendIdentityAndProcessPreserved = JSON.stringify(report.backendBefore) === JSON.stringify(report.backendAfter);
      const afterInventory = inventory();
      report.containerInventoryAfter = afterInventory;
      report.outsideContainerCountAfter = afterInventory.filter(item => item.project !== stack.project).length;
      report.comparisonHasSubjects = report.outsideContainerCountBefore > 0;
      report.otherContainerIdsPreserved = JSON.stringify(beforeInventory.filter(item => item.project !== stack.project))
        === JSON.stringify(afterInventory.filter(item => item.project !== stack.project));
      report.isolatedContainerIdsPreserved = JSON.stringify(beforeInventory.filter(item => item.project === stack.project))
        === JSON.stringify(afterInventory.filter(item => item.project === stack.project));
      report.success = report.success && report.backendIdentityAndProcessPreserved && report.otherContainerIdsPreserved && report.isolatedContainerIdsPreserved;
    } catch {
      report.success = false; report.preservationError = 'Post-probe test process/inventory verification failed.';
    }
    report.finishedUtc = new Date().toISOString();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(`Body-parser ${report.passed ?? 0}/${report.total ?? 8} probes; success=${report.success}; report ${path.join(output, 'results.json')}`);
  }
  if (!report.success) process.exitCode = 1;
}

if (require.main === module) main(process.argv[2]).catch(() => {
  console.error('Parser regression refused or failed validation; no configuration or credentials were printed.');
  process.exitCode = 1;
});
module.exports = { containerProbes };
