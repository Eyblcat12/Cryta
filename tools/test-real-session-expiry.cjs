// Genuine server-clock JWT expiry against a generated short-TTL test stack.
// Credentials stay in memory; no HTTP interception, trace, HAR or storage-state file.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { startSessionTlsProxy } = require('./testing/session-tls-proxy.cjs');
const [reportArgument, playwrightDirectory, channel = 'msedge'] = process.argv.slice(2);
let browser, tlsProxy;
async function main() {
  assert.ok(reportArgument, 'Pass the generated isolated-stack report.json.');
  const reportPath = path.resolve(reportArgument), root = path.resolve(__dirname, '..');
  const artifactRoot = path.join(__dirname, 'test-artifacts', 'integration');
  assert.ok(reportPath.startsWith(artifactRoot + path.sep), 'Report must belong to the test artifact root.');
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.equal(stack.database, 'crypta_t30_test'); assert.equal(stack.provider, 'MOCK'); assert.equal(stack.smtpEnabled, false);
  assert.equal(stack.fixtureOnly, false); assert.equal(stack.started, true); assert.equal(stack.keptStack, true); assert.equal(stack.cleanupCompleted, false);
  assert.ok(Number.isInteger(stack.accessTtlSeconds) && stack.accessTtlSeconds >= 10 && stack.accessTtlSeconds <= 30, 'Report must declare a 10–30 second test access TTL.');
  const origin = new URL(stack.origin);
  assert.equal(origin.hostname, '127.0.0.1'); assert.equal(origin.protocol, 'http:'); assert.ok(origin.port && origin.port !== '8080');
  const browserOrigin = new URL(stack.sessionTlsOrigin ?? origin.href);
  const secure = Boolean(stack.sessionTlsOrigin);
  assert.ok(['msedge', 'chrome', 'chromium'].includes(channel));
  const compose = ['compose', '--project-name', stack.project, '--env-file', path.join(path.dirname(reportPath), 'test.env'), '--file', path.join(root, 'tools', 'testing', 'compose.t30.yml')];
  function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim(); }
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json']));
  assert.equal(config.name, stack.project); assert.equal(config.services.backend.environment.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(String(config.services.backend.environment.SMTP_ENABLED), 'false');
  assert.equal(config.services.backend.environment.JWT_ACCESS_TTL, `${stack.accessTtlSeconds}s`);
  assert.equal(config.volumes.test_postgres.name, `${stack.project}_test_postgres`); assert.equal(config.volumes.test_postgres.external, undefined);
  const ids = docker([...compose, 'ps', '-q']).split(/\s+/).filter(Boolean); assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  for (const container of containers) assert.equal(container.Config.Labels['com.docker.compose.project'], stack.project);
  assert.deepEqual(containers.map(container => container.Config.Labels['com.docker.compose.service']).sort(), ['backend', 'frontend', 'postgres']);
  const backend = containers.find(container => container.Config.Labels['com.docker.compose.service'] === 'backend');
  assert.ok(backend.Config.Env.includes(`JWT_ACCESS_TTL=${stack.accessTtlSeconds}s`), 'Running backend must use the declared test TTL.');
  if (secure) {
    assert.ok(backend.Config.Env.includes('COOKIE_SECURE=true') &&
      backend.Config.Env.includes(`CORS_ORIGIN=${browserOrigin.origin}`) &&
      backend.Config.Env.includes(`APP_URL=${browserOrigin.origin}`), 'Backend must use the isolated HTTPS cookie and origin settings.');
  }
  const frontend = containers.find(container => container.Config.Labels['com.docker.compose.service'] === 'frontend');
  const bindings = frontend.NetworkSettings.Ports['80/tcp'];
  assert.ok(bindings?.length === 1 && bindings[0].HostIp === '127.0.0.1' && bindings[0].HostPort === origin.port, 'Origin must be the validated isolated frontend binding.');
  const postgres = containers.find(container => container.Config.Labels['com.docker.compose.service'] === 'postgres');
  assert.ok(postgres.Mounts.some(mount => mount.Type === 'volume' && mount.Name === `${stack.project}_test_postgres`), 'Database volume must belong to this generated project.');
  function sql(query) { return docker([...compose, 'exec', '-T', 'postgres', 'psql', '-U', 'crypta_t30_test', '-d', stack.database, '-At', '-c', query]); }
  assert.equal(sql('SELECT current_database()'), stack.database);
  const html = await (await fetch(origin)).text();
  const buildAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map(match => match[1]); assert.equal(buildAssets.length, 2);
  const output = path.join(path.dirname(reportPath), `expiry-${channel}-${Date.now()}`); await fs.mkdir(output, { recursive: true });
  const results = [];
  async function call(method, endpoint, body, token) {
    const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(new URL(`/api/v1${endpoint}`, origin), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const envelope = await response.json(); return { status: response.status, data: envelope.data, code: envelope.error?.code };
  }
  function expectStatus(response, status, code) { assert.equal(response.status, status, `HTTP ${response.status}; expected ${status}; code ${response.code ?? '-'}`); if (code) assert.equal(response.code, code); return response.data; }
  function expiry(accessToken) {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    assert.ok(Number.isInteger(claims.iat) && Number.isInteger(claims.exp));
    assert.equal(claims.exp - claims.iat, stack.accessTtlSeconds, 'Real issued JWT must have the declared short lifetime.');
    return claims.exp * 1000;
  }
  async function waitForServerExpiry(accessToken) {
    const end = expiry(accessToken) + 1200;
    while (Date.now() < end) await new Promise(resolve => setTimeout(resolve, Math.min(250, end - Date.now())));
    expectStatus(await call('GET', '/auth/me', undefined, accessToken), 401, 'TOKEN_INVALID');
  }
  const temporaryPassword = 'Initial@Test12345', changedPassword = 'Changed@Test12345';
  const admin = expectStatus(await call('POST', '/auth/login', { email: 'admin@congty.com', password: 'Password@123' }), 200);
  const reference = expectStatus(await call('GET', '/users/reference-data', undefined, admin.accessToken), 200);
  const it = reference.departments.find(department => department.code === 'IT').id;
  const email = `expiry.${randomUUID()}@example.test`;
  const created = expectStatus(await call('POST', '/users', { email, displayName: 'Short TTL integration', departmentId: it, temporaryPassword, roles: ['USER'], approverDepartmentIds: [] }, admin.accessToken), 201);
  const activeRefreshRows = () => Number(sql(`SELECT COUNT(*) FROM auth_sessions
    WHERE user_id='${created.id}' AND revoked_at IS NULL AND expires_at>NOW()`));
  const firstLogin = expectStatus(await call('POST', '/auth/login', { email, password: temporaryPassword }), 200);
  expectStatus(await call('POST', '/auth/change-password', { currentPassword: temporaryPassword, newPassword: changedPassword }, firstLogin.accessToken), 200);
  const { chromium } = playwrightDirectory ? require(path.join(playwrightDirectory, 'playwright')) : require('playwright');
  if (secure) tlsProxy = await startSessionTlsProxy(browserOrigin, origin, output);
  browser = await chromium.launch({ channel, headless: true, args: tlsProxy?.browserArgs });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15000);
  const calls = [], responses = [], errors = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/v1/')) calls.push({ method: request.method(), path: url.pathname.slice(7) }); });
  page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/v1/')) responses.push({ method: response.request().method(), path: url.pathname.slice(7), status: response.status() }); });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(new URL('/assets', browserOrigin).href);
    await page.locator('.login-card input[type=email]').fill(email); await page.locator('.login-card input[type=password]').fill(changedPassword);
    const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login');
    await page.locator('.login-card button[type=submit], .login-card button.login-submit').click();
    const loginEnvelope = await (await loginResponse).json(); const session = loginEnvelope.data;
    assert.equal(session.expiresIn, `${stack.accessTtlSeconds}s`); expiry(session.accessToken);
    await page.getByRole('heading', { name: 'Tài sản của tôi', level: 1, exact: true }).waitFor(); await page.locator('.table-shell[aria-busy=false]').waitFor();
    const beforeCookie = (await context.cookies()).find(cookie => cookie.name === 'crypta_refresh'); assert.ok(beforeCookie && beforeCookie.httpOnly);
    if (secure) {
      assert.equal(beforeCookie.secure, true);
      assert.equal(beforeCookie.sameSite, 'Strict');
      assert.equal(beforeCookie.path, '/api/v1/auth');
      assert.equal(await tlsProxy.preflight(browserOrigin.origin), browserOrigin.origin);
      assert.equal(await tlsProxy.preflight(tlsProxy.foreign.origin), undefined);
      assert.equal(await tlsProxy.preflight(tlsProxy.sibling.origin), undefined);
      const sessionCount = () => sql(`SELECT COUNT(*) FROM auth_sessions WHERE user_id='${created.id}'`);
      const beforeSessionCount = sessionCount();
      const externalPage = await context.newPage();
      try {
        for (const origin of [tlsProxy.foreign, tlsProxy.sibling]) {
          await externalPage.goto(origin.href);
          const readable = await externalPage.evaluate(url => fetch(url, { method: 'POST', credentials: 'include' })
            .then(() => true, () => false), new URL('/api/v1/auth/refresh', browserOrigin).href);
          assert.equal(readable, false);
        }
        assert.deepEqual(tlsProxy.crossOriginRefreshes, [
          { origin: tlsProxy.foreign.origin, status: 401, sentRefreshCookie: false },
          { origin: tlsProxy.sibling.origin, status: 403, sentRefreshCookie: true },
        ]);
        assert.equal(sessionCount(), beforeSessionCount, 'Neither cross-origin refresh may create a session.');
        assert.equal(activeRefreshRows(), 1, 'Both cross-origin refreshes must leave the original session live.');
      } finally { await externalPage.close(); }
    }
    await waitForServerExpiry(session.accessToken);
    assert.equal(await page.getByRole('heading', { name: 'Tài sản của tôi', level: 1, exact: true }).count(), 1, 'The already-open workspace remains mounted until the next authenticated read.');
    calls.length = 0; responses.length = 0;
    const refreshResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/refresh');
    await page.locator('.nav-groups a[href="/notifications"]').click();
    const rotatedEnvelope = await (await refreshResponse).json(); const rotated = rotatedEnvelope.data;
    await page.getByRole('heading', { name: 'Thông báo', level: 1, exact: true }).waitFor(); await page.locator('.activity-list[aria-busy=false]').waitFor();
    assert.equal(calls.filter(call => call.method === 'POST' && call.path === '/auth/refresh').length, 1);
    assert.equal(responses.filter(response => response.path === '/auth/refresh' && response.status === 200).length, 1);
    assert.ok(responses.some(response => response.path === '/notifications' && response.status === 401));
    assert.ok(responses.some(response => response.path === '/notifications' && response.status === 200));
    const afterCookie = (await context.cookies()).find(cookie => cookie.name === 'crypta_refresh'); assert.ok(afterCookie && afterCookie.value !== beforeCookie.value, 'Expiry recovery must rotate the real HttpOnly cookie.');
    if (secure) assert.ok(afterCookie.secure && afterCookie.httpOnly && afterCookie.sameSite === 'Strict');
    results.push({ name: 'M short-TTL: already-open UI recovers once after real access-JWT expiry', passed: true, evidence: { serverRejectedExpiredAccess: 401, accessLifetimeSeconds: stack.accessTtlSeconds, refreshPosts: 1, successfulRefreshes: 1, protectedReadRetried: true, httpOnlyCookieRotated: true } });
    // Expire only the dedicated user's live refresh rows. Keep the table's
    // expires_at > created_at invariant; no HTTP response is fabricated.
    sql(`UPDATE auth_sessions SET created_at=NOW()-INTERVAL '2 days',expires_at=NOW()-INTERVAL '1 day' WHERE user_id='${created.id}' AND revoked_at IS NULL`);
    assert.equal(activeRefreshRows(), 0, 'The fixture must have no unexpired refresh session.');
    await waitForServerExpiry(rotated.accessToken);
    calls.length = 0; responses.length = 0;
    await page.locator('.nav-groups a[href="/assets"]').click(); await page.locator('.login-card').waitFor();
    assert.equal(await page.locator('#main-content, .nav-groups').count(), 0);
    assert.equal(calls.filter(call => call.method === 'POST' && call.path === '/auth/refresh').length, 1);
    assert.equal(responses.filter(response => response.path === '/auth/refresh' && response.status === 401).length, 1);
    assert.equal(activeRefreshRows(), 0, 'The rejected refresh must not create a new live session.');
    await page.waitForTimeout(600);
    assert.equal(calls.filter(call => call.method === 'POST' && call.path === '/auth/refresh').length, 1, 'Session expiry must not loop refresh POSTs.');
    const callsBeforeF5 = calls.length; await page.reload(); await page.locator('.login-card').waitFor();
    assert.equal(calls.slice(callsBeforeF5).filter(call => call.method === 'POST' && call.path === '/auth/refresh').length, 0, 'F5 must retain the ended client session.');
    assert.equal(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => /eyJ[A-Za-z0-9_-]+\./.test(value))), false);
    assert.equal(errors.length, 0);
    if (secure) {
      await page.locator('.login-card input[type=email]').fill(email);
      await page.locator('.login-card input[type=password]').fill(changedPassword);
      await page.locator('.login-card button[type=submit], .login-card button.login-submit').click();
      const logout = page.getByRole('button', { name: 'Đăng xuất', exact: true });
      const [response] = await Promise.all([
        page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/auth/logout'), logout.click(),
      ]);
      assert.equal(response.status(), 200);
      await page.locator('.login-card').waitFor();
      assert.equal((await context.cookies()).some(cookie => cookie.name === 'crypta_refresh'), false);
      assert.equal(activeRefreshRows(), 0, 'HTTPS logout must revoke the new session.');
    }
    results.push({ name: 'M short-TTL: expired refresh and access clear an already-open UI without a loop', passed: true, evidence: { serverRejectedExpiredAccess: 401, dedicatedRefreshRowsExpiredInDatabase: true, refreshPosts: 1, refreshRejected: 401, activeRefreshRows: 0, workspaceCleared: true, refreshPostsAfterF5: 0, credentialStorage: false } });
  } catch (error) {
    results.push({ name: results.length ? 'M short-TTL: expired refresh and access clear an already-open UI without a loop' : 'M short-TTL: already-open UI recovers once after real access-JWT expiry', passed: false, error: error instanceof assert.AssertionError ? error.message : `${error.name}: ${String(error.message).slice(0, 800)}` });
  } finally { await context.close(); }
  const summary = { createdUtc: new Date().toISOString(), project: stack.project, origin: browserOrigin.origin, database: stack.database, browser: channel, browserVersion: browser.version(), accessTtlSeconds: stack.accessTtlSeconds, buildAssets, runtimeImages: containers.map(container => ({ service: container.Config.Labels['com.docker.compose.service'], imageId: container.Image })), fixtureOnly: false, interceptedRequests: 0, browserClockChanged: false, recordedCredentialTraces: false, provider: 'MOCK', smtpEnabled: false, passed: results.filter(result => result.passed).length, total: results.length, plannedTotal: 2, results, limitations: ['Uses a 10–30 second TTL in the generated test backend; production retains its configured access-token TTL.', 'Session expiry is observed at the next authenticated read; no proactive idle-tab timer is claimed.', secure ? 'Uses a pinned test certificate on loopback; deployment ingress needs its own verification.' : 'Local HTTP does not validate production TLS/origin settings.'] };
  if (secure && summary.passed === summary.plannedTotal) {
    summary.https = { secureHttpOnlyStrictCookie: true, configuredCorsOriginOnly: true, crossSiteRefreshRejected: true, sameSiteForeignOriginRefreshRejected: true, logoutClearedCookieAndSession: true };
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(summary, null, 2), 'utf8');
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.passed ? '' : `\n${result.error}`}`);
  console.log(`${summary.passed}/${summary.total} real short-TTL groups passed; report ${path.join(output, 'results.json')}`);
  if (summary.passed !== summary.plannedTotal) process.exitCode = 1;
}
main().catch(error => { console.error(`Expiry setup failed: ${error.name}: ${String(error.message).slice(0, 800)}`); process.exitCode = 1; }).finally(async () => {
  try { if (browser) await browser.close(); } finally { tlsProxy?.close(); }
});
