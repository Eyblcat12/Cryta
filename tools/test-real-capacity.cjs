// Measures a runner-owned PostgreSQL/Nginx stack. No operational credentials or data are read.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { verifyMonitorLoad } = require('./testing/capacity-monitor.cjs');

const [reportArgument, label, ...flags] = process.argv.slice(2);
const sampleCount = 48;
const round = value => Number(value.toFixed(2));
const sha = value => createHash('sha256').update(value).digest('hex');
const sqlString = value => `'${value.replaceAll("'", "''")}'`;

function docker(args, input) {
  return execFileSync('docker', args, { input, encoding: 'utf8', timeout: 120_000,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).trim();
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => round(sorted[Math.ceil(sorted.length * fraction) - 1]);
  return { count: sorted.length, p50: at(0.50), p95: at(0.95), max: at(1) };
}

async function main() {
  assert.match(label ?? '', /^[a-z0-9-]{1,35}$/);
  assert.ok(flags.every(flag => ['--seed', '--jobs', '--pages', '--monitor'].includes(flag)));
  const artifactRoot = fs.realpathSync(path.join(__dirname, 'test-artifacts/integration'));
  const reportPath = fs.realpathSync(reportArgument);
  assert.ok(reportPath.startsWith(artifactRoot + path.sep));
  const stack = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.equal(stack.database, 'crypta_t30_test');
  assert.ok(stack.status === 'PASSED' && stack.started && stack.keptStack && !stack.cleanupCompleted);
  assert.ok(stack.provider === 'MOCK' && stack.smtpEnabled === false && stack.fixtureOnly === false);
  const origin = new URL(stack.origin);
  assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(origin.protocol, 'http:');
  assert.ok(origin.port && origin.port !== '8080');
  const ids = docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${stack.project}`]).split(/\s+/);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  const byService = Object.fromEntries(containers.map(c => [c.Config.Labels['com.docker.compose.service'], c]));
  const { backend, frontend, postgres } = byService;
  assert.ok(containers.every(c => c.Config.Labels['com.docker.compose.project'] === stack.project && c.State.Running));
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK') && backend.Config.Env.includes('SMTP_ENABLED=false'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(m => m.Name === `${stack.project}_test_postgres`));
  assert.deepEqual(frontend.NetworkSettings.Ports['80/tcp'], [{ HostIp: '127.0.0.1', HostPort: origin.port }]);

  const output = path.join(path.dirname(reportPath), `capacity-${label}.json`);
  assert.equal(fs.existsSync(output), false, 'Choose a fresh report label.');
  const sql = text => docker(['exec', '-i', postgres.Id, 'psql', '-XqAt', '-U', 'crypta_t30_test', '-d', stack.database,
    '-v', 'ON_ERROR_STOP=1'], text);
  if (flags.includes('--seed')) sql(fs.readFileSync(path.join(__dirname, 'testing/capacity-fixture.sql'), 'utf8'));
  const dataset = JSON.parse(sql(`SELECT json_build_object(
    'users',(SELECT count(*) FROM users WHERE email LIKE 'capacity-%@example.test'),
    'assets',(SELECT count(*) FROM crypto_assets WHERE asset_code LIKE 'T50-ASSET-%'),
    'requests',(SELECT count(*) FROM requests WHERE reason LIKE 'T50 capacity request %'),
    'audit',(SELECT count(*) FROM audit_logs WHERE entity_id LIKE 't50-audit-%'),
    'notifications',(SELECT count(*) FROM notifications WHERE deduplication_key LIKE 'capacity-notice-%'),
    'scheduledEmail',(SELECT count(*) FROM notifications WHERE deduplication_key LIKE 'capacity-notice-%' AND channel='EMAIL'),
    'dbBytes',pg_database_size(current_database()),'postgres',current_setting('server_version'),
    'sharedBuffers',current_setting('shared_buffers'),'workMem',current_setting('work_mem'));`));
  assert.deepEqual([dataset.users, dataset.assets, dataset.requests, dataset.audit, dataset.notifications, dataset.scheduledEmail],
    [4000, 50000, 40000, 250000, 50000, 10000]);

  async function api(endpoint, token, body, status = 200) {
    const started = performance.now();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(new URL('/api/v1' + endpoint, origin), { method: body === undefined ? 'GET' : 'POST',
      headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, status, `${endpoint} expected HTTP ${status}, got ${response.status}`);
    const data = (await response.json()).data;
    return { data, ms: performance.now() - started };
  }
  const sessions = {};
  for (const [role, email] of Object.entries({ admin: 'admin@congty.com', approver: 'it.manager@congty.com', owner: 'dev.nguyen@congty.com' })) {
    sessions[role] = (await api('/auth/login', undefined, { email, password: 'Password@123' })).data;
  }
  const routes = [
    ['admin-dashboard', 'admin', '/dashboard?role=ADMIN', 200],
    ['owner-dashboard', 'owner', '/dashboard?role=USER', 200],
    ['approver-dashboard', 'approver', '/dashboard?role=APPROVER', 200],
    ['admin-assets', 'admin', '/assets?page=1&pageSize=25', 200],
    ['admin-assets-deep', 'admin', '/assets?page=1000&pageSize=25', 300],
    ['owner-assets', 'owner', '/assets?page=1&pageSize=25&ownedOnly=true', 200],
    ['approver-queue', 'approver', '/requests?page=1&pageSize=25&status=PENDING', 200],
    ['audit-recent', 'admin', '/audit-logs?page=1&pageSize=25', 200],
    ['audit-search', 'admin', '/audit-logs?page=1&pageSize=25&search=T50_ASSET_ROTATED', 350],
    ['owner-notifications', 'owner', '/notifications?page=1&pageSize=25', 200],
    ['admin-users', 'admin', '/users?page=1&pageSize=25', 200],
  ].map(([name, role, endpoint, proposedBudgetMs]) => ({ name, role, endpoint, proposedBudgetMs }));

  const ownerId = sessions.owner.user.id;
  const approverDepartment = sessions.approver.user.approverDepartmentIds[0];
  assert.match(ownerId, /^[a-f0-9-]{36}$/);
  assert.match(approverDepartment, /^[a-f0-9-]{36}$/);
  const expected = JSON.parse(sql(`SELECT json_build_object(
    'admin-assets',(SELECT count(*) FROM crypto_assets),'admin-assets-deep',(SELECT count(*) FROM crypto_assets),
    'owner-assets',(SELECT count(*) FROM crypto_assets WHERE owner_id='${ownerId}'),
    'approver-queue',(SELECT count(*) FROM requests WHERE department_id='${approverDepartment}' AND status='PENDING' AND submitted_at IS NOT NULL),
    'audit-recent',(SELECT count(*) FROM audit_logs),
    'audit-search',(SELECT count(*) FROM audit_logs WHERE action='T50_ASSET_ROTATED'),
    'owner-notifications',(SELECT count(*) FROM notifications WHERE recipient_id='${ownerId}' AND channel='IN_APP'),
    'admin-users',(SELECT count(*) FROM users));`));

  async function read(route) {
    const { data, ms } = await api(route.endpoint, sessions[route.role].accessToken);
    if (route.name === 'audit-recent') {
      // Approval/login/worker audit can append events while the test is running.
      assert.ok(data.total >= expected[route.name]);
    } else if (route.name in expected) assert.equal(data.total, expected[route.name], route.name);
    if (route.name in expected) assert.equal(data.items.length, 25, route.name);
    return { data, ms };
  }
  const dashboards = {};
  for (const route of routes) {
    const { data } = await read(route);
    if (!route.name.endsWith('-dashboard')) continue;
    assert.equal(data.role, { admin: 'ADMIN', approver: 'APPROVER', owner: 'USER' }[route.role]);
    dashboards[route.name] = data.trend;
  }
  const checks = [
    ['approver-queue-order', 'approver', '/requests?page=1&pageSize=25&status=PENDING',
      `SELECT id FROM requests WHERE department_id='${approverDepartment}' AND status='PENDING' AND submitted_at IS NOT NULL
       ORDER BY emergency DESC,submitted_at ASC,id ASC LIMIT 25`],
    ['approver-queue-search-page', 'approver', '/requests?page=2&pageSize=25&status=PENDING&search=T50%20capacity%20request&sortBy=updatedAt&sortOrder=desc',
      `SELECT id FROM requests WHERE department_id='${approverDepartment}' AND status='PENDING' AND submitted_at IS NOT NULL
       AND reason ILIKE '%T50 capacity request%' ORDER BY updated_at DESC,id DESC LIMIT 25 OFFSET 25`],
    ['assets-deep-order', 'admin', '/assets?page=1000&pageSize=25',
      'SELECT id FROM crypto_assets ORDER BY expires_at ASC,id ASC LIMIT 25 OFFSET 24975'],
    ['assets-owner-name', 'admin', '/assets?page=2&pageSize=25&search=Capacity%20User%201&sortBy=code&sortOrder=desc',
      `SELECT a.id FROM crypto_assets a JOIN users u ON a.owner_id=u.id
       WHERE u.display_name ILIKE '%Capacity User 1%' ORDER BY a.asset_code DESC,a.id DESC LIMIT 25 OFFSET 25`],
    ['audit-actor-search-and-sort', 'admin', '/audit-logs?page=1&pageSize=25&search=Capacity%20User%20111&sortBy=actor',
      `SELECT a.id FROM audit_logs a JOIN users u ON a.actor_id=u.id
       WHERE u.display_name ILIKE '%Capacity User 111%' ORDER BY u.display_name ASC,a.id ASC LIMIT 25`],
    ['audit-actor-filter', 'admin', '/audit-logs?page=1&pageSize=25&actor=Capacity%20User%20111',
      `SELECT a.id FROM audit_logs a JOIN users u ON a.actor_id=u.id
       WHERE u.display_name ILIKE '%Capacity User 111%' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 25`],
    ['assets-outside-owner-scope', 'owner', '/assets?page=1&pageSize=25&ownedOnly=true&search=T50-ASSET-050000',
      'SELECT id FROM crypto_assets WHERE FALSE'],
  ];
  const projectionChecks = [];
  for (const [name, role, endpoint, referenceQuery] of checks) {
    const ids = sql(referenceQuery + ';').split(/\r?\n/).filter(Boolean);
    const { data } = await api(endpoint, sessions[role].accessToken);
    assert.deepEqual(data.items.map(item => String(item.id)), ids, name);
    projectionChecks.push({ name, matched: ids.length, digest: sha(ids.join(',')) });
  }
  for (const [name, search, page] of [
    ['selective', 't50_asset_rotated', 1], ['overlap', 'T50', 2], ['short', '50', 1],
    ['actor', 'Capacity User 111', 1], ['unicode', 'quản trị', 1], ['wildcard', '%_a%', 1],
    ['escaped', 'T50\\_ASSET\\_ROTATED', 1], ['past-last-page', 'T50_ASSET_ROTATED', 300],
  ]) {
    const pattern = sqlString(`%${search}%`);
    const filter = `FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
      WHERE a.action ILIKE ${pattern} OR a.entity_id ILIKE ${pattern} OR u.display_name ILIKE ${pattern}`;
    const reference = JSON.parse(sql(`SELECT json_build_object('total',(SELECT count(*) ${filter}),
      'ids',(SELECT COALESCE(json_agg(id),'[]') FROM (SELECT a.id::text ${filter}
      ORDER BY a.occurred_at DESC,a.id DESC LIMIT 25 OFFSET ${(page - 1) * 25}) rows));`));
    const { data } = await api(`/audit-logs?${new URLSearchParams({ search, page: String(page), pageSize: '25' })}`, sessions.admin.accessToken);
    assert.equal(data.total, reference.total, name);
    assert.deepEqual(data.items.map(item => String(item.id)), reference.ids, name);
    projectionChecks.push({ name: `audit-search-${name}`, total: reference.total, matched: reference.ids.length, digest: sha(reference.ids.join(',')) });
  }
  const stats = async () => (await api('/operations/metrics', sessions.admin.accessToken)).data;
  const phases = [];
  for (const concurrency of [4, 16, 32]) {
    const samples = Object.fromEntries(routes.map(route => [route.name, []]));
    const before = await stats();
    let next = 0;
    const total = sampleCount * routes.length;
    const started = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < total) {
        const route = routes[next++ % routes.length];
        samples[route.name].push((await read(route)).ms);
      }
    }));
    const elapsed = performance.now() - started;
    const after = await stats();
    phases.push({ concurrency, requests: total, durationMs: round(elapsed), perSecond: round(total / elapsed * 1000),
      databaseBefore: before.database, databaseAfter: after.database, processBefore: before.process, processAfter: after.process,
      routes: routes.map(route => ({ ...route, ...summarize(samples[route.name]) })) });
    console.log(`${label}: ${concurrency} in flight, ${total} checked requests, ${round(total / elapsed * 1000)} req/s`);
  }

  const monitor = flags.includes('--monitor') ? await verifyMonitorLoad({
    origin: origin.origin, postgresId: postgres.Id, backendEnvironment: backend.Config.Env,
    artifactRoot, sql, read, routes, summarize,
  }) : undefined;

  const querySource = `const { DashboardService } = require('./dist/dashboard/dashboard.service');
    const { AssetsService } = require('./dist/assets/assets.service');
    const { RequestsService } = require('./dist/requests/requests.service');
    const { AuditController } = require('./dist/audit/audit.controller');
    const queries = {};
    function capture(names, match = () => true) {
      return {query: async (text, values = []) => { if (match(text)) queries[names.shift()] = {text, values}; return {rows:[{}]}; }};
    }
    (async () => {
      const admin = {roles:['ADMIN']};
      const dashboard = new DashboardService(capture(['adminTrend','ownerTrend'], text => text.includes('generate_series')));
      await dashboard.get(admin,'ADMIN');
      await dashboard.get({roles:['USER'],id:${JSON.stringify(ownerId)}},'USER');
      await new AssetsService(capture(['assetCount','assetDeepPage'])).list(admin, {page:'1000',pageSize:'25'});
      await new AssetsService(capture(['assetFirstPage'], text => !text.includes('COUNT(*)'))).list(admin, {page:'1',pageSize:'25'});
      await new RequestsService(capture(['queueCount','queuePage'])).list({roles:['APPROVER'],approverDepartmentIds:[${JSON.stringify(approverDepartment)}]}, {page:'1',pageSize:'25',status:'PENDING'});
      await new AuditController(capture(['auditSearchCount','auditSearchPage'])).list(admin, {page:'1',pageSize:'25',search:'T50_ASSET_ROTATED'});
      console.log(JSON.stringify(queries));
    })().catch(error => { console.error(error.message); process.exitCode = 1; });`;
  const queries = JSON.parse(docker(['exec', backend.Id, 'node', '-e', querySource]));
  const plans = {};
  for (const [name, { text, values }] of Object.entries(queries)) {
    const query = text.replace(/\$(\d+)/g, (_, index) => {
      const value = values[Number(index) - 1];
      if (Array.isArray(value)) {
        assert.ok(value.length && value.every(item => typeof item === 'string' && /^[a-f0-9-]{36}$/.test(item)));
        return 'ARRAY[' + value.map(sqlString).join(',') + ']';
      }
      assert.ok(typeof value === 'string' || Number.isSafeInteger(value));
      return typeof value === 'string' ? sqlString(value) : String(value);
    });
    const [plan] = JSON.parse(sql('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query + ';'));
    plans[name] = { text, ...plan };
  }

  const bundle = [];
  for (const asset of stack.buildAssets) {
    assert.match(asset, /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/);
    const response = await fetch(new URL(asset, origin));
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    bundle.push({ asset, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: sha(bytes) });
  }
  const dockerHost = JSON.parse(docker(['info', '--format', '{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}}}']));
  const memory = docker(['stats', '--no-stream', '--format', '{{.Name}} {{.MemUsage}}', ...ids]).split(/\r?\n/);
  let pages;
  if (flags.includes('--pages')) {
    const { chromium } = require(path.join(process.env.CRYPTA_CAPACITY_PLAYWRIGHT, 'playwright'));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(new URL('/dashboard', origin).href);
      await page.locator('.login-card input[type=email]').fill('admin@congty.com');
      await page.locator('.login-card input[type=password]').fill('Password@123');
      await page.locator('.login-card button.login-submit').click();
      const dashboardReady = page.locator('[aria-label="Tổng quan"][aria-busy="false"] [aria-label="Tổng quan an toàn"]');
      await dashboardReady.waitFor();
      pages = { browser: browser.version(), proposedBudgetMs: 1500, results: [] };
      const assetsReady = page.locator('#admin-assets .table-shell[aria-busy="false"] tbody .table-link').first();
      for (const [route, ready] of [['/dashboard', dashboardReady], ['/assets?page=1000&pageSize=25', assetsReady]]) {
        const samples = [];
        for (let i = 0; i <= 24; i++) {
          const start = performance.now();
          await page.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded' });
          await ready.waitFor();
          if (i > 0) samples.push(performance.now() - start);
        }
        pages.results.push({ route, ...summarize(samples) });
      }
    } finally { await browser.close(); }
  }
  let jobs;
  if (flags.includes('--jobs')) {
    const count = 12;
    const before = await stats();
    assert.equal(before.assets.ready, 0);
    assert.equal(before.assets.processing, 0);
    const pending = [];
    for (let i = 0; i < count; i++) {
      pending.push((await api('/requests', sessions.owner.accessToken, {
        type: 'CREATE', policyVersionId: '05555555-1111-1111-1111-111111111112',
        reason: `T50 worker throughput ${label} ${i}`, parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 90 },
      }, 201)).data);
    }
    for (const request of pending) {
      assert.match(request.id, /^[a-f0-9-]{36}$/);
      await api(`/requests/${request.id}/decision`, sessions.approver.accessToken, { decision: 'APPROVED', version: String(request.version) }, 201);
    }
    const deadline = Date.now() + 35_000;
    let finished = [];
    while (Date.now() < deadline) {
      finished = await Promise.all(pending.map(async request => (await api(`/requests/${request.id}`, sessions.owner.accessToken)).data.status));
      assert.ok(finished.every(status => ['APPROVED', 'PROCESSING', 'COMPLETED'].includes(status)));
      if (finished.every(status => status === 'COMPLETED')) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.deepEqual(finished, Array(count).fill('COMPLETED'));
    const timings = JSON.parse(sql(`SELECT json_agg(json_build_object(
      'ms',extract(epoch from r.completed_at-d.decided_at)*1000,'attempts',p.attempt_count,
      'receipt',p.receipt_at IS NOT NULL,'notice',(SELECT count(*) FROM notifications n
        WHERE n.request_id=r.id AND n.type='REQUEST_COMPLETED' AND n.channel='IN_APP')))
      FROM requests r JOIN request_decisions d ON d.request_id=r.id JOIN provider_operations p ON p.request_id=r.id
      WHERE r.id IN (${pending.map(request => `'${request.id}'`).join(',')});`));
    assert.equal(timings.length, count);
    assert.ok(timings.every(row => row.attempts === 1 && row.receipt && row.notice === 1 && row.ms >= 0));
    const after = await stats();
    assert.equal(after.assets.ready, 0);
    assert.equal(after.assets.processing, 0);
    jobs = { approvedToCompletedMs: summarize(timings.map(row => row.ms)), proposedBudgetMs: 20_000,
      operationsWithOneAttemptAndReceipt: count, inAppCompletionNotices: count,
      before: { assets: before.assets, email: before.email }, after: { assets: after.assets, email: after.email } };
  }
  const report = { label, project: stack.project, capturedAt: new Date().toISOString(),
    mode: { smtp: false, provider: 'MOCK', http: 'loopback through Nginx' }, dataset, dockerHost, memory,
    images: Object.fromEntries(Object.entries(byService).map(([service, container]) => [service, container.Image])),
    bundle, expected, dashboards, projectionChecks, phases, monitor, plans, pages, jobs };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`Capacity report: ${output}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
