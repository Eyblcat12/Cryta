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
  assert.ok(['msedge', 'chrome', 'chromium'].includes(channel));
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
  function effects(id) {
    assert.match(id, /^[a-f0-9-]{36}$/);
    return sql(`SELECT json_build_object(
      'rowCount', (SELECT count(*) FROM requests WHERE id='${id}'),
      'status', (SELECT status FROM requests WHERE id='${id}'),
      'version', (SELECT version FROM requests WHERE id='${id}'),
      'submittedAudit', (SELECT count(*) FROM audit_logs WHERE request_id='${id}' AND action='REQUEST_SUBMITTED'),
      'cancelAudit', (SELECT count(*) FROM audit_logs WHERE request_id='${id}' AND action='REQUEST_CANCELLED'),
      'notifications', (SELECT count(*) FROM notifications WHERE request_id='${id}'),
      'provider', (SELECT count(*) FROM provider_operations WHERE request_id='${id}'));`);
  }
  const output = path.join(path.dirname(reportPath), `draft-ui-${channel}-${Date.now()}`);
  await fs.mkdir(output);
  const { chromium } = require(path.join(playwrightDirectory, 'playwright'));
  const browser = await chromium.launch({ channel, headless: true });
  const report = { success: false, fixtureOnly: false, channel, browserVersion: browser.version(), project: stack.project,
    images: { backend: backend.Image, frontend: frontend.Image }, results: [] };
  const { expect } = require(path.join(playwrightDirectory, 'playwright/test'));
  const uuidFromUrl = url => new URL(url).pathname.split('/')[2];
  async function pageFor(width, theme) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(theme => localStorage.setItem('crypta-theme', theme), theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', () => errors.push('pageerror'));
    await page.goto(stack.origin + '/requests/new');
    await page.locator('.login-card input[type=email]').fill('dev.nguyen@congty.com');
    await page.locator('.login-card input[type=password]').fill('Password@123');
    await page.locator('.login-card button[type=submit],.login-card button.login-submit').click();
    await page.getByRole('dialog').waitFor();
    return { context, page, errors };
  }
  async function checkActions(page, label) {
    for (const name of ['Hủy', 'Lưu bản nháp', 'Gửi yêu cầu']) {
      const button = page.getByRole('button', { name, exact: true });
      await button.focus();
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, label + ' action clipped');
    }
    assert.ok(await page.locator('[role="dialog"]').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  }
  async function scenario(name, width, theme, run) {
    const state = await pageFor(width, theme);
    try {
      await run(state.page);
      assert.equal(state.errors.length, 0);
      report.results.push({ name, width, theme, passed: true });
    } catch (error) {
      await state.page.screenshot({ path: path.join(output, `failed-${report.results.length}.png`), fullPage: true });
      report.results.push({ name, width, theme, passed: false, error: String(error.message).slice(0, 700) });
    } finally { await state.context.close(); }
  }
  try {
    const html = await (await fetch(stack.origin)).text();
    const js = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    assert.match(js ?? '', /^\/assets\/[a-zA-Z0-9_-]+\.js$/);
    assert.ok(stack.buildAssets.includes(js), 'JavaScript must match the isolated stack smoke report.');
    const served = Buffer.from(await (await fetch(stack.origin + js)).arrayBuffer());
    report.jsAsset = js;
    report.jsSha256 = createHash('sha256').update(served).digest('hex');
    const imageHash = docker(['exec', frontend.Id, 'sha256sum', '/usr/share/nginx/html' + js]).split(/\s+/)[0];
    assert.equal(report.jsSha256, imageHash, 'Served JavaScript must match the running frontend image.');
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
      await scenario('save incomplete, reopen, edit, submit, cancel', width, theme, async page => {
        const shortReason = 'Nháp';
        const finalReason = `Yêu cầu nháp ${channel} ${width} cho kiểm thử`;
        await page.getByLabel('Lý do nghiệp vụ').fill(shortReason);
        await checkActions(page, 'draft');
        await page.screenshot({ path: path.join(output, `form-${width}-${theme}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
        const id = uuidFromUrl(page.url());
        await page.getByRole('heading', { name: shortReason, exact: true }).waitFor();
        assert.deepEqual(effects(id), { rowCount: 1, status: 'DRAFT', version: 1, submittedAudit: 0, cancelAudit: 0, notifications: 0, provider: 0 });
        await page.reload();
        await page.getByRole('button', { name: 'Sửa bản nháp', exact: true }).click();
        await page.getByRole('dialog').waitFor();
        await expect(page.getByLabel('Lý do nghiệp vụ')).toHaveValue(shortReason);
        await page.getByLabel('Lý do nghiệp vụ').fill(finalReason);
        await expect(page.getByRole('button', { name: 'Gửi yêu cầu', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/requests/' + id);
        await page.getByText('Chờ duyệt', { exact: true }).waitFor();
        const pending = effects(id);
        assert.equal(pending.status, 'PENDING');
        assert.equal(pending.version, 3);
        assert.equal(pending.submittedAudit, 1);
        assert.ok(pending.notifications > 0);
        assert.equal(pending.provider, 0);
        await page.getByRole('button', { name: 'Hủy yêu cầu', exact: true }).click();
        const cancel = page.getByRole('dialog', { name: 'Hủy yêu cầu này?' });
        await cancel.waitFor();
        await expect(cancel.getByRole('button', { name: 'Đóng', exact: true })).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(cancel.getByRole('button', { name: 'Xác nhận hủy', exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(cancel.getByRole('button', { name: 'Đóng', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(cancel).not.toBeVisible();
        await page.getByRole('button', { name: 'Hủy yêu cầu', exact: true }).click();
        await page.getByRole('textbox', { name: /Lý do hủy/ }).fill('Dừng yêu cầu kiểm thử');
        await page.screenshot({ path: path.join(output, `cancel-${width}-${theme}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Xác nhận hủy', exact: true }).click();
        await page.getByText('Đã hủy yêu cầu', { exact: true }).waitFor();
        await page.reload();
        await page.getByText('Dừng yêu cầu kiểm thử', { exact: true }).waitFor();
        const cancelled = effects(id);
        assert.equal(cancelled.status, 'CANCELLED');
        assert.equal(cancelled.cancelAudit, 1);
        assert.equal(cancelled.submittedAudit, 1);
      });
      await scenario('committed draft with lost response is inspected and saved once', width, theme, async page => {
        const reason = `Lưu có mất phản hồi ${channel} ${width}`;
        await page.getByLabel('Lý do nghiệp vụ').fill(reason);
        let putId;
        let committed = false;
        await page.route('**/api/v1/requests/drafts/*', async route => {
          if (committed || route.request().method() !== 'PUT') return route.continue();
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          putId = uuidFromUrl(route.request().url().replace('/api/v1/requests/drafts/', '/requests/'));
          committed = true;
          await route.abort('failed');
        });
        await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await page.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).waitFor();
        assert.ok(committed && putId);
        await expect(page.getByLabel('Lý do nghiệp vụ')).toHaveValue(reason);
        await expect(page.getByRole('button', { name: 'Lưu bản nháp', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).click();
        await page.getByLabel('Tôi đã đối chiếu dữ liệu', { exact: false }).check();
        await page.getByRole('button', { name: 'Kết thúc đối chiếu', exact: true }).click();
        await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/requests/' + putId);
        assert.deepEqual(effects(putId), { rowCount: 1, status: 'DRAFT', version: 1, submittedAudit: 0, cancelAudit: 0, notifications: 0, provider: 0 });
      });
      await scenario('stale editor preserves input, warns before leaving and never overwrites another tab', width, theme, async page => {
        await page.getByLabel('Lý do nghiệp vụ').fill('Nháp chỉnh sửa từ hai tab');
        await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
        const id = uuidFromUrl(page.url());
        await page.getByRole('button', { name: 'Sửa bản nháp', exact: true }).click();
        await page.getByRole('dialog').waitFor();
        const other = await page.context().newPage();
        try {
          await other.goto(stack.origin + '/requests/new?draftId=' + id);
          await other.getByRole('dialog').waitFor();
          await other.getByLabel('Lý do nghiệp vụ').fill('Nội dung đã lưu từ tab thứ hai');
          await other.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
          await other.waitForURL(url => url.pathname === '/requests/' + id);
          await page.getByLabel('Lý do nghiệp vụ').fill('Giữ nội dung chưa lưu ở tab đầu');
          await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
          await page.getByRole('alert').filter({ hasText: 'Yêu cầu đã thay đổi' }).waitFor();
          await expect(page.getByLabel('Lý do nghiệp vụ')).toHaveValue('Giữ nội dung chưa lưu ở tab đầu');
          assert.equal(effects(id).version, 2);
          const reason = sql(`SELECT to_json(reason) FROM requests WHERE id='${id}';`);
          assert.equal(reason, 'Nội dung đã lưu từ tab thứ hai');
          await page.getByRole('button', { name: 'Đóng', exact: true }).click();
          const warning = page.getByRole('alertdialog', { name: 'Bỏ các thay đổi đang nhập?' });
          await warning.waitFor();
          await warning.getByRole('button', { name: 'Ở lại', exact: true }).click();
          await expect(page.getByLabel('Lý do nghiệp vụ')).toHaveValue('Giữ nội dung chưa lưu ở tab đầu');
          await page.getByRole('button', { name: 'Đóng', exact: true }).click();
          await warning.getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
          await page.waitForURL(url => url.pathname === '/requests/' + id);
          await page.getByRole('heading', { name: 'Nội dung đã lưu từ tab thứ hai', exact: true }).waitFor();
        } finally { await other.close(); }
      });
      await scenario('committed direct submission with lost response is inspected through the owner list without replay', width, theme, async page => {
        await expect(page.getByLabel('Chính sách', { exact: true })).toBeEnabled();
        const reason = `Gửi trực tiếp mất phản hồi ${channel} ${width}`;
        await page.getByLabel('Lý do nghiệp vụ').fill(reason);
        let id;
        let attempts = 0;
        await page.route('**/api/v1/requests', async route => {
          if (route.request().method() !== 'POST') return route.continue();
          attempts++;
          const response = await route.fetch();
          assert.equal(response.status(), 201);
          id = (await response.json()).data.id;
          assert.match(id, /^[a-f0-9-]{36}$/);
          await route.abort('failed');
        });
        await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
        await page.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).waitFor();
        await expect(page.getByRole('button', { name: 'Gửi yêu cầu', exact: true })).toBeDisabled();
        await expect(page.getByLabel('Lý do nghiệp vụ')).toHaveValue(reason);
        const submitted = effects(id);
        assert.equal(submitted.status, 'PENDING');
        assert.equal(submitted.submittedAudit, 1);
        assert.ok(submitted.notifications > 0);
        assert.equal(submitted.provider, 0);
        const inspected = page.waitForResponse(response => response.request().method() === 'GET'
          && new URL(response.url()).pathname === '/api/v1/requests'
          && new URL(response.url()).searchParams.get('createdByMe') === 'true');
        await page.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).click();
        const inspection = await inspected;
        assert.equal(inspection.status(), 200);
        assert.ok((await inspection.json()).data.items.some(request => request.id === id));
        await page.getByLabel('Tôi đã đối chiếu dữ liệu', { exact: false }).check();
        await page.getByRole('button', { name: 'Kết thúc đối chiếu', exact: true }).click();
        await page.getByRole('button', { name: 'Đóng', exact: true }).click();
        await page.getByRole('alertdialog', { name: 'Bỏ các thay đổi đang nhập?', exact: true })
          .getByRole('button', { name: 'Bỏ thay đổi', exact: true }).click();
        await page.goto(stack.origin + '/requests/' + id);
        await page.getByText('Chờ duyệt', { exact: true }).waitFor();
        assert.equal(attempts, 1);
        assert.deepEqual(effects(id), submitted);
      });
      await scenario('committed draft submission with lost response is inspected without replay', width, theme, async page => {
        await expect(page.getByLabel('Chính sách', { exact: true })).toBeEnabled();
        await page.getByLabel('Lý do nghiệp vụ').fill(`Gửi nháp mất phản hồi ${channel} ${width}`);
        await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
        const id = uuidFromUrl(page.url());
        await page.getByRole('button', { name: 'Sửa bản nháp', exact: true }).click();
        let attempts = 0;
        await page.route(`**/api/v1/requests/${id}/submit`, async route => {
          attempts++;
          const response = await route.fetch();
          assert.equal(response.status(), 201);
          await route.abort('failed');
        });
        await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
        await page.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).waitFor();
        await expect(page.getByRole('button', { name: 'Gửi yêu cầu', exact: true })).toBeDisabled();
        const submitted = effects(id);
        assert.equal(submitted.status, 'PENDING');
        assert.equal(submitted.version, 2);
        assert.equal(submitted.submittedAudit, 1);
        assert.ok(submitted.notifications > 0);
        assert.equal(submitted.provider, 0);
        const inspected = page.waitForResponse(response => response.request().method() === 'GET'
          && new URL(response.url()).pathname === `/api/v1/requests/${id}`);
        await page.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).click();
        assert.equal((await inspected).status(), 200);
        await page.getByLabel('Tôi đã đối chiếu dữ liệu', { exact: false }).check();
        await page.getByRole('button', { name: 'Kết thúc đối chiếu', exact: true }).click();
        await page.getByRole('button', { name: 'Đóng', exact: true }).click();
        await page.goto(stack.origin + '/requests/' + id);
        await page.getByText('Chờ duyệt', { exact: true }).waitFor();
        assert.equal(attempts, 1);
        assert.deepEqual(effects(id), submitted);
      });
      await scenario('committed cancellation with lost response is inspected without replay', width, theme, async page => {
        await expect(page.getByLabel('Chính sách', { exact: true })).toBeEnabled();
        await page.getByLabel('Lý do nghiệp vụ').fill(`Hủy yêu cầu mất phản hồi ${channel} ${width}`);
        await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
        const id = uuidFromUrl(page.url());
        await page.getByRole('button', { name: 'Sửa bản nháp', exact: true }).click();
        await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/requests/' + id);
        await page.getByText('Chờ duyệt', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Hủy yêu cầu', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Hủy yêu cầu này?', exact: true });
        await dialog.getByRole('textbox', { name: /Lý do hủy/ }).fill('Dừng yêu cầu đã gửi để kiểm thử mất phản hồi');
        let attempts = 0;
        await page.route(`**/api/v1/requests/${id}/cancel`, async route => {
          attempts++;
          const response = await route.fetch();
          assert.equal(response.status(), 201);
          await route.abort('failed');
        });
        await dialog.getByRole('button', { name: 'Xác nhận hủy', exact: true }).click();
        await dialog.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).waitFor();
        await expect(dialog.getByRole('button', { name: 'Xác nhận hủy', exact: true })).toBeDisabled();
        const cancelled = effects(id);
        assert.equal(cancelled.status, 'CANCELLED');
        assert.equal(cancelled.version, 3);
        assert.equal(cancelled.submittedAudit, 1);
        assert.equal(cancelled.cancelAudit, 1);
        assert.equal(cancelled.provider, 0);
        const inspected = page.waitForResponse(response => response.request().method() === 'GET'
          && new URL(response.url()).pathname === `/api/v1/requests/${id}`);
        await dialog.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).click();
        assert.equal((await inspected).status(), 200);
        await dialog.getByLabel('Tôi đã đối chiếu dữ liệu', { exact: false }).check();
        await dialog.getByRole('button', { name: 'Kết thúc đối chiếu', exact: true }).click();
        await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
        await page.reload();
        await page.getByText('Đã hủy yêu cầu', { exact: true }).waitFor();
        assert.equal(attempts, 1);
        assert.deepEqual(effects(id), cancelled);
      });
      for (const [type, label] of [['RENEW', 'Gia hạn'], ['REVOKE', 'Thu hồi']]) {
        await scenario(type + ' draft can be saved before selection and submitted after reopening', width, theme, async page => {
          const target = sql(`SELECT to_json(a.id) FROM crypto_assets a JOIN users u ON u.id=a.owner_id
            WHERE u.email='dev.nguyen@congty.com' AND a.status IN ('ACTIVE','EXPIRING_SOON')
              AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.target_asset_id=a.id
                AND r.status IN ('PENDING','APPROVED','PROCESSING','RECONCILIATION_REQUIRED'))
            ORDER BY a.id LIMIT 1;`);
          assert.match(target, /^[a-f0-9-]{36}$/);
          await page.locator('.request-types label').filter({ has: page.locator(`input[value="${type}"]`) }).click();
          await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
          await page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
          const id = uuidFromUrl(page.url());
          assert.equal(effects(id).status, 'DRAFT');
          await page.getByRole('button', { name: 'Sửa bản nháp', exact: true }).click();
          const selector = page.locator('#request-asset');
          await expect(selector).toBeEnabled();
          await selector.selectOption(target);
          await page.getByLabel('Lý do nghiệp vụ').fill(label + ' từ bản nháp đã lưu để kiểm thử');
          await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
          await page.waitForURL(url => url.pathname === '/requests/' + id);
          await page.reload();
          await page.getByRole('button', { name: 'Sửa bản nháp', exact: true }).click();
          await expect(page.locator('#request-asset')).toHaveValue(target);
          const send = page.getByRole('button', { name: type === 'REVOKE' ? 'Tiếp tục thu hồi' : 'Gửi yêu cầu', exact: true });
          await expect(send).toBeEnabled();
          await send.click();
          if (type === 'REVOKE') {
            await page.getByRole('button', { name: 'Xác nhận thu hồi', exact: true }).click();
          }
          await page.waitForURL(url => url.pathname === '/requests/' + id);
          await page.getByText('Chờ duyệt', { exact: true }).waitFor();
          assert.equal(effects(id).submittedAudit, 1);
          assert.equal(effects(id).provider, 0);
          await page.getByRole('button', { name: 'Hủy yêu cầu', exact: true }).click();
          await page.getByRole('button', { name: 'Xác nhận hủy', exact: true }).click();
          await page.getByText('Đã hủy yêu cầu', { exact: true }).waitFor();
          assert.equal(effects(id).cancelAudit, 1);
        });
      }
      await scenario('existing draft priority and provisioning parameters survive a reason edit', width, theme, async page => {
        await page.getByLabel('Lý do nghiệp vụ').fill('Nháp có thuộc tính từ client trước');
        await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
        const id = uuidFromUrl(page.url());
        // Populate supported API data that the basic form does not expose as editable controls.
        sql(`UPDATE requests SET emergency=TRUE,
          requested_parameters=jsonb_build_object('assetType','KEY','usage','PRESERVED_USAGE','validityDays',60)
          WHERE id='${id}' AND status='DRAFT';
          SELECT to_json(true);`);
        await page.reload();
        await page.getByRole('button', { name: 'Sửa bản nháp', exact: true }).click();
        await page.getByLabel('Lý do nghiệp vụ').fill('Chỉ sửa lý do của bản nháp đã có');
        await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/requests/' + id);
        const preserved = sql(`SELECT json_build_object('emergency',emergency,'parameters',requested_parameters)
          FROM requests WHERE id='${id}';`);
        assert.deepEqual(preserved, {
          emergency: true, parameters: { assetType: 'KEY', usage: 'PRESERVED_USAGE', validityDays: 60 },
        });
        assert.equal(effects(id).version, 2);
      });
    }
    report.passed = report.results.filter(result => result.passed).length;
    report.total = report.results.length;
    report.success = report.total === 18 && report.passed === report.total;
  } finally {
    await browser.close();
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  }
  process.stdout.write(`${report.success ? 'PASS' : 'FAIL'} draft UI ${channel}: ${output}\n`);
  if (!report.success) process.exitCode = 1;
}

main(...process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
