const { createHash, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { isAbsolute } = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { AdapterError, OpenBaoTransitAdapter } = require('./adapter.cjs');

const credentialDigest = value => createHash('sha256').update(value).digest();

async function jsonBody(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new AdapterError('CONTENT_TYPE_INVALID', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new AdapterError('REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
    return value;
  } catch { throw new AdapterError('REQUEST_BODY_INVALID', 400); }
}

function createBridge({ adapter, clientToken, tls }) {
  if (typeof clientToken !== 'string' || !/^[!-~]{32,1024}$/.test(clientToken)) throw new Error('BRIDGE_TOKEN_INVALID');
  const expected = credentialDigest('Bearer ' + clientToken);
  const handler = async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!timingSafeEqual(credentialDigest(request.headers.authorization ?? ''), expected)) {
        throw new AdapterError('BRIDGE_UNAUTHORIZED', 401);
      }
      const route = new URL(request.url ?? '', 'http://127.0.0.1');
      if (route.search || route.hash) throw new AdapterError('ROUTE_NOT_FOUND', 404);
      let result;
      if (request.method === 'POST' && ['/assets', '/assets/revoke'].includes(route.pathname)) {
        const body = await jsonBody(request);
        if (body.operationId !== request.headers['idempotency-key']) throw new AdapterError('IDEMPOTENCY_KEY_MISMATCH', 400);
        result = route.pathname === '/assets' ? await adapter.provision(body) : await adapter.revoke(body);
      } else if (request.method === 'GET' && /^\/operations\/[a-zA-Z0-9_.-]{1,128}$/.test(route.pathname)) {
        result = await adapter.lookup(route.pathname.slice('/operations/'.length));
      } else if (request.method === 'GET' && route.pathname === '/capabilities') {
        result = { provider: 'OPENBAO_TRANSIT', assetTypes: ['KEY'], usages: ['SIGNING'],
          algorithms: { RSA: [2048, 3072, 4096], ECDSA: [256, 384, 521] }, revocation: 'SOFT_DELETE', expiry: 'POLICY_METADATA' };
      } else throw new AdapterError('ROUTE_NOT_FOUND', 404);
      response.statusCode = 200;
      response.end(JSON.stringify(result));
    } catch (error) {
      const known = error instanceof AdapterError;
      response.statusCode = known ? error.status : 500;
      response.end(JSON.stringify({ error: { code: known ? error.message : 'BRIDGE_OPERATION_FAILED' } }));
    }
  };
  const options = { headersTimeout: 5_000, requestTimeout: 10_000, maxHeaderSize: 8192 };
  return tls ? https.createServer({ ...options, ...tls, minVersion: 'TLSv1.2' }, handler) : http.createServer(options, handler);
}

function secret(env, name) {
  const file = env[name + '_FILE'];
  if (file && isAbsolute(file) && !env[name]) return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  if (env.NODE_ENV !== 'production' && !file && env[name]) return env[name];
  throw new Error('BRIDGE_SECRET_FILE_REQUIRED');
}

function start(env = process.env) {
  const upstream = new URL(env.OPENBAO_URL ?? '');
  const production = env.NODE_ENV === 'production';
  if (production && upstream.protocol !== 'https:') throw new Error('OPENBAO_TLS_REQUIRED');
  const clientToken = secret(env, 'CRYPTA_BRIDGE_TOKEN');
  const token = secret(env, 'OPENBAO_TOKEN');
  if (token === clientToken) throw new Error('BRIDGE_TOKENS_MUST_DIFFER');
  const adapter = new OpenBaoTransitAdapter({ origin: upstream.href, token, transitMount: env.OPENBAO_TRANSIT_MOUNT ?? 'transit',
    journalMount: env.OPENBAO_JOURNAL_MOUNT ?? 'crypta-journal', namespace: env.OPENBAO_NAMESPACE ?? 'crypta' });
  const port = Number(env.PORT ?? 18211);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('BRIDGE_PORT_INVALID');
  const tls = production ? { cert: secret(env, 'CRYPTA_BRIDGE_TLS_CERT'), key: secret(env, 'CRYPTA_BRIDGE_TLS_KEY') } : undefined;
  const server = createBridge({ adapter, clientToken, tls });
  server.listen(port, production ? (env.BIND_ADDRESS ?? '127.0.0.1') : '127.0.0.1');
  return server;
}

if (require.main === module) {
  try { start(); }
  catch (error) {
    console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'BRIDGE_START_FAILED');
    process.exitCode = 1;
  }
}

module.exports = { createBridge };
