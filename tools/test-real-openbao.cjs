const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { OpenBaoTransitAdapter } = require('../providers/openbao-transit/adapter.cjs');
const { createBridge } = require('../providers/openbao-transit/server.cjs');
const { keyReceipt, sameKey, revocationReceipt } = require('./testing/provider-contract.cjs');

const image = 'ghcr.io/openbao/openbao:2.7.2@sha256:5046911075e137e154ce49ab051502f4ec7cf367d484ae4a4dce665d9b90561f';
const nativeBinary = process.argv[2] === '--native' ? process.argv[3] : undefined;
const reportPath = nativeBinary ? undefined : path.resolve(process.argv[2]);
const artifactRoot = path.join(__dirname, 'test-artifacts', 'integration');
const results = [];
const secret = () => randomBytes(32).toString('base64url');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function docker(args, env = process.env) {
  return execFileSync('docker', args, { env, timeout: 90_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function getPort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  const id = randomBytes(6).toString('hex');
  let binary, output;
  if (nativeBinary) {
    const sandbox = path.join(__dirname, 'test-artifacts', 'openbao-bin');
    binary = await fs.realpath(nativeBinary);
    assert.ok(binary.startsWith(sandbox + path.sep), 'Native OpenBao executable must be inside the ignored fixture directory');
    output = path.join(__dirname, 'test-artifacts', 'openbao-native-' + id);
  } else {
    assert.ok(reportPath.startsWith(artifactRoot + path.sep) && path.basename(reportPath) === 'report.json');
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.match(report.project, /^crypta-t30-test-[a-f0-9]{12}$/);
    assert.equal(path.basename(path.dirname(reportPath)), report.project);
    assert.ok(report.started && report.keptStack && !report.cleanupCompleted && report.provider === 'MOCK' && !report.smtpEnabled);
    const origin = new URL(report.origin);
    assert.ok(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && origin.port !== '8080');
    output = path.join(path.dirname(reportPath), 'openbao');
  }
  await fs.mkdir(output);
  const name = 'crypta-openbao-test-' + id;
  const port = await getPort();
  const upstream = `http://127.0.0.1:${port}`;
  const rootToken = secret(), clientToken = secret();
  let container, nativeProcess, bridge, cleanupCompleted = false, failure, cleanupFailure;
  const fixtureContainers = () => docker(['ps', '-a', '--filter', 'label=org.crypta.openbao-test=' + id, '--format', '{{.ID}}', '--no-trunc']);
  const request = (base, pathname, method, headers, body) => fetch(base + pathname, {
    method, redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { ...headers, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const bao = (method, route, body) => request(upstream, '/v1' + route, method, { 'X-Vault-Token': rootToken }, body);
  async function data(response, status, label) {
    const raw = await response.text();
    const body = raw ? JSON.parse(raw) : undefined;
    assert.equal(response.status, status, `${label}: expected ${status}, received ${response.status} (${body?.error?.code ?? 'no code'})`);
    return body;
  }
  async function check(name, run) {
    try { results.push({ name, passed: true, evidence: await run() }); console.log('PASS ' + name); }
    catch (error) {
      const line = String(error.stack).match(/test-real-openbao\.cjs:(\d+):\d+/)?.[1];
      const detail = error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name;
      results.push({ name, passed: false, error: `${detail} (runner line ${line ?? '?'})` });
      throw new Error(detail, { cause: error });
    }
  }
  async function stopProvider() {
    if (nativeProcess && nativeProcess.exitCode === null && nativeProcess.signalCode === null) {
      const stopped = once(nativeProcess, 'exit');
      nativeProcess.kill();
      await stopped;
    }
    if (container) {
      docker(['stop', '--time', '2', container]);
    }
  }
  try {
    const env = { ...process.env, BAO_DEV_ROOT_TOKEN_ID: rootToken };
    if (binary) {
      nativeProcess = spawn(binary, ['server', '-dev', '-dev-listen-address=127.0.0.1:' + port], { env, windowsHide: true, stdio: 'ignore' });
      await once(nativeProcess, 'spawn');
    } else {
      container = docker(['run', '--detach', '--name', name, '--label', 'org.crypta.openbao-test=' + id,
        '--publish', `127.0.0.1:${port}:8200`, '--env', 'BAO_DEV_ROOT_TOKEN_ID', '--env', 'SKIP_SETCAP=true',
        image, 'server', '-dev', '-dev-listen-address=0.0.0.0:8200'], env);
      assert.match(container, /^[a-f0-9]{64}$/);
    }
    let online = false;
    for (let i = 0; i < 30; i++) {
      try {
        if ((await bao('GET', '/sys/health')).ok) { online = true; break; }
      } catch { /* The pinned sandbox is starting. */ }
      await wait(400);
    }
    assert.ok(online, 'OpenBao sandbox reached readiness');
    await data(await bao('POST', '/sys/mounts/crypta-transit', { type: 'transit' }), 204, 'Transit mount');
    await data(await bao('POST', '/sys/mounts/crypta-journal', { type: 'kv', options: { version: '2' } }), 204, 'KV v2 journal');
    const policy = `path "crypta-transit/keys/+" { capabilities = ["create","update","read"] }
path "crypta-transit/keys/+/soft-delete" { capabilities = ["delete"] }
path "crypta-journal/data/crypta-test/operations/*" { capabilities = ["create","read"] }`;
    await data(await bao('PUT', '/sys/policies/acl/crypta-bridge', { policy }), 204, 'Scoped bridge policy');
    const issued = await data(await bao('POST', '/auth/token/create', {
      policies: ['crypta-bridge'], no_default_policy: true, ttl: '15m',
    }), 200, 'Scoped sandbox token');
    const adapter = new OpenBaoTransitAdapter({ origin: upstream, token: issued.auth.client_token, transitMount: 'crypta-transit',
      journalMount: 'crypta-journal', namespace: 'crypta-test', timeoutMs: 3500 });
    bridge = createBridge({ adapter, clientToken });
    bridge.listen(0, '127.0.0.1');
    await once(bridge, 'listening');
    const base = 'http://127.0.0.1:' + bridge.address().port;
    const api = (method, route, body, headers = {}) => request(base, route, method, {
      Authorization: 'Bearer ' + clientToken, ...(body?.operationId && { 'Idempotency-Key': body.operationId }), ...headers,
    }, body);
    const input = { operationId: randomUUID(), assetType: 'KEY', algorithm: 'RSA', keySize: 2048, usage: 'SIGNING',
      purpose: 'Isolated provider contract test', validityDays: 31 };
    let original, renewed;
    await check('OpenBao declares a key-only signing capability and rejects unauthorized or certificate requests', async () => {
      const capability = await data(await api('GET', '/capabilities'), 200, 'Capabilities');
      assert.deepEqual(capability.assetTypes, ['KEY']);
      await data(await api('GET', '/capabilities', undefined, { Authorization: 'Bearer invalid' }), 401, 'Bridge authorization');
      await data(await api('POST', '/assets', { ...input, assetType: 'CERTIFICATE' }), 422, 'Unsupported certificate');
      await data(await api('GET', '/operations/' + input.operationId), 404, 'Unsupported request was never reserved');
      await data(await api('POST', '/assets', input, { 'Idempotency-Key': randomUUID() }), 400, 'Idempotency mismatch');
      return { assetTypes: capability.assetTypes, unauthorized: 401, unsupported: 422 };
    });
    await check('Concurrent provisioning and lookup return the same real key and validity window', async () => {
      const [one, two] = await Promise.all([api('POST', '/assets', input), api('POST', '/assets', input)]);
      original = await data(one, 200, 'Original provisioning');
      assert.deepEqual(await data(two, 200, 'Concurrent retry'), original);
      keyReceipt(original, input);
      assert.equal(Date.parse(original.expiresAt) - Date.parse(original.validFrom), 31 * 86_400_000);
      assert.deepEqual(await data(await api('GET', '/operations/' + input.operationId), 200, 'Provider lookup'), original);
      await data(await api('POST', '/assets', { ...input, validityDays: 32 }), 409, 'Idempotency payload conflict');
      const upstreamKey = await data(await bao('GET', '/crypta-transit/keys/' + original.providerReference), 200, 'OpenBao key');
      assert.equal(upstreamKey.data.exportable, false);
      assert.equal(upstreamKey.data.latest_version, 1);
      assert.equal(upstreamKey.data.soft_deleted, false);
      let cryptaHttpClient = false;
      if (binary) {
        const { CryptoProviderService } = require('../backend/dist/jobs/crypto-provider.service');
        const config = {
          NODE_ENV: 'test', CRYPTO_PROVIDER_MODE: 'HTTP', CRYPTO_PROVIDER_URL: base,
          CRYPTO_PROVIDER_SCOPE: 'openbao-transit-sandbox', CRYPTO_PROVIDER_TOKEN: clientToken,
        };
        const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
        try {
          Object.assign(process.env, config);
          const client = new CryptoProviderService();
          const reopened = await client.provision(input);
          sameKey(original, reopened);
          cryptaHttpClient = true;
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
      return { replay: true, fingerprint: true, validityDays: 31, upstreamVersions: 1, cryptaHttpClient };
    });
    await check('Renewal creates a distinct key and soft revocation stops upstream signing', async () => {
      const next = { ...input, operationId: randomUUID(), algorithm: 'ECDSA', keySize: 256,
        replacesProviderReference: original.providerReference };
      renewed = await data(await api('POST', '/assets', next), 200, 'Distinct renewal');
      keyReceipt(renewed, next);
      assert.notEqual(renewed.providerReference, original.providerReference);
      assert.notEqual(renewed.publicKeyFingerprint, original.publicKeyFingerprint);
      const sign = ref => bao('POST', '/crypta-transit/sign/' + ref, { input: Buffer.from('Crypta fixture').toString('base64') });
      assert.equal((await sign(original.providerReference)).status, 200);
      const revoke = { operationId: randomUUID(), providerReference: original.providerReference };
      const receipt = await data(await api('POST', '/assets/revoke', revoke), 200, 'Soft revocation');
      revocationReceipt(receipt, revoke);
      assert.deepEqual(await data(await api('POST', '/assets/revoke', revoke), 200, 'Revocation replay'), receipt);
      assert.deepEqual(await data(await api('GET', '/operations/' + revoke.operationId), 200, 'Revocation lookup'), receipt);
      assert.equal((await data(await api('GET', '/operations/' + input.operationId), 200, 'Revoked key lookup')).status, 'REVOKED');
      const rejected = await sign(original.providerReference);
      const denied = rejected.status;
      const denial = await rejected.json();
      assert.ok(!rejected.ok && denial.errors?.length && !denial.data?.signature,
        `Upstream signing with a revoked key must return an error without a signature, received ${denied}`);
      assert.equal((await sign(renewed.providerReference)).status, 200, 'Renewed key can sign');
      const journal = '/crypta-journal/data/crypta-test/operations/' + renewed.providerReference.slice('crypta-'.length);
      const stored = await data(await bao('GET', journal), 200, 'Renewal journal');
      await data(await bao('POST', journal, { options: { cas: stored.data.metadata.version }, data: { ...stored.data.data,
        validFrom: new Date(Date.now() - 86_400_000).toISOString(), expiresAt: new Date(Date.now() - 1_000).toISOString(),
      } }), 200, 'Expired policy fixture');
      assert.equal((await data(await api('GET', '/operations/' + next.operationId), 200, 'Expired key lookup')).status, 'EXPIRED');
      await data(await api('POST', '/assets', next), 409, 'Expired provisioning is not replayed as active');
      return { separateReference: true, oldKeySigningDenied: denied, renewedKeySigns: true, expiredLookup: true };
    });
    await check('Transport outage returns an explicit failure without a success receipt', async () => {
      await stopProvider();
      const response = await data(await api('GET', '/operations/' + renewed.operationId), 503, 'OpenBao outage');
      assert.match(response.error.code, /^OPENBAO_(?:TRANSPORT_FAILED|TIMEOUT)$/);
      return { outage: 503, falseReceipt: false };
    });
  } catch (error) {
    failure = error instanceof Error ? error.message.split('\n')[0] : 'OpenBao verification failed.';
    console.error(failure);
  } finally {
    try {
      if (bridge) {
        bridge.closeAllConnections();
        await new Promise(resolve => bridge.close(resolve));
      }
      if (nativeProcess) await stopProvider();
      if (!binary) {
        const owned = fixtureContainers();
        if (owned) {
          assert.match(owned, /^[a-f0-9]{64}$/);
          if (container) assert.equal(owned, container, 'OpenBao test container identity changed.');
          assert.equal(docker(['inspect', '--format', '{{.Name}}', owned]), '/' + name);
          docker(['rm', '--force', owned]);
        }
      }
      cleanupCompleted = binary ? Boolean(!nativeProcess || nativeProcess.exitCode !== null || nativeProcess.signalCode !== null)
        : !fixtureContainers();
      if (!cleanupCompleted) cleanupFailure = 'OpenBao fixture still exists after cleanup.';
    } catch {
      cleanupFailure = 'Could not verify and remove the OpenBao fixture.';
    } finally {
      await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({
        passed: results.filter(item => item.passed).length, total: 4, success: !failure && results.length === 4 && cleanupCompleted,
        cleanupCompleted, results, failure, cleanupFailure,
      }, null, 2));
    }
    console.log('OpenBao report: ' + path.join(output, 'results.json'));
    if (cleanupFailure) console.error(cleanupFailure);
    if (failure || !cleanupCompleted || results.length !== 4) process.exitCode = 1;
  }
}

main().catch(() => { process.exitCode = 1; });
