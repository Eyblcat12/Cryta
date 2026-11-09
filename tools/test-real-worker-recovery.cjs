// T13–T15/T48: actual compiled worker + PostgreSQL, generated MOCK stack only.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');

async function main(reportArgument, mode = 'after') {
  assert.ok(reportArgument, 'Pass a retained isolated-stack report.json.');
  assert.ok(['before', 'after'].includes(mode));
  const root = path.resolve(__dirname, '..');
  const artifactRoot = await fs.realpath(path.join(__dirname, 'test-artifacts', 'integration'));
  const reportPath = await fs.realpath(path.resolve(reportArgument));
  assert.ok(reportPath.startsWith(artifactRoot + path.sep));
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
  assert.ok(origin.port && origin.port !== '8080');
  const envFile = await fs.realpath(path.join(path.dirname(reportPath), 'test.env'));
  assert.equal(path.dirname(envFile), path.dirname(reportPath));
  const compose = ['compose', '--project-name', stack.project, '--env-file', envFile,
    '--file', path.join(root, 'tools', 'testing', 'compose.t30.yml')];
  function docker(args, input, timeout = 30000) {
    try {
      return execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        timeout, maxBuffer: 8 * 1024 * 1024 }).trim();
    } catch { throw new Error('Isolated Docker command failed; no configuration or credentials were printed.'); }
  }
  function inventory() {
    const output = docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}|{{.Names}}|{{.Label `com.docker.compose.project`}}']);
    const seen = new Set();
    return (output ? output.split(/\r?\n/) : []).map(line => {
      const fields = line.split('|');
      assert.equal(fields.length, 3, 'Malformed Docker inventory.');
      const [id, name, project] = fields;
      assert.match(id, /^[a-f0-9]{64}$/);
      assert.match(name, /^[A-Za-z0-9][A-Za-z0-9_.-]*(,[A-Za-z0-9][A-Za-z0-9_.-]*)*$/);
      assert.ok(project === '' || /^[a-z0-9][a-z0-9_-]*$/.test(project));
      assert.ok(!seen.has(id), 'Duplicate Docker container ID.'); seen.add(id);
      return { id, name, project };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json']));
  assert.equal(config.name, stack.project);
  assert.equal(config.services.backend.environment.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(String(config.services.backend.environment.SMTP_ENABLED), 'false');
  assert.equal(config.services.postgres.environment.POSTGRES_DB, 'crypta_t30_test');
  assert.equal(config.services.postgres.environment.POSTGRES_USER, 'crypta_t30_test');
  assert.equal(config.volumes.test_postgres.name, `${stack.project}_test_postgres`);
  assert.notEqual(config.volumes.test_postgres.external, true);
  const ids = docker([...compose, 'ps', '-q']).split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  assert.deepEqual(containers.map(item => item.Config.Labels['com.docker.compose.service']).sort(), ['backend', 'frontend', 'postgres']);
  for (const item of containers) {
    assert.equal(item.Config.Labels['com.docker.compose.project'], stack.project);
    assert.equal(item.State.Running, true);
  }
  const backend = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'backend');
  const postgres = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'postgres');
  const frontend = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'frontend');
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK'));
  assert.ok(backend.Config.Env.includes('SMTP_ENABLED=false'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_USER=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(item => item.Type === 'volume' && item.Name === `${stack.project}_test_postgres`));
  const binding = frontend.NetworkSettings.Ports['80/tcp'];
  assert.ok(binding?.length === 1 && binding[0].HostIp === '127.0.0.1' && binding[0].HostPort === origin.port);
  const databaseSetting = backend.Config.Env.find(value => value.startsWith('DATABASE_URL='));
  assert.ok(databaseSetting);
  const connection = new URL(databaseSetting.slice('DATABASE_URL='.length));
  assert.equal(connection.protocol, 'postgresql:'); assert.equal(connection.hostname, 'postgres');
  assert.equal(connection.username, 'crypta_t30_test'); assert.equal(connection.pathname, '/crypta_t30_test');
  function sql(database, query) {
    assert.ok(database === stack.database || /^crypta_worker_test_[a-f0-9]{12}$/.test(database));
    return docker([...compose, 'exec', '-T', 'postgres', 'psql', '-X', '-U', 'crypta_t30_test',
      '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'], query);
  }
  assert.equal(sql(stack.database, 'SELECT current_database();'), stack.database);
  const beforeInventory = inventory();
  const beforeOthers = beforeInventory.filter(item => item.project !== stack.project);
  const beforeIsolated = beforeInventory.filter(item => item.project === stack.project);
  assert.equal(beforeIsolated.length, 3);
  const runId = randomBytes(6).toString('hex'), testDatabase = `crypta_worker_test_${runId}`;
  assert.equal(sql(stack.database, `SELECT COUNT(*) FROM pg_database WHERE datname='${testDatabase}';`), '0');
  const output = path.join(path.dirname(reportPath), `worker-recovery-${mode}-${runId}`);
  await fs.mkdir(output, { recursive: false });
  const runner = await fs.readFile(path.join(__dirname, 'testing', 'worker-recovery-runner.cjs'), 'utf8');
  const certificatePem = await fs.readFile(path.join(root, 'backend/test/fixtures/provider-tls-test.pem'), 'utf8');
  const schema = await fs.readFile(path.join(root, 'database_schema.sql'), 'utf8');
  const report = {
    project: stack.project, sourceDatabase: stack.database, testDatabase, mode,
    createdUtc: new Date().toISOString(), fixtureOnly: false, provider: 'MOCK', smtpEnabled: false,
    success: false, cleanupCompleted: false, operationalEnvironmentRead: false,
    runtimeImages: containers.map(item => ({ service: item.Config.Labels['com.docker.compose.service'], imageId: item.Image })),
    containerInventoryBefore: beforeInventory, containerCountBefore: beforeInventory.length,
    outsideContainerInventoryBefore: beforeOthers, outsideContainerCountBefore: beforeOthers.length,
    comparisonHasSubjects: beforeOthers.length > 0, sourceHashes: {}, results: [],
  };
  for (const relative of ['tools/test-real-worker-recovery.cjs', 'tools/testing/worker-recovery-runner.cjs',
    'database_schema.sql', 'backend/test/fixtures/provider-tls-test.pem', 'backend/src/jobs/asset-processing.service.ts',
    'backend/src/jobs/crypto-provider.service.ts', 'backend/src/jobs/crypto-provider-config.ts',
    'backend/src/notifications/notifications.service.ts', 'backend/src/database/migration.service.ts',
    'backend/src/requests/request-policy.ts', 'backend/src/operations/operations-metrics.service.ts']) {
    report.sourceHashes[relative] = createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex');
  }
  let allocated = false;
  try {
    sql(stack.database, `CREATE DATABASE "${testDatabase}" OWNER crypta_t30_test;`); allocated = true;
    assert.equal(sql(testDatabase, 'SELECT current_database();'), testDatabase);
    assert.equal(sql(testDatabase, "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public';"), '0');
    sql(testDatabase, schema);
    const invocation = `\nmain(${JSON.stringify({ project: stack.project, database: testDatabase, mode, certificatePem })})\n`
      + '.then(result => process.stdout.write(JSON.stringify(result)))\n'
      + ".catch(() => { process.stderr.write('Worker runner failed without emitting connection data.'); process.exitCode = 1; });\n";
    const result = JSON.parse(docker([...compose, 'exec', '-T', 'backend', 'node', '-'], runner + invocation, 180000));
    Object.assign(report, result);
    assert.equal(result.database, testDatabase); assert.equal(result.fixtureOnly, false);
    assert.ok(Array.isArray(result.results) && result.results.length > 0);
    report.success = result.results.every(item => item.passed === true) && result.results.length === result.plannedTotal;
  } catch (error) {
    report.error = error instanceof assert.AssertionError ? error.message : String(error.message).slice(0, 300);
    report.success = false;
  } finally {
    if (allocated) {
      try {
        assert.match(testDatabase, /^crypta_worker_test_[a-f0-9]{12}$/); assert.notEqual(testDatabase, stack.database);
        sql(stack.database, `DROP DATABASE "${testDatabase}" WITH (FORCE);`);
        report.testDatabaseRemaining = Number(sql(stack.database, `SELECT COUNT(*) FROM pg_database WHERE datname='${testDatabase}';`));
        report.cleanupCompleted = report.testDatabaseRemaining === 0;
      } catch { report.cleanupError = 'Allocated worker test database cleanup failed; inspect its generated name in this report.'; }
    }
    try {
      report.containerInventoryAfter = inventory(); report.containerCountAfter = report.containerInventoryAfter.length;
      report.outsideContainerInventoryAfter = report.containerInventoryAfter.filter(item => item.project !== stack.project);
      report.outsideContainerCountAfter = report.outsideContainerInventoryAfter.length;
      report.otherContainerIdsPreserved = JSON.stringify(beforeOthers) === JSON.stringify(report.outsideContainerInventoryAfter);
      report.isolatedContainerIdsPreserved = JSON.stringify(beforeIsolated) === JSON.stringify(report.containerInventoryAfter.filter(item => item.project === stack.project));
    } catch { report.otherContainerIdsPreserved = false; report.isolatedContainerIdsPreserved = false; }
    report.success = report.success && report.cleanupCompleted && report.otherContainerIdsPreserved && report.isolatedContainerIdsPreserved;
    report.finishedUtc = new Date().toISOString(); report.passed = report.results.filter(item => item.passed).length; report.total = report.results.length;
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    for (const item of report.results) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}${item.passed ? '' : `: ${item.error}`}`);
    console.log(`Worker recovery report: ${path.join(output, 'results.json')}`);
  }
  if (!report.success || !report.cleanupCompleted || !report.otherContainerIdsPreserved || !report.isolatedContainerIdsPreserved) process.exitCode = 1;
}
if (require.main === module) main(process.argv[2], process.argv[3] || 'after').catch(() => {
  console.error('Worker recovery safety validation failed before execution; no environment values were printed.'); process.exitCode = 1;
});
module.exports = { main };
