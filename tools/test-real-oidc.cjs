const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHmac } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const [reportArg, modules] = process.argv.slice(2);
const userId = '04444444-2222-2222-2222-222222222222';
const reviewer = 'it.manager@congty.com';
const it = 'd1111111-1111-1111-1111-111111111111';
const auth = '/api/v1/auth';
const reportPath = path.resolve(reportArg);
const results = [];

function otp(key, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const n = [...key].reduce((value, character) => value * 32n + BigInt(alphabet.indexOf(character)), 0n);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const hmac = createHmac('sha1', Buffer.from(n.toString(16).padStart(40, '0'), 'hex')).update(counter).digest();
  return String((hmac.readUInt32BE(hmac[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function check(name, operation) {
  try {
    const evidence = await operation();
    results.push({ name, passed: true, evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    // Only report a controlled assertion label or error type. Browser logs can include entered values.
    const line = String(error.stack).match(/test-real-oidc\.cjs:(\d+):\d+/)?.[1];
    const detail = `${error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name} (runner line ${line ?? '?'})`;
    results.push({ name, passed: false, error: detail });
    console.error(`FAIL ${name}: ${detail}`);
    throw new Error('Real OIDC verification failed.');
  }
}

async function main() {
  const artifactRoot = path.join(__dirname, 'test-artifacts');
  assert.ok(reportPath.startsWith(path.join(artifactRoot, 'integration') + path.sep));
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.ok(stack.started && stack.keptStack && stack.mfaRequired && !stack.cleanupCompleted);
  assert.equal(stack.database, 'crypta_t30_test');
  assert.equal(stack.provider, 'MOCK');
  assert.equal(stack.smtpEnabled, false);
  const origin = new URL(stack.origin), app = new URL(stack.browserOrigin), issuer = new URL(stack.oidcIssuer);
  const cookieScope = new URL(auth + '/refresh', app).href;
  assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(app.origin, `http://app.crypta.test:${origin.port}`);
  assert.equal(issuer.href, `http://oidc.crypta.test:${issuer.port}/realms/crypta-oidc-test`);
  assert.ok(origin.port && issuer.port && origin.port !== '8080' && issuer.port !== '8080' && origin.port !== issuer.port);
  const credentials = JSON.parse(await fs.readFile(path.join(artifactRoot, 'keycloak-test-' + stack.project.slice(-12), 'test-credentials.json'), 'utf8'));
  assert.match(credentials.linked.subject, /^[0-9a-f-]{36}$/);
  const compose = ['compose', '--project-name', stack.project, '--env-file', path.join(path.dirname(reportPath), 'test.env'),
    '--file', path.join(__dirname, 'testing', 'compose.t30.yml'), '--file', path.join(__dirname, 'testing', 'compose.oidc-test.yml')];
  const docker = (args, input) => execFileSync('docker', [...compose, ...args], { input, encoding: 'utf8', timeout: 30_000,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] }).trim();
  const sqlArgs = ['exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', stack.database, '-d', stack.database, '-qAt'];
  const sql = query => docker([...sqlArgs, '-c', query]);
  const linkSql = await fs.readFile(path.join(__dirname, '../deploy/oidc-account-link.sql'), 'utf8');
  const link = action => docker([...sqlArgs, '-v', `oidc_action=${action}`, '-v', `oidc_user_id=${userId}`,
    '-v', `oidc_issuer=${issuer.href}`, '-v', `oidc_subject=${credentials.linked.subject}`,
    '-v', 'oidc_reason=isolated OIDC verification'], linkSql);
  async function call(route, options = {}) {
    return fetch(new URL(route, origin), { redirect: 'manual', signal: AbortSignal.timeout(18_000), ...options });
  }
  function post(body, headers = {}) {
    return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
  }
  async function data(response, expected = 200, label = 'API status') {
    const result = await response.json().catch(() => ({}));
    assert.equal(response.status, expected, `${label}: expected ${expected}, received ${response.status} (${result.error?.code ?? 'no code'})`);
    return result.data;
  }
  async function setKeycloakUserEnabled(enabled) {
    const transport = `http://127.0.0.1:${issuer.port}`;
    const adminToken = await fetch(transport + '/realms/master/protocol/openid-connect/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: 'crypta-oidc-test-operator', client_secret: credentials.adminSecret,
      }),
    });
    assert.equal(adminToken.status, 200, 'Temporary Keycloak operator grant');
    const { access_token } = await adminToken.json();
    const changed = await fetch(`${transport}/admin/realms/crypta-oidc-test/users/${credentials.linked.subject}`, {
      method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` }, body: JSON.stringify({ enabled }),
    });
    assert.equal(changed.status, 204, 'Temporary operator updates the fixture identity');
  }
  const { chromium } = require(path.join(path.resolve(modules), 'playwright'));
  const browser = await chromium.launch({ args: ['--no-proxy-server', '--host-resolver-rules=MAP *.crypta.test 127.0.0.1'] });
  async function beginBrowserLogin(identity) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(new URL('/login', app).href);
      await page.getByRole('button', { name: 'Đăng nhập bằng SSO' }).click({ timeout: 25_000 });
      await page.waitForURL(url => url.hostname === issuer.hostname, { timeout: 20_000 });
      await page.locator('#username').fill(identity.username);
      await page.locator('#password').fill(identity.password);
      const callbackPromise = page.waitForResponse(response => new URL(response.url()).pathname === auth + '/oidc/callback');
      const finishPromise = page.waitForResponse(response => new URL(response.url()).pathname === auth + '/oidc/finish');
      await page.locator('#kc-login').click();
      const callback = await callbackPromise;
      assert.equal(callback.request().method(), 'POST', 'Keycloak must submit the authorization response as a form');
      assert.equal(callback.status(), 303, 'Callback must redirect without credentials in the URL');
      assert.equal(callback.headers().location, '/login?oidc=complete', 'Callback must hand off a validated authorization response');
      const finish = await finishPromise;
      return { context, page, callback, finish };
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }
  let session, refreshCookie, linkedBrowser, manualKey;
  try {
    await check('Keycloak discovery, protected origin and browser-bound callback', async () => {
      for (let n = 0; n < 30; n++) {
        try {
          const response = await call(auth + '/oidc/start', post({}, { Origin: app.origin }));
          if (response.ok) break;
          if (n === 29) await data(response, 200, 'Keycloak start readiness');
        } catch (error) { if (n === 29) throw error; }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      await data(await call(auth + '/oidc/start', post({}, { Origin: 'https://untrusted.example.test' })), 403, 'Foreign origin');
      const start = await call(auth + '/oidc/start', post({}, { Origin: app.origin }));
      const redirect = new URL((await data(start)).redirect);
      assert.equal(redirect.origin, issuer.origin);
      assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
      const callback = await call(auth + '/oidc/callback', { method: 'POST', body: new URLSearchParams({
        state: redirect.searchParams.get('state'), code: 'invalid',
      }) });
      assert.equal(callback.headers.get('location'), '/login?oidc=denied');
      await data(await call(auth + '/oidc/finish', post({}, { Origin: app.origin })), 401, 'Missing browser handoff');
      return { pkce: true, foreignOrigin: 403, unboundCallback: 'denied' };
    });

    await check('Exact identity linkage denies local password and a colliding Keycloak email', async () => {
      link('link');
      assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE action='OIDC_ACCOUNT_LINKED' AND entity_id='${userId}'`), '1');
      await data(await call(auth + '/login', post({ email: reviewer, password: 'Password@123' })), 401, 'Linked user password');
      const { context, page, finish } = await beginBrowserLogin(credentials.colliding);
      try {
        assert.equal(finish.status(), 401, 'Email collision must not sign in');
        await page.getByRole('alert').getByText(/chưa được cấp quyền/i).waitFor();
        assert.ok(!(await context.cookies(cookieScope)).some(cookie => cookie.name === 'crypta_refresh'));
      } finally { await context.close(); }
      return { localPassword: 401, collidingEmail: 401, linkAudited: true };
    });

    await check('Linked Approver uses MFA and retains only Crypta roles and scope', async () => {
      linkedBrowser = await beginBrowserLogin(credentials.linked);
      const { context, page, finish } = linkedBrowser;
      const handoff = await finish.json();
      assert.equal(finish.status(), 200, `Linked subject starts MFA: HTTP ${finish.status()} (${handoff.error?.code ?? 'no code'})`);
      const challenge = handoff.data;
      assert.equal(challenge.mfa, 'ENROLL');
      assert.equal(challenge.accessToken, undefined);
      assert.ok(!(await context.cookies(cookieScope)).some(cookie => cookie.name === 'crypta_refresh'));
      await data(await call(auth + '/oidc/finish', post({}, { Origin: app.origin })), 401, 'Handoff cannot be reused');
      manualKey = challenge.enrollment.manualKey;
      await page.getByLabel('Mã xác thực 6 số').fill(otp(manualKey, -1));
      await page.getByRole('button', { name: 'Xác minh và tiếp tục' }).click();
      await page.getByRole('checkbox', { name: /Tôi đã lưu các mã/ }).check();
      const completed = page.waitForResponse(response => new URL(response.url()).pathname === auth + '/mfa/enrollment/finish');
      await page.getByRole('button', { name: /Hoàn tất/ }).click();
      const response = await completed;
      assert.equal(response.status(), 200, 'MFA completion issues a Crypta session');
      session = (await response.json()).data;
      assert.equal(session.user.id, userId);
      assert.equal(session.user.signInMethod, 'SSO');
      assert.deepEqual(session.user.roles, ['APPROVER']);
      assert.deepEqual(session.user.approverDepartmentIds, [it]);
      const cookie = (await context.cookies(cookieScope)).find(value => value.name === 'crypta_refresh');
      assert.ok(cookie, 'SSO issues a Crypta refresh cookie after MFA');
      assert.equal(cookie.httpOnly, true);
      refreshCookie = `${cookie.name}=${cookie.value}`;
      const headers = { Authorization: `Bearer ${session.accessToken}` };
      const me = await data(await call(auth + '/me', { headers }));
      assert.deepEqual(me.approverDepartmentIds, [it]);
      const requests = await data(await call('/api/v1/requests', { headers }));
      assert.ok(requests.length > 0 && requests.every(request => request.departmentId === it), 'Approver list stays within the assigned department');
      return { factor: 'TOTP', role: 'APPROVER', scopedRequests: requests.length, httpOnlyRefresh: true };
    });

    await check('SSO refresh renews the provider proof and Keycloak logout retires it', async () => {
      assert.match(sql(`UPDATE auth_oidc_sessions SET access_expires_at=clock_timestamp()+interval '5 seconds'
        WHERE user_id='${userId}' RETURNING id`), /^[0-9a-f-]{36}$/, 'Set the linked session near provider expiry');
      const renewed = await call(auth + '/refresh', post({}, { Cookie: refreshCookie }));
      session = await data(renewed, 200, 'Provider and local refresh');
      refreshCookie = renewed.headers.get('set-cookie').split(';')[0];
      assert.equal(sql(`SELECT (access_expires_at>clock_timestamp()+interval '30 seconds')::text FROM auth_oidc_sessions
        WHERE user_id='${userId}'`), 'true', 'Provider expiry advances after refresh');
      const headers = { Authorization: `Bearer ${session.accessToken}`, Cookie: refreshCookie };
      await data(await call(auth + '/oidc/backchannel', { method: 'POST', body: new URLSearchParams({ logout_token: 'invalid' }) }), 401, 'Forged logout');
      const logout = await data(await call(auth + '/logout', post({}, headers)), 200, 'Crypta logout');
      await data(await call(auth + '/me', { headers }), 401, 'Local logout revokes the access token');
      assert.equal(new URL(logout.redirect).origin, issuer.origin);
      await linkedBrowser.page.goto(logout.redirect);
      if (new URL(linkedBrowser.page.url()).hostname === issuer.hostname) await linkedBrowser.page.locator('#kc-logout').click();
      await linkedBrowser.page.waitForURL(url => url.origin === app.origin);
      assert.equal(sql(`SELECT count(*) FROM auth_oidc_revocations WHERE issuer='${issuer.href}'`), '1', 'A signed Keycloak logout reaches the backchannel');
      return { renewed: true, forgedLogout: 401, accessAfterLogout: 401, providerBackchannel: true };
    });

    await check('Disabling the upstream identity invalidates a live Crypta session', async () => {
      const { context, finish } = await beginBrowserLogin(credentials.linked);
      try {
        const body = (await finish.json()).data;
        assert.equal(body.mfa, 'VERIFY');
        const verified = await call(auth + '/mfa/verify', post({ challenge: body.challenge, totpCode: otp(manualKey) }));
        const current = await data(verified, 200, 'MFA for the revocation session');
        const cookie = verified.headers.get('set-cookie').split(';')[0];
        await data(await call(auth + '/me', { headers: { Authorization: `Bearer ${current.accessToken}` } }), 200, 'Session before disable');
        await setKeycloakUserEnabled(false);
        const started = Date.now();
        await data(await call(auth + '/refresh', post({}, { Cookie: cookie })), 401, 'Disabled upstream identity refresh');
        await data(await call(auth + '/me', { headers: { Authorization: `Bearer ${current.accessToken}` } }), 401, 'Disabled upstream identity access');
        return { accessAfterDisable: 401, refreshAfterDisable: 401, verifiedWithinMs: Date.now() - started };
      } finally {
        await setKeycloakUserEnabled(true);
        await context.close();
      }
    });

    await check('SSO revocation blocks pending MFA and leaves the local admin emergency path', async () => {
      const { context, finish } = await beginBrowserLogin(credentials.linked);
      try {
        const body = (await finish.json()).data;
        assert.equal(body.mfa, 'VERIFY');
        link('revoke');
        await data(await call(auth + '/mfa/verify', post({ challenge: body.challenge, totpCode: '000000' })), 401, 'Revoked pending MFA');
        await data(await call(auth + '/login', post({ email: reviewer, password: 'Password@123' })), 401, 'Revoked link must not reactivate password');
      } finally { await context.close(); }
      docker(['stop', 'keycloak']);
      const contextAdmin = await browser.newContext();
      try {
        const page = await contextAdmin.newPage();
        await page.goto(new URL('/login', app).href);
        await page.getByRole('button', { name: 'Đăng nhập bằng SSO' }).click();
        await page.getByRole('alert').getByText(/SSO tạm thời không khả dụng/).waitFor({ timeout: 20_000 });
        await page.getByRole('button', { name: 'Dùng tài khoản cục bộ' }).click();
        await page.getByLabel('Email', { exact: true }).fill('admin@congty.com');
        await page.getByLabel('Mật khẩu', { exact: true }).fill('Password@123');
        const mfa = page.waitForResponse(response => new URL(response.url()).pathname === auth + '/login');
        await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
        const enrollment = (await (await mfa).json()).data;
        assert.equal(enrollment.mfa, 'ENROLL');
        const verified = await call(auth + '/mfa/enrollment/verify', post({
          challenge: enrollment.challenge, totpCode: otp(enrollment.enrollment.manualKey),
        }));
        await data(verified, 200, 'Emergency Admin TOTP during outage');
        const completed = await call(auth + '/mfa/enrollment/finish', post({ challenge: enrollment.challenge, savedRecoveryCodes: true }));
        const emergency = await data(completed, 200, 'Emergency Admin signs in during outage');
        assert.deepEqual(emergency.user.roles, ['ADMIN']);
        assert.equal(emergency.user.signInMethod, undefined);
      } finally { await contextAdmin.close(); }
      return { revokedPendingMfa: 401, retiredPassword: 401, outageEmergencyAdminMfa: true };
    });
  } finally {
    await browser.close();
  }
}

main().catch(() => { process.exitCode = 1; }).finally(async () => {
  const output = path.join(path.dirname(reportPath), 'oidc');
  if (!reportPath.startsWith(path.join(__dirname, 'test-artifacts', 'integration') + path.sep)) return;
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results }, null, 2));
});
