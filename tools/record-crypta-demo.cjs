// Record the real SPA against a disposable stack with the demo seed.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const [reportArgument, playwrightDirectory] = process.argv.slice(2);
const actors = { user: 'dev.nguyen@congty.com', approver: 'it.manager@congty.com', admin: 'admin@congty.com' };
const rsa = '05555555-1111-1111-1111-111111111112';

function docker(args, input) {
  return execFileSync('docker', args, { input, encoding: 'utf8', timeout: 30_000, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] }).trim();
}

async function main() {
  const root = await fs.realpath(path.join(__dirname, 'test-artifacts/integration'));
  const reportPath = await fs.realpath(reportArgument);
  assert.ok(reportPath.startsWith(root + path.sep));
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.ok(stack.started && stack.keptStack && !stack.cleanupCompleted && stack.status === 'PASSED');
  assert.ok(stack.database === 'crypta_t30_test' && stack.provider === 'MOCK' && stack.smtpEnabled === false);
  const origin = new URL(stack.origin);
  assert.ok(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && origin.port !== '8080');
  const ids = docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${stack.project}`]).split(/\s+/);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  assert.ok(containers.every(c => c.Config.Labels['com.docker.compose.project'] === stack.project && c.State.Running));
  const services = Object.fromEntries(containers.map(c => [c.Config.Labels['com.docker.compose.service'], c]));
  const { backend, frontend, postgres } = services;
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK') && backend.Config.Env.includes('SMTP_ENABLED=false'));
  assert.ok(backend.Config.Env.some(v => v.startsWith('DATABASE_URL=postgresql://crypta_t30_test:') && v.endsWith('@postgres:5432/crypta_t30_test')));
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(m => m.Name === `${stack.project}_test_postgres`));
  assert.deepEqual(frontend.NetworkSettings.Ports['80/tcp'], [{ HostIp: '127.0.0.1', HostPort: origin.port }]);
  const sql = query => docker(['exec', '-i', postgres.Id, 'psql', '-XqAt', '-U', 'crypta_t30_test', '-d', stack.database, '-v', 'ON_ERROR_STOP=1'], query);
  assert.equal(sql("SELECT count(*) FROM requests WHERE reason LIKE 'Trình diễn Crypta %';"), '0', 'Use a fresh demo database.');

  const output = path.join(path.dirname(reportPath), `demo-${Date.now()}`);
  await fs.mkdir(output);
  const { chromium } = require(path.join(playwrightDirectory, 'playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: output, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const started = performance.now();
  const chapters = [];
  let caption = '';
  let token;

  async function mark(text) {
    caption = text;
    await page.evaluate(label => {
      let note = document.getElementById('crypta-demo-caption');
      if (!note) {
        note = document.createElement('div');
        note.id = 'crypta-demo-caption';
        note.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483647;background:#102344;color:white;padding:10px 16px;border-radius:8px;font:600 16px system-ui;pointer-events:none;max-width:calc(100vw - 24px)';
        document.body.append(note);
      }
      note.textContent = label;
    }, caption);
  }
  async function chapter(id, title) {
    await mark(`${id} · ${title}  |  Dữ liệu mẫu · Provider MOCK`);
    chapters.push({ id, title, offsetMs: Math.round(performance.now() - started) });
    await page.waitForTimeout(1250);
  }
  async function go(route) {
    await page.goto(new URL(route, origin).href);
    if (caption) await mark(caption);
  }
  async function as(role, route) {
    if (page.url().startsWith(origin.origin + '/')) await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await context.clearCookies();
    const response = await context.request.post(new URL('/api/v1/auth/login', origin).href, { data: { email: actors[role], password: 'Password@123' } });
    assert.equal(response.status(), 200, 'Demo session setup');
    token = (await response.json()).data.accessToken;
    await response.dispose();
    await go(route);
  }
  async function read(route, status = 200) {
    const response = await fetch(new URL('/api/v1' + route, origin), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, status, route);
    return (await response.json()).data;
  }
  const button = name => page.getByRole('button', { name, exact: true });
  async function submit(reason, revoke = false) {
    await page.getByLabel('Lý do nghiệp vụ').fill(reason);
    if (revoke) {
      await page.getByRole('checkbox', { name: /Đánh dấu khẩn cấp/ }).check();
      await button('Tiếp tục thu hồi').click();
      await page.waitForTimeout(1300);
    }
    await button(revoke ? 'Xác nhận thu hồi' : 'Gửi yêu cầu').click();
    await page.getByRole('button', { name: new RegExp(reason) }).click();
    await page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
    await page.getByText('Chờ duyệt', { exact: true }).waitFor();
    return new URL(page.url()).pathname;
  }
  async function decide(requestPath, reason, reject = false, showQueue = false) {
    await as('approver', `/approvals?q=${encodeURIComponent(reason)}`);
    const row = button(requestPath.split('/').at(-1));
    await row.waitFor();
    if (showQueue) await chapter('UC05', 'Approver lọc hàng chờ trong phạm vi đơn vị');
    await row.click();
    await button(reject ? 'Từ chối' : 'Phê duyệt').click();
    if (reject) await page.getByRole('textbox', { name: /Ghi chú quyết định/ }).fill('Bổ sung phạm vi sử dụng và ngày kết thúc dự kiến.');
    await page.waitForTimeout(1300);
    await button(reject ? 'Xác nhận từ chối' : 'Xác nhận phê duyệt').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    if (reject) return;
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      const request = await read(requestPath);
      if (request.status === 'COMPLETED') return request;
      assert.ok(['APPROVED', 'PROCESSING'].includes(request.status));
      await page.waitForTimeout(250);
    }
    throw new Error('Demo worker did not complete');
  }

  let success = false;
  try {
    await page.setContent('<main style="padding:120px;color:#16335b;font:24px system-ui"><h1>Crypta · Demo 12 luồng nghiệp vụ</h1><p>PostgreSQL cách ly · Provider MOCK · SMTP tắt</p></main>');
    await page.waitForTimeout(1700);
    await as('user', '/requests/new');
    await chapter('UC01', 'User gửi yêu cầu cấp khóa mới');
    const issueReason = 'Trình diễn Crypta cấp mới';
    const issued = await decide(await submit(issueReason), issueReason, false, true);
    assert.ok(issued.resultAssetId);

    await as('user', `/assets/${issued.resultAssetId}`);
    await chapter('UC02', 'Gia hạn từ tài sản vừa cấp');
    await button('Yêu cầu gia hạn').click();
    const renewReason = 'Trình diễn Crypta gia hạn';
    const renewed = await decide(await submit(renewReason), renewReason);
    await as('user', `/assets/${issued.resultAssetId}`);
    await page.getByText('Đã thay thế', { exact: true }).first().waitFor();
    assert.notEqual(renewed.resultAssetId, issued.resultAssetId);
    await mark('UC02 · Tài sản cũ chuyển Đã thay thế  |  Provider MOCK');
    await page.waitForTimeout(1600);

    await go(`/assets/${renewed.resultAssetId}`);
    await chapter('UC03', 'Xác nhận thu hồi khẩn, sau đó Approver duyệt');
    await button('Thu hồi').click();
    const revokeReason = 'Trình diễn Crypta thu hồi';
    await decide(await submit(revokeReason, true), revokeReason);
    await as('user', `/assets/${renewed.resultAssetId}`);
    await page.getByText('Đã thu hồi', { exact: true }).first().waitFor();
    await mark('UC03 · Khóa chuyển Đã thu hồi  |  Provider MOCK');
    await page.waitForTimeout(1600);

    await as('approver', '/assets');
    await page.getByRole('heading', { name: 'Tài sản trong phạm vi phê duyệt', exact: true }).waitFor();
    await chapter('UC04', 'Approver xem danh mục theo phạm vi được giao');
    const financeAsset = sql("SELECT id FROM crypto_assets WHERE asset_code='CRT-FIN-ACTIVE';");
    assert.match(financeAsset, /^[a-f0-9-]{36}$/);
    await read(`/assets/${financeAsset}`, 403);
    await go(`/assets/${financeAsset}`);
    await page.getByRole('alert').filter({ hasText: /không có quyền/i }).waitFor();
    await page.waitForTimeout(1300);

    await as('user', '/requests/new');
    await chapter('UC06', 'Approver từ chối có lý do. User mở lại chi tiết');
    const rejectedReason = 'Trình diễn Crypta từ chối';
    const rejected = await submit(rejectedReason);
    await decide(rejected, rejectedReason, true);
    await as('user', rejected);
    await page.getByText('Bổ sung phạm vi sử dụng và ngày kết thúc dự kiến.', { exact: true }).waitFor();
    assert.equal((await read(rejected)).status, 'REJECTED');
    await page.waitForTimeout(1700);

    await as('admin', '/assets');
    await page.getByRole('heading', { name: 'Tài sản toàn hệ thống', exact: true }).waitFor();
    await page.locator('#admin-assets .table-shell[aria-busy="false"] tbody .table-link').first().waitFor();
    await chapter('UC07', 'Admin tra cứu danh mục toàn hệ thống');
    await go('/policies');
    const row = page.getByRole('row').filter({ hasText: 'RSA_STANDARD' });
    await row.getByRole('button', { name: 'Tạo phiên bản' }).click();
    await chapter('UC08', 'Admin phát hành phiên bản mới của policy RSA');
    await page.getByLabel('Thời hạn tối đa (ngày)').fill('330');
    await page.getByRole('checkbox', { name: /xác nhận phát hành/ }).check();
    await button('Phát hành phiên bản').click();
    await row.getByText('v3', { exact: true }).waitFor();
    await page.waitForTimeout(1400);

    await go('/audit?q=REQUEST_REJECTED');
    await page.getByRole('heading', { name: 'Audit Log', exact: true }).first().waitFor();
    assert.ok((await read('/audit-logs?action=REQUEST_REJECTED&page=1&pageSize=25')).items.some(event => event.requestId === rejected.split('/').at(-1)));
    await chapter('UC09', 'Tra nhật ký quyết định từ chối');

    await go('/users/access');
    await page.getByRole('textbox', { name: 'Tìm tài khoản để phân quyền' }).fill('kt.tran');
    await button('Tìm tài khoản').click();
    const person = page.getByRole('combobox', { name: 'Người dùng', exact: true });
    await person.selectOption({ label: 'Trần Thị Kế Toán — kt.tran@congty.com' });
    await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('APPROVER');
    await page.getByRole('checkbox', { name: 'Tài chính - Kế toán', exact: true }).check();
    await page.getByRole('checkbox', { name: /Xác nhận thay đổi quyền/ }).check();
    await chapter('UC10', 'Admin cấp vai trò Approver cho một đơn vị');
    await button('Lưu quyền truy cập').click();
    await page.getByRole('status').filter({ hasText: 'Đã cập nhật quyền. Người dùng cần đăng nhập lại.' }).first().waitFor();

    sql(`INSERT INTO crypto_assets(asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at)
      SELECT code,'KEY',u.id,u.department_id,'${rsa}',purpose,'ACTIVE',now()-interval '60 days',now()+delta
      FROM users u CROSS JOIN (VALUES ('DEMO-WARNING','Khóa chuẩn bị đến hạn',interval '6 days'),
      ('DEMO-EXPIRED','Khóa đã đến hạn',interval '-1 minute')) fixture(code,purpose,delta) WHERE u.email='dev.nguyen@congty.com';`);
    docker(['exec', '-i', backend.Id, 'node', '-'], `require('reflect-metadata');
      const {Pool}=require('pg');const {ExpiryScanService}=require('./dist/jobs/expiry-scan.service');
      const {NotificationsService}=require('./dist/notifications/notifications.service');
      const pool=new Pool({connectionString:process.env.DATABASE_URL});
      new ExpiryScanService(pool,new NotificationsService(pool)).run().finally(()=>pool.end());`);
    await as('user', '/notifications');
    await page.getByText('DEMO-WARNING', { exact: true }).waitFor();
    await chapter('UC11', 'Cảnh báo sắp hết hạn xuất hiện trong ứng dụng');
    const expiredNotice = page.getByRole('article').filter({ hasText: 'DEMO-EXPIRED' });
    await expiredNotice.getByRole('button', { name: 'Xem chi tiết' }).click();
    await page.getByRole('heading', { name: 'Khóa đã đến hạn', exact: true }).waitFor();
    assert.equal(sql("SELECT status FROM crypto_assets WHERE asset_code='DEMO-EXPIRED';"), 'EXPIRED');
    await chapter('UC12', 'Worker chuyển tài sản đến hạn sang Đã hết hạn');
    await page.waitForTimeout(1800);
    assert.deepEqual([...new Set(chapters.map(chapter => chapter.id))].sort(), Array.from({ length: 12 }, (_, i) => 'UC' + String(i + 1).padStart(2, '0')));
    success = true;
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    const raw = await video.path();
    const videoPath = path.join(output, success ? 'crypta-demo.webm' : 'incomplete.webm');
    await fs.rename(raw, videoPath);
    const bytes = await fs.readFile(videoPath);
    assert.ok(bytes.length > 100_000 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])));
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ success, project: stack.project, chapters, provider: 'MOCK', smtpEnabled: false,
      images: { backend: backend.Image, frontend: frontend.Image }, buildAssets: stack.buildAssets,
      video: path.basename(videoPath), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2) + '\n');
  }
  console.log(`PASS demo recording: ${output}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
