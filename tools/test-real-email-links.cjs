const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Isolated Docker operation failed.');
  return result.stdout.trim();
}

async function main(reportArgument, playwrightDirectory, channel = 'msedge') {
  assert.ok(['msedge', 'chrome'].includes(channel));
  const root = path.resolve(__dirname, '..');
  const artifactRoot = await fs.realpath(path.join(__dirname, 'test-artifacts/integration'));
  const reportPath = await fs.realpath(reportArgument);
  assert.ok(reportPath.startsWith(artifactRoot + path.sep));
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.ok(stack.started && stack.keptStack && !stack.cleanupCompleted && stack.status === 'PASSED');
  assert.ok(stack.database === 'crypta_t30_test' && stack.provider === 'MOCK' && stack.smtpEnabled === false);
  assert.match(stack.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
  const ids = docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${stack.project}`]).split(/\s+/);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  assert.ok(containers.every(c => c.Config.Labels['com.docker.compose.project'] === stack.project && c.State.Running));
  const postgres = containers.find(c => c.Config.Labels['com.docker.compose.service'] === 'postgres');
  const backend = containers.find(c => c.Config.Labels['com.docker.compose.service'] === 'backend');
  const frontend = containers.find(c => c.Config.Labels['com.docker.compose.service'] === 'frontend');
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK') && backend.Config.Env.includes('SMTP_ENABLED=false'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(m => m.Name === `${stack.project}_test_postgres`));
  assert.deepEqual(frontend.NetworkSettings.Ports['80/tcp'], [{ HostIp: '127.0.0.1', HostPort: new URL(stack.origin).port }]);
  const sql = query => JSON.parse(docker([
    'exec', '-i', postgres.Id, 'psql', '-XqAt', '-U', 'crypta_t30_test', '-d', stack.database,
    '-v', 'ON_ERROR_STOP=1',
  ], query));
  const { notificationEmail, emailConfiguration } = require(path.join(root, 'backend/dist/notifications/email-template'));
  const rendererHash = createHash('sha256').update(await fs.readFile(path.join(root, 'backend/dist/notifications/email-template.js'))).digest('hex');
  assert.equal(docker(['exec', backend.Id, 'sha256sum', 'dist/notifications/email-template.js']).split(/\s+/)[0], rendererHash);
  const output = path.join(path.dirname(reportPath), 'email-links-' + channel + '-' + Date.now()); await fs.mkdir(output);
  const { chromium } = require(path.join(playwrightDirectory, 'playwright')), { expect } = require(path.join(playwrightDirectory, 'playwright/test'));
  const browser = await chromium.launch({ channel, headless: true }), results = [];
  async function call(method, endpoint, body, token) {
    const response = await fetch(stack.origin + '/api/v1' + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const envelope = await response.json(); assert.ok(response.ok, `HTTP ${response.status}; code ${envelope.error?.code}`); return envelope.data;
  }
  const login = email => call('POST', '/auth/login', { email, password: 'Password@123' });
  const owner = await login('dev.nguyen@congty.com'), approver = await login('it.manager@congty.com');
  const policies = await call('GET', '/policies', undefined, owner.accessToken);
  const policy = policies.find(policy => policy.configuration.algorithm === 'RSA' && policy.configuration.minimum_key_size === 2048); assert.ok(policy);
  const reason = 'Email link integration ' + crypto.randomUUID();
  // A real approved request is completed by the normal polling worker; the notification is not inserted by this harness.
  const request = await call('POST', '/requests', { type: 'CREATE', policyVersionId: policy.id, reason, emergency: false, parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 90 } }, owner.accessToken);
  await call('POST', `/requests/${request.id}/decision`, { decision: 'APPROVED', version: String(request.version), comment: 'Approve local email link check' }, approver.accessToken);
  let current;
  const deadline = Date.now() + 20000;
  do { current = await call('GET', `/requests/${request.id}`, undefined, owner.accessToken); if (current.status === 'COMPLETED') break; await new Promise(resolve => setTimeout(resolve, 250)); } while (Date.now() < deadline);
  assert.equal(current.status, 'COMPLETED');
  const mail = notificationEmail({ type: 'REQUEST_COMPLETED', recipientName: owner.user.displayName, requestId: request.id }, emailConfiguration({ APP_URL: stack.origin }));
  async function uiLogin(page, email) { await page.locator('.login-card input[type=email]').fill(email); await page.locator('.login-card input[type=password]').fill('Password@123'); await page.locator('.login-card button[type=submit],.login-card button.login-submit').click(); }
  try {
    const context = await browser.newContext(), page = await context.newPage();
    await page.setContent(mail.html); await page.getByRole('link', { name: 'Xem chi tiết trong Crypta', exact: true }).click();
    await page.locator('.login-card').waitFor(); await uiLogin(page, 'dev.nguyen@congty.com');
    await expect(page).toHaveURL(stack.origin + '/requests/' + request.id); await expect(page.locator('main')).toContainText(reason);
    results.push({ name: 'Rendered email link requires login and restores the exact owned completed request', passed: true });
    await page.goto(stack.origin + '/notifications');
    const article = page.locator('article').filter({ has: page.getByText('Yêu cầu đã hoàn tất', { exact: true }) }).filter({ hasText: reason });
    await expect(article).toHaveCount(1); await article.getByRole('button', { name: 'Xem chi tiết', exact: true }).click();
    await expect(page).toHaveURL(stack.origin + '/requests/' + request.id);
    results.push({ name: 'A worker-created completion appears with the correct label and detail action in the notification center', passed: true });
    const foreignContext = await browser.newContext(), foreign = await foreignContext.newPage();
    await foreign.goto(stack.origin + '/requests/' + request.id); await foreign.locator('.login-card').waitFor();
    const denied = foreign.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/requests/' + request.id && response.request().method() === 'GET');
    await uiLogin(foreign, 'kt.tran@congty.com'); assert.equal((await denied).status(), 404);
    await expect(foreign.locator('main')).not.toContainText(reason);
    results.push({ name: 'The same link grants no access to a different authenticated owner', passed: true });
    await context.close(); await foreignContext.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ success: true, project: stack.project, fixtureOnly: false, provider: 'MOCK', smtpEnabled: false,
      backendImage: backend.Image, rendererHash, results, browserVersion: browser.version(), screenshots: false, tracing: false }, null, 2));
    console.log(`PASS ${results.length} real email-link groups; report ${path.join(output, 'results.json')}`);
  } finally { await browser.close(); }
}
main(...process.argv.slice(2)).catch(error => { console.error(error.name + ': ' + String(error.message).slice(0, 700)); process.exitCode = 1; });
