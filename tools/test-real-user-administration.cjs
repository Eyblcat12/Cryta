// Real HTTP/DB transaction checks, restricted to a retained isolated test stack.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function docker(args, input) {
  const value = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 30000, maxBuffer: 2 ** 22 });
  if (value.status !== 0) throw new Error('Isolated Docker operation failed.');
  return value.stdout.trim();
}

async function main(reportArgument) {
  const root = path.resolve(__dirname, '..');
  const reportPath = await fs.realpath(reportArgument);
  const artifactRoot = await fs.realpath(path.join(__dirname, 'test-artifacts/integration'));
  assert.ok(reportPath.startsWith(artifactRoot + path.sep));
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.ok(stack.started && stack.keptStack && !stack.cleanupCompleted && stack.status === 'PASSED');
  assert.ok(stack.database === 'crypta_t30_test' && stack.provider === 'MOCK' && stack.smtpEnabled === false);
  assert.match(stack.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
  assert.notEqual(new URL(stack.origin).port, '8080');
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
  const sql = query => docker(['exec', '-i', postgres.Id, 'psql', '-XqAt', '-U', 'crypta_t30_test', '-d', stack.database, '-v', 'ON_ERROR_STOP=1'], query);
  const jsonSql = query => JSON.parse(sql(query));
  const output = path.join(path.dirname(reportPath), `user-administration-${Date.now()}`);
  await fs.mkdir(output);
  const report = { success: false, project: stack.project, fixtureOnly: false, interceptedRequests: 0,
    provider: 'MOCK', smtpEnabled: false, backendImage: backend.Image, results: [] };
  async function call(method, endpoint, body, token) {
    const response = await fetch(`${stack.origin}/api/v1${endpoint}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    const envelope = await response.json();
    return { status: response.status, code: envelope.error?.code, data: envelope.data };
  }
  function status(value, expected, code) {
    assert.equal(value.status, expected, `HTTP ${value.status}; expected ${expected}; code ${value.code || '-'}`);
    if (code) assert.equal(value.code, code);
    return value.data;
  }
  async function login(email, password = 'Password@123') { return status(await call('POST', '/auth/login', { email, password }), 200); }
  const admin = await login('admin@congty.com');
  const reference = status(await call('GET', '/users/reference-data', undefined, admin.accessToken), 200);
  const department = reference.departments.find(d => d.code === 'IT').id;
  const temporaryPassword = 'Initial@Test12345', password = 'Changed@Test12345';
  async function createUser(roles = ['USER']) {
    const email = `useradmin.${randomUUID()}@example.test`;
    const created = status(await call('POST', '/users', { email, displayName: 'User administration test', departmentId: department,
      temporaryPassword, roles, approverDepartmentIds: [] }, admin.accessToken), 201);
    const first = await login(email, temporaryPassword);
    status(await call('POST', '/auth/change-password', { currentPassword: temporaryPassword, newPassword: password }, first.accessToken), 200);
    return { ...created, ...await login(email, password) };
  }
  function snapshot(id) {
    assert.match(id, /^[a-f0-9-]{36}$/);
    return jsonSql(`SELECT json_build_object('user',(SELECT to_jsonb(u)-'password_hash'-'last_login_at' FROM users u WHERE id='${id}'),
      'roles',(SELECT coalesce(json_agg(r.code ORDER BY r.code),'[]') FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id='${id}'),
      'scopes',(SELECT coalesce(json_agg(department_id ORDER BY department_id),'[]') FROM approver_scopes WHERE user_id='${id}'),
      'sessions',(SELECT coalesce(json_agg(json_build_object('id',id,'revoked',revoked_at) ORDER BY id),'[]') FROM auth_sessions WHERE user_id='${id}'),
      'audit',(SELECT count(*) FROM audit_logs WHERE entity_type='USER' AND entity_id='${id}'));`);
  }
  async function until(test, description) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { const result = test(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Timed out waiting for ${description}.`);
  }
  async function test(name, run) {
    if (process.env.CRYPTA_USER_ADMIN_FILTER && !name.includes(process.env.CRYPTA_USER_ADMIN_FILTER)) return;
    const evidence = {};
    try { await run(evidence); report.results.push({ name, passed: true, evidence }); console.log(`PASS ${name}`); }
    catch (error) { report.results.push({ name, passed: false, evidence, error: error instanceof assert.AssertionError ? error.message : error.name }); console.log(`FAIL ${name}`); }
  }
  for (const revocation of ['access', 'INACTIVE', 'LOCKED']) {
    for (const operation of ['status', 'access']) {
      await test(`queued-${revocation}-${operation}: a revoked administrator cannot commit a previously authorized mutation`, async evidence => {
        const actor = await createUser(['ADMIN']), target = await createUser();
        const before = snapshot(target.id), email = `queued.${randomUUID()}@example.test`;
        const app = 't30_useradmin_' + randomUUID().replaceAll('-', '');
        const holder = spawn('docker', ['exec', '-e', `PGAPPNAME=${app}`, postgres.Id, 'psql', '-XqAt', '-U', 'crypta_t30_test', '-d', stack.database,
          '-v', 'ON_ERROR_STOP=1', '-c', 'BEGIN; SELECT pg_advisory_xact_lock(17232,1); SELECT pg_sleep(25); ROLLBACK;'], { stdio: ['ignore', 'pipe', 'pipe'] });
        const holderDone = new Promise(resolve => { holder.once('error', () => resolve('error')); holder.once('close', code => resolve(code)); });
        let holderPid, changePromise, queuedPromise;
        try {
          holderPid = await until(() => Number(sql(`SELECT pid FROM pg_stat_activity WHERE application_name='${app}' AND wait_event='PgSleep';`) || 0), 'test lock holder');
          changePromise = revocation === 'access'
            ? call('PUT', `/users/${actor.id}/access`, { roles: ['USER'], approverDepartmentIds: [] }, admin.accessToken)
            : call('PATCH', `/users/${actor.id}/status`, { status: revocation }, admin.accessToken);
          const waiters = () => Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE datname='crypta_t30_test' AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock(17232,1)%';`));
          await until(() => waiters() === 1, 'revocation queued first');
          queuedPromise = operation === 'status' ? call('PATCH', `/users/${target.id}/status`, { status: 'LOCKED' }, actor.accessToken)
            : operation === 'access' ? call('PUT', `/users/${target.id}/access`, { roles: ['APPROVER'], approverDepartmentIds: [department] }, actor.accessToken)
            : call('POST', '/users', { email, displayName: 'Queued user', departmentId: department, temporaryPassword, roles: ['USER'], approverDepartmentIds: [] }, actor.accessToken);
          await until(() => waiters() === 2, 'previously authorized mutation queued second');
          evidence.queuedWaitersBeforeRelease = waiters();
          evidence.lockHolder = holderPid;
        } finally {
          if (holderPid) sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=${holderPid} AND application_name='${app}' AND datname='crypta_t30_test' AND usename='crypta_t30_test';`);
          await holderDone;
        }
        const changed = await changePromise, queued = await queuedPromise;
        evidence.revocationStatus = changed.status; evidence.queuedStatus = queued.status; evidence.queuedCode = queued.code;
        evidence.targetUnchanged = JSON.stringify(snapshot(target.id)) === JSON.stringify(before);
        evidence.createdRows = Number(sql(`SELECT count(*) FROM users WHERE email='${email}';`));
        evidence.remainingHolders = Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${app}';`));
        status(changed, 200); status(queued, 401, 'SESSION_REVOKED');
        assert.ok(evidence.targetUnchanged); assert.equal(evidence.createdRows, 0); assert.equal(evidence.remainingHolders, 0);
      });
    }
  }
  await test('audit failure rolls back status/access, token version, scope and session revocation', async evidence => {
    const target = await createUser();
    const guard = 't30_useradmin_' + randomUUID().replaceAll('-', '');
    const before = snapshot(target.id);
    sql(`CREATE FUNCTION ${guard}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.entity_type='USER' AND NEW.entity_id='${target.id}' AND NEW.action IN ('USER_STATUS_CHANGED','USER_ACCESS_CHANGED') THEN RAISE EXCEPTION 'isolated audit fault'; END IF;
      RETURN NEW; END $$; CREATE TRIGGER ${guard} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${guard}();`);
    try {
      evidence.statusWrite = (await call('PATCH', `/users/${target.id}/status`, { status: 'LOCKED' }, admin.accessToken)).status;
      assert.equal(evidence.statusWrite, 500); assert.deepEqual(snapshot(target.id), before);
      evidence.accessWrite = (await call('PUT', `/users/${target.id}/access`, { roles: ['APPROVER'], approverDepartmentIds: [department] }, admin.accessToken)).status;
      assert.equal(evidence.accessWrite, 500); assert.deepEqual(snapshot(target.id), before);
      status(await call('GET', '/auth/me', undefined, target.accessToken), 200);
      evidence.rollbackVerified = true;
    } finally { sql(`DROP TRIGGER ${guard} ON audit_logs; DROP FUNCTION ${guard}();`); }
  });
  await test('successful status/access writes revoke old tokens and sessions with exactly one audit', async evidence => {
    evidence.operations = [];
    for (const operation of ['status', 'access']) {
      const target = await createUser(), before = snapshot(target.id);
      status(await call(operation === 'status' ? 'PATCH' : 'PUT', `/users/${target.id}/${operation}`,
        operation === 'status' ? { status: 'LOCKED' } : { roles: ['APPROVER'], approverDepartmentIds: [department] }, admin.accessToken), 200);
      const after = snapshot(target.id);
      assert.equal(after.user.token_version, before.user.token_version + 1);
      assert.ok(after.sessions.length && after.sessions.every(session => session.revoked));
      assert.equal(after.audit, before.audit + 1);
      status(await call('GET', '/auth/me', undefined, target.accessToken), 401);
      if (operation === 'access') { assert.deepEqual(after.roles, ['APPROVER']); assert.deepEqual(after.scopes, [department]); }
      else assert.equal(after.user.status, 'LOCKED');
      evidence.operations.push({ operation, auditDelta: 1, tokenVersionDelta: 1, revokedSessions: after.sessions.length });
    }
  });
  report.testResidues = jsonSql("SELECT json_build_object('triggers',(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND starts_with(tgname,'t30_useradmin_')),'functions',(SELECT count(*) FROM pg_proc WHERE starts_with(proname,'t30_useradmin_')),'holders',(SELECT count(*) FROM pg_stat_activity WHERE starts_with(application_name,'t30_useradmin_')));");
  assert.deepEqual(report.testResidues, { triggers: 0, functions: 0, holders: 0 });
  report.sourceHashes = {};
  for (const file of ['backend/src/users/users.service.ts', 'backend/src/auth/jwt-auth.guard.ts', 'tools/test-real-user-administration.cjs']) report.sourceHashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
  report.compiledHash = docker(['exec', backend.Id, 'sha256sum', 'dist/users/users.service.js']);
  assert.equal(report.compiledHash.split(/\s+/)[0], createHash('sha256').update(await fs.readFile(path.join(root, 'backend/dist/users/users.service.js'))).digest('hex'));
  report.success = report.results.length > 0 && report.results.every(result => result.passed);
  report.createdUtc = new Date().toISOString();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`${report.results.filter(result => result.passed).length}/${report.results.length}; report ${path.join(output, 'results.json')}`);
  if (!report.success) process.exitCode = 1;
}
main(process.argv[2]).catch(error => { console.error(`User administration setup failed: ${error.name}: ${error.message}`); process.exitCode = 1; });
