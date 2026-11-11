const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, X509Certificate } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

async function startSessionTlsProxy(origin, upstream, directory) {
  assert.match(origin.href, /^https:\/\/crypta-session\.test:\d+\/$/);
  const foreign = new URL(`https://crypta-foreign.test:${origin.port}`);
  const sibling = new URL(`https://sibling.${origin.hostname}:${origin.port}`);
  const testOrigins = [foreign, sibling];
  const keyFile = path.join(directory, 'tls-test-key.pem');
  const certFile = path.join(directory, 'tls-test-cert.pem');
  let key, cert;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', `/CN=${origin.hostname}`, '-addext', `subjectAltName=${[origin, ...testOrigins].map(url => `DNS:${url.hostname}`).join(',')}`,
      '-keyout', keyFile, '-out', certFile], { stdio: 'pipe', timeout: 15_000 });
    [key, cert] = await Promise.all([fs.readFile(keyFile), fs.readFile(certFile)]);
  } finally {
    await Promise.all([keyFile, certFile].map(file => fs.rm(file, { force: true })));
  }

  const keyDer = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
  const pin = createHash('sha256').update(keyDer).digest('base64');
  const crossOriginRefreshes = [];
  const server = https.createServer({ key, cert }, (request, response) => {
    if (testOrigins.some(url => url.host === request.headers.host)) {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Foreign origin fixture</title>');
      return;
    }
    if (request.headers.host !== origin.host || !request.url.startsWith('/')) {
      response.writeHead(400).end();
      return;
    }
    const forwarded = http.request({ hostname: upstream.hostname, port: upstream.port,
      method: request.method, path: request.url, headers: request.headers, timeout: 15_000 }, result => {
      if (request.method === 'POST' && request.url === '/api/v1/auth/refresh' && testOrigins.some(url => url.origin === request.headers.origin)) {
        crossOriginRefreshes.push({ origin: request.headers.origin, status: result.statusCode, sentRefreshCookie: /(?:^|;\s*)crypta_refresh=/.test(request.headers.cookie ?? '') });
      }
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    forwarded.on('timeout', () => forwarded.destroy());
    forwarded.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => forwarded.destroy());
    request.pipe(forwarded);
  });
  server.listen(Number(origin.port), '127.0.0.1');
  await once(server, 'listening');

  function preflight(requestOrigin) {
    return new Promise((resolve, reject) => {
      const request = https.request({ hostname: '127.0.0.1', port: origin.port, servername: origin.hostname,
        method: 'OPTIONS', path: '/api/v1/auth/refresh', ca: cert, signal: AbortSignal.timeout(5000),
        headers: { Host: origin.host, Origin: requestOrigin, 'Access-Control-Request-Method': 'POST' } }, response => {
        response.resume();
        resolve(response.headers['access-control-allow-origin']);
      });
      request.on('error', reject);
      request.end();
    });
  }

  return { foreign, sibling, crossOriginRefreshes, preflight, browserArgs: ['--no-proxy-server',
    `--host-resolver-rules=${[origin, ...testOrigins].map(url => `MAP ${url.hostname} 127.0.0.1`).join(', ')}`,
    `--ignore-certificate-errors-spki-list=${pin}`],
  close: () => { server.close(); server.closeAllConnections(); } };
}

module.exports = { startSessionTlsProxy };
