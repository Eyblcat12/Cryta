// Real HTTP/browser/DB checks. Refuses to target anything except a runner-created test project.
// Tokens/cookies remain in memory; no Playwright trace, HAR or storage-state file is recorded.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const [reportArgument, playwrightDirectory, channel = 'msedge'] = process.argv.slice(2);
const results = [];
let interceptedRequests = 0;
let browser;
async function main() {
  assert.ok(reportArgument, 'Pass the isolated-stack report.json path.');
  const reportPath = path.resolve(reportArgument);
  const root = path.resolve(__dirname, '..');
  const artifactRoot = path.join(__dirname, 'test-artifacts', 'integration');
  assert.ok(reportPath.startsWith(artifactRoot + path.sep), 'Report must belong to the local test artifact root.');
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.equal(stack.database, 'crypta_t30_test');
  assert.equal(stack.provider, 'MOCK');
  assert.equal(stack.smtpEnabled, false);
  assert.equal(stack.fixtureOnly, false);
  assert.equal(stack.started, true);
  assert.equal(stack.keptStack, true);
  assert.equal(stack.cleanupCompleted, false);
  const origin = new URL(stack.origin);
  assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(origin.protocol, 'http:');
  assert.ok(origin.port && origin.port !== '8080', 'Do not target the operational stack.');
  assert.ok(['msedge', 'chrome', 'chromium'].includes(channel));
  const compose = ['compose', '--project-name', stack.project, '--env-file', path.join(path.dirname(reportPath), 'test.env'), '--file', path.join(root, 'tools', 'testing', 'compose.t30.yml')];
  function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim(); }
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json']));
  assert.equal(config.name, stack.project);
  assert.equal(config.services.backend.environment.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(String(config.services.backend.environment.SMTP_ENABLED), 'false');
  assert.equal(config.volumes.test_postgres.name, `${stack.project}_test_postgres`);
  assert.equal(config.volumes.test_postgres.external, undefined);
  const containerIds = docker([...compose, 'ps', '-q']).split(/\s+/).filter(Boolean);
  assert.equal(containerIds.length, 3, 'Expected exactly the three isolated services.');
  const containers = JSON.parse(docker(['inspect', ...containerIds]));
  for (const container of containers) assert.equal(container.Config.Labels['com.docker.compose.project'], stack.project);
  const runtimeImages = containers.map(container => ({ service: container.Config.Labels['com.docker.compose.service'], imageId: container.Image }));
  const html = await (await fetch(origin)).text();
  const buildAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.equal(buildAssets.length, 2, 'Expected current JS and CSS build assets.');
  function sql(query) { return docker([...compose, 'exec', '-T', 'postgres', 'psql', '-U', 'crypta_t30_test', '-d', stack.database, '-At', '-c', query]); }
  const output = path.join(path.dirname(reportPath), `real-${channel}-${Date.now()}`);
  await fs.mkdir(output, { recursive: true });
  const { chromium } = playwrightDirectory ? require(path.join(playwrightDirectory, 'playwright')) : require('playwright');
  browser = await chromium.launch({ channel, headless: true });
  const stamp = randomUUID();
  const temporaryPassword = 'Initial@Test12345', changedPassword = 'Changed@Test12345';
  const contexts = [];
  async function test(name, run) {
    if (process.env.CRYPTA_REAL_TEST_FILTER && !name.includes(process.env.CRYPTA_REAL_TEST_FILTER)) return;
    try { const evidence = await run(); results.push({ name, passed: true, evidence: evidence ?? null }); console.log(`PASS ${name}`); }
    catch (error) {
      // The tests never assert equality of token/cookie/password strings or dump HTTP bodies.
      const message = error instanceof assert.AssertionError ? error.message : `${error.name}: ${String(error.message).slice(0, 800)}`;
      results.push({ name, passed: false, error: message }); console.error(`FAIL ${name}\n${message}`);
    }
  }
  async function call(method, endpoint, body, token, cookie) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(new URL(`/api/v1${endpoint}`, origin), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const envelope = await response.json();
    return { status: response.status, data: envelope.data, code: envelope.error?.code,
      cookie: response.headers.get('set-cookie')?.split(';')[0], requestId: response.headers.get('x-request-id') };
  }
  function expectStatus(response, status, code) { assert.equal(response.status, status, `HTTP status ${response.status}; expected ${status}; code ${response.code ?? '-'}`); if (code) assert.equal(response.code, code); return response.data; }
  async function login(email, password = 'Password@123') { return expectStatus(await call('POST', '/auth/login', { email, password }), 200); }
  const admin = await login('admin@congty.com');
  const approver = await login('it.manager@congty.com');
  const dev = await login('dev.nguyen@congty.com');
  const finance = await login('kt.tran@congty.com');
  const reference = expectStatus(await call('GET', '/users/reference-data', undefined, admin.accessToken), 200);
  const it = reference.departments.find(d => d.code === 'IT').id;
  const policies = expectStatus(await call('GET', '/policies', undefined, dev.accessToken), 200);
  const policy = policies.find(p => p.code === 'RSA_STANDARD');
  assert.ok(policy);
  async function createUser(roles = ['USER'], scopes = [], activate = true) {
    const email = `integration.${randomUUID()}@example.test`;
    const created = expectStatus(await call('POST', '/users', { email, displayName: `Integration ${roles.join(' ')}`, departmentId: it, temporaryPassword, roles, approverDepartmentIds: scopes }, admin.accessToken), 201);
    if (!activate) return { ...created, email };
    const first = await login(email, temporaryPassword);
    expectStatus(await call('POST', '/auth/change-password', { currentPassword: temporaryPassword, newPassword: changedPassword }, first.accessToken), 200);
    return { ...created, ...await login(email, changedPassword), email };
  }
  async function createRequest(session, suffix = '', emergency = false) {
    return expectStatus(await call('POST', '/requests', { type: 'CREATE', policyVersionId: policy.id, reason: `Integration ${stamp} ${suffix}`, emergency, parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 90 } }, session.accessToken), 201);
  }
  const account = await createUser();
  const ownerRequest = await createRequest(account, 'owner');
  const otherRequest = await createRequest(finance, 'finance');
  const ownApproverRequest = await createRequest(approver, 'self-approval');
  await test('T06: login throttling conceals account state and starts a fresh window after expiry', async () => {
    const subject = await createUser();
    const deniedLogin = async (email, password = 'Invalid@Test12345') => {
      const response = await fetch(new URL('/api/v1/auth/login', origin), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(!response.headers.has('set-cookie'));
      return (await response.json()).error;
    };
    const state = () => JSON.parse(sql(`SELECT json_build_object('failures',failed_login_attempts,
      'lockedUntil',locked_until,'locked',COALESCE(locked_until>NOW(),false)) FROM users WHERE id='${subject.id}';`));
    const generic = await deniedLogin(`absent.${randomUUID()}@example.test`);
    assert.equal(generic.code, 'INVALID_CREDENTIALS');
    const failures = await Promise.all(Array.from({ length: 7 }, () => deniedLogin(subject.email)));
    for (const denial of failures) assert.deepEqual(denial, generic);
    const locked = state();
    assert.equal(locked.locked, true);
    assert.deepEqual(await deniedLogin(subject.email, changedPassword), generic);
    assert.equal(locked.failures, 5);
    assert.deepEqual(state(), locked);
    sql(`UPDATE users SET locked_until=NOW()-INTERVAL '1 second' WHERE id='${subject.id}';`);
    assert.deepEqual(await deniedLogin(subject.email), generic);
    assert.deepEqual(state(), { failures: 1, lockedUntil: null, locked: false });
    await login(subject.email, changedPassword);
    assert.deepEqual(state(), { failures: 0, lockedUntil: null, locked: false });
    expectStatus(await call('PATCH', `/users/${subject.id}/status`, { status: 'INACTIVE' }, admin.accessToken), 200);
    assert.deepEqual(await deniedLogin(subject.email, changedPassword), generic);
    assert.deepEqual(state(), { failures: 0, lockedUntil: null, locked: false });
    return { samePublicError: true, concurrentFailures: 7, lockThreshold: 5, freshWindowAfterExpiry: true, inactiveDenied: true };
  });
  await test('T21: Nginx logs safe fields and correlates a denied API call with PostgreSQL audit', async () => {
    const frontend = containers.find(container => container.Config.Labels['com.docker.compose.service'] === 'frontend');
    assert.ok(frontend, 'Expected the isolated frontend container.');
    const marker = `t21-redaction-${randomUUID()}`;
    const denied = await fetch(new URL(`/api/v1/audit-logs?search=${marker}`, origin), {
      headers: { Referer: `https://example.test/${marker}`, Authorization: `Bearer ${marker}`,
        Cookie: `fixture=${marker}`, 'X-Request-Id': marker },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(denied.status, 401);
    const correlationId = denied.headers.get('x-request-id');
    assert.match(correlationId, /^req_[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    await denied.arrayBuffer();
    const missing = await fetch(new URL(`/assets/${marker}.js`, origin), { signal: AbortSignal.timeout(15000) });
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
    const logs = spawnSync('docker', ['logs', '--tail', '300', frontend.Id], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(logs.status, 0, 'Unable to read isolated Nginx logs.');
    const raw = logs.stdout + '\n' + logs.stderr;
    assert.ok(!raw.includes(marker), 'Synthetic sensitive value was found in the Nginx logs.');
    const access = raw.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line))
      .filter(record => record.event === 'nginx.access');
    const record = access.find(entry => entry.correlationId === correlationId);
    assert.ok(record, 'No Nginx access record matched the server-generated audit ID.');
    assert.match(record.proxyRequestId, /^[0-9a-f]{32}$/);
    assert.deepEqual([record.method, record.surface, record.status, record.upstreamStatus], ['GET', 'api', '401', '401']);
    assert.ok(access.some(entry => entry.surface === 'web' && entry.status === '404' && entry.correlationId === '-'));
    const audit = JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('action',action,'metadata',metadata))
      FROM audit_logs WHERE metadata->>'correlationId'='${correlationId}';`));
    assert.deepEqual(audit, [{ action: 'HTTP_REQUEST_DENIED', metadata: {
      correlationId, method: 'GET', route: '/api/v1/audit-logs', httpStatus: 401,
    } }]);
    return { apiStatus: 401, staticStatus: 404, serverCorrelationMatched: true, syntheticValueExcluded: true };
  });
  await test('M API/DB: logout validates cookie format, secret and authenticated session owner', async () => {
    const victim = await createUser();
    const sessions = [];
    for (let index=0; index<3; index++) {
      const session = await call('POST','/auth/login',{email:victim.email,password:changedPassword});
      expectStatus(session,200); assert.ok(session.cookie);
      const id=session.cookie.split('=')[1].split('.')[0];
      assert.match(id,/^[0-9a-f-]{36}$/i); sessions.push({...session,id});
    }
    const malformedStatuses=[];
    for (const value of ['not-a-uuid.secret',sessions[0].id,`${sessions[0].id}.secret.extra`,'%E0%A4']) {
      malformedStatuses.push((await call('POST','/auth/logout',undefined,account.accessToken,`crypta_refresh=${value}`)).status);
    }
    const foreign=await call('POST','/auth/logout',undefined,account.accessToken,sessions[0].cookie);
    const foreignActive=Number(sql(`SELECT COUNT(*) FROM auth_sessions WHERE id='${sessions[0].id}' AND revoked_at IS NULL`));
    const wrongSecret=await call('POST','/auth/logout',undefined,victim.accessToken,`crypta_refresh=${sessions[1].id}.incorrect-secret`);
    const wrongSecretActive=Number(sql(`SELECT COUNT(*) FROM auth_sessions WHERE id='${sessions[1].id}' AND revoked_at IS NULL`));
    const own=await call('POST','/auth/logout',undefined,victim.accessToken,sessions[2].cookie.replace('.', '%2E'));
    const ownActive=Number(sql(`SELECT COUNT(*) FROM auth_sessions WHERE id='${sessions[2].id}' AND revoked_at IS NULL`));
    const repeated=await call('POST','/auth/logout',undefined,victim.accessToken,sessions[2].cookie);
    await fs.writeFile(path.join(output,'logout-observations.json'),JSON.stringify({malformedStatuses,foreignStatus:foreign.status,foreignActive,wrongSecretStatus:wrongSecret.status,wrongSecretActive,ownStatus:own.status,ownActive,repeatedStatus:repeated.status},null,2));
    assert.deepEqual(malformedStatuses,[200,200,200,200],'Malformed cookies must be harmless idempotent logout.');
    expectStatus(foreign,200); assert.equal(foreignActive,1,'An actor must never revoke another user\'s refresh session.');
    expectStatus(wrongSecret,200); assert.equal(wrongSecretActive,1,'A guessed session UUID without its matching secret must not revoke a session.');
    expectStatus(own,200); assert.equal(ownActive,0); expectStatus(repeated,200);
    return {malformedStatuses,foreignSessionPreserved:true,wrongSecretSessionPreserved:true,ownSessionRevoked:true,idempotent:true};
  });
  await test('M API: owner/scope filters apply before count and paging', async () => {
    const own = expectStatus(await call('GET', `/requests?createdByMe=true&page=1&pageSize=1&search=${stamp}`, undefined, account.accessToken), 200);
    assert.equal(own.total, 1); assert.equal(own.items[0].id, ownerRequest.id);
    const page2 = expectStatus(await call('GET', `/requests?createdByMe=true&page=2&pageSize=1&search=${stamp}`, undefined, account.accessToken), 200);
    assert.equal(page2.total, 1); assert.equal(page2.items.length, 0);
    const scoped = expectStatus(await call('GET', `/requests?page=1&pageSize=100&search=${stamp}`, undefined, approver.accessToken), 200);
    assert.equal(scoped.total, 2); assert.ok(scoped.items.every(item => item.departmentId === it));
    const personal = expectStatus(await call('GET', `/requests?createdByMe=true&page=1&pageSize=100&search=${stamp}`, undefined, approver.accessToken), 200);
    assert.equal(personal.total, 1); assert.equal(personal.items[0].id, ownApproverRequest.id);
    const ownedAssets = expectStatus(await call('GET', '/assets?ownedOnly=true&page=1&pageSize=1', undefined, approver.accessToken), 200);
    assert.equal(ownedAssets.total, 0); assert.equal(ownedAssets.items.length, 0);
    return { ownerTotal: own.total, scopedTotal: scoped.total, personalApproverTotal: personal.total };
  });
  await test('M API: foreign request hidden; asset/detail/timeline denied by object scope', async () => {
    expectStatus(await call('GET', `/requests/${otherRequest.id}`, undefined, account.accessToken), 404);
    expectStatus(await call('GET', `/requests/${otherRequest.id}`, undefined, approver.accessToken), 404);
    expectStatus(await call('GET', '/assets/a2222223-2222-2222-2222-222222222223', undefined, dev.accessToken), 403, 'ASSET_SCOPE_DENIED');
    expectStatus(await call('GET', '/assets/a2222223-2222-2222-2222-222222222223/history', undefined, dev.accessToken), 403, 'ASSET_SCOPE_DENIED');
    expectStatus(await call('GET', `/requests/${ownerRequest.id}`, undefined, account.accessToken), 200);
    expectStatus(await call('GET', `/requests/${ownerRequest.id}`, undefined, approver.accessToken), 200);
  });
  await test('M API: SoD, out-of-scope, stale version cannot write a decision', async () => {
    const decision = { decision: 'REJECTED', version: String(ownerRequest.version), comment: 'Integration rejects test request' };
    expectStatus(await call('POST', `/requests/${ownerRequest.id}/decision`, decision, admin.accessToken), 403, 'ROLE_FORBIDDEN');
    expectStatus(await call('POST', `/requests/${ownApproverRequest.id}/decision`, { ...decision, version: String(ownApproverRequest.version) }, approver.accessToken), 403, 'SOD_VIOLATION');
    expectStatus(await call('POST', `/requests/${otherRequest.id}/decision`, { ...decision, version: String(otherRequest.version) }, approver.accessToken), 403, 'OUT_OF_SCOPE');
    expectStatus(await call('POST', `/requests/${ownerRequest.id}/decision`, { ...decision, version: '999' }, approver.accessToken), 409, 'VERSION_CONFLICT');
    assert.equal(sql(`SELECT COUNT(*) FROM request_decisions WHERE request_id IN ('${ownerRequest.id}','${otherRequest.id}','${ownApproverRequest.id}')`), '0');
  });
  await test('M API/DB: two distinct Approvers decide simultaneously and commit exactly once', async () => {
    const secondApprover = await createUser(['APPROVER'], [it]);
    assert.notEqual(secondApprover.user.id, approver.user.id);
    const decision = { decision: 'REJECTED', version: String(ownerRequest.version), comment: 'Integration concurrent rejection' };
    const responses = await Promise.all([call('POST', `/requests/${ownerRequest.id}/decision`, decision, approver.accessToken), call('POST', `/requests/${ownerRequest.id}/decision`, decision, secondApprover.accessToken)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(sql(`SELECT COUNT(*) FROM request_decisions WHERE request_id='${ownerRequest.id}'`), '1');
    assert.equal(sql(`SELECT COUNT(*) FROM audit_logs WHERE request_id='${ownerRequest.id}' AND action='REQUEST_REJECTED' AND outcome='SUCCESS'`), '1');
    const detail = expectStatus(await call('GET', `/requests/${ownerRequest.id}`, undefined, account.accessToken), 200);
    assert.equal(detail.status, 'REJECTED'); assert.equal(detail.version, ownerRequest.version + 1);
    assert.equal(detail.decision.approverId, responses[0].status === 201 ? approver.user.id : secondApprover.user.id);
    return { statuses: responses.map(r => r.status), distinctApprovers: true, decisions: 1, auditEvents: 1, version: detail.version };
  });
  await test('M API: Admin cannot create business requests or remove own access', async () => {
    expectStatus(await call('POST', '/requests', { type: 'CREATE', policyVersionId: policy.id, reason: 'Integration forbidden admin request' }, admin.accessToken), 403, 'ROLE_FORBIDDEN');
    expectStatus(await call('PATCH', `/users/${admin.user.id}/status`, { status: 'INACTIVE' }, admin.accessToken), 409, 'CANNOT_DISABLE_SELF');
    expectStatus(await call('PUT', `/users/${admin.user.id}/access`, { roles: ['USER'], approverDepartmentIds: [] }, admin.accessToken), 409, 'CANNOT_REMOVE_OWN_ADMIN');
  });
  await test('M API/DB: invalid role/scope assignments roll back user creation', async () => {
    const combinations = [
      { roles: ['ADMIN', 'APPROVER'], scopes: [it], code: 'SOD_ROLE_CONFLICT' },
      { roles: ['APPROVER'], scopes: [], code: 'APPROVER_SCOPE_REQUIRED' },
      { roles: ['USER'], scopes: [it], code: 'SCOPE_ROLE_MISMATCH' },
      { roles: ['APPROVER'], scopes: ['ffffffff-ffff-ffff-ffff-ffffffffffff'], code: 'INVALID_DEPARTMENT_SCOPE' },
    ];
    for (const item of combinations) {
      const email = `invalid.${randomUUID()}@example.test`;
      expectStatus(await call('POST', '/users', { email, displayName: 'Invalid integration user', departmentId: it, temporaryPassword, roles: item.roles, approverDepartmentIds: item.scopes }, admin.accessToken), 409, item.code);
      const search = expectStatus(await call('GET', `/users?email=${encodeURIComponent(email)}&page=1&pageSize=25`, undefined, admin.accessToken), 200);
      assert.equal(search.total, 0);
    }
  });
  await test('M API/DB: password change revokes all access and refresh sessions', async () => {
    const user = await createUser(['USER'], [], false);
    const one = await call('POST', '/auth/login', { email: user.email, password: temporaryPassword });
    const two = await call('POST', '/auth/login', { email: user.email, password: temporaryPassword });
    expectStatus(one, 200); expectStatus(two, 200);
    expectStatus(await call('GET', '/assets', undefined, one.data.accessToken), 403, 'PASSWORD_CHANGE_REQUIRED');
    expectStatus(await call('POST', '/auth/change-password', { currentPassword: temporaryPassword, newPassword: changedPassword }, one.data.accessToken), 200);
    for (const old of [one, two]) {
      expectStatus(await call('GET', '/auth/me', undefined, old.data.accessToken), 401, 'SESSION_REVOKED');
      expectStatus(await call('POST', '/auth/refresh', undefined, undefined, old.cookie), 401);
    }
    assert.equal(sql(`SELECT COUNT(*) FROM auth_sessions WHERE user_id='${user.id}' AND revoked_at IS NULL`), '0');
    assert.equal((await login(user.email, changedPassword)).user.mustChangePassword, false);
  });
  await test('T06: expired and retired refresh cookies leave a separate live session usable', async () => {
    const user = await createUser();
    const signIn = async () => {
      const response = await call('POST', '/auth/login', { email: user.email, password: changedPassword });
      expectStatus(response, 200);
      assert.ok(response.cookie);
      return response;
    };
    const refresh = cookie => call('POST', '/auth/refresh', undefined, undefined, cookie);
    const sessionId = cookie => {
      const id = cookie.split('=')[1].split('.')[0];
      assert.match(id, /^[a-f0-9-]{36}$/);
      return id;
    };
    const independent = await signIn(), expired = await signIn(), loggedOut = await signIn(), retired = await signIn();
    const stillActive = () => sql(`SELECT revoked_at IS NULL FROM auth_sessions WHERE id='${sessionId(independent.cookie)}';`);
    sql(`UPDATE auth_sessions SET created_at=NOW()-INTERVAL '2 hours',expires_at=NOW()-INTERVAL '1 hour'
      WHERE id='${sessionId(expired.cookie)}';`);
    expectStatus(await refresh(expired.cookie), 401, 'SESSION_INVALID');
    assert.equal(stillActive(), 't');
    expectStatus(await call('POST', '/auth/logout', undefined, loggedOut.data.accessToken, loggedOut.cookie), 200);
    expectStatus(await refresh(loggedOut.cookie), 401, 'SESSION_INVALID');
    assert.equal(stillActive(), 't');

    const successor = await refresh(retired.cookie);
    expectStatus(successor, 200);
    expectStatus(await call('POST', '/auth/logout', undefined, successor.data.accessToken, successor.cookie), 200);
    expectStatus(await refresh(retired.cookie), 401, 'SESSION_INVALID');
    assert.equal(stillActive(), 't');
    assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE actor_id='${user.id}' AND action='SESSION_REPLAY_REJECTED';`), '0');
    expectStatus(await refresh(independent.cookie), 200);
    return { expiredRejected: true, logoutRejected: true, retiredRotationRejected: true, independentRefreshStatus: 200 };
  });
  await test('M API/DB: replayed refresh token rejects and revokes rotated refresh', async () => {
    const replayAudits = () => Number(sql(`SELECT count(*) FROM audit_logs WHERE actor_id='${account.id}' AND action='SESSION_REPLAY_REJECTED';`));
    const auditsBefore = replayAudits();
    const one = await call('POST', '/auth/login', { email: account.email, password: changedPassword }); expectStatus(one, 200);
    const rotated = await call('POST', '/auth/refresh', undefined, undefined, one.cookie); expectStatus(rotated, 200);
    assert.ok(rotated.cookie && rotated.cookie !== one.cookie, 'Refresh cookie must rotate.');
    const latest = await call('POST', '/auth/refresh', undefined, undefined, rotated.cookie); expectStatus(latest, 200);
    expectStatus(await call('POST', '/auth/refresh', undefined, undefined, one.cookie), 401);
    expectStatus(await call('POST', '/auth/refresh', undefined, undefined, rotated.cookie), 401);
    expectStatus(await call('POST', '/auth/refresh', undefined, undefined, latest.cookie), 401);
    assert.equal(replayAudits(), auditsBefore + 1);
    assert.equal(sql(`SELECT COUNT(*) FROM auth_sessions WHERE user_id='${account.id}' AND revoked_at IS NULL`), '0');
  });
  await test('T06: logout with a rotated cookie revokes the live successor only in that session chain', async () => {
    const user = await createUser();
    const signIn = () => call('POST', '/auth/login', { email: user.email, password: changedPassword });
    const refresh = cookie => call('POST', '/auth/refresh', undefined, undefined, cookie);
    const original = await signIn(), independent = await signIn();
    expectStatus(original, 200); expectStatus(independent, 200);
    const rotated = await refresh(original.cookie); expectStatus(rotated, 200);
    const latest = await refresh(rotated.cookie); expectStatus(latest, 200);
    assert.ok(original.cookie && latest.cookie && original.cookie !== latest.cookie);
    expectStatus(await call('POST', '/auth/logout', undefined, original.data.accessToken, original.cookie), 200);
    expectStatus(await refresh(latest.cookie), 401, 'SESSION_INVALID');
    expectStatus(await refresh(independent.cookie), 200);
    assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE actor_id='${user.id}' AND action='LOGOUT';`), '1');
    assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE actor_id='${user.id}' AND action='SESSION_REPLAY_REJECTED';`), '0');
    return { rotations: 2, successorRefreshStatus: 401, independentRefreshStatus: 200 };
  });
  await test('M API/DB: simultaneous refresh/access change leaves no surviving old session', async () => {
    const outcomes = [];
    for (let round = 0; round < 3; round++) {
      const user = await createUser();
      const session = await call('POST', '/auth/login', { email: user.email, password: changedPassword }); expectStatus(session, 200);
      const [rotated, changed] = await Promise.all([
        call('POST', '/auth/refresh', undefined, undefined, session.cookie),
        call('PUT', `/users/${user.id}/access`, { roles: ['APPROVER'], approverDepartmentIds: [it] }, admin.accessToken),
      ]);
      expectStatus(changed, 200); assert.ok([200, 401].includes(rotated.status), `Refresh returned ${rotated.status}.`);
      assert.equal(sql(`SELECT COUNT(*) FROM auth_sessions WHERE user_id='${user.id}' AND revoked_at IS NULL`), '0');
      expectStatus(await call('GET', '/auth/me', undefined, session.data.accessToken), 401);
      if (rotated.status === 200) {
        expectStatus(await call('GET', '/auth/me', undefined, rotated.data.accessToken), 401);
        expectStatus(await call('POST', '/auth/refresh', undefined, undefined, rotated.cookie), 401);
      }
      outcomes.push({ refresh: rotated.status, access: changed.status, survivingSessions: 0 });
    }
    return outcomes;
  });
  await test('M API/DB: controlled slow rotation cannot escape access revocation', async () => {
    const user = await createUser();
    const session = await call('POST', '/auth/login', { email: user.email, password: changedPassword }); expectStatus(session, 200);
    // The fresh DB delays only this user's new session INSERT, holding the old session
    // lock while the real access-change API runs. No HTTP responses are intercepted.
    sql(`CREATE OR REPLACE FUNCTION t30_delay_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${user.id}'::uuid THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END $$; CREATE TRIGGER t30_delay_rotation BEFORE INSERT ON auth_sessions FOR EACH ROW EXECUTE FUNCTION t30_delay_rotation()`);
    let rotatedPromise;
    try {
      rotatedPromise = call('POST', '/auth/refresh', undefined, undefined, session.cookie);
      let sleeping = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        sleeping = sql("SELECT COUNT(*) FROM pg_stat_activity WHERE datname='crypta_t30_test' AND wait_event='PgSleep' AND query LIKE 'INSERT INTO auth_sessions%'") !== '0';
        if (sleeping) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(sleeping, 'The real refresh transaction must reach the injected DB delay.');
      const changedPromise = call('PUT', `/users/${user.id}/access`, { roles: ['APPROVER'], approverDepartmentIds: [it] }, admin.accessToken);
      const [rotated, changed] = await Promise.all([rotatedPromise, changedPromise]);
      expectStatus(rotated, 200); expectStatus(changed, 200);
      assert.equal(sql(`SELECT COUNT(*) FROM auth_sessions WHERE user_id='${user.id}' AND revoked_at IS NULL`), '0');
      expectStatus(await call('GET', '/auth/me', undefined, rotated.data.accessToken), 401);
      expectStatus(await call('POST', '/auth/refresh', undefined, undefined, rotated.cookie), 401);
      return { delaySeconds: 2, databaseFaultInjection: true, refreshStatus: rotated.status, accessStatus: changed.status, survivingSessions: 0 };
    } finally {
      if (rotatedPromise) await rotatedPromise.catch(() => undefined);
      sql('DROP TRIGGER IF EXISTS t30_delay_rotation ON auth_sessions; DROP FUNCTION IF EXISTS t30_delay_rotation()');
    }
  });
  await test('M API: malformed refresh cookie returns 401', async () => {
    for (const cookie of ['invalid.secret', '%E0%A4']) {
      expectStatus(await call('POST', '/auth/refresh', undefined, undefined, `crypta_refresh=${cookie}`), 401, 'SESSION_INVALID');
    }
  });
  async function newPage(viewport = { width: 1440, height: 1000 }, sharedContext) {
    const context = sharedContext ?? await browser.newContext({ viewport }); if (!sharedContext) contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const calls = [], errors = [];
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/v1/')) calls.push(`${request.method()} ${url.pathname.slice(7)}${url.search}`); });
    page.on('pageerror', error => errors.push(error.message));
    return { context, page, calls, errors };
  }
  async function uiLogin(page, email, password = 'Password@123') {
    await page.locator('.login-card input[type=email]').fill(email);
    await page.locator('.login-card input[type=password]').fill(password);
    await page.locator('.login-card button[type=submit], .login-card button.login-submit').click();
  }
  await test('UC5 approval queue: scope, priority, search and pagination agree across UI and API', async () => {
    const search = `UC5-${randomUUID()}`;
    const normal = [];
    for (let index = 0; index < 10; index++) normal.push(await createRequest(account, `${search} in-${index}`));
    const urgent = await createRequest(account, `${search} urgent`, true);
    const foreign = await createRequest(finance, `${search} foreign`, true);
    assert.equal(urgent.departmentId, it);
    assert.notEqual(foreign.departmentId, it);
    const list = async (filters, actor = approver) => {
      const params = new URLSearchParams({ search, status: 'PENDING', pageSize: '10', ...filters });
      return expectStatus(await call('GET', `/requests?${params}`, undefined, actor.accessToken), 200);
    };
    const scope = { approvalScope: 'true' };
    const day = 86_400_000;
    const firstSubmission = Date.parse(normal[0].submittedAt);
    const from = new Date(firstSubmission - day).toISOString();
    const to = new Date(firstSubmission + day).toISOString();
    const selected = { ...scope, departmentId: it, type: 'CREATE', from, to };
    const pageOne = await list(selected);
    assert.equal(pageOne.total, 11);
    assert.deepEqual(pageOne.items.map(row => row.id), [urgent, ...normal.slice(0, 9)].map(row => row.id));
    assert.deepEqual((await list({ ...scope, page: '2' })).items.map(row => row.id), [normal.at(-1).id]);
    assert.equal((await list({ ...scope, departmentId: foreign.departmentId })).total, 0);
    assert.equal((await list({ ...scope, to: from })).total, 0);
    assert.equal((await list({ ...scope, from: to })).total, 0);
    assert.equal((await list({ ...scope, type: 'REVOKE' })).total, 0);
    assert.deepEqual((await list({ departmentId: foreign.departmentId, emergency: 'true', from, to }, admin)).items.map(row => row.id), [foreign.id]);
    const report = expectStatus(await call('POST', '/reports/preview', {
      dataset: 'REQUESTS', filters: { ...selected, search, status: 'PENDING' },
    }, approver.accessToken), 200);
    assert.equal(report.total, pageOne.total);
    assert.deepEqual(report.scope, { mode: 'DEPARTMENTS', departments: [it] });
    for (const [filter, code] of [
      ['departmentId=invalid', 'INVALID_DEPARTMENT_ID'], ['from=2026-02-30T10%3A00%3A00Z', 'INVALID_DATE'],
      [`from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`, 'INVALID_DATE'],
      ['from=2026-11-07T10%3A00%3A00', 'INVALID_DATE'], ['to=2026-11-07T10%3A00%3A00Z&to=2026-11-08T10%3A00%3A00Z', 'INVALID_FILTER'],
    ]) expectStatus(await call('GET', `/requests?${filter}`, undefined, approver.accessToken), 400, code);

    const { context, page, errors } = await newPage();
    try {
      await page.goto(new URL('/approvals?pageSize=10', origin).href);
      await uiLogin(page, approver.user.email);
      const queue = page.getByRole('region', { name: 'Hàng chờ phê duyệt', exact: true });
      await queue.getByLabel('Tìm yêu cầu', { exact: true }).fill(search);
      await queue.getByRole('button', { name: 'Tìm', exact: true }).click();
      await page.getByText('Trang 1/2 · 11 yêu cầu', { exact: true }).waitFor();
      const ids = page.locator('table tbody button.table-link');
      assert.deepEqual(await ids.allTextContents(), pageOne.items.map(row => row.id));
      await page.getByRole('button', { name: 'Sau', exact: true }).click();
      await page.getByText('Trang 2/2 · 11 yêu cầu', { exact: true }).waitFor();
      assert.deepEqual(await ids.allTextContents(), [normal.at(-1).id]);
      const filters = page.getByRole('group', { name: 'Lọc hàng chờ' });
      await filters.getByRole('button', { name: /^Khẩn cấp/ }).click();
      await page.getByText('Trang 1/1 · 1 yêu cầu', { exact: true }).waitFor();
      assert.deepEqual(await ids.allTextContents(), [urgent.id]);
      assert.equal(new URL(page.url()).searchParams.get('q'), search);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
    return { inScope: 11, foreignExcluded: true, urgentOnFirstPage: true, pageTwo: 1, urgentFilter: 1, departmentAndTimeFilters: true, reportPreviewMatches: true };
  });
  await test('NAV-22 Nginx: static assets, API and SPA deep links use separate fallbacks', async () => {
    const read = route => fetch(new URL(route, origin), { signal: AbortSignal.timeout(15000) });
    const shell = '<div id="root"></div>';
    for (const route of buildAssets) {
      const response = await read(route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type') ?? '', route.endsWith('.css') ? /^text\/css\b/ : /^(?:application|text)\/javascript\b/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(!(await response.text()).includes(shell), route);
    }
    const deepLinks = ['/assets', '/assets/', '/assets/a2222223-2222-2222-2222-222222222223',
      `/requests/${ownerRequest.id}`, '/account/reset-password'];
    for (const route of deepLinks) {
      const response = await read(route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/);
      assert.ok((await response.text()).includes(shell), route);
      if (route.startsWith('/account/')) assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    }
    const apiRoutes = [['/api/v1/health/live', 200], [`/api/v1/missing-${stamp}.js`, 404]];
    for (const [route, status] of apiRoutes) {
      const response = await read(route);
      assert.equal(response.status, status, route);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
      assert.ok(await response.json(), route);
    }
    const missingAssets = [`/assets/missing-${stamp}.js`, `/assets/chunks/missing-${stamp}.css`, `/missing-${stamp}.ico`];
    for (const route of missingAssets) {
      const response = await read(route);
      assert.equal(response.status, 404, route);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(!(await response.text()).includes(shell), route);
    }
    return { buildAssets: buildAssets.length, deepLinks: deepLinks.length, apiRoutes: apiRoutes.length, missingAssets: missingAssets.length };
  });
  await test('T30 N6: default frontend image navigates without route animation', async () => {
    const { context, page, errors } = await newPage();
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(() => {
        window.__routeAnimationCount = 0;
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          if (this.id === 'main-content') window.__routeAnimationCount++;
          return animate.apply(this, args);
        };
      });
      await page.goto(new URL('/users', origin).href);
      await uiLogin(page, admin.user.email);
      await page.waitForURL('**/users');
      await page.getByRole('heading', { name: 'Người dùng và vai trò' }).waitFor();
      await page.getByRole('link', { name: 'Audit Log', exact: true }).click();
      await page.waitForURL('**/audit');
      await page.waitForFunction(() => document.activeElement?.id === 'page-title');
      const count = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
        resolve(window.__routeAnimationCount);
      })));
      assert.equal(count, 0);
      await page.setViewportSize({ width: 390, height: 844 });
      const menu = page.getByRole('button', { name: 'Mở điều hướng', exact: true });
      await menu.press('Enter');
      await page.waitForFunction(() => document.activeElement?.closest('.sidebar-open'));
      const mobileNavigation = page.getByRole('dialog', { name: 'Điều hướng chính', exact: true });
      assert.equal(await mobileNavigation.getAttribute('aria-modal'), 'true');
      assert.equal(await page.getByRole('main').count(), 0);
      await mobileNavigation.getByRole('button', { name: 'Đóng điều hướng', exact: true }).press('Enter');
      assert.equal(await menu.evaluate(element => document.activeElement === element), true);
      await menu.press('Enter');
      const policies = mobileNavigation.getByRole('link', { name: 'Chính sách', exact: true });
      await policies.press('Enter');
      await page.waitForURL('**/policies');
      await page.waitForFunction(() => document.activeElement?.id === 'page-title');
      assert.equal(await menu.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(() => window.__routeAnimationCount), 0);
      assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), 1);
      assert.deepEqual(errors, []);
      return { routeAnimations: count, oneDocument: true, pageFocus: true, mobileKeyboardMenu: true, mobileDialog: true };
    } finally { await context.close(); }
  });
  await test('T29: dashboard counters use the email channel and charts use their displayed periods', async () => {
    const dashboard = async (role, token) => expectStatus(await call('GET', `/dashboard?role=${role}`, undefined, token), 200);
    const adminSummary = async () => expectStatus(await call('GET', '/dashboard/summary?role=ADMIN', undefined, admin.accessToken), 200);
    const before = (await adminSummary()).metrics;
    const prefix = `t29-${randomUUID()}`;
    sql(`INSERT INTO notifications(recipient_id,request_id,type,channel,delivery_status,deduplication_key,failed_at)
      SELECT '${account.id}', '${ownerRequest.id}', 'REQUEST_APPROVED', channel, status,
        '${prefix}-' || channel || '-' || status, CASE WHEN status='FAILED' THEN NOW() END
      FROM (VALUES ('EMAIL'),('IN_APP')) AS channels(channel)
      CROSS JOIN (VALUES ('FAILED'),('RECONCILIATION_REQUIRED')) AS statuses(status);`);
    try {
      const metrics = (await adminSummary()).metrics;
      assert.equal(metrics.failed_jobs, before.failed_jobs + 1);
      assert.equal(metrics.email_reconciliation, before.email_reconciliation + 1);
      const listed = expectStatus(await call('GET', '/notifications/delivery-issues?page=1&pageSize=1', undefined, admin.accessToken), 200);
      assert.equal(metrics.failed_jobs + metrics.email_reconciliation, listed.total);
      const ownerData = await dashboard('USER', dev.accessToken);
      const approverData = await dashboard('APPROVER', approver.accessToken);
      const adminData = await dashboard('ADMIN', admin.accessToken);
      const statusCounts = JSON.parse(sql(`SELECT json_object_agg(status,n) FROM (
        SELECT status,count(*) AS n FROM crypto_assets GROUP BY status) counts;`));
      assert.deepEqual(Object.fromEntries(adminData.composition.map(({ label, value }) => [label, value])), statusCounts);
      assert.equal(adminData.composition.length, Object.keys(statusCounts).length);
      assert.equal(adminData.metrics.total_assets, Object.values(statusCounts).reduce((total, value) => total + value, 0));
      assert.equal(adminData.metrics.expiring, statusCounts.EXPIRING_SOON ?? 0);
      assert.equal(metrics.total_assets, adminData.metrics.total_assets);
      assert.equal(metrics.expiring, adminData.metrics.expiring);
      assert.ok(!Object.hasOwn(metrics, 'composition'));
      for (const [session, label, total, unit] of [
        [dev, 'Yêu cầu tháng này', ownerData.trend.at(-1).value, 'yêu cầu'],
        [approver, 'Quyết định trong 7 ngày', approverData.trend.reduce((sum, item) => sum + item.value, 0), 'quyết định'],
        [admin, 'Tài sản hiện tại', adminData.metrics.total_assets, 'tài sản'],
      ]) {
        const { context, page, errors } = await newPage();
        try {
          await page.goto(new URL('/dashboard', origin).href);
          await uiLogin(page, session.user.email);
          const ready = page.locator('[aria-label="Tổng quan"][aria-busy="false"]');
          const trend = ready.locator('.trend-summary').filter({ hasText: label });
          await trend.waitFor();
          assert.equal(await trend.locator('strong').textContent(), String(total));
          const chart = ready.locator('.trend-card');
          await chart.getByText(/Múi giờ Asia\/Ho_Chi_Minh/).waitFor();
          const points = await chart.locator('svg circle title').allTextContents();
          assert.equal(points.length, session === approver ? 7 : 6);
          const periodPattern = session === approver ? /\d+\/\d+\/\d+:/ : /\d{4}:/;
          assert.ok(points.every(point => point.endsWith(unit) && periodPattern.test(point)));
          const labelText = await chart.getByRole('img').getAttribute('aria-label');
          assert.ok(points.every(point => labelText.includes(point)));
          await chart.screenshot({ path: path.join(output, `t29-${unit === 'yêu cầu' ? 'owner' : unit === 'quyết định' ? 'approver' : 'admin'}.png`), animations: 'disabled' });
          if (session === approver) {
            const donut = ready.locator('.composition-card').filter({ hasText: 'Kết quả 30 ngày' });
            assert.equal(await donut.locator('.donut-chart strong').textContent(), String(approverData.metrics.approved + approverData.metrics.rejected));
            assert.equal(await donut.getByText('Chờ xử lý', { exact: true }).count(), 0);
          }
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      }
    } finally {
      sql(`DELETE FROM notifications WHERE deduplication_key LIKE '${prefix}-%';`);
    }
    return { emailChannelOnly: true, ownerMonth: true, approverSevenDays: true, decisionsThirtyDays: true, adminAssetTotal: true, chartLabels: 3 };
  });
  await test('T29: calendar trends assign midnight boundaries in the application timezone for all roles', async () => {
    const actors = [['USER', dev], ['APPROVER', approver], ['ADMIN', admin]];
    const trends = () => Promise.all(actors.map(async ([role, actor]) =>
      expectStatus(await call('GET', `/dashboard?role=${role}`, undefined, actor.accessToken), 200)));
    const bounds = JSON.parse(sql(`WITH dates AS (SELECT
      date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '1 month' AS month_start,
      date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '2 days' AS day_start)
      SELECT json_build_object('month',month_start AT TIME ZONE 'Asia/Ho_Chi_Minh',
        'previousMonth',to_char(month_start - INTERVAL '1 month','YYYY-MM'),
        'currentMonth',to_char(month_start,'YYYY-MM'),
        'day',day_start AT TIME ZONE 'Asia/Ho_Chi_Minh',
        'previousDay',to_char(day_start - INTERVAL '1 day','YYYY-MM-DD'),
        'currentDay',to_char(day_start,'YYYY-MM-DD')) FROM dates;`));
    const month = `'${bounds.month}'::timestamptz`, day = `'${bounds.day}'::timestamptz`;
    const prefix = `t29-calendar-${randomUUID()}`;
    const decisionRequestIds = [randomUUID(), randomUUID()];
    const decisionRequests = decisionRequestIds.map(id => `'${id}'`).join(',');
    const before = await trends();
    try {
      sql(`BEGIN;
        INSERT INTO requests(request_type,creator_id,department_id,policy_version_id,status,reason,submitted_at)
        SELECT 'CREATE','${dev.user.id}','${it}','${policy.id}','CANCELLED','${prefix}',
          CASE WHEN n=0 THEN ${month} - INTERVAL '1 millisecond' ELSE ${month} END
        FROM generate_series(0,321) n;
        INSERT INTO requests(request_type,creator_id,department_id,policy_version_id,status,reason,submitted_at)
        SELECT 'CREATE','${finance.user.id}','${finance.user.departmentId}','${policy.id}','CANCELLED','${prefix}',${month}
        FROM generate_series(1,287);
        INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,reason)
        SELECT id::uuid,'CREATE','${account.user.id}','${it}','${policy.id}','${prefix}'
        FROM unnest(ARRAY[${decisionRequests}]) AS requests(id);
        INSERT INTO request_decisions(request_id,approver_id,decision,decided_at)
        VALUES ('${decisionRequestIds[0]}','${approver.user.id}','APPROVED',${day}-INTERVAL '1 millisecond'),
          ('${decisionRequestIds[1]}','${approver.user.id}','APPROVED',${day});
        INSERT INTO crypto_assets(asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,valid_from,expires_at,created_at)
        SELECT '${prefix}-'||n,'KEY','${account.user.id}','${it}','${policy.id}','${prefix}',NOW(),NOW()+INTERVAL '1 day',
          CASE WHEN n=0 THEN ${month} - INTERVAL '1 millisecond' ELSE ${month} END
        FROM generate_series(0,401) n;
        COMMIT;`);
      const after = await trends();
      const expected = [
        [6, { [bounds.previousMonth]: 1, [bounds.currentMonth]: 321 }],
        [7, { [bounds.previousDay]: 1, [bounds.currentDay]: 1 }],
        [6, { [bounds.previousMonth]: 1, [bounds.currentMonth]: 401 }],
      ];
      after.forEach((data, index) => {
        const [count, deltas] = expected[index];
        assert.equal(data.trend.length, count);
        const original = new Map(before[index].trend.map(row => [row.period, row.value]));
        assert.deepEqual(data.trend.map(row => row.period), [...original.keys()]);
        const changed = Object.fromEntries(data.trend.filter(row => row.value !== original.get(row.period))
          .map(row => [row.period, row.value - original.get(row.period)]));
        assert.deepEqual(changed, deltas);
        assert.equal(data.trendTimeZone, 'Asia/Ho_Chi_Minh');
      });
      assert.equal(after[1].metrics.approved, before[1].metrics.approved + 2);
      assert.equal(after[2].metrics.total_assets, before[2].metrics.total_assets + 402);
      return { zone: 'Asia/Ho_Chi_Minh', localMidnightExact: true, ownerRequests: 322, foreignRequests: 287, assets: 402,
        decisions: 2, buckets: after.map(({ role, trend }) => ({ role, periods: trend.length })) };
    } finally {
      sql(`BEGIN;
        ALTER TABLE request_decisions DISABLE TRIGGER trg_request_decision_immutable;
        DELETE FROM request_decisions WHERE request_id IN (${decisionRequests});
        ALTER TABLE request_decisions ENABLE TRIGGER trg_request_decision_immutable;
        DELETE FROM requests WHERE reason='${prefix}';
        DELETE FROM crypto_assets WHERE purpose='${prefix}';
        COMMIT;`);
    }
  });
  await test('T28: queue status counts only SMTP and exposes a protected shared worker sample', async () => {
    const base = '/notifications/status', prefix = `t28-queue-${randomUUID()}`;
    const status = async () => expectStatus(await call('GET', base, undefined, admin.accessToken), 200);
    expectStatus(await call('GET', base, undefined, dev.accessToken), 403, 'ADMIN_REQUIRED');
    const before = await status();
    sql(`INSERT INTO notifications(recipient_id,request_id,type,channel,delivery_status,deduplication_key,scheduled_for,failed_at,sent_at)
      SELECT '${account.user.id}','${ownerRequest.id}','REQUEST_APPROVED',channel,status,'${prefix}-'||channel||'-'||status,
        NOW()-INTERVAL '8 minutes',CASE WHEN status='FAILED' THEN NOW() END,CASE WHEN status='SENT' THEN NOW() END
      FROM (VALUES ('EMAIL'),('IN_APP')) AS channels(channel)
      CROSS JOIN (VALUES ('PENDING'),('SENDING'),('FAILED'),('SENT'),('RECONCILIATION_REQUIRED')) AS statuses(status);`);
    try {
      const result = await status();
      for (const name of ['PENDING', 'SENDING', 'FAILED', 'SENT', 'RECONCILIATION_REQUIRED']) {
        assert.equal(result.queue[name], (before.queue[name] ?? 0) + 1);
      }
      assert.ok(result.oldestDueSeconds >= 480);
      assert.ok(Math.abs(Date.now() - Date.parse(result.lastFailedAt)) < 30_000);
      assert.equal(result.smtpEnabled, false);
      assert.equal(result.queueDelayed, false);
      assert.equal(result.worker.state, 'DISABLED');
      assert.ok(Number.isFinite(Date.parse(result.collectedAt)));
      return { adminOnly: true, smtpCounts: 5, disabledWorker: true, delayedWarningSuppressedWhenDisabled: true };
    } finally { sql(`DELETE FROM notifications WHERE deduplication_key LIKE '${prefix}-%';`); }
  });
  await test('T28: only Admin can read redacted SMTP delivery detail', async () => {
    const rejected = randomUUID(), unknown = randomUUID(), inApp = randomUUID();
    sql(`INSERT INTO notifications(id,recipient_id,request_id,type,channel,deduplication_key,delivery_status,
      attempt_count,claimed_at,failed_at,sent_at,error_message)
      VALUES ('${rejected}','${account.user.id}','${ownerRequest.id}','REQUEST_APPROVED','EMAIL','${rejected}',
        'FAILED',1,NOW(),NOW(),NULL,'SMTP rejected delivery (550)'),
      ('${unknown}','${account.user.id}','${ownerRequest.id}','REQUEST_APPROVED','EMAIL','${unknown}',
        'RECONCILIATION_REQUIRED',2,NOW(),NULL,NULL,'raw diagnostic: relay.example.invalid'),
      ('${inApp}','${account.user.id}','${ownerRequest.id}','REQUEST_APPROVED','IN_APP','${inApp}',
        'SENT',0,NULL,NULL,NOW(),NULL);`);
    try {
      const route = id => `/notifications/delivery-issues/${id}`;
      for (const actor of [account, approver]) {
        expectStatus(await call('GET', route(unknown), undefined, actor.accessToken), 403, 'ADMIN_REQUIRED');
      }
      for (const id of [inApp, randomUUID()]) {
        expectStatus(await call('GET', route(id), undefined, admin.accessToken), 404, 'EMAIL_DELIVERY_NOT_FOUND');
      }
      const details = await Promise.all([rejected, unknown].map(async id => {
        const response = await fetch(new URL(`/api/v1${route(id)}`, origin), {
          headers: { Authorization: `Bearer ${admin.accessToken}` }, signal: AbortSignal.timeout(15_000),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const { data } = await response.json();
        assert.equal(data.messageIdPrefix, `notification-${id}`);
        assert.ok(!JSON.stringify(data).includes('relay.example.invalid'));
        assert.ok(!Object.hasOwn(data, 'error_message'));
        assert.ok(data.claimedAt);
        return data;
      }));
      assert.deepEqual(details.map(({ status, attemptCount, smtpStatus, failure }) => [status, attemptCount, smtpStatus, failure]), [
        ['FAILED', 1, 550, 'SMTP_PERMANENT_REJECTION'], ['RECONCILIATION_REQUIRED', 2, null, 'OUTCOME_UNKNOWN'],
      ]);
      return { adminOnly: true, emailChannelOnly: true, noStore: true, diagnosticRedacted: true, messageIdLookupPrefix: true };
    } finally {
      sql(`DELETE FROM notifications WHERE id IN ('${rejected}','${unknown}','${inApp}');`);
    }
  });
  await test('T28: reconciliation commits one evidenced decision and rolls back on audit failure', async () => {
    const accepted = randomUUID(), unsent = randomUUID(), fault = randomUUID();
    const ids = [accepted, unsent, fault].map(id => `'${id}'`).join(',');
    const secondAdmin = await login('ciso@congty.com');
    const pathFor = id => `/notifications/delivery-issues/${id}`;
    const resolve = (id, body, actor = admin) => call('POST', `${pathFor(id)}/reconcile`, body, actor.accessToken);
    const acceptedAt = new Date(Date.now() - 60_000).toISOString();
    const acceptedDto = { outcome: 'ACCEPTED', attemptCount: 2, evidenceReference: 'SMTP-T28-2041', acceptedAt };
    const unsentDto = { outcome: 'UNSENT', attemptCount: 2, evidenceReference: 'SMTP-T28-2042' };
    sql(`INSERT INTO notifications(id,recipient_id,request_id,type,channel,deduplication_key,delivery_status,
      attempt_count,created_at,claimed_at) SELECT id::uuid,'${account.user.id}','${ownerRequest.id}',
      'REQUEST_APPROVED','EMAIL',id,'RECONCILIATION_REQUIRED',2,NOW()-INTERVAL '2 minutes',NOW()-INTERVAL '90 seconds'
      FROM unnest(ARRAY[${ids}]::text[]) AS test(id);`);
    try {
      expectStatus(await resolve(accepted, acceptedDto, approver), 403, 'ADMIN_REQUIRED');
      expectStatus(await resolve(accepted, { ...acceptedDto, attemptCount: 1 }), 409, 'EMAIL_DELIVERY_CHANGED');
      expectStatus(await resolve(accepted, { ...acceptedDto, acceptedAt: '2020-01-01T00:00:00Z' }), 400, 'EMAIL_ACCEPTANCE_TIME_INVALID');
      expectStatus(await resolve(accepted, { ...acceptedDto, acceptedAt: undefined }), 400, 'EMAIL_ACCEPTANCE_TIME_INVALID');
      expectStatus(await resolve(unsent, { ...unsentDto, acceptedAt }), 400, 'EMAIL_ACCEPTANCE_TIME_INVALID');
      expectStatus(await resolve(unsent, { ...unsentDto, evidenceReference: 'invalid@example.test' }), 400);
      expectStatus(await resolve(randomUUID(), unsentDto), 404, 'EMAIL_DELIVERY_NOT_FOUND');
      const attempts = await Promise.all([resolve(accepted, acceptedDto), resolve(accepted, acceptedDto, secondAdmin)]);
      assert.deepEqual(attempts.map(response => response.status).sort(), [201, 409]);
      assert.deepEqual(expectStatus(attempts.find(response => response.status === 201), 201), { id: accepted, status: 'SENT' });
      expectStatus(attempts.find(response => response.status === 409), 409, 'EMAIL_DELIVERY_CHANGED');
      assert.deepEqual(expectStatus(await resolve(unsent, unsentDto), 201), { id: unsent, status: 'FAILED' });
      const detail = async id => expectStatus(await call('GET', pathFor(id), undefined, admin.accessToken), 200);
      assert.equal((await detail(accepted)).sentAt, acceptedAt);
      assert.equal((await detail(unsent)).failure, 'VERIFIED_UNSENT');

      sql(`CREATE FUNCTION t28_reject_delivery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.entity_type='EMAIL_DELIVERY' AND NEW.entity_id='${fault}' THEN RAISE EXCEPTION 'T28 audit fixture'; END IF;
        RETURN NEW; END $$;
        CREATE TRIGGER t28_reject_delivery_audit BEFORE INSERT ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION t28_reject_delivery_audit();`);
      try { expectStatus(await resolve(fault, unsentDto), 500); }
      finally { sql('DROP TRIGGER t28_reject_delivery_audit ON audit_logs; DROP FUNCTION t28_reject_delivery_audit();'); }
      assert.equal((await detail(fault)).status, 'RECONCILIATION_REQUIRED');
      const audit = JSON.parse(sql(`SELECT json_agg(json_build_object('id',entity_id,'actor',actor_id,'action',action,'metadata',metadata) ORDER BY id)
        FROM audit_logs WHERE entity_type='EMAIL_DELIVERY' AND entity_id IN (${ids});`));
      assert.equal(audit.length, 2);
      assert.equal(audit[0].id, accepted);
      assert.equal(audit[0].actor, attempts[0].status === 201 ? admin.user.id : secondAdmin.user.id);
      assert.equal(audit[0].action, 'EMAIL_DELIVERY_ACCEPTED_CONFIRMED');
      assert.equal(audit[0].metadata.acceptedAt, acceptedAt);
      assert.equal(audit[0].metadata.evidenceReference, acceptedDto.evidenceReference);
      assert.match(audit[0].metadata.correlationId, /^req_[a-f0-9-]{36}$/);
      assert.equal(audit[1].id, unsent);
      assert.equal(audit[1].action, 'EMAIL_DELIVERY_UNSENT_CONFIRMED');
      assert.equal(audit[1].metadata.evidenceReference, unsentDto.evidenceReference);
      assert.equal(sql(`SELECT count(*) FROM notifications WHERE id IN (${ids}) AND (attempt_count<>2 OR delivery_status='PENDING')`), '0');
      return { concurrentAdmins: 2, confirmedAuditEvents: 2, rollbackOnAuditFailure: true, queuedForRetry: 0 };
    } finally {
      sql(`DELETE FROM notifications WHERE id IN (${ids});`);
    }
  });
  await test('T28: email retry requires matching evidence and queues exactly one audited action', async () => {
    const [eligible, exhausted, missingEvidence, auditFault] = Array.from({ length: 4 }, () => randomUUID());
    const ids = [eligible, exhausted, missingEvidence, auditFault].map(id => `'${id}'`).join(',');
    const secondAdmin = await login('ciso@congty.com');
    const delivery = id => `/notifications/delivery-issues/${id}`;
    const reference = 'SMTP-T28-RETRY';
    const proof = { attemptCount: 2, evidenceReference: reference };
    const retry = (id, dto = proof, actor = admin) => call('POST', `${delivery(id)}/retry`, dto, actor.accessToken);
    const detail = async id => expectStatus(await call('GET', delivery(id), undefined, admin.accessToken), 200);
    sql(`INSERT INTO notifications(id,recipient_id,request_id,type,channel,deduplication_key,delivery_status,attempt_count)
      SELECT id::uuid,'${account.user.id}','${ownerRequest.id}','REQUEST_APPROVED','EMAIL',id,'RECONCILIATION_REQUIRED',
        CASE WHEN id='${exhausted}' THEN 5 ELSE 2 END FROM unnest(ARRAY[${ids}]::text[]) AS fixture(id);`);
    try {
      const denied = await retry(eligible, proof, approver);
      expectStatus(denied, 403, 'ADMIN_REQUIRED');
      assert.match(denied.requestId, /^req_[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
      assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE action='HTTP_REQUEST_DENIED'
        AND actor_id='${approver.user.id}' AND entity_id='/api/v1/notifications/delivery-issues/:id/retry'
        AND metadata->>'correlationId'='${denied.requestId}';`), '1');
      expectStatus(await retry(eligible), 409, 'EMAIL_DELIVERY_CHANGED');
      for (const [id, attemptCount] of [[eligible, 2], [exhausted, 5], [auditFault, 2]]) {
        expectStatus(await call('POST', `${delivery(id)}/reconcile`, { ...proof, attemptCount, outcome: 'UNSENT' }, admin.accessToken), 201);
      }
      sql(`UPDATE notifications SET delivery_status='FAILED',failed_at=NOW(),
        error_message='SMTP did not accept delivery (operator verified)' WHERE id='${missingEvidence}';`);
      assert.deepEqual((await detail(eligible)).retry, { evidenceReference: reference, delaySeconds: 120, maxAttempts: 5 });
      assert.equal((await detail(exhausted)).retry, null);
      assert.equal((await detail(missingEvidence)).retry, null);
      expectStatus(await retry(exhausted, { ...proof, attemptCount: 5 }), 409, 'EMAIL_RETRY_INELIGIBLE');
      expectStatus(await retry(missingEvidence), 409, 'EMAIL_RETRY_INELIGIBLE');
      expectStatus(await retry(eligible, { ...proof, evidenceReference: 'SMTP-WRONG' }), 409, 'EMAIL_RETRY_INELIGIBLE');
      expectStatus(await retry(eligible, { ...proof, attemptCount: 1 }), 409, 'EMAIL_DELIVERY_CHANGED');
      const results = await Promise.all([retry(eligible), retry(eligible, proof, secondAdmin)]);
      assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
      const queued = expectStatus(results.find(result => result.status === 201), 201);
      assert.equal(queued.id, eligible);
      assert.equal(queued.status, 'PENDING');
      const persisted = await detail(eligible);
      assert.equal(persisted.attemptCount, 2);
      assert.equal(persisted.retry, null);
      assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE action='EMAIL_DELIVERY_RETRY_SCHEDULED'
        AND entity_id='${eligible}' AND metadata->>'evidenceReference'='${reference}'
        AND (metadata->>'scheduledFor')::timestamptz >= occurred_at + INTERVAL '119 seconds';`), '1');
      sql(`CREATE FUNCTION t28_reject_email_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action='EMAIL_DELIVERY_RETRY_SCHEDULED' AND NEW.entity_id='${auditFault}' THEN RAISE EXCEPTION 'retry audit fixture'; END IF;
        RETURN NEW; END $$;
        CREATE TRIGGER t28_reject_email_retry_audit BEFORE INSERT ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION t28_reject_email_retry_audit();`);
      try { expectStatus(await retry(auditFault), 500); }
      finally { sql('DROP TRIGGER t28_reject_email_retry_audit ON audit_logs; DROP FUNCTION t28_reject_email_retry_audit();'); }
      assert.equal((await detail(auditFault)).status, 'FAILED');
      return { concurrentAdmins: 2, schedules: 1, attemptCountUnchanged: true, rollbackOnAuditFailure: true, requiresMatchingEvidence: true };
    } finally { sql(`DELETE FROM notifications WHERE id IN (${ids});`); }
  });
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
    await test(`T28 UI: email delivery detail and evidence on ${width}px ${theme}`, async () => {
      const unknown = randomUUID(), failed = randomUUID();
      const acceptedAt = new Date(Date.now() - 60_000).toISOString().slice(0, 19);
      const evidence = `SMTP-T28-${width}`;
      sql(`INSERT INTO notifications(id,recipient_id,request_id,type,channel,deduplication_key,delivery_status,
        attempt_count,created_at,claimed_at,failed_at,error_message)
        VALUES ('${unknown}','${account.user.id}','${ownerRequest.id}','REQUEST_APPROVED','EMAIL','${unknown}',
          'RECONCILIATION_REQUIRED',2,NOW()-INTERVAL '2 minutes',NOW()-INTERVAL '90 seconds',NULL,'raw diagnostic: relay.example.invalid'),
        ('${failed}','${account.user.id}','${ownerRequest.id}','REQUEST_APPROVED','EMAIL','${failed}',
          'FAILED',1,NOW(),NOW(),NOW(),'SMTP rejected delivery (550)');`);
      const { context, page, calls, errors } = await newPage({ width, height: 900 });
      await context.addInitScript(value => localStorage.setItem('crypta-theme', value), theme);
      const deliveryPath = id => `/notifications/delivery-issues/${id}`;
      const detailButton = id => page.getByRole('button', { name: `Xem chi tiết Yêu cầu đã được duyệt · ${id}` });
      const dialog = page.getByRole('dialog', { name: 'Chi tiết lần gửi' });
      const close = () => dialog.getByRole('button', { name: 'Đóng', exact: true });
      const submit = () => dialog.getByRole('button', { name: 'Ghi kết quả' });
      const referenceInput = () => dialog.getByRole('textbox', { name: /Mã phiếu đối soát/ });
      const requestCount = () => calls.filter(call => call === `POST ${deliveryPath(unknown)}/reconcile`).length;
      try {
        await page.goto(new URL('/operations/email', origin).href);
        await uiLogin(page, 'admin@congty.com');
        await page.getByRole('heading', { level: 1, name: 'Email cần xử lý' }).waitFor();
        await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
        const queue = page.getByRole('region', { name: 'Tình trạng hàng đợi' });
        await queue.getByText(/SMTP đang tắt/).waitFor();
        await queue.getByText(/Lấy số liệu lúc/).waitFor();
        await queue.screenshot({ path: path.join(output, `t28-queue-${width}-${theme}.png`), animations: 'disabled' });
        const failPath = '**/api/v1' + deliveryPath(failed);
        await page.route(failPath, route => route.fulfill({ status: 503, json: { error: {
          code: 'TEST_UNAVAILABLE', message: 'Chi tiết tạm thời không khả dụng.',
        } } }), { times: 1 });
        const failedButton = detailButton(failed);
        await failedButton.focus();
        await page.keyboard.press('Enter');
        await dialog.getByRole('alert').filter({ hasText: /Chi tiết tạm thời/ }).waitFor();
        await dialog.getByRole('button', { name: 'Thử tải lại' }).click();
        await dialog.getByText('SMTP từ chối vĩnh viễn (550).').waitFor();
        assert.equal(await submit().count(), 0);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await failedButton.evaluate(element => new Promise(resolve => requestAnimationFrame(resolve)));
        assert.equal(await failedButton.evaluate(element => document.activeElement === element), true);

        await detailButton(unknown).click();
        await dialog.getByText(`notification-${unknown}`, { exact: true }).waitFor();
        assert.equal(await dialog.getByText(/relay\.example\.invalid/).count(), 0);
        await close().focus();
        await page.keyboard.press('Shift+Tab');
        assert.equal(await submit().evaluate(element => document.activeElement === element), true);
        await page.keyboard.press('Tab');
        assert.equal(await close().evaluate(element => document.activeElement === element), true);
        const selection = dialog.getByRole('combobox', { name: 'Kết quả đã xác minh' });
        const outcome = width === 1440 ? 'ACCEPTED' : 'UNSENT';
        await selection.selectOption(outcome);
        const timestamp = dialog.getByLabel('Thời điểm SMTP chấp nhận (UTC)');
        if (outcome === 'ACCEPTED') await timestamp.fill(acceptedAt);
        else assert.equal(await timestamp.count(), 0);
        await referenceInput().fill(evidence);
        await page.keyboard.press('Escape');
        await page.getByRole('alertdialog').getByRole('button', { name: 'Ở lại' }).click();
        assert.equal(await referenceInput().inputValue(), evidence);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
        assert.equal(await dialog.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight + 1;
        }), true, 'Dialog must stay inside the viewport');
        // Measure the laid-out target, independently of the dialog's entrance transform.
        assert.ok(await submit().evaluate(element => element.offsetHeight) >= 44);
        await page.screenshot({ path: path.join(output, `t28-email-delivery-${width}-${theme}.png`), animations: 'disabled' });

        if (outcome === 'ACCEPTED') {
          sql(`UPDATE notifications SET attempt_count=3 WHERE id='${unknown}';`);
          await submit().click();
          await dialog.getByRole('alert').filter({ hasText: /Trạng thái lần gửi đã thay đổi/ }).waitFor();
          assert.equal(await referenceInput().inputValue(), evidence);
          assert.equal(await submit().isDisabled(), true);
          await dialog.getByRole('button', { name: 'Tải lại chi tiết', exact: true }).click();
          await dialog.getByText(/^3 lượt/).waitFor();
          assert.equal(await referenceInput().inputValue(), evidence);
          assert.equal(new Date((await timestamp.inputValue()) + 'Z').toISOString(), acceptedAt + '.000Z');
        }
        await submit().click();
        await dialog.waitFor({ state: 'hidden' });
        await page.getByText('Đã ghi kết quả đối soát email.', { exact: true }).waitFor();
        await page.waitForFunction(() => document.activeElement?.id === 'email-health-title');
        const expectedStatus = outcome === 'ACCEPTED' ? 'SENT' : 'FAILED';
        const details = expectStatus(await call('GET', deliveryPath(unknown), undefined, admin.accessToken), 200);
        assert.equal(details.status, expectedStatus);
        assert.equal(details.sentAt, outcome === 'ACCEPTED' ? acceptedAt + '.000Z' : null);
        assert.equal(details.attemptCount, outcome === 'ACCEPTED' ? 3 : 2);
        assert.equal(requestCount(), outcome === 'ACCEPTED' ? 2 : 1);
        assert.equal(calls.filter(call => call === 'POST /notifications/test-email').length, 0);
        assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_type='EMAIL_DELIVERY' AND entity_id='${unknown}'
          AND metadata->>'evidenceReference'='${evidence}' AND metadata->>'correlationId' IS NOT NULL;`), '1');
        if (outcome === 'ACCEPTED') await detailButton(unknown).waitFor({ state: 'hidden' });
        else {
          await detailButton(unknown).click();
          await dialog.getByText('Quản trị viên đã xác minh SMTP chưa chấp nhận thư.').waitFor();
          assert.equal(await submit().count(), 0);
          const retry = dialog.getByRole('button', { name: 'Lên lịch gửi lại' });
          await retry.focus();
          await page.keyboard.press('Enter');
          const confirmation = page.getByRole('dialog', { name: 'Xác nhận gửi lại' });
          const confirm = confirmation.getByRole('button', { name: 'Lên lịch gửi lại' });
          assert.equal(await confirm.isDisabled(), true);
          await page.keyboard.press('Escape');
          await retry.waitFor();
          await page.waitForFunction(() => document.activeElement?.textContent === 'Lên lịch gửi lại');
          await retry.click();
          await confirmation.getByRole('checkbox', { name: /Tôi đã đối chiếu mã phiếu/ }).check();
          await page.screenshot({ path: path.join(output, 't28-email-retry-390-dark.png'), animations: 'disabled' });
          await confirm.click();
          await confirmation.waitFor({ state: 'hidden' });
          await page.getByText(/Đã lên lịch gửi lại email/).waitFor();
          const queued = expectStatus(await call('GET', deliveryPath(unknown), undefined, admin.accessToken), 200);
          assert.equal(queued.status, 'PENDING');
          assert.equal(queued.attemptCount, 2);
          assert.equal(calls.filter(call => call === `POST ${deliveryPath(unknown)}/retry`).length, 1);
        }
        assert.deepEqual(errors, []);
        return { width, theme, expectedStatus, evidenceAuditEvents: 1, conflictPreservedDraft: outcome === 'ACCEPTED', keyboard: true, layout: true };
      } finally {
        await context.close();
        sql(`DELETE FROM notifications WHERE id IN ('${unknown}','${failed}');`);
      }
    });
  }
  await test('T22: audit search, redacted event detail and export use the same scope and filters', async () => {
    const user = await createUser(['USER'], [], false);
    const disabled = await call('PATCH', `/users/${user.id}/status`, { status: 'INACTIVE' }, admin.accessToken);
    expectStatus(disabled, 200);
    assert.match(disabled.requestId, /^req_[a-f0-9-]{36}$/);
    expectStatus(await call('PATCH', `/users/${user.id}/status`, { status: 'ACTIVE' }, admin.accessToken), 200);
    const filters = { actor: admin.user.displayName, action: 'USER_STATUS_CHANGED', entity: user.id, outcome: 'SUCCESS' };
    const query = new URLSearchParams({ ...filters, page: '2', pageSize: '1' });
    const second = expectStatus(await call('GET', `/audit-logs?${query}`, undefined, admin.accessToken), 200);
    assert.equal(second.total, 2);
    assert.equal(second.items[0].correlationId, disabled.requestId);
    const id = second.items[0].id;
    expectStatus(await call('GET', `/audit-logs/${id}`, undefined, approver.accessToken), 403, 'ADMIN_REQUIRED');
    expectStatus(await call('GET', `/audit-logs/${id}`, undefined, dev.accessToken), 403, 'ADMIN_REQUIRED');
    const event = expectStatus(await call('GET', `/audit-logs/${id}`, undefined, admin.accessToken), 200);
    assert.deepEqual(event.changes, [{ field: 'status', before: 'ACTIVE', after: 'INACTIVE' }]);
    assert.deepEqual(event.related, { kind: 'USER', id: user.id });
    assert.ok(!Object.hasOwn(event, 'metadata'));
    const exact = { ...filters, correlationId: disabled.requestId, from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString() };
    const filtered = expectStatus(await call('GET', `/audit-logs?${new URLSearchParams(exact)}`, undefined, admin.accessToken), 200);
    const preview = expectStatus(await call('POST', '/reports/preview', { dataset: 'AUDIT', filters: exact }, admin.accessToken), 200);
    assert.equal(filtered.items[0].id, id);
    assert.equal(preview.total, 1);
    assert.equal(preview.total, filtered.total);

    for (const width of [1440, 390]) {
      const { context, page, errors } = await newPage({ width, height: 900 });
      try {
        if (width === 390) await page.addInitScript(() => localStorage.setItem('crypta-theme', 'dark'));
        await page.goto(new URL('/audit', origin).href);
        await uiLogin(page, admin.user.email);
        if (width === 1440) {
          await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
          const reportDialog = page.getByRole('dialog', { name: 'Xuất báo cáo' });
          const create = reportDialog.getByRole('button', { name: 'Tạo báo cáo', exact: true });
          await page.waitForFunction(button => !button.disabled, await create.elementHandle());
          await page.keyboard.press('Escape');
          await reportDialog.waitFor({ state: 'hidden' });
        }
        await page.getByText('Bộ lọc nâng cao', { exact: true }).click();
        await page.getByLabel('Mã truy vết HTTP', { exact: true }).fill(disabled.requestId);
        await page.getByLabel('Mã đối tượng', { exact: true }).fill(user.id);
        await page.getByRole('button', { name: 'Áp dụng' }).click();
        await page.waitForURL(url => url.searchParams.get('correlationId') === disabled.requestId);
        await page.reload();
        const audit = page.getByRole('region', { name: 'Audit Log', exact: true });
        await audit.getByRole('status').filter({ hasText: 'Đã tìm thấy 1 sự kiện.' }).waitFor();
        const trigger = page.getByRole('button', { name: 'USER_STATUS_CHANGED', exact: true });
        await trigger.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Chi tiết sự kiện' });
        await dialog.getByRole('status').filter({ hasText: 'Đã tải chi tiết sự kiện.' }).waitFor();
        await dialog.getByText('Đã vô hiệu hóa', { exact: true }).waitFor();
        assert.ok(await dialog.getByText('Đang hoạt động', { exact: true }).isVisible());
        assert.ok(await dialog.getByText(disabled.requestId, { exact: true }).isVisible());
        assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth));
        await page.screenshot({ path: path.join(output, `audit-detail-${width}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(element => document.activeElement === element, await trigger.elementHandle());
        await trigger.click();
        await dialog.getByRole('link', { name: 'Mở tài khoản liên quan' }).click();
        await page.waitForURL(url => url.pathname === '/users' && url.searchParams.get('userId') === user.id);
        await page.getByText(user.email, { exact: true }).waitFor();
        assert.equal(await page.getByRole('table').locator('tbody tr').count(), 1);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    return { secondPage: true, noRawMetadata: true, adminOnly: true, reportMatches: true, accessibleStatus: true, browserWidths: [1440, 390] };
  });
  await test('X02: scoped Approvers advance separate levels and worker only runs after both', async () => {
    const second = await createUser(['APPROVER'], [it]);
    const foreign = await createUser(['APPROVER'], [finance.user.departmentId]);
    const policyBody = { code:`X02_${stamp.slice(0,8)}`, name:'Chính sách thử duyệt hai cấp', algorithm:'RSA',
      minimumKeySize:2048, maximumValidityDays:365, warningDays:[30], approvalLevels:2 };
    const approvalPolicy = expectStatus(await call('POST','/policies',policyBody,admin.accessToken),201);
    try {
      assert.equal(approvalPolicy.latest.configuration.approval_deadline_hours,48);
      const request = expectStatus(await call('POST','/requests',{
        type:'CREATE', policyVersionId:approvalPolicy.latest.id, reason:`Yêu cầu X02 ${stamp}`,
        parameters:{assetType:'KEY',algorithm:'RSA',keySize:2048,validityDays:90},
      },account.accessToken),201);
      const route = `/requests/${request.id}`;
      const decide = (actor, version, decision = 'APPROVED', comment) => call('POST',route+'/decision',{ decision,version:String(version),comment },actor.accessToken);
      const detail = () => call('GET',route,undefined,account.accessToken).then(response=>expectStatus(response,200));
      expectStatus(await decide(foreign,request.version),403,'OUT_OF_SCOPE');
      const concurrent = await Promise.all([decide(approver,request.version),decide(second,request.version)]);
      assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
      const firstActor = concurrent[0].status===201?approver:second;
      const nextActor = firstActor===approver?second:approver;
      const partial = concurrent.find(r=>r.status===201).data;
      assert.equal(partial.status,'PENDING');
      assert.equal(partial.approval.approved,1);
      assert.equal(partial.approval.firstApproverId,firstActor.user.id);
      const ownerAfterFirst = await detail();
      assert.equal(ownerAfterFirst.decision,null);
      assert.equal(ownerAfterFirst.approvalHistory.length,1);
      expectStatus(await decide(firstActor,partial.version),403,'SECOND_APPROVER_REQUIRED');
      expectStatus(await decide(foreign,partial.version),403,'OUT_OF_SCOPE');
      assert.equal(sql(`SELECT count(*) FROM provider_operations WHERE request_id='${request.id}'`),'0');
      assert.equal(sql(`SELECT count(*) FROM notifications WHERE request_id='${request.id}' AND type='REQUEST_APPROVED'`),'0');
      assert.equal(sql(`SELECT count(*) FROM notifications WHERE request_id='${request.id}' AND type='REQUEST_SECOND_APPROVAL' AND recipient_id='${nextActor.user.id}'`),'2');
      assert.equal(sql(`SELECT count(*) FROM notifications WHERE request_id='${request.id}' AND type='REQUEST_SECOND_APPROVAL' AND recipient_id IN ('${firstActor.user.id}','${foreign.user.id}','${account.user.id}')`),'0');
      sql(`DO $test$ BEGIN
        BEGIN UPDATE requests SET status='APPROVED' WHERE id='${request.id}'; RAISE EXCEPTION 'unsafe direct update';
        EXCEPTION WHEN check_violation THEN IF SQLERRM<>'TWO_APPROVALS_REQUIRED' THEN RAISE; END IF; END;
      END $test$;`);

      const reviewer = await newPage({width:390,height:850});
      try {
        await reviewer.page.goto(new URL(`/approvals?q=${request.id}`,origin).href);
        await uiLogin(reviewer.page,nextActor.user.email,nextActor===second?changedPassword:undefined);
        await reviewer.page.getByText('Chờ cấp 2 · 1/2',{exact:true}).waitFor();
        await reviewer.page.getByRole('button',{name:request.id,exact:true}).press('Enter');
        await reviewer.page.waitForURL(new URL(route,origin).href);
        await reviewer.page.getByText('Cấp 1 · Đã duyệt',{exact:true}).waitFor();
        await reviewer.page.evaluate(() => {
          const requestFrame = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = callback => {
            if (!document.getElementById('decision-title') || !callback.toString().includes('.focus()')) return requestFrame(callback);
            return requestFrame(timestamp => {
              window.__releaseDecisionFocus = () => callback(timestamp);
              window.requestAnimationFrame = requestFrame;
            });
          };
        });
        await reviewer.page.getByRole('button',{name:'Duyệt cấp 2',exact:true}).press('Enter');
        const confirmation = reviewer.page.getByRole('dialog', { name: /^Duyệt cấp 2 / });
        const submit = confirmation.getByRole('button',{name:'Xác nhận duyệt cấp 2',exact:true});
        await reviewer.page.waitForFunction(() => typeof window.__releaseDecisionFocus === 'function');
        await submit.focus();
        await reviewer.page.evaluate(() => window.__releaseDecisionFocus());
        assert.equal(await submit.evaluate(element => document.activeElement === element), true,
          'Deferred dialog focus must not move the confirmation button out of focus.');
        const [response] = await Promise.all([
          reviewer.page.waitForResponse(result => result.request().method() === 'POST' && new URL(result.url()).pathname === '/api/v1' + route + '/decision'),
          reviewer.page.keyboard.press('Enter'),
        ]);
        assert.equal(response.status(), 201);
        await confirmation.waitFor({state:'hidden'});
        await reviewer.page.getByText('Cấp 2 · Đã duyệt',{exact:true}).waitFor();
        assert.deepEqual(reviewer.errors,[]);
        await reviewer.page.screenshot({path:path.join(output,'x02-two-stage-mobile.png')});
      } finally { await reviewer.context.close(); }
      let completed;
      const until=Date.now()+25_000;
      do {
        completed=await detail();
        if(completed.status==='COMPLETED')break;
        assert.ok(['APPROVED','PROCESSING'].includes(completed.status));
        await new Promise(resolve=>setTimeout(resolve,250));
      } while(Date.now()<until);
      assert.equal(completed.status,'COMPLETED');
      assert.deepEqual(completed.approvalHistory.map(item=>[item.level,item.approverId]),[[1,firstActor.user.id],[2,nextActor.user.id]]);
      assert.equal(sql(`SELECT attempt_count FROM provider_operations WHERE request_id='${request.id}'`),'1');
      assert.equal(sql(`SELECT count(*) FROM notifications WHERE request_id='${request.id}' AND type='REQUEST_APPROVED' AND recipient_id='${account.user.id}'`),'2');

      async function createPending() {
        return expectStatus(await call('POST','/requests',{
          type:'CREATE',policyVersionId:approvalPolicy.latest.id,reason:`X02 kiểm hủy và từ chối ${randomUUID()}`,
          parameters:{assetType:'KEY',algorithm:'RSA',keySize:2048,validityDays:90},
        },account.accessToken),201);
      }
      const rejectTarget = await createPending();
      const rejectPath = `/requests/${rejectTarget.id}`;
      const first = expectStatus(await call('POST',rejectPath+'/decision',{decision:'APPROVED',version:String(rejectTarget.version)},approver.accessToken),201);
      expectStatus(await call('POST',rejectPath+'/decision',{decision:'REJECTED',version:String(first.version),comment:'Thiếu bằng chứng theo chính sách.'},second.accessToken),201);
      const rejected = expectStatus(await call('GET',rejectPath,undefined,account.accessToken),200);
      assert.deepEqual(rejected.approvalHistory.map(item=>item.decision),['APPROVED','REJECTED']);
      assert.equal(rejected.status,'REJECTED');
      const cancelTarget = await createPending();
      const cancelPath = `/requests/${cancelTarget.id}`;
      const cancellable = expectStatus(await call('POST',cancelPath+'/decision',{decision:'APPROVED',version:String(cancelTarget.version)},approver.accessToken),201);
      expectStatus(await call('POST',cancelPath+'/cancel',{version:cancellable.version},account.accessToken),201);
      const cancelled = expectStatus(await call('GET',cancelPath,undefined,account.accessToken),200);
      assert.equal(cancelled.status,'CANCELLED');
      assert.equal(cancelled.approvalHistory.length,1);
      const expired = randomUUID();
      sql(`INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,status,reason,submitted_at)
        VALUES('${expired}','CREATE','${account.user.id}','${it}','${approvalPolicy.latest.id}','PENDING','X02 expired fixture',now()-interval '49 hours')`);
      expectStatus(await call('POST',`/requests/${expired}/decision`,{decision:'APPROVED',version:'1'},approver.accessToken),409,'APPROVAL_DEADLINE_EXPIRED');
      expectStatus(await call('POST',`/requests/${expired}/cancel`,{version:1},account.accessToken),201);
      assert.equal(sql(`SELECT count(*) FROM provider_operations WHERE request_id IN ('${expired}','${cancelTarget.id}','${rejectTarget.id}')`),'0');
      return { concurrentStatuses:concurrent.map(r=>r.status), partialRetained:true, directBypassDenied:true, completedWithTwoActors:true,
        workerAttempts:1, secondScopeNotified:true, secondRejected:true, cancelledAfterFirst:true, expiredDenied:true, deferredFocusPreserved:true };
    } finally {
      expectStatus(await call('PATCH', `/policies/${approvalPolicy.id}/deactivate`,
        {expectedVersion:approvalPolicy.latest.version},admin.accessToken),200);
    }
  });
  await test('M keyboard: deferred page focus preserves row and decision activation', async () => {
    const request = await createRequest(account, 'deferred keyboard focus');
    const reviewer = await newPage();
    try {
      await reviewer.page.addInitScript(() => {
        const requestFrame = window.requestAnimationFrame.bind(window);
        const cancelFrame = window.cancelAnimationFrame.bind(window);
        const pending = new Map();
        let released = 0;
        const release = () => {
          const frames = [...pending.values()]; pending.clear();
          released += frames.length;
          for (const { callback, timestamp } of frames) callback(timestamp);
        };
        window.requestAnimationFrame = callback => {
          if (!callback.toString().includes('page-title')) return requestFrame(callback);
          const id = requestFrame(timestamp => pending.set(id, { callback, timestamp }));
          return id;
        };
        window.cancelAnimationFrame = id => { pending.delete(id); cancelFrame(id); };
        const releaseOnControlFocus = event => {
          if (event.target instanceof HTMLButtonElement && event.target.closest('#main-content')) {
            queueMicrotask(release);
          }
        };
        document.addEventListener('focusin', releaseOnControlFocus);
        window.__routeFocusRace = {
          get pending() { return pending.size; },
          get released() { return released; },
          restore() {
            document.removeEventListener('focusin', releaseOnControlFocus);
            release();
            window.requestAnimationFrame = requestFrame;
            window.cancelAnimationFrame = cancelFrame;
          },
        };
      });
      await reviewer.page.goto(new URL(`/approvals?q=${request.id}`, origin).href);
      await uiLogin(reviewer.page, approver.user.email);
      const row = reviewer.page.getByRole('button', { name: request.id, exact: true });
      await row.waitFor();
      await reviewer.page.waitForFunction(() => window.__routeFocusRace.pending > 0);
      await row.press('Enter');
      await reviewer.page.waitForURL(new URL(`/requests/${request.id}`, origin).href);
      const reject = reviewer.page.getByRole('button', { name: 'Từ chối', exact: true });
      await reject.waitFor();
      await reviewer.page.waitForFunction(() => window.__routeFocusRace.pending > 0);
      await reject.press('Enter');
      const dialog = reviewer.page.getByRole('dialog');
      await dialog.waitFor();
      const releasedFrames = await reviewer.page.evaluate(() => {
        const released = window.__routeFocusRace.released;
        window.__routeFocusRace.restore();
        return released;
      });
      assert(releasedFrames >= 2, 'Both page focus callbacks must race the keyboard activation.');
      await reviewer.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await reviewer.page.waitForFunction(element => element === document.activeElement,
        await reject.elementHandle(), { timeout: 5_000 });
      assert.equal(sql(`SELECT count(*) FROM request_decisions WHERE request_id='${request.id}'`), '0');
      assert.deepEqual(reviewer.errors, []);
      return { releasedFrames, rowOpened: true, decisionOpened: true, escapeRestoredFocus: true };
    } finally {
      await reviewer.context.close();
      expectStatus(await call('POST', `/requests/${request.id}/cancel`, { version: Number(request.version) }, account.accessToken), 201);
    }
  });
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
    await test(`T49 real UI: rejected request shows decision to its owner at ${width}px`, async () => {
      const owner = await newPage({ width, height: 900 });
      const reviewer = await newPage({ width, height: 900 });
      for (const { page } of [owner, reviewer]) {
        await page.addInitScript(value => localStorage.setItem('crypta-theme', value), theme);
      }
      const subject = `Kiểm thử từ chối ${width} ${stamp}`;
      const reason = 'Bổ sung phạm vi sử dụng và ngày kết thúc dự kiến.';
      await owner.page.goto(new URL('/requests/new', origin).href);
      await uiLogin(owner.page, account.email, changedPassword);
      await owner.page.getByLabel('Lý do nghiệp vụ').fill(subject);
      await owner.page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).press('Enter');
      await owner.page.getByRole('button', { name: new RegExp(subject) }).press('Enter');
      await owner.page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
      const requestPath = new URL(owner.page.url()).pathname;
      const id = requestPath.split('/').at(-1);

      await reviewer.page.goto(new URL(`/approvals?q=${encodeURIComponent(subject)}`, origin).href);
      await uiLogin(reviewer.page, approver.user.email);
      await reviewer.page.getByRole('button', { name: id, exact: true }).press('Enter');
      await reviewer.page.waitForURL(new URL(requestPath, origin).href);
      await reviewer.page.getByRole('button', { name: 'Từ chối', exact: true }).press('Enter');
      const dialog = reviewer.page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: /Ghi chú quyết định/ }).fill(reason);
      await dialog.getByRole('button', { name: 'Xác nhận từ chối', exact: true }).press('Enter');
      await dialog.waitFor({ state: 'hidden' });
      await owner.page.reload();
      await owner.page.getByText('Từ chối', { exact: true }).waitFor();
      await owner.page.waitForFunction(() => document.activeElement?.id === 'page-title');

      const effects = JSON.parse(sql(`SELECT json_build_object(
        'decisions', (SELECT count(*) FROM request_decisions WHERE request_id='${id}' AND decision='REJECTED'),
        'audit', (SELECT count(*) FROM audit_logs WHERE request_id='${id}' AND action='REQUEST_REJECTED' AND outcome='SUCCESS'),
        'notice', (SELECT count(*) FROM notifications WHERE request_id='${id}' AND type='REQUEST_REJECTED' AND channel='IN_APP'),
        'provider', (SELECT count(*) FROM provider_operations WHERE request_id='${id}'));`));
      assert.deepEqual(effects, { decisions: 1, audit: 1, notice: 1, provider: 0 });
      const detail = expectStatus(await call('GET', requestPath, undefined, account.accessToken), 200);
      assert.equal(detail.decision.comment, reason);
      assert.equal(detail.decision.approverId, approver.user.id);
      const ui = {
        reasonVisible: await owner.page.getByText(reason, { exact: true }).isVisible(),
        reviewerVisible: await owner.page.getByText(approver.user.displayName, { exact: true }).first().isVisible(),
        timeline: await owner.page.locator('.mini-timeline ol strong').allTextContents(),
      };
      await owner.page.screenshot({ path: path.join(output, `t49-rejection-${width}-${theme}.png`), animations: 'disabled' });
      assert.deepEqual(ui, { reasonVisible: true, reviewerVisible: true, timeline: ['Đã tạo yêu cầu', 'Đã từ chối'] });
      assert.equal(detail.decision.approverName, approver.user.displayName);
      assert.equal(owner.errors.length + reviewer.errors.length, 0);
      await owner.context.close(); await reviewer.context.close();
      return { width, theme, keyboard: true, status: detail.status, effects, ui };
    });
  }
  await test('T19: malformed stored policy limits block explicit request parameters before submission', async () => {
    const policyId = randomUUID(), versionId = randomUUID();
    sql(`INSERT INTO policies(id,code,name) VALUES('${policyId}','T19-${policyId}','Legacy policy fixture');
      INSERT INTO policy_versions(id,policy_id,version,configuration) VALUES('${versionId}','${policyId}',1,
        '{"algorithm":"RSA","minimum_key_size":"unknown","maximum_validity_days":"unknown"}'::jsonb);`);
    try {
      expectStatus(await call('POST', '/requests', { type: 'CREATE', policyVersionId: versionId,
        reason: `T19 malformed limits ${stamp}`, parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 90 },
      }, account.accessToken), 409, 'POLICY_CONFIGURATION_INVALID');
      assert.equal(sql(`SELECT count(*) FROM requests WHERE policy_version_id='${versionId}';`), '0');
      return { invalidPolicyRejected: true, requestsCreated: 0 };
    } finally {
      sql(`UPDATE policies SET is_active=false WHERE id='${policyId}';`);
    }
  });
  function seedRequestTarget(policyVersionId = policy.id, keySize = 2048) {
    const id = randomUUID();
    sql(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,
      valid_from,expires_at,provider_scope,provider_reference)
      VALUES('${id}','T10-${id}','KEY','${account.user.id}','${it}','${policyVersionId}','T10 target','ACTIVE',
        NOW()-INTERVAL '1 day',NOW()+INTERVAL '30 days','MOCK','mock-key-${id}');
      INSERT INTO cryptographic_keys(asset_id,algorithm,key_size,usage,public_key_fingerprint)
      VALUES('${id}','RSA',${keySize},'SIGNING','t10-fingerprint-${id}');`);
    return id;
  }
  const targetRequest = (targetAssetId, type) => ({ type, targetAssetId, policyVersionId: policy.id,
    reason: `Integration T10 ${type} ${stamp}`, parameters: {} });
  const decideTargetRequest = (request, decision) => call('POST', `/requests/${request.id}/decision`,
    { decision, version: String(request.version), comment: 'Integration target verification' }, approver.accessToken);
  await test('T03: renewal validates inherited key metadata at submission and approval', async () => {
    const policyId = randomUUID(), versionId = randomUUID(), draftId = randomUUID();
    sql(`INSERT INTO policies(id,code,name) VALUES('${policyId}','T03-${policyId}','Renewal metadata fixture');
      INSERT INTO policy_versions(id,policy_id,version,configuration) VALUES('${versionId}','${policyId}',1,
        '{"algorithm":"RSA","minimum_key_size":3072,"maximum_validity_days":90}'::jsonb);`);
    const target = seedRequestTarget(versionId);
    const input = { ...targetRequest(target, 'RENEW'), policyVersionId: versionId };
    const submit = body => call('POST', '/requests', body, account.accessToken);
    expectStatus(await submit(input), 409, 'POLICY_KEY_SIZE_TOO_SMALL');
    assert.equal(sql(`SELECT count(*) FROM requests WHERE target_asset_id='${target}';`), '0');
    const draft = expectStatus(await call('PUT', `/requests/drafts/${draftId}`, input, account.accessToken), 200);
    expectStatus(await call('POST', `/requests/${draftId}/submit`, { version: draft.version }, account.accessToken),
      409, 'POLICY_KEY_SIZE_TOO_SMALL');
    assert.equal(sql(`SELECT status FROM requests WHERE id='${draftId}';`), 'DRAFT');

    const changedTarget = seedRequestTarget(versionId, 3072);
    const changed = expectStatus(await submit({ ...input, targetAssetId: changedTarget }), 201);
    sql(`UPDATE cryptographic_keys SET key_size=2048 WHERE asset_id='${changedTarget}';`);
    expectStatus(await decideTargetRequest(changed, 'APPROVED'), 409, 'POLICY_KEY_SIZE_TOO_SMALL');
    assert.equal(sql(`SELECT count(*) FROM request_decisions WHERE request_id='${changed.id}';`), '0');
    expectStatus(await decideTargetRequest(changed, 'REJECTED'), 201);

    sql(`INSERT INTO policy_versions(policy_id,version,configuration) VALUES('${policyId}',2,
      '{"algorithm":"RSA","minimum_key_size":4096,"maximum_validity_days":30}'::jsonb);`);
    const valid = expectStatus(await submit({ ...input, parameters: { keySize: 3072, validityDays: 60 } }), 201);
    expectStatus(await decideTargetRequest(valid, 'APPROVED'), 201);
    const deadline = Date.now() + 15000;
    let result;
    do {
      result = sql(`SELECT json_build_object('policyVersionId',a.policy_version_id,'keySize',k.key_size,'usage',k.usage,
        'days',extract(epoch FROM (a.expires_at-a.valid_from))/86400,'attempts',op.attempt_count)
        FROM requests r JOIN crypto_assets a ON a.id=r.result_asset_id
        JOIN cryptographic_keys k ON k.asset_id=a.id JOIN provider_operations op ON op.request_id=r.id
        WHERE r.id='${valid.id}' AND r.status='COMPLETED';`);
      if (result) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert.ok(result, 'The worker did not complete the corrected renewal.');
    assert.deepEqual(JSON.parse(result), { policyVersionId: versionId, keySize: 3072, usage: 'SIGNING', days: 60, attempts: 1 });
    return { rejectedBoundaries: 3, correctSize: 3072, originalPolicyRetained: true, providerAttempts: 1 };
  });
  await test('T10: approval revalidates asset ownership and expiry while rejection remains available', async () => {
    const checks = [
      { type: 'RENEW', change: `owner_id='${finance.user.id}'`, httpStatus: 403, code: 'ASSET_NOT_OWNED' },
      { type: 'REVOKE', change: "expires_at=NOW()-INTERVAL '1 second'", httpStatus: 409, code: 'INVALID_ASSET_STATE' },
      { type: 'REVOKE', change: 'provider_reference=NULL', httpStatus: 409, code: 'PROVIDER_REFERENCE_REQUIRED' },
    ];
    for (const { type, change, httpStatus, code } of checks) {
      const asset = seedRequestTarget();
      const request = expectStatus(await call('POST', '/requests', targetRequest(asset, type), account.accessToken), 201);
      sql(`UPDATE crypto_assets SET ${change} WHERE id='${asset}';`);
      expectStatus(await decideTargetRequest(request, 'APPROVED'), httpStatus, code);
      const before = JSON.parse(sql(`SELECT json_build_object('status',r.status,'version',r.version,
        'decisions',(SELECT count(*) FROM request_decisions WHERE request_id=r.id),
        'approvals',(SELECT count(*) FROM audit_logs WHERE request_id=r.id AND action='REQUEST_APPROVED'),
        'notices',(SELECT count(*) FROM notifications WHERE request_id=r.id AND type='REQUEST_APPROVED'),
        'provider',(SELECT count(*) FROM provider_operations WHERE request_id=r.id))
        FROM requests r WHERE r.id='${request.id}';`));
      assert.deepEqual(before, { status: 'PENDING', version: request.version, decisions: 0, approvals: 0, notices: 0, provider: 0 });
      assert.equal(expectStatus(await decideTargetRequest(request, 'REJECTED'), 201).status, 'REJECTED');
    }
    return { changedTargetsDenied: checks.length, approvalEffects: 0, rejectionAvailable: true };
  });
  await test('T10: concurrent renewal and revocation submit only one open request and one provider attempt', async () => {
    const asset = seedRequestTarget();
    const responses = await Promise.all(['RENEW', 'REVOKE'].map(type =>
      call('POST', '/requests', targetRequest(asset, type), account.accessToken)));
    assert.deepEqual(responses.map(result => result.status).sort(), [201, 409]);
    expectStatus(responses.find(result => result.status === 409), 409, 'DUPLICATE_OPEN_REQUEST');
    const request = expectStatus(responses.find(result => result.status === 201), 201);
    assert.equal(sql(`SELECT count(*) FROM requests WHERE target_asset_id='${asset}';`), '1');
    expectStatus(await decideTargetRequest(request, 'APPROVED'), 201);
    const deadline = Date.now() + 15000;
    let outcome;
    do {
      outcome = JSON.parse(sql(`SELECT json_build_object('status',r.status,'type',r.request_type,
        'targetStatus',a.status,'resultId',r.result_asset_id,'attempts',op.attempt_count,
        'successors',(SELECT count(*) FROM crypto_assets WHERE replaces_asset_id=a.id))
        FROM requests r JOIN crypto_assets a ON a.id=r.target_asset_id
        LEFT JOIN provider_operations op ON op.request_id=r.id WHERE r.id='${request.id}';`));
      if (outcome.status === 'COMPLETED') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.attempts, 1);
    if (outcome.type === 'RENEW') {
      assert.equal(outcome.targetStatus, 'SUPERSEDED');
      assert.equal(outcome.successors, 1);
      assert.ok(outcome.resultId !== asset);
    } else {
      assert.equal(outcome.type, 'REVOKE');
      assert.equal(outcome.targetStatus, 'REVOKED');
      assert.equal(outcome.successors, 0);
      assert.equal(outcome.resultId, asset);
    }
    return { winningOperation: outcome.type, rejectedConflicts: 1, providerAttempts: outcome.attempts };
  });
  await test('T32: certificate issuance offers only compatible policies and sends the selected version', async () => {
    const certificate = policies.find(item => item.configuration?.certificate_profile === 'TLS_SERVER');
    assert.ok(certificate, 'Expected a seeded certificate policy.');
    const owner = await newPage({ width: 390, height: 844 });
    try {
      await owner.page.addInitScript(() => localStorage.setItem('crypta-theme', 'dark'));
      await owner.page.goto(new URL('/requests/new', origin).href);
      await uiLogin(owner.page, account.email, changedPassword);
      const dialog = owner.page.getByRole('dialog');
      const assetType = dialog.getByRole('combobox', { name: /Loại tài sản/ });
      const picker = dialog.getByLabel('Chính sách', { exact: true });
      const reason = dialog.getByLabel('Lý do nghiệp vụ');
      await picker.selectOption(policy.id);
      assert.equal(await picker.locator(`option[value="${certificate.id}"]`).count(), 0);
      await reason.fill(`Integration certificate policy selection ${stamp}`);
      await assetType.selectOption('CERTIFICATE');
      await picker.locator(`option[value="${certificate.id}"]`).waitFor({ state: 'attached' });
      assert.equal(await picker.locator(`option[value="${policy.id}"]`).count(), 0, 'A key-only policy appeared in certificate options.');
      await picker.selectOption(certificate.id);
      assert.equal(await reason.inputValue(), `Integration certificate policy selection ${stamp}`);
      assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth));
      await owner.page.screenshot({ path: path.join(output, 'certificate-policy-390-dark.png'), animations: 'disabled' });
      const submitted = owner.page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/requests');
      await dialog.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).press('Enter');
      const response = await submitted;
      assert.equal(response.status(), 201);
      const { data: request } = await response.json();
      assert.deepEqual([request.policyVersionId, request.parameters.assetType, request.status], [certificate.id, 'CERTIFICATE', 'PENDING']);
      assert.equal(owner.errors.length, 0);
      return { width: 390, theme: 'dark', keyboardSubmit: true, certificatePolicySubmitted: true };
    } finally { await owner.context.close(); }
  });
  await test('T49 real UI: issue, renew and revoke through User, Approver and worker', async () => {
    const owner = await newPage();
    const reviewer = await newPage();
    await owner.page.goto(new URL('/requests/new', origin).href);
    await uiLogin(owner.page, account.email, changedPassword);
    await reviewer.page.goto(new URL('/approvals', origin).href);
    await uiLogin(reviewer.page, approver.user.email);
    const results = [];
    const steps = [
      { type: 'CREATE', draft: true }, { type: 'RENEW' }, { type: 'REVOKE', emergency: true },
      { type: 'CREATE' }, { type: 'REVOKE' },
    ];
    for (const [index, { type, draft = false, emergency = false }] of steps.entries()) {
      const target = type === 'CREATE' ? null : results.at(-1).resultAssetId;
      if (target) {
        await owner.page.goto(new URL(`/assets/${target}`, origin).href);
        await owner.page.getByRole('button', { name: type === 'RENEW' ? 'Yêu cầu gia hạn' : 'Thu hồi', exact: true }).click();
      } else if (index > 0) {
        await owner.page.goto(new URL('/requests/new', origin).href);
      }
      const subject = `Nghiệp vụ kiểm thử ${type} ${index + 1} ${stamp}`;
      const requestForm = owner.page.getByRole('dialog');
      if (type === 'CREATE') await requestForm.getByLabel('Chính sách', { exact: true }).selectOption(policy.id);
      let draftPath;
      if (draft) {
        const incompleteReason = 'Nháp';
        await requestForm.getByLabel('Lý do nghiệp vụ').fill(incompleteReason);
        await requestForm.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await owner.page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
        draftPath = new URL(owner.page.url()).pathname;
        const draftId = draftPath.split('/').at(-1);
        const saved = expectStatus(await call('GET', draftPath, undefined, account.accessToken), 200);
        assert.equal(saved.status, 'DRAFT');
        expectStatus(await call('GET', draftPath, undefined, approver.accessToken), 404);
        assert.equal(sql(`SELECT count(*) FROM provider_operations WHERE request_id='${draftId}'`), '0');
        await owner.page.reload();
        await owner.page.getByRole('button', { name: 'Sửa bản nháp', exact: true }).click();
        assert.equal(await requestForm.getByLabel('Lý do nghiệp vụ').inputValue(), incompleteReason);
      }
      await requestForm.getByLabel('Lý do nghiệp vụ').fill(subject);
      if (type === 'REVOKE') {
        const urgent = requestForm.getByRole('checkbox', { name: /Đánh dấu khẩn cấp/ });
        if (emergency) await urgent.check();
        assert.equal(await urgent.isChecked(), emergency);
        await requestForm.getByRole('button', { name: 'Tiếp tục thu hồi', exact: true }).click();
      }
      await requestForm.getByRole('button', { name: type === 'REVOKE' ? 'Xác nhận thu hồi' : 'Gửi yêu cầu', exact: true }).click();
      if (draftPath) {
        await owner.page.waitForURL(url => url.pathname === draftPath);
        await owner.page.getByText('Chờ duyệt', { exact: true }).waitFor();
      } else {
        await owner.page.getByRole('button', { name: new RegExp(subject) }).click();
        await owner.page.waitForURL(url => /^\/requests\/[a-f0-9-]{36}$/.test(url.pathname));
      }
      const requestPath = new URL(owner.page.url()).pathname;
      const id = requestPath.split('/').at(-1);
      assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE request_id='${id}' AND action='REQUEST_SUBMITTED'`), '1');
      assert.equal(sql(`SELECT count(*) FROM provider_operations WHERE request_id='${id}'`), '0');

      await reviewer.page.goto(new URL(`/approvals?q=${encodeURIComponent(subject)}`, origin).href);
      const entry = reviewer.page.getByRole('button', { name: id, exact: true });
      const queueRow = reviewer.page.getByRole('row').filter({ has: entry });
      await queueRow.getByText(emergency ? 'Khẩn cấp' : 'Bình thường', { exact: true }).waitFor();
      await entry.click();
      await reviewer.page.getByRole('button', { name: 'Phê duyệt', exact: true }).click();
      const decision = reviewer.page.getByRole('dialog');
      await decision.getByRole('button', { name: 'Xác nhận phê duyệt', exact: true }).click();
      await decision.waitFor({ state: 'hidden' });

      let completed;
      const deadline = Date.now() + 25_000;
      do {
        completed = expectStatus(await call('GET', requestPath, undefined, account.accessToken), 200);
        if (completed.status === 'COMPLETED') break;
        assert.ok(['APPROVED', 'PROCESSING'].includes(completed.status), `${type} worker entered ${completed.status}`);
        await new Promise(resolve => setTimeout(resolve, 250));
      } while (Date.now() < deadline);
      assert.equal(completed.status, 'COMPLETED', type);
      assert.equal(completed.type, type);
      assert.equal(completed.targetAssetId, target ?? null);
      assert.equal(completed.emergency, emergency);
      assert.equal(sql(`SELECT count(*) FROM request_decisions WHERE request_id='${id}'`), '1');
      const operation = JSON.parse(sql(`SELECT json_build_object('attempts',attempt_count,'status',status,'receipt',receipt_at IS NOT NULL) FROM provider_operations WHERE request_id='${id}';`));
      assert.deepEqual(operation, { attempts: 1, status: 'COMPLETED', receipt: true });
      await owner.page.getByRole('button', { name: 'Làm mới chi tiết', exact: true }).click();
      await owner.page.getByText('Đã hoàn tất', { exact: true }).waitFor();
      results.push({ type, draft, emergency, requestId: id, resultAssetId: completed.resultAssetId, operation });
    }
    const [issued, renewed, , regularAsset] = results;
    const detail = async id => expectStatus(await call('GET', `/assets/${id}`, undefined, account.accessToken), 200);
    assert.equal((await detail(issued.resultAssetId)).status, 'SUPERSEDED');
    assert.equal((await detail(renewed.resultAssetId)).status, 'REVOKED');
    assert.equal((await detail(regularAsset.resultAssetId)).status, 'REVOKED');
    assert.equal(sql(`SELECT replaces_asset_id FROM crypto_assets WHERE id='${renewed.resultAssetId}';`), issued.resultAssetId);
    await owner.page.goto(new URL(`/assets/${renewed.resultAssetId}`, origin).href);
    await owner.page.getByText('Đã thu hồi', { exact: true }).first().waitFor();
    assert.equal(await owner.page.getByRole('button', { name: 'Yêu cầu gia hạn', exact: true }).count(), 0);
    for (const [pageRoute, endpoint, label] of [
      ['/requests', '/requests?createdByMe=true&page=1&pageSize=10', 'yêu cầu'],
      ['/notifications', '/notifications?page=1&pageSize=10', 'thông báo'],
    ]) {
      const { total } = expectStatus(await call('GET', endpoint, undefined, account.accessToken), 200);
      assert.ok(total > 0);
      await owner.page.goto(new URL(pageRoute, origin).href);
      const status = owner.page.locator(`#${pageRoute.slice(1)}`).getByRole('status').filter({ hasText: `Có ${total} ${label}.` });
      await status.waitFor();
      assert.equal(await status.evaluate(element => !!element.closest('[aria-busy="true"]')), false);
    }
    assert.equal(owner.errors.length + reviewer.errors.length, 0);
    return { lifecycle: results, firstAsset: 'SUPERSEDED', replacementAsset: 'REVOKED', regularAsset: 'REVOKED', listStatusMatchesApi: true };
  });
  await test('T15 real UI: recovery actions preserve reason on conflict and commit once', async () => {
    const mobile = channel === 'chrome';
    const { context, page, calls, errors } = await newPage({ width: mobile ? 390 : 1440, height: 900 });
    if (mobile) await context.addInitScript(() => localStorage.setItem('crypta-theme', 'dark'));
    const seedIssue = failureClass => {
      const id = randomUUID(), claim = failureClass === 'OUTCOME_UNKNOWN' ? 'NULL' : '1';
      sql(`INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,status,reason)
        VALUES('${id}','CREATE','${dev.user.id}','${it}','${policy.id}','RECONCILIATION_REQUIRED','Recovery browser fixture');
        INSERT INTO provider_operations(request_id,operation_type,status,claim_version,failure_class,last_error_code)
        VALUES('${id}','CREATE','RECONCILIATION_REQUIRED',${claim},'${failureClass}','STALE_PROCESSING');`);
      return id;
    };
    const unknown = seedIssue('OUTCOME_UNKNOWN'), retry = seedIssue('UNSENT_TRANSIENT'), close = seedIssue('UNSENT_PERMANENT');
    const recorded = await createRequest(dev, 'recorded recovery fixture');
    assert.match(recorded.id, /^[a-f0-9-]{36}$/);
    const trigger = `ui_recover_${recorded.id.replaceAll('-', '')}`;
    sql(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.request_id='${recorded.id}' AND NEW.action='ASSET_CREATED' THEN RAISE EXCEPTION 'UI recovery fixture'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}();`);
    try {
      expectStatus(await call('POST', `/requests/${recorded.id}/decision`, { decision:'APPROVED', version:String(recorded.version) }, approver.accessToken), 201);
      const end = Date.now() + 16000;
      let ready = false;
      while (Date.now() < end && !ready) {
        const result = await call('GET', `/operations/provider-issues/${recorded.id}`, undefined, admin.accessToken);
        ready = result.data?.status === 'RECONCILIATION_REQUIRED' && result.data.availableActions.includes('CONFIRM');
        if (!ready) await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert(ready, 'Expected the real worker to preserve the provider receipt after a rollback');
    } finally { sql(`DROP TRIGGER ${trigger} ON audit_logs; DROP FUNCTION ${trigger}();`); }
    await page.goto(new URL('/operations/provider', origin).href); await uiLogin(page, 'admin@congty.com');
    await page.getByRole('heading', { name: 'Đối soát provider', exact: true }).waitFor();
    await page.locator('main .resource-region[aria-busy=false]').waitFor();
    const dialog = page.getByRole('dialog');
    const open = id => page.getByRole('button', { name: `Xem chi tiết yêu cầu ${id}` }).click();
    const reason = 'Đã kiểm tra dữ liệu phê duyệt và nhật ký gửi';
    const confirm = () => dialog.getByRole('button', { name: 'Xác nhận', exact: true });
    await open(unknown);
    await dialog.getByText('Cần đối chiếu với nhà cung cấp trước khi thay đổi yêu cầu.').waitFor();
    assert.equal(await dialog.getByRole('button', { name: /Áp dụng biên nhận|Lên lịch thử lại|Đóng do lỗi xử lý/ }).count(), 0);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await open(retry); await dialog.getByRole('button', { name: 'Lên lịch thử lại' }).click();
    assert.equal(await confirm().isEnabled(), false);
    await dialog.getByLabel(/Lý do/).fill(reason); await dialog.getByRole('checkbox').check();
    sql(`UPDATE requests SET version=version+1 WHERE id='${retry}'`);
    const conflict = page.waitForResponse(response => response.url().endsWith(`/provider-issues/${retry}/actions`) && response.request().method() === 'POST');
    await confirm().click(); assert.equal((await conflict).status(), 409);
    await dialog.getByRole('button', { name: 'Tải lại trạng thái' }).click();
    await dialog.getByRole('button', { name: 'Tải lại trạng thái' }).waitFor({ state: 'hidden' });
    assert.equal(await dialog.getByLabel(/Lý do/).inputValue(), reason);
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false);
    await dialog.getByRole('checkbox').check(); await confirm().click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal(sql(`SELECT status FROM requests WHERE id='${retry}'`), 'APPROVED');
    await page.getByRole('row').filter({ hasText: retry.slice(0,8) }).getByText('Đang chờ thử lại').waitFor();
    await open(close); await dialog.getByRole('button', { name: 'Đóng do lỗi xử lý' }).click();
    await dialog.getByLabel(/Lý do/).fill(reason); await page.keyboard.press('Escape');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ở lại', exact: true }).click();
    assert.equal(await dialog.getByLabel(/Lý do/).inputValue(), reason);
    await dialog.getByRole('checkbox').check(); await confirm().click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal(sql(`SELECT status FROM requests WHERE id='${close}'`), 'FAILED');
    assert.equal(sql(`SELECT count(*) FROM notifications WHERE request_id='${close}' AND type='REQUEST_FAILED'`), '2');
    await open(recorded.id); await dialog.getByRole('button', { name: 'Áp dụng biên nhận' }).click();
    await page.screenshot({ path: path.join(output, 't15-confirm-receipt.png'), animations: 'disabled' });
    await dialog.getByLabel(/Lý do/).fill(reason); await dialog.getByRole('checkbox').check();
    await confirm().click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal(sql(`SELECT status FROM requests WHERE id='${recorded.id}'`), 'COMPLETED');
    assert.equal(sql(`SELECT attempt_count FROM provider_operations WHERE request_id='${recorded.id}'`), '1');
    await page.waitForFunction(() => document.activeElement?.id === 'page-title' && document.body.style.overflow !== 'hidden');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), mobile ? 390 : 1440);
    assert.equal(calls.filter(value => value.endsWith(`/provider-issues/${recorded.id}/actions`) && value.startsWith('POST')).length, 1);
    assert.deepEqual(errors, []);
    return { mobile, theme: mobile ? 'dark' : 'light', conflictPreservedReason: true, retryScheduled: true, closedWithNotifications: true, receiptAppliedOnce: true };
  });
  await test('T15 real UI: user route is forbidden without loading recovery data', async () => {
    const { page, calls } = await newPage();
    await page.goto(new URL('/operations/provider', origin).href); await uiLogin(page, 'dev.nguyen@congty.com');
    await page.waitForURL(url => url.pathname === '/forbidden');
    assert(!calls.some(value => value.includes('/operations/provider-issues')));
    return { role: 'USER', routeForbidden: true, providerReads: 0 };
  });
  await require('./testing/delayed-navigation.cjs')({test,sql,compose,newPage,uiLogin,origin,createUser,changedPassword,call,expectStatus,admin});
  await test('NAV-21 real Nginx: a lost decision response after leaving the page is reconciled without replay', async () => {
    const request = await createRequest(account, 'NAV-21 lost decision response');
    assert.match(request.id, /^[a-f0-9-]{36}$/);
    const detailPath = `/requests/${request.id}`;
    const decisionUrl = new URL(`/api/v1${detailPath}/decision`, origin).href;
    const reason = 'Cần bổ sung phạm vi sử dụng trước khi phê duyệt.';
    const { context, page, calls, errors } = await newPage();
    const upstream = Promise.withResolvers();
    const dropResponse = Promise.withResolvers();
    const effects = () => JSON.parse(sql(`SELECT json_build_object(
      'status', (SELECT status FROM requests WHERE id='${request.id}'),
      'decisions', (SELECT count(*) FROM request_decisions WHERE request_id='${request.id}'),
      'audit', (SELECT count(*) FROM audit_logs WHERE request_id='${request.id}' AND action='REQUEST_REJECTED' AND outcome='SUCCESS'),
      'notice', (SELECT count(*) FROM notifications WHERE request_id='${request.id}' AND type='REQUEST_REJECTED' AND channel='IN_APP'),
      'provider', (SELECT count(*) FROM provider_operations WHERE request_id='${request.id}'));`));
    let dropped = 0;
    try {
      await page.route(decisionUrl, async route => {
        interceptedRequests++;
        let status;
        try {
          // Deliver the original POST to Nginx and withhold its real response from the page.
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10000 });
          status = response.status();
          await response.dispose();
        } catch {
          status = null;
        } finally {
          upstream.resolve(status);
          await dropResponse.promise;
          await route.abort('connectionreset');
          dropped++;
        }
      });
      await page.goto(new URL(detailPath, origin).href);
      await uiLogin(page, approver.user.email);
      await page.getByRole('button', { name: 'Từ chối', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: /Ghi chú quyết định/ }).fill(reason);
      const failed = page.waitForEvent('requestfailed', event => event.url() === decisionUrl);
      const [status] = await Promise.all([
        Promise.race([upstream.promise, failed.then(() => null)]),
        dialog.getByRole('button', { name: 'Xác nhận từ chối', exact: true }).click(),
      ]);
      assert.equal(status, 201);
      const committed = { status: 'REJECTED', decisions: 1, audit: 1, notice: 1, provider: 0 };
      assert.deepEqual(effects(), committed);
      const pending = page.getByRole('status').filter({ hasText: 'đang chờ máy chủ xác nhận' });
      await dialog.getByRole('status').filter({ hasText: 'đang chờ máy chủ xác nhận' }).waitFor();
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
      await page.getByRole('button', { name: 'Về danh sách', exact: true }).last().click();
      await page.waitForURL(url => url.pathname === '/approvals');
      await pending.waitFor();
      dropResponse.resolve();
      assert.equal((await failed).failure()?.errorText, 'net::ERR_CONNECTION_RESET');

      const notice = page.getByRole('region', { name: 'Kết quả thao tác chưa rõ' });
      await notice.waitFor();
      await page.waitForLoadState('networkidle');
      const beforeReview = calls.length;
      await notice.getByRole('button', { name: 'Kiểm tra dữ liệu', exact: true }).click();
      await notice.getByText(/Dữ liệu hiện tại: Từ chối/).waitFor();
      const reviewCalls = calls.slice(beforeReview);
      assert.equal(reviewCalls.filter(call => call === `GET ${detailPath}`).length, 1);
      assert(reviewCalls.every(call => call.startsWith('GET ')), 'Review may refresh related reads only.');
      await notice.getByRole('link', { name: 'Mở dữ liệu liên quan', exact: true }).click();
      await page.waitForURL(new URL(detailPath, origin).href);
      await page.getByText(reason, { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Từ chối', exact: true }).count(), 0);
      assert.equal(await page.getByRole('status').filter({ hasText: 'Quyết định đã được ghi nhận.' }).count(), 0);
      assert.equal(calls.filter(call => call === `POST ${detailPath}/decision`).length, 1);
      assert.equal(dropped, 1);
      assert.deepEqual(effects(), committed);
      assert.deepEqual(errors, []);
      return { upstreamStatus: status, leftBeforeResponseLoss: true, dropped, reviewReads: reviewCalls.length, decisionPosts: 1, ...committed };
    } finally {
      dropResponse.resolve();
      await page.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
  });
  await require('./testing/asset-lineage-ui.cjs')({test,call,expectStatus,createRequest,account,approver,admin,policy,newPage,uiLogin,origin,output});
  await require('./testing/policy-lifecycle-ui.cjs')({test,call,expectStatus,admin,dev,newPage,uiLogin,origin,output,stamp,sql});
  await test('NAV-03 real Nginx: valid asset deep link and F5 restore its metadata and history', async () => {
    const assets = expectStatus(await call('GET', '/assets?pageSize=25', undefined, dev.accessToken), 200);
    const asset = assets.items.find(item => item.code === 'KEY-DEV-001'); assert.ok(asset);
    const detail = expectStatus(await call('GET', `/assets/${asset.id}`, undefined, dev.accessToken), 200);
    const { context, page, calls, errors } = await newPage(); const target = `/assets/${asset.id}`;
    await page.goto(new URL(target, origin).href); await uiLogin(page, 'dev.nguyen@congty.com');
    await page.waitForURL(url => url.pathname === target);
    const title = page.locator('#page-title').filter({ hasText: detail.purpose }); await title.waitFor();
    await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();
    await page.locator('.history-timeline[aria-busy="false"]').waitFor();
    assert.equal(await title.textContent(), detail.purpose); assert.equal(await page.locator('.drawer-title p').textContent(), asset.code);
    assert.equal(calls.filter(item => item === `GET /assets/${asset.id}`).length, 1);
    const beforeCookie = (await context.cookies()).find(cookie => cookie.name === 'crypta_refresh'); assert.ok(beforeCookie);
    const beforeTitle = await page.title(); await page.reload(); await title.waitFor();
    await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();
    await page.locator('.history-timeline[aria-busy="false"]').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'page-title');
    const afterCookie = (await context.cookies()).find(cookie => cookie.name === 'crypta_refresh');
    assert.ok(afterCookie && afterCookie.value !== beforeCookie.value, 'Asset F5 must rotate the real refresh cookie.');
    assert.equal(new URL(page.url()).pathname, target); assert.equal(await page.title(), beforeTitle);
    assert.equal(await title.textContent(), detail.purpose); assert.equal(calls.filter(item => item === `GET /assets/${asset.id}`).length, 2);
    assert.equal(errors.length, 0); await page.screenshot({ path: path.join(output, 'valid-asset-detail-f5.png'), fullPage: true });
    return { assetId: asset.id, directRoute: true, reloadMetadataMatched: true, historyReady: true, detailReads: 2, cookieRotated: true };
  });
  await test('NAV-03 real Nginx: valid request deep link and F5 restore the fetched request', async () => {
    const detail = expectStatus(await call('GET', `/requests/${ownerRequest.id}`, undefined, account.accessToken), 200);
    const { context, page, calls, errors } = await newPage(); const target = `/requests/${ownerRequest.id}`;
    await page.goto(new URL(target, origin).href); await uiLogin(page, account.email, changedPassword);
    await page.waitForURL(url => url.pathname === target);
    const title = page.locator('#page-title').filter({ hasText: detail.reason }); await title.waitFor();
    await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();
    assert.equal(await title.textContent(), detail.reason); assert.equal(await page.locator('.drawer-title p').textContent(), ownerRequest.id);
    assert.equal(calls.filter(item => item === `GET /requests/${ownerRequest.id}`).length, 1);
    assert.equal(await page.getByRole('button', { name: /^Phê duyệt$|^Từ chối$/ }).count(), 0);
    const beforeCookie = (await context.cookies()).find(cookie => cookie.name === 'crypta_refresh'); assert.ok(beforeCookie);
    const beforeTitle = await page.title(); await page.reload(); await title.waitFor();
    await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'page-title');
    const afterCookie = (await context.cookies()).find(cookie => cookie.name === 'crypta_refresh');
    assert.ok(afterCookie && afterCookie.value !== beforeCookie.value, 'Request F5 must rotate the real refresh cookie.');
    assert.equal(new URL(page.url()).pathname, target); assert.equal(await page.title(), beforeTitle); assert.equal(await title.textContent(), detail.reason);
    assert.equal(calls.filter(item => item === `GET /requests/${ownerRequest.id}`).length, 2); assert.equal(errors.length, 0);
    await page.screenshot({ path: path.join(output, 'valid-request-detail-f5.png'), fullPage: true });
    return { requestId: ownerRequest.id, directRoute: true, reloadMetadataMatched: true, detailReads: 2, cookieRotated: true, userDecisionActions: 0 };
  });
  await test('M browser: guest deep link/login/F5 preserves query with HttpOnly rotation', async () => {
    const { context, page, errors } = await newPage();
    const target = '/assets?status=ACTIVE&pageSize=10';
    await page.goto(new URL(target, origin).href); await uiLogin(page, 'dev.nguyen@congty.com');
    await page.waitForURL(url => url.pathname + url.search === target);
    await page.locator('#page-title').filter({ hasText: 'Tài sản của tôi' }).waitFor();
    await page.getByRole('button', { name: 'KEY-DEV-001', exact: true }).first().waitFor();
    const before = (await context.cookies()).find(cookie => cookie.name === 'crypta_refresh');
    assert.ok(before); assert.equal(before.httpOnly, true); assert.equal(before.sameSite, 'Strict'); assert.equal(before.path, '/api/v1/auth'); assert.equal(before.secure, false);
    assert.equal(await page.evaluate(() => document.cookie.includes('crypta_refresh')), false);
    assert.equal(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => /eyJ[A-Za-z0-9_-]+\./.test(value))), false);
    await page.reload(); await page.getByRole('button', { name: 'KEY-DEV-001', exact: true }).first().waitFor();
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, target);
    const after = (await context.cookies()).find(cookie => cookie.name === 'crypta_refresh');
    assert.ok(after && after.value !== before.value, 'F5 must restore using a rotated real cookie.');
    assert.equal(errors.length, 0);
    await page.screenshot({ path: path.join(output, 'user-assets-f5.png'), fullPage: true });
    return { cookie: { name: after.name, httpOnly: after.httpOnly, sameSite: after.sameSite, path: after.path, secure: after.secure }, queryPreserved: true, cookieRotated: true };
  });
  for (const nativeWebLocks of [true, false]) await test(
    nativeWebLocks ? 'M browser multitab/API/DB: two tabs restore one shared cookie without replay revocation'
      : 'T06 browser multitab: two tabs restore one shared cookie without Web Locks', async () => {
    const user = await createUser();
    const first = await newPage(), second = await newPage(undefined, first.context);
    if (!nativeWebLocks) await first.context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await first.page.goto(new URL('/assets', origin).href); await uiLogin(first.page, user.email, changedPassword);
    await first.page.getByRole('heading', { name: 'Tài sản của tôi', exact: true, level: 1 }).waitFor();
    await first.page.locator('.table-shell[aria-busy=false]').waitFor();
    await second.page.goto(new URL('/assets', origin).href);
    await second.page.getByRole('heading', { name: 'Tài sản của tôi', exact: true, level: 1 }).waitFor();
    await second.page.locator('.table-shell[aria-busy=false]').waitFor();
    for (const tab of [first, second]) {
      assert.equal(await tab.page.evaluate(() => typeof navigator.locks?.request === 'function'), nativeWebLocks);
      if (!nativeWebLocks) assert.equal(await tab.page.evaluate(() => typeof indexedDB.open === 'function'), true);
    }
    const before = (await first.context.cookies()).find(cookie => cookie.name === 'crypta_refresh'); assert.ok(before);
    const activeBefore = Number(sql(`SELECT COUNT(*) FROM auth_sessions WHERE user_id='${user.id}' AND revoked_at IS NULL`)); assert.ok(activeBefore > 0);
    const rotations = [], captureRotation = response => { if (new URL(response.url()).pathname === '/api/v1/auth/refresh') rotations.push(response.status()); };
    first.page.on('response', captureRotation); second.page.on('response', captureRotation); first.calls.length = 0; second.calls.length = 0;
    // Without cross-tab serialization, the second real POST reaches the same old
    // cookie while the first transaction sleeps and revokes the rotated session.
    sql(`CREATE OR REPLACE FUNCTION t30_delay_multitab_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${user.id}'::uuid THEN PERFORM pg_sleep(2); END IF; RETURN NEW; END $$; CREATE TRIGGER t30_delay_multitab_rotation BEFORE INSERT ON auth_sessions FOR EACH ROW EXECUTE FUNCTION t30_delay_multitab_rotation()`);
    try {
      const refreshed = [first, second].map(tab => tab.page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/v1/auth/refresh'));
      await Promise.all([...refreshed, first.page.reload(), second.page.reload()]);
      assert.deepEqual(rotations.sort(), [200, 200]);
      await Promise.all([first, second].map(tab => tab.page.getByRole('heading', { name: 'Tài sản của tôi', exact: true, level: 1 }).waitFor()));
      await Promise.all([first, second].map(tab => tab.page.locator('.table-shell[aria-busy=false]').waitFor()));
      for (const tab of [first, second]) {
        assert.equal(tab.calls.filter(call => call === 'POST /auth/refresh').length, 1);
        assert.equal(tab.calls.filter(call => call === 'POST /auth/login').length, 0);
        assert.equal(await tab.page.locator('.login-card').count(), 0); assert.equal(tab.errors.length, 0);
      }
      assert.equal(Number(sql(`SELECT COUNT(*) FROM auth_sessions WHERE user_id='${user.id}' AND revoked_at IS NULL`)), activeBefore);
      const after = (await first.context.cookies()).find(cookie => cookie.name === 'crypta_refresh'); assert.ok(after && after.value !== before.value, 'Shared cookie must rotate.');
      const probe = await first.context.request.post(new URL('/api/v1/auth/refresh', origin).href);
      assert.equal(probe.status(), 200, 'The final shared cookie must remain usable, rather than silently revoked by replay.');
      if (!nativeWebLocks) {
        const storedRecords = await first.page.evaluate(() => new Promise((resolve, reject) => {
          const opening = indexedDB.open('crypta-session-coordination');
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const database = opening.result;
            const read = database.transaction('cookie').objectStore('cookie').count();
            database.close();
            read.onsuccess = () => resolve(read.result);
            read.onerror = () => reject(read.error);
          };
        }));
        assert.equal(storedRecords, 0, 'Coordination storage must stay empty.');
      }
      return { tabs: 2, nativeWebLocks, delaySeconds: 2, refreshStatuses: rotations, sharedCookieRotated: true, activeSessionsUnchanged: true, finalCookieRefresh: probe.status(), interceptedRequests: 0 };
    } finally {
      first.page.off('response', captureRotation); second.page.off('response', captureRotation);
      sql('DROP TRIGGER IF EXISTS t30_delay_multitab_rotation ON auth_sessions; DROP FUNCTION IF EXISTS t30_delay_multitab_rotation()');
    }
  });
  for (const nativeWebLocks of [true, false]) await test(
    nativeWebLocks ? 'M browser multitab: cross-tab logout/account switch clears the sibling and keeps it signed out'
      : 'T06 browser multitab: account switch clears sibling data without Web Locks', async () => {
    const first = await newPage(), second = await newPage(undefined, first.context);
    if (!nativeWebLocks) await first.context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await first.page.goto(new URL('/assets', origin).href); await uiLogin(first.page, 'dev.nguyen@congty.com');
    await first.page.getByRole('button', { name: 'KEY-DEV-001', exact: true }).first().waitFor();
    await second.page.goto(new URL('/assets', origin).href); await second.page.getByRole('button', { name: 'KEY-DEV-001', exact: true }).first().waitFor();
    await first.page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await Promise.all([first.page.locator('.login-card').waitFor(), second.page.locator('.login-card').waitFor()]);
    assert.equal(await second.page.getByRole('button', { name: 'KEY-DEV-001', exact: true }).count(), 0);
    await uiLogin(first.page, 'kt.tran@congty.com'); await first.page.getByRole('button', { name: 'CRT-FIN-ACTIVE', exact: true }).first().waitFor();
    second.calls.length = 0; await second.page.reload(); await second.page.locator('.login-card').waitFor();
    assert.equal(second.calls.filter(call => call === 'POST /auth/refresh').length, 0);
    assert.equal(await second.page.getByRole('button', { name: 'CRT-FIN-ACTIVE', exact: true }).count(), 0);
    assert.equal(await second.page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => /eyJ[A-Za-z0-9_-]+\./.test(value))), false);
    assert.equal(first.errors.length + second.errors.length, 0);
    return { sharedCookieContext: true, siblingClearedOnLogout: true, siblingF5StayedSignedOutAfterAccountSwitch: true, siblingRefreshRequestsAfterF5: 0, credentialStorage: false };
  });
  await test('M browser: USER forbidden route makes no privileged GET; unknown route recovers', async () => {
    const { page, calls, errors } = await newPage();
    await page.goto(new URL('/login', origin).href); await uiLogin(page, 'dev.nguyen@congty.com'); await page.waitForURL('**/dashboard');
    calls.length = 0; await page.goto(new URL('/users', origin).href);
    await page.getByRole('heading', { name: 'Bạn không có quyền mở trang này' }).waitFor();
    assert.ok(!calls.some(call => /^GET \/users(?:\?|$)/.test(call)));
    await page.goto(new URL('/missing-integration-page', origin).href); await page.getByRole('heading', { name: 'Không tìm thấy trang' }).waitFor();
    await page.getByRole('button', { name: 'Về tổng quan' }).click(); await page.waitForURL('**/dashboard'); assert.equal(errors.length, 0);
  });
  await test('M browser: Admin Users/Policies Back/Forward is SPA; Approvals blocked', async () => {
    const { page, errors } = await newPage();
    await page.goto(new URL('/users', origin).href); await uiLogin(page, 'admin@congty.com'); await page.waitForURL('**/users');
    await page.locator('table tbody tr').first().waitFor();
    const identity = randomUUID(); await page.evaluate(value => { window.__integrationDocument = value; }, identity);
    await page.locator('.nav-groups a[href="/policies"]').click(); await page.waitForURL('**/policies');
    await page.goBack(); await page.waitForURL('**/users'); await page.goForward(); await page.waitForURL('**/policies');
    assert.equal(await page.evaluate(() => window.__integrationDocument), identity);
    await page.goto(new URL('/approvals', origin).href); await page.getByRole('heading', { name: 'Bạn không có quyền mở trang này' }).waitFor(); assert.equal(errors.length, 0);
  });
  await test('M browser: mandatory password gate sends no business GET and returns to URL', async () => {
    const user = await createUser(['USER'], [], false);
    const { page, calls, errors } = await newPage({ width: 390, height: 844 });
    await page.goto(new URL('/assets', origin).href); await uiLogin(page, user.email, temporaryPassword);
    await page.getByRole('heading', { name: 'Đổi mật khẩu ban đầu' }).waitFor();
    assert.ok(!calls.some(call => /^GET \/(assets|requests|policies|dashboard|notifications)(?:\/|\?|$)/.test(call)));
    await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill(temporaryPassword);
    await page.locator('input[autocomplete="new-password"]').nth(0).fill(changedPassword);
    await page.locator('input[autocomplete="new-password"]').nth(1).fill(changedPassword);
    await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
    await page.locator('.login-card').waitFor(); await uiLogin(page, user.email, changedPassword); await page.waitForURL('**/assets');
    await page.getByRole('heading', { name: 'Tài sản của tôi', level: 1, exact: true }).waitFor(); assert.equal(errors.length, 0);
  });
  await test('M browser: logout clears real cookie/F5; another account sees only its assets', async () => {
    const { context, page, errors } = await newPage();
    await page.goto(new URL('/assets', origin).href); await uiLogin(page, 'dev.nguyen@congty.com'); await page.waitForURL('**/assets');
    await page.getByRole('button', { name: 'KEY-DEV-001', exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await page.locator('.login-card').waitFor();
    assert.equal((await context.cookies()).filter(cookie => cookie.name === 'crypta_refresh').length, 0);
    await page.reload(); await page.locator('.login-card').waitFor(); await uiLogin(page, 'kt.tran@congty.com'); await page.waitForURL('**/assets');
    await page.getByRole('button', { name: 'CRT-FIN-ACTIVE', exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'KEY-DEV-001', exact: true }).count(), 0); assert.equal(errors.length, 0);
  });
  await test('UC10: Admin changes approver scope from UI and invalidates open sessions', async () => {
    const user = await createUser();
    const prefix = `UC10-${randomUUID()}`;
    const inIt = await createRequest(account, prefix);
    const inFinance = await createRequest(finance, prefix);
    const financeDepartment = inFinance.departmentId;
    const operator = await newPage();
    const subject = await newPage();
    const queueUrl = new URL(`/approvals?q=${prefix}`, origin).href;
    const editor = operator.page.getByRole('region', { name: 'Phân quyền và phạm vi phòng ban' });
    const scope = id => editor.getByRole('checkbox', { name: reference.departments.find(department => department.id === id).name, exact: true });
    const save = editor.getByRole('button', { name: 'Lưu quyền truy cập', exact: true });
    async function selectSubject() {
      await editor.getByLabel('Người dùng', { exact: true }).selectOption(user.id);
    }
    async function saveAccess(oldSession) {
      assert.equal(await save.isDisabled(), true);
      await editor.getByRole('checkbox', { name: 'Xác nhận thay đổi quyền của tài khoản đã chọn.', exact: true }).check();
      const [response] = await Promise.all([
        operator.page.waitForResponse(result => result.request().method() === 'PUT' &&
          new URL(result.url()).pathname === `/api/v1/users/${user.id}/access`),
        save.click(),
      ]);
      assert.equal(response.status(), 200);
      await editor.getByText('Đã cập nhật quyền. Người dùng cần đăng nhập lại.', { exact: true }).waitFor();
      expectStatus(await call('GET', '/auth/me', undefined, oldSession.accessToken), 401, 'SESSION_REVOKED');
      assert.equal(sql(`SELECT count(*) FROM auth_sessions WHERE user_id='${user.id}' AND revoked_at IS NULL`), '0');
      await subject.page.reload();
      await subject.page.locator('.login-card').waitFor();
      await uiLogin(subject.page, user.email, changedPassword);
    }
    try {
      await operator.page.goto(new URL('/users/access', origin).href);
      await uiLogin(operator.page, admin.user.email);
      await editor.getByLabel('Tìm tài khoản để phân quyền', { exact: true }).fill(user.email);
      await editor.getByRole('button', { name: 'Tìm tài khoản', exact: true }).click();
      await selectSubject();
      await subject.page.goto(new URL('/assets', origin).href);
      await uiLogin(subject.page, user.email, changedPassword);
      await subject.page.getByRole('heading', { name: 'Tài sản của tôi', level: 1, exact: true }).waitFor();

      await editor.getByLabel('Vai trò', { exact: true }).selectOption('APPROVER');
      await scope(it).check();
      await scope(financeDepartment).check();
      await saveAccess(user);
      await subject.page.getByRole('heading', { name: 'Tài sản trong phạm vi phê duyệt', level: 1, exact: true }).waitFor();
      await subject.page.goto(queueUrl);
      const queue = subject.page.getByRole('region', { name: 'Hàng chờ phê duyệt', exact: true });
      const requests = queue.locator('table tbody button.table-link');
      await queue.getByText('Trang 1/1 · 2 yêu cầu', { exact: true }).waitFor();
      assert.deepEqual((await requests.allTextContents()).sort(), [inIt.id, inFinance.id].sort());
      const full = await login(user.email, changedPassword);
      assert.deepEqual(full.user.roles, ['APPROVER']);
      assert.deepEqual([...full.user.approverDepartmentIds].sort(), [it, financeDepartment].sort());
      expectStatus(await call('GET', `/requests/${inFinance.id}`, undefined, full.accessToken), 200);

      await selectSubject();
      assert.equal(await scope(it).isChecked(), true);
      assert.equal(await scope(financeDepartment).isChecked(), true);
      await scope(financeDepartment).uncheck();
      await saveAccess(full);
      await queue.getByText('Trang 1/1 · 1 yêu cầu', { exact: true }).waitFor();
      assert.deepEqual(await requests.allTextContents(), [inIt.id]);
      const reduced = await login(user.email, changedPassword);
      assert.deepEqual(reduced.user.roles, ['APPROVER']);
      assert.deepEqual(reduced.user.approverDepartmentIds, [it]);
      expectStatus(await call('GET', `/requests/${inIt.id}`, undefined, reduced.accessToken), 200);
      expectStatus(await call('GET', `/requests/${inFinance.id}`, undefined, reduced.accessToken), 404);
      const audit = JSON.parse(sql(`SELECT json_agg(metadata->'scopes' ORDER BY id) FROM audit_logs
        WHERE entity_id='${user.id}' AND entity_type='USER' AND action='USER_ACCESS_CHANGED' AND actor_id='${admin.user.id}';`));
      assert.deepEqual(audit.map(scopes => scopes.sort()), [[it, financeDepartment].sort(), [it]]);
      assert.deepEqual([...operator.errors, ...subject.errors], []);
      return { scopeChangesFromAdminUi: 2, revokedExistingSessions: true, visibleRequests: [2, 1], removedRequestDenied: 404, auditEvents: 2 };
    } finally {
      await Promise.all([operator.context.close(), subject.context.close()]);
    }
  });
  await test('T26: notification target scope, paging, read state and deleted links', async () => {
    const owner = await createUser();
    const watcher = await createUser(['APPROVER'], [it]);
    const request = await createRequest(owner, 'notification target');
    const asset = randomUUID();
    const deletedAsset = randomUUID();
    const olderNotice = randomUUID();
    const deletedNotice = randomUUID();
    const assetCode = `T26-ASSET-${asset}`;
    const deletedCode = `T26-DELETED-${deletedAsset}`;
    sql(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,valid_from,expires_at)
      VALUES ('${asset}','${assetCode}','KEY','${owner.user.id}','${it}','${policy.id}','T26 fixture',NOW(),NOW()+INTERVAL '30 days'),
        ('${deletedAsset}','${deletedCode}','KEY','${owner.user.id}','${it}','${policy.id}','T26 fixture',NOW(),NOW()+INTERVAL '30 days');
      INSERT INTO notifications(id,recipient_id,asset_id,type,channel,deduplication_key,delivery_status,sent_at,created_at)
      VALUES ('${olderNotice}','${owner.user.id}','${asset}','ASSET_EXPIRING','IN_APP','${stamp}:t26:old','SENT',NOW(),NOW()-INTERVAL '1 hour'),
        ('${deletedNotice}','${owner.user.id}','${deletedAsset}','ASSET_EXPIRING','IN_APP','${stamp}:t26:delete','SENT',NOW(),NOW()+INTERVAL '1 second'),
        (gen_random_uuid(),'${owner.user.id}','${asset}','ASSET_EXPIRING','EMAIL','${stamp}:t26:email','PENDING',NULL,NOW()),
        (gen_random_uuid(),'${watcher.user.id}','${asset}','ASSET_EXPIRING','IN_APP','${stamp}:t26:watch','SENT',NOW(),NOW()),
        (gen_random_uuid(),'${admin.user.id}','${asset}','ASSET_EXPIRING','IN_APP','${stamp}:t26:admin','SENT',NOW(),NOW());
      INSERT INTO notifications(recipient_id,asset_id,type,channel,deduplication_key,delivery_status,sent_at)
      SELECT '${owner.user.id}','${asset}','ASSET_EXPIRING','IN_APP','${stamp}:t26:page:'||n,'SENT',NOW() FROM generate_series(1,9) AS n;`);

    const list = async (actor, query = '?page=1&pageSize=10') =>
      expectStatus(await call('GET', `/notifications${query}`, undefined, actor.accessToken), 200);
    const scoped = (await list(watcher)).items;
    assert.equal(scoped.find(item => item.type === 'REQUEST_SUBMITTED')?.requestId, request.id);
    assert.equal(scoped.find(item => item.type === 'ASSET_EXPIRING')?.assetId, asset);
    assert.equal((await list(admin, `?search=${assetCode}`)).items[0]?.assetId, asset);
    assert.equal((await list(watcher)).items.some(item => item.id === olderNotice), false);
    const forbiddenWrite = await call('PATCH', `/notifications/${olderNotice}/read`, undefined, watcher.accessToken);
    assert.equal(expectStatus(forbiddenWrite, 200).updated, 0);

    expectStatus(await call('PUT', `/users/${watcher.user.id}/access`, {
      roles: ['APPROVER'], approverDepartmentIds: [finance.user.departmentId],
    }, admin.accessToken), 200);
    const reauthenticated = await login(watcher.email, changedPassword);
    for (const items of [(await list(reauthenticated)).items, await list(reauthenticated, '')]) {
      assert.equal(items.length, 2);
      for (const item of items) {
        assert.equal(item.requestId, null);
        assert.equal(item.assetId, null);
        assert.equal(item.description, null);
        assert.equal(item.assetCode, null);
      }
    }
    assert.equal((await list(reauthenticated, `?search=${assetCode}`)).total, 0);

    const mobile = await newPage({ width: 390, height: 844 });
    const desktop = await newPage();
    const administration = await newPage();
    try {
      await mobile.page.goto(new URL('/notifications', origin).href);
      await uiLogin(mobile.page, watcher.email, changedPassword);
      const hiddenRequest = mobile.page.getByRole('article').filter({ hasText: 'Yêu cầu mới' });
      await hiddenRequest.getByRole('button', { name: 'Xem chi tiết' }).press('Enter');
      await hiddenRequest.getByRole('alert').getByText(/quyền xem đã thay đổi/i).waitFor();
      assert.ok(!(await hiddenRequest.textContent()).includes(request.id));
      assert.ok(!mobile.calls.includes(`GET /requests/${request.id}`));

      await administration.page.goto(new URL('/notifications', origin).href);
      await uiLogin(administration.page, admin.user.email);
      const adminNotice = administration.page.getByRole('article').filter({ hasText: assetCode });
      await adminNotice.getByRole('button', { name: 'Xem chi tiết' }).press('Enter');
      await administration.page.waitForURL(new URL(`/assets/${asset}`, origin).href);

      const secondPage = (await list(owner, '?page=2&pageSize=10')).items;
      assert.deepEqual(secondPage.map(item => item.id), [olderNotice]);
      await desktop.page.goto(new URL('/notifications?page=2', origin).href);
      await uiLogin(desktop.page, owner.email, changedPassword);
      const oldItem = desktop.page.getByRole('article');
      await oldItem.getByRole('button', { name: 'Đánh dấu đã đọc' }).press('Enter');
      const readButton = oldItem.getByRole('button', { name: 'Đánh dấu đã đọc' });
      await readButton.waitFor({ state: 'hidden' });
      assert.equal((await list(owner, '?read=false')).total, 10);
      await desktop.page.reload();
      await oldItem.getByText(assetCode, { exact: true }).waitFor();
      await desktop.page.locator('[aria-label="10 thông báo chưa đọc"]').first().waitFor({ state: 'attached' });
      assert.equal(await readButton.count(), 0);
      await desktop.page.getByRole('button', { name: 'Trước', exact: true }).press('Enter');
      const stale = desktop.page.getByRole('article').filter({ hasText: deletedCode });
      await stale.getByText(deletedCode, { exact: true }).waitFor();
      sql(`DELETE FROM crypto_assets WHERE id='${deletedAsset}'`);
      await stale.getByRole('button', { name: 'Xem chi tiết' }).press('Enter');
      await stale.getByRole('alert').getByText('Không tìm thấy tài sản.').waitFor();
      assert.equal(new URL(desktop.page.url()).pathname, '/notifications');
      assert.ok(!desktop.calls.includes(`PATCH /notifications/${deletedNotice}/read`));

      await desktop.page.locator('.notification-heading').getByRole('button', { name: 'Đánh dấu đã đọc' }).press('Enter');
      await desktop.page.locator('[aria-label$=" thông báo chưa đọc"]').first().waitFor({ state: 'detached' });
      assert.equal((await list(owner, '?read=false')).total, 0);
      assert.equal(sql(`SELECT count(*) FROM notifications WHERE deduplication_key='${stamp}:t26:email'
        AND delivery_status='PENDING' AND read_at IS NULL`), '1');
      assert.deepEqual([...mobile.errors, ...desktop.errors, ...administration.errors], []);
      return { pagedTotal: 11, unreadAfterReload: 10, unreadAfterMarkAll: 0, roles: 3, deletedTargetStayedOnList: true,
        hiddenTargetRedacted: true, foreignReadDenied: true, emailUntouched: true };
    } finally {
      await Promise.all([mobile.context.close(), desktop.context.close(), administration.context.close()]);
    }
  });
  await test('UC11–UC12: expiry job catches up after downtime and reaches the correct users', async () => {
    const owner = await createUser();
    const outside = await createUser(['APPROVER'], [finance.user.departmentId]);
    const prefix = `EXP-${randomUUID()}`;
    const expiryPolicy = randomUUID();
    const expiryVersion = randomUUID();
    const fixtures = [
      { id: randomUUID(), code: `${prefix}-soon`, status: 'ACTIVE', delay: '12 hours' },
      { id: randomUUID(), code: `${prefix}-past`, status: 'ACTIVE', delay: '2 seconds' },
      { id: randomUUID(), code: `${prefix}-revoked`, status: 'REVOKED', delay: '2 seconds' },
      { id: randomUUID(), code: `${prefix}-superseded`, status: 'SUPERSEDED', delay: '2 seconds' },
    ];
    const [soon, past] = fixtures;
    const ids = fixtures.map(({ id }) => `'${id}'`).join(',');
    const effects = () => JSON.parse(sql(`SELECT json_build_object(
      'statuses', (SELECT json_object_agg(id,status) FROM crypto_assets WHERE id IN (${ids})),
      'audit', (SELECT COALESCE(json_agg(json_build_array(entity_id,action) ORDER BY id),'[]')
        FROM audit_logs WHERE entity_type='CRYPTO_ASSET' AND entity_id IN (${ids})),
      'notices', (SELECT COALESCE(json_agg(json_build_array(asset_id,recipient_id,channel,type,delivery_status) ORDER BY deduplication_key),'[]')
        FROM notifications WHERE asset_id IN (${ids})));`));
    async function waitForScan(previousProcess) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const metrics = await fetch(new URL('/api/v1/operations/metrics', origin), {
          headers: { Authorization: `Bearer ${admin.accessToken}` }, signal: AbortSignal.timeout(3_000),
        })
          .then(response => response.ok && response.json()).catch(() => null);
        const process = metrics?.data?.process;
        if (process?.since && process.since !== previousProcess && process.jobs.expiryScan) {
          assert.equal(process.jobs.expiryScan.outcome, 'completed');
          return process.since;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('The isolated backend did not catch up on expiry during startup.');
    }

    docker([...compose, 'stop', 'backend']);
    try {
      sql(`INSERT INTO policies(id,code,name) VALUES('${expiryPolicy}','${prefix}','Expiry E2E');
        INSERT INTO policy_versions(id,policy_id,version,configuration)
          SELECT '${expiryVersion}','${expiryPolicy}',1,configuration || '{"warning_days":[30,7,1]}'::jsonb
          FROM policy_versions WHERE id='${policy.id}';
        INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at)
          VALUES ${fixtures.map(({ id, code, status, delay }) =>
            `('${id}','${code}','KEY','${owner.user.id}','${it}','${expiryVersion}','Expiry E2E','${status}',NOW()-INTERVAL '1 day',NOW()+INTERVAL '${delay}')`).join(',')};
        SELECT pg_sleep(2.1);`);
      assert.equal(sql(`SELECT status='ACTIVE' AND expires_at<=clock_timestamp() FROM crypto_assets WHERE id='${past.id}'`), 't');
      assert.deepEqual(effects().notices, []);
    } finally {
      docker([...compose, 'start', 'backend']);
    }
    const firstProcess = await waitForScan();
    const first = effects();
    assert.deepEqual(first.statuses, Object.fromEntries(fixtures.map(({ id, status }) => [id,
      id === soon.id ? 'EXPIRING_SOON' : id === past.id ? 'EXPIRED' : status])));
    assert.deepEqual(first.audit, [[past.id, 'ASSET_MARKED_EXPIRED'], [soon.id, 'ASSET_MARKED_EXPIRING_SOON']]);
    for (const [asset, type] of [[soon, 'ASSET_EXPIRING'], [past, 'ASSET_EXPIRED']]) {
      const rows = first.notices.filter(([assetId]) => assetId === asset.id);
      for (const actor of [owner, approver, admin]) {
        assert.deepEqual(rows.filter(([, recipient]) => recipient === actor.user.id).map(([, , ...delivery]) => delivery),
          [['EMAIL', type, 'PENDING'], ['IN_APP', type, 'SENT']]);
      }
      assert.ok(!rows.some(([, recipient]) => recipient === outside.user.id));
      assert.equal(new Set(rows.map(row => row.slice(1, 3).join(':'))).size, rows.length);
    }
    assert.ok(first.notices.every(([assetId]) => assetId === soon.id || assetId === past.id));

    docker([...compose, 'restart', 'backend']);
    await waitForScan(firstProcess);
    assert.deepEqual(effects(), first);

    for (const [actor, password, allowed] of [[owner, changedPassword, true], [approver, undefined, true],
      [admin, undefined, true], [outside, changedPassword, false]]) {
      const { context, page, errors } = await newPage();
      try {
        await page.goto(new URL('/notifications', origin).href);
        await uiLogin(page, actor.user.email, password);
        if (allowed) {
          const warning = page.getByRole('article').filter({ hasText: soon.code });
          const expired = page.getByRole('article').filter({ hasText: past.code });
          await warning.getByText('Tài sản sắp hết hạn', { exact: true }).waitFor();
          await expired.getByText('Tài sản đã hết hạn', { exact: true }).waitFor();
          if (actor === owner) {
            await expired.getByRole('button', { name: 'Xem chi tiết' }).press('Enter');
            await page.waitForURL(new URL(`/assets/${past.id}`, origin).href);
            await page.locator('.drawer-status').getByText('Đã hết hạn', { exact: true }).waitFor();
          }
        } else {
          await page.locator('#notifications .activity-list[aria-busy="false"]').waitFor();
          assert.equal(await page.getByRole('article').filter({ hasText: prefix }).count(), 0);
          const outsidePage = expectStatus(await call('GET', `/notifications?search=${prefix}`, undefined, actor.accessToken), 200);
          assert.equal(outsidePage.total, 0);
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    return { crossedExpiryWhileStopped: true, auditEvents: 2, notifications: first.notices.length,
      rolesWithNotifications: 3, outsideScopeExcluded: true, duplicateFreeAfterRestart: true, emailDelivered: false };
  });
  await test('M API/DB: concurrent removal preserves the last active Admin', async () => {
    const second = await createUser(['ADMIN']);
    const cisoId = '04444444-6666-6666-6666-666666666666';
    let winner;
    try {
      expectStatus(await call('PATCH', `/users/${cisoId}/status`, { status: 'INACTIVE' }, admin.accessToken), 200);
      const responses = await Promise.all([
        call('PATCH', `/users/${second.id}/status`, { status: 'INACTIVE' }, admin.accessToken),
        call('PATCH', `/users/${admin.user.id}/status`, { status: 'INACTIVE' }, second.accessToken),
      ]);
      assert.equal(responses.filter(r => r.status === 200).length, 1);
      const rejected = responses.find(r => r.status !== 200);
      assert.ok((rejected.status === 401 && ['SESSION_REVOKED', 'SESSION_INVALID'].includes(rejected.code)) ||
        (rejected.status === 409 && rejected.code === 'LAST_ACTIVE_ADMIN'));
      const count = Number(sql("SELECT COUNT(DISTINCT u.id) FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.status='ACTIVE' AND r.code='ADMIN'"));
      assert.equal(count, 1);
      winner = responses[0].status === 200 ? admin : second;
      return { statuses: responses.map(r => r.status), activeAdmins: count };
    } finally {
      // Restore the test seed only; no request ever addresses the operational project.
      if (!winner) {
        const adminState = sql(`SELECT status FROM users WHERE id='${admin.user.id}'`);
        winner = adminState === 'ACTIVE' ? await login('admin@congty.com') : await login(second.email, changedPassword);
      }
      expectStatus(await call('PATCH', `/users/${cisoId}/status`, { status: 'ACTIVE' }, winner.accessToken), 200);
      if (winner.user.id !== admin.user.id) expectStatus(await call('PATCH', `/users/${admin.user.id}/status`, { status: 'ACTIVE' }, winner.accessToken), 200);
      const restored = await login('admin@congty.com');
      expectStatus(await call('PATCH', `/users/${second.id}/status`, { status: 'INACTIVE' }, restored.accessToken), 200);
    }
  });
  await Promise.all(contexts.map(context => context.close()));
  const summary = { createdUtc: new Date().toISOString(), project: stack.project, origin: origin.origin, database: stack.database, fixtureOnly: false, interceptedRequests, smtpEnabled: false, provider: 'MOCK', browser: channel, browserVersion: browser.version(), buildAssets, runtimeImages, passed: results.filter(r => r.passed).length, total: results.length, results, limitations: ['Local HTTP COOKIE_SECURE=false; does not validate production TLS cookie behavior.', 'Logout revokes the refresh session; existing access JWT follows the current short TTL contract.', 'Cross-tab cookie serialization uses Web Locks or IndexedDB. With both unavailable, refresh deduplication is per tab. Account-boundary checks across tabs require local storage.', 'NAV-21 injects response loss at the browser after the real Nginx/API request completes.', 'No short-TTL open-UI expiration, native screen reader, real provider or SMTP delivery acceptance.'] };
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`${summary.passed}/${summary.total} real integration groups passed; report ${path.join(output, 'results.json')}`);
  if (summary.passed !== summary.total) process.exitCode = 1;
}
main().catch(error => { console.error(`Integration setup failed: ${error.name}: ${error.message}`); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
