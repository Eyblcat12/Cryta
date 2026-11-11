// T27/T48: real PostgreSQL, actual compiled services, generated test project only.
// Creates and removes a new test database; never reads the operational .env.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');

async function main(reportArgument) {
  assert.ok(reportArgument, 'Pass a fresh retained isolated-stack report.json.');
  const root = path.resolve(__dirname, '..');
  const artifactRoot = await fs.realpath(path.join(__dirname, 'test-artifacts', 'integration'));
  const reportPath = await fs.realpath(path.resolve(reportArgument));
  assert.ok(reportPath.startsWith(artifactRoot + path.sep), 'Report must be inside the test artifact root.');
  assert.equal(path.basename(reportPath), 'report.json');
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
  assert.equal(origin.protocol, 'http:');
  assert.equal(origin.hostname, '127.0.0.1');
  assert.ok(origin.port && origin.port !== '8080', 'Refusing the operational frontend binding.');
  const envFile = await fs.realpath(path.join(path.dirname(reportPath), 'test.env'));
  assert.equal(path.dirname(envFile), path.dirname(reportPath), 'Test env must belong to this report directory.');
  const compose = ['compose', '--project-name', stack.project, '--env-file', envFile,
    '--file', path.join(root, 'tools', 'testing', 'compose.t30.yml')];
  function docker(args, input, timeout = 30000) {
    // Keep Docker diagnostics in memory: an error can otherwise echo env values.
    try {
      return execFileSync('docker', args, { input, encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'], timeout, maxBuffer: 8 * 1024 * 1024 }).trim();
    } catch {
      throw new Error('Isolated Docker command failed; no configuration or credentials were printed.');
    }
  }
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json']));
  assert.equal(config.name, stack.project);
  assert.equal(config.services.backend.environment.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(String(config.services.backend.environment.SMTP_ENABLED), 'false');
  assert.equal(config.services.postgres.environment.POSTGRES_DB, 'crypta_t30_test');
  assert.equal(config.services.postgres.environment.POSTGRES_USER, 'crypta_t30_test');
  assert.equal(config.volumes.test_postgres.name, `${stack.project}_test_postgres`);
  assert.equal(config.volumes.test_postgres.external, undefined);
  const ids = docker([...compose, 'ps', '-q']).split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 3, 'Expected the three running generated test services.');
  const containers = JSON.parse(docker(['inspect', ...ids]));
  for (const item of containers) {
    assert.equal(item.Config.Labels['com.docker.compose.project'], stack.project);
    assert.equal(item.State.Running, true);
  }
  assert.deepEqual(containers.map(item => item.Config.Labels['com.docker.compose.service']).sort(),
    ['backend', 'frontend', 'postgres']);
  const backend = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'backend');
  const postgres = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'postgres');
  const frontend = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'frontend');
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK'));
  assert.ok(backend.Config.Env.includes('SMTP_ENABLED=false'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_USER=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(mount => mount.Type === 'volume'
    && mount.Name === `${stack.project}_test_postgres`));
  const binding = frontend.NetworkSettings.Ports['80/tcp'];
  assert.ok(binding?.length === 1 && binding[0].HostIp === '127.0.0.1'
    && binding[0].HostPort === origin.port, 'Frontend binding must match the isolated report.');
  const databaseSetting = backend.Config.Env.find(value => value.startsWith('DATABASE_URL='));
  assert.ok(databaseSetting, 'Expected the isolated backend database setting.');
  const databaseUrl = new URL(databaseSetting.slice('DATABASE_URL='.length));
  assert.equal(databaseUrl.protocol, 'postgresql:');
  assert.equal(databaseUrl.hostname, 'postgres');
  assert.equal(databaseUrl.pathname, '/crypta_t30_test');
  assert.equal(databaseUrl.username, 'crypta_t30_test');
  function sql(database, query) {
    assert.ok(database === stack.database || /^crypta_runtime_test_[a-f0-9]{12}$/.test(database));
    return docker([...compose, 'exec', '-T', 'postgres', 'psql', '-X', '-U', 'crypta_t30_test',
      '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'], query);
  }
  assert.equal(sql(stack.database, 'SELECT current_database();'), stack.database);
  function inventory() {
    // Native negative-label filters can omit unlabeled containers. Read every
    // subject first, then exclude only this exact generated project in JS.
    const lines = docker(['ps', '-a', '--no-trunc', '--format',
      '{"id":{{json .ID}},"name":{{json .Names}},"project":{{json (.Label "com.docker.compose.project")}}}']);
    const items = lines.split('\n').filter(Boolean).map(line => {
      let item;
      try { item = JSON.parse(line); } catch { throw new Error('Container inventory JSON could not be validated.'); }
      assert.ok(item && typeof item === 'object');
      assert.match(item.id, /^[a-f0-9]{64}$/);
      assert.ok(typeof item.name === 'string' && item.name.length > 0);
      assert.equal(typeof item.project, 'string');
      return { id: item.id, name: item.name, project: item.project };
    }).sort((left, right) => left.id.localeCompare(right.id));
    assert.equal(new Set(items.map(item => item.id)).size, items.length, 'Container inventory has duplicate IDs.');
    return items;
  }
  const beforeInventory = inventory();
  const beforeOthers = beforeInventory.filter(item => item.project !== stack.project);
  const beforeIsolated = beforeInventory.filter(item => item.project === stack.project);
  assert.deepEqual(beforeIsolated.map(item => item.id).sort(), containers.map(item => item.Id).sort(),
    'Full inventory must contain exactly the validated isolated containers.');
  const runId = randomBytes(6).toString('hex');
  const testDatabase = `crypta_runtime_test_${runId}`;
  assert.match(testDatabase, /^crypta_runtime_test_[a-f0-9]{12}$/);
  assert.equal(sql(stack.database, `SELECT COUNT(*) FROM pg_database WHERE datname='${testDatabase}';`), '0');
  const testRole = `crypta_runtime_role_${runId}`;
  const testRoles=[testRole,`crypta_owner_role_${runId}`,`crypta_migrator_role_${runId}`];
  for(const role of testRoles)assert.equal(sql(stack.database, `SELECT COUNT(*) FROM pg_roles WHERE rolname='${role}';`), '0');
  const output = path.join(path.dirname(reportPath), `runtime-privileges-${runId}`);
  await fs.mkdir(output, { recursive: false });
  const grantsSql = await fs.readFile(path.join(__dirname,'testing/runtime-grants.sql'),'utf8');
  const seed = await fs.readFile(path.join(root,'seed_data.sql'),'utf8');
  const schema = await fs.readFile(path.join(root, 'database_schema.sql'), 'utf8');
  const runnerPath = path.join(__dirname, 'testing', 'runtime-privileges-runner.cjs');
  const accountRunner = await fs.readFile(path.join(__dirname, 'testing/account-actions-runner.cjs'), 'utf8');
  const emailTestRunner = await fs.readFile(path.join(__dirname, 'testing/email-test-operations-runner.cjs'), 'utf8');
  const runner = emailTestRunner + '\n' + accountRunner + '\n' + await fs.readFile(runnerPath, 'utf8');
  const hashFile = async relative => createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex');
  const report = {
    project: stack.project, sourceDatabase: stack.database, testDatabase,
    createdUtc: new Date().toISOString(), fixtureOnly: false, provider: 'MOCK', smtpEnabled: false,
    applicationSourceChanged: false, success: false, cleanupCompleted: false,
    operationalEnvironmentRead: false, reportSource: path.relative(root, reportPath).split(path.sep).join('/'),
    runtimeImages: containers.map(item => ({ service: item.Config.Labels['com.docker.compose.service'], imageId: item.Image })),
    sourceHashes: {}, results: [], containerInventoryBefore: beforeInventory,
    outsideContainerInventoryBefore: beforeOthers, outsideContainerCountBefore: beforeOthers.length,
    comparisonHasSubjects: beforeOthers.length > 0, limitations: [
      'Real LOGIN roles and a child API process in the allocated test DB. Provider MOCK and SMTP disabled; no production deployment or external delivery acceptance.',
      'Explicit narrow UPDATE column exceptions support PostgreSQL row locks; this is not per-user RLS or protection against DBA.',
    ],
  };
  for (const relative of ['tools/test-real-runtime-privileges.cjs', 'tools/testing/runtime-privileges-runner.cjs', 'tools/testing/account-actions-runner.cjs',
    'tools/testing/email-test-operations-runner.cjs','backend/src/notifications/email-test.service.ts','backend/src/notifications/email-worker.service.ts','backend/src/notifications/notifications.service.ts','backend/src/notifications/notifications.controller.ts','backend/src/notifications/notifications.module.ts','backend/src/notifications/asset-alert-recipient.ts','backend/src/jobs/expiry-warning-policy.ts','backend/src/jobs/expiry-scan.service.ts',
    'database_schema.sql','seed_data.sql','tools/testing/runtime-grants.sql', 'backend/src/database/migrate.ts',
    'backend/src/database/database.module.ts', 'backend/src/database/migration.service.ts',
    'backend/src/audit/audit-context.ts','backend/src/audit/audit-redaction.ts','backend/src/audit/http-failure-audit.service.ts','backend/src/audit/audit.module.ts','backend/src/audit/audit.controller.ts','backend/src/common/api-exception.filter.ts','backend/src/common/request-context.middleware.ts','backend/src/main.ts','backend/src/auth/auth.service.ts']) {
    report.sourceHashes[relative] = await hashFile(relative);
  }
  let createdDatabase = false;
  try {
    sql(stack.database, `CREATE DATABASE "${testDatabase}" OWNER crypta_t30_test;`);
    createdDatabase = true;
    assert.equal(sql(testDatabase, 'SELECT current_database();'), testDatabase);
    // Bootstrap includes DROP statements; it is fed only to this newly-created empty DB.
    assert.equal(sql(testDatabase,
      "SELECT COUNT(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');"), '0');
    report.allocatedDatabaseWasEmptyBeforeSchema = true;
    sql(testDatabase, schema);
    sql(testDatabase, seed);
    const invocation = `\nmain(${JSON.stringify({ project: stack.project, database: testDatabase, grantsSql })})\n`
      + '.then(result => process.stdout.write(JSON.stringify(result)))\n'
      + ".catch(() => { process.stderr.write('Ledger runner failed without emitting connection data.'); process.exitCode = 1; });\n";
    // The runner reads DATABASE_URL from its already validated container environment,
    // then changes only the pathname to the new database. No secret is in CLI arguments.
    const result = JSON.parse(docker([...compose, 'exec', '-T', 'backend', 'node', '-'], runner + invocation, 240000));
    Object.assign(report, result);
    assert.equal(result.database, testDatabase);
    assert.equal(result.fixtureOnly, false);
    assert.ok(Array.isArray(result.results) && result.results.length > 0);
    report.success = result.success === true && result.results.every(test => test.passed === true);
  } catch (error) {
    report.success = false;
    report.error = error instanceof assert.AssertionError ? error.message : String(error.message).slice(0, 300);
  } finally {
    if (createdDatabase) {
      try {
        assert.match(testDatabase, /^crypta_runtime_test_[a-f0-9]{12}$/);
        assert.notEqual(testDatabase, stack.database);
        // Only the database allocated by this invocation can be dropped.
        sql(stack.database, `DROP DATABASE "${testDatabase}" WITH (FORCE);`);
        report.testDatabaseRemaining = Number(sql(stack.database,
          `SELECT COUNT(*) FROM pg_database WHERE datname='${testDatabase}';`));
        for(const role of testRoles)sql(stack.database, `DROP ROLE IF EXISTS "${role}";`);
        report.testRoleRemaining = Number(sql(stack.database, `SELECT COUNT(*) FROM pg_roles WHERE rolname IN (${testRoles.map(r=>"'"+r+"'").join(',')});`));
        report.roleRemaining=report.testRoleRemaining;
        report.cleanupCompleted = report.testDatabaseRemaining === 0 && report.testRoleRemaining === 0;
      } catch {
        report.cleanupCompleted = false;
        report.cleanupError = 'Allocated ledger test database cleanup failed; inspect its generated name in this report.';
      }
    }
    try {
      report.containerInventoryAfter = inventory();
      report.outsideContainerInventoryAfter = report.containerInventoryAfter.filter(item => item.project !== stack.project);
      report.outsideContainerCountAfter = report.outsideContainerInventoryAfter.length;
      report.otherContainerIdsPreserved = JSON.stringify(beforeOthers) === JSON.stringify(report.outsideContainerInventoryAfter);
      const afterIsolated = report.containerInventoryAfter.filter(item => item.project === stack.project);
      report.isolatedContainerIdsPreserved = JSON.stringify(beforeIsolated) === JSON.stringify(afterIsolated);
      if (!report.otherContainerIdsPreserved || !report.isolatedContainerIdsPreserved) {
        report.success = false;
        report.identityError = 'Container inventory changed; identities are not accepted as preserved.';
      }
    } catch {
      report.otherContainerIdsPreserved = false;
      report.isolatedContainerIdsPreserved = false;
      report.success = false;
      report.identityError = 'Final container inventory could not be validated.';
    }
    report.finishedUtc = new Date().toISOString();
    report.passed = report.results.filter(test => test.passed).length;
    report.total = report.results.length;
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    for (const test of report.results) console.log(`${test.passed ? 'PASS' : 'FAIL'} ${test.name}`);
    console.log(`Runtime ledger report: ${path.join(output, 'results.json')}`);
  }
  if (!report.success || !report.cleanupCompleted || !report.otherContainerIdsPreserved
    || !report.isolatedContainerIdsPreserved) process.exitCode = 1;
}

if (require.main === module) main(process.argv[2]).catch(() => {
  console.error('Runtime ledger safety validation failed before test execution; no environment values were printed.');
  process.exitCode = 1;
});
module.exports = { main };
