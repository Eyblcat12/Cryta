const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const [reportArg, modules] = process.argv.slice(2);
const root = path.join(__dirname, 'test-artifacts', 'integration');
const reportPath = path.resolve(reportArg);
const results = [];
const password = 'Password@123';
const email = 'dev.nguyen@congty.com';
const it = 'd1111111-1111-1111-1111-111111111111';
const owner = '04444444-3333-3333-3333-333333333333';
const marker = 'X04_REPORT_PDF_FIXTURE';

async function main() {
  assert.ok(reportPath.startsWith(root + path.sep));
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.ok(stack.started && stack.keptStack && !stack.cleanupCompleted && !stack.mfaRequired);
  assert.equal(stack.database, 'crypta_t30_test');
  assert.equal(stack.provider, 'MOCK');
  assert.equal(stack.smtpEnabled, false);
  const origin = new URL(stack.origin);
  assert.ok(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && origin.port !== '8080');
  const compose = ['compose', '--project-name', stack.project, '--env-file', path.join(path.dirname(reportPath), 'test.env'),
    '--file', path.join(__dirname, 'testing', 'compose.t30.yml')];
  const sql = input => execFileSync('docker', [...compose, 'exec', '-T', 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', stack.database, '-d', stack.database, '-c', input], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const output = path.join(path.dirname(reportPath), 'reports');
  await fs.mkdir(output);
  const { chromium } = require(path.join(path.resolve(modules), 'playwright'));
  let browser;
  async function call(route, options = {}) {
    const { token, body } = options;
    return fetch(new URL('/api/v1' + route, origin), {
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15_000),
      headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }
  async function data(response, status = 200, label = 'API status') {
    const body = await response.json().catch(() => ({}));
    assert.equal(response.status, status, `${label}: expected ${status}, received ${response.status} (${body.error?.code ?? 'no code'})`);
    return body.data;
  }
  const login = async account => (await data(await call('/auth/login', { body: { email: account, password } }))).accessToken;
  const preview = (token, dataset, filters) => call('/reports/preview', { token, body: { dataset, filters } });
  const create = (token, dataset, format, filters, requestKey = randomUUID()) =>
    call('/reports', { token, body: { dataset, format, filters, requestKey } });
  const jobs = (token, dataset) => call('/reports?dataset=' + dataset, { token });
  const file = (token, id) => call(`/reports/${id}/file`, { token });
  async function ready(token, dataset, id) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const job = (await data(await jobs(token, dataset))).find(value => value.id === id);
      if (job?.state === 'READY') return job;
      assert.notEqual(job?.state, 'FAILED', 'Report worker failure ' + job?.failureCode);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.fail('The report worker did not publish the file within 20 seconds.');
  }
  async function check(name, operation) {
    try {
      results.push({ name, passed: true, evidence: await operation() });
      console.log('PASS ' + name);
    } catch (error) {
      const line = String(error.stack).match(/test-real-reports\.cjs:(\d+):\d+/)?.[1];
      const detail = error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name;
      results.push({ name, passed: false, error: `${detail} (runner line ${line ?? '?'})` });
      console.error('FAIL ' + name + ': ' + detail + ' at runner line ' + line);
      throw error;
    }
  }
  const [user, approver, admin, other] = await Promise.all([email, 'it.manager@congty.com', 'admin@congty.com', 'kt.tran@congty.com'].map(login));
  const assetFilter = { ownedOnly: 'true' };
  let csvId;
  try {
    await check('Export preview agrees with lists and enforces owner, department and audit permissions', async () => {
      const assets = await data(await call('/assets?page=1&pageSize=100&ownedOnly=true', { token: user }));
      const own = await data(await preview(user, 'ASSETS', assetFilter));
      assert.equal(own.total, assets.total);
      assert.ok(own.total > 0);
      assert.equal(own.scope.mode, 'OWN');
      const requests = await data(await call('/requests?page=1&pageSize=100&approvalScope=true', { token: approver }));
      const scoped = await data(await preview(approver, 'REQUESTS', { approvalScope: 'true' }));
      assert.equal(scoped.total, requests.total);
      assert.deepEqual(scoped.scope, { mode: 'DEPARTMENTS', departments: [it] });
      assert.ok(requests.items.every(row => row.departmentId === it));
      await data(await preview(approver, 'AUDIT', {}), 403, 'Audit requires Security Admin');
      await data(await preview(user, 'ASSETS', { pageSize: '1000' }), 400, 'Server-owned pagination');
      const empty = await data(await preview(user, 'ASSETS', { search: 'nothing-x04-fixture-matches' }));
      assert.equal(empty.total, 0);
      return { assetRows: own.total, requestRows: scoped.total, deniedAudit: 403, emptyRows: 0 };
    });

    await check('CSV uses safe cells, scoped rows, idempotency and guarded downloads', async () => {
      const original = sql(`SELECT encode(convert_to(name,'UTF8'),'hex') FROM departments WHERE id='${it}'`);
      assert.match(original, /^[0-9a-f]+$/);
      sql(`UPDATE departments SET name='=1+1' WHERE id='${it}'`);
      try {
        const key = randomUUID();
        const responses = await Promise.all([create(user, 'ASSETS', 'CSV', assetFilter, key), create(user, 'ASSETS', 'CSV', assetFilter, key)]);
        const [first, second] = await Promise.all(responses.map(response => data(response, 202)));
        assert.equal(first.id, second.id, 'Concurrent create retries must produce one job');
        csvId = first.id;
        const job = await ready(user, 'ASSETS', csvId);
        const response = await file(user, csvId);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.match(response.headers.get('content-type'), /^text\/csv/);
        const csv = Buffer.from(await response.arrayBuffer()).toString('utf8');
        assert.ok(csv.startsWith('\uFEFF'));
        assert.equal(csv.trimEnd().split('\r\n').length, job.rowCount + 1);
        assert.match(csv, /"Văn bản: =1\+1"/);
        assert.doesNotMatch(csv, /,"=1\+1"|providerReference|KEY-FIN|CRT-FIN/);
        await data(await file(other, csvId), 404, 'A different user must not download the file');
        assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${csvId}' AND action='REPORT_EXPORT_DOWNLOADED'`), '1');
        return { rows: job.rowCount, idempotent: true, formulaNeutralized: true, otherUser: 404 };
      } finally {
        sql(`UPDATE departments SET name=convert_from(decode('${original}','hex'),'UTF8') WHERE id='${it}'`);
      }
    });

    await check('Multi-page PDF stays within the Audit Log projection and downloads as an attachment', async () => {
      sql(`INSERT INTO audit_logs (actor_type,action,entity_type,entity_id,outcome,metadata)
        SELECT 'SYSTEM','${marker}','USER','fixture-'||i,'SUCCESS','{"sensitiveMarker":"PRIVATE_EXPORT_FIXTURE"}'::jsonb
        FROM generate_series(1,54) i`);
      const job = await data(await create(admin, 'AUDIT', 'PDF', { action: marker }), 202);
      const report = await ready(admin, 'AUDIT', job.id);
      assert.equal(report.rowCount, 54);
      const response = await file(admin, job.id);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-disposition'), /attachment; filename="crypta-audit-.*\.pdf"/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
      const pages = [...bytes.toString('latin1').matchAll(/\/Type \/Page\b/g)].length;
      assert.ok(pages >= 2 && pages < 8, 'Audit PDF should span multiple pages with a bounded page count');
      if (process.env.CRYPTA_REPORT_PDF_QA === '1') await fs.writeFile(path.join(output, 'fixture-audit.pdf'), bytes);
      return { rows: report.rowCount, pages, attachment: true };
    });

    await check('Cancellation and expiry deny file access and remove expired bytes', async () => {
      const id = randomUUID();
      const version = sql(`SELECT token_version FROM users WHERE id='${owner}'`);
      assert.match(version, /^\d+$/);
      sql(`INSERT INTO report_exports (id,request_key,requester_id,token_version,dataset,format,filters,scope,state,claim_token,lease_until)
        VALUES ('${id}','${randomUUID()}','${owner}',${version},'ASSETS','CSV','{"ownedOnly":"true"}',
        '{"mode":"OWN","departments":[]}','RUNNING','${randomUUID()}',clock_timestamp()+interval '1 hour')`);
      const cancelled = await data(await call(`/reports/${id}/cancel`, { token: user, body: {} }));
      assert.equal(cancelled.state, 'CANCELLED');
      await data(await file(user, id), 409, 'Cancelled file is unavailable');
      sql(`UPDATE report_exports SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${csvId}'`);
      await data(await file(user, csvId), 410, 'Expired file is unavailable');
      for (let i = 0; i < 14 && sql(`SELECT (content IS NULL)::text FROM report_exports WHERE id='${csvId}'`) !== 'true'; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.equal(sql(`SELECT (content IS NULL)::text FROM report_exports WHERE id='${csvId}'`), 'true');
      return { cancelled: true, expired: 410, bytesCleared: true };
    });

    await check('Chromium exports from the current filter and restores report status after reload', async () => {
      browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1365, height: 850 }, acceptDownloads: true });
      await page.goto(new URL('/assets?status=ACTIVE', origin).href);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      const open = page.getByRole('button', { name: 'Xuất báo cáo' });
      await open.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Xuất báo cáo' });
      await dialog.getByText('Dữ liệu của tôi', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, 'desktop.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Xuất báo cáo', undefined, { timeout: 5_000 });
      await open.click();
      await dialog.getByRole('button', { name: 'Tạo báo cáo' }).click();
      const download = page.getByRole('button', { name: 'Tải CSV' });
      await download.waitFor();
      await page.reload();
      await download.waitFor();
      const event = page.waitForEvent('download');
      await download.click();
      assert.match((await event).suggestedFilename(), /^crypta-assets-[0-9a-f-]+\.csv$/);
      await page.setViewportSize({ width: 390, height: 844 });
      await open.click();
      await dialog.getByText('Dữ liệu của tôi', { exact: true }).waitFor();
      assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth));
      await page.screenshot({ path: path.join(output, 'mobile.png'), animations: 'disabled' });
      return { keyboardFocusRestored: true, readyAfterReload: true, download: true, mobileFits: true };
    });

    await check('A new permission version invalidates both existing files and queued work', async () => {
      const created = await data(await create(user, 'ASSETS', 'CSV', assetFilter), 202);
      await ready(user, 'ASSETS', created.id);
      const stale = randomUUID();
      sql(`BEGIN;
        INSERT INTO report_exports (id,request_key,requester_id,token_version,dataset,format,filters,scope)
          SELECT '${stale}','${randomUUID()}',id,token_version,'ASSETS','CSV','{"ownedOnly":"true"}',
            '{"mode":"OWN","departments":[]}' FROM users WHERE id='${owner}';
        UPDATE users SET token_version=token_version+1 WHERE id='${owner}';
        COMMIT`);
      await data(await file(user, created.id), 401, 'Old permission token cannot download');
      const current = await login(email);
      await data(await file(current, created.id), 404, 'A new permission version cannot download an earlier file');
      const expected = 'FAILED|REPORT_SCOPE_CHANGED|true';
      const result = () => sql(`SELECT state||'|'||coalesce(failure_code,'')||'|'||(content IS NULL)::text FROM report_exports WHERE id='${stale}'`);
      for (let i = 0; i < 20 && result() !== expected; i++) await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(result(), expected);
      return { staleToken: 401, previousFile: 404, staleQueuedWorkDiscarded: true };
    });
  } finally {
    await browser?.close().catch(() => undefined);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({
      passed: results.filter(result => result.passed).length, total: results.length, results,
    }, null, 2));
  }
}

main().catch(() => { process.exitCode = 1; });
