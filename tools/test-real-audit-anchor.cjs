const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'test-artifacts', 'integration');
const reportPath = fs.realpathSync(process.argv[2]);
assert.ok(reportPath.startsWith(root + path.sep) && path.basename(reportPath) === 'report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
assert.match(report.project, /^crypta-t30-test-[a-f0-9]{12}$/);
assert.equal(path.basename(path.dirname(reportPath)), report.project);
assert.ok(report.started && report.keptStack && !report.cleanupCompleted);
assert.equal(report.database, 'crypta_t30_test');
assert.equal(report.provider, 'MOCK');
assert.equal(report.smtpEnabled, false);
const origin = new URL(report.origin);
assert.ok(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && origin.port !== '8080');

const stamp = randomBytes(6).toString('hex');
const database = 'crypta_anchor_test_' + stamp;
const restoreDb = database + 'b';
const signer = 'crypta_anchor_sign_' + stamp;
const verifier = 'crypta_anchor_verify_' + stamp;
const output = path.join(path.dirname(reportPath), 'audit-anchor');
fs.mkdirSync(output);
const runner = fs.readFileSync(path.join(__dirname, 'testing', 'audit-anchor-runner.cjs'));
const compose = ['compose', '--project-name', report.project, '--env-file', path.join(path.dirname(reportPath), 'test.env'),
  '--file', path.join(__dirname, 'testing', 'compose.t30.yml')];
function docker(args, input) {
  return execFileSync('docker', [...compose, ...args], { input, timeout: 90_000, maxBuffer: 12 * 1024 * 1024,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
}
function psql(db, args = [], input) {
  return docker(['exec', '-T', 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', report.database,
    '-d', db, ...args], input);
}
function exercise(phase, ...args) {
  try { return JSON.parse(docker(['exec', '-T', 'backend', 'node', '-', phase, stamp, ...args], runner).toString()); }
  catch (error) {
    const detail = error.stderr?.toString().trim().split('\n').at(-1) ?? error.name;
    throw new Error(/^[\w ():.-]+$/.test(detail) ? detail : 'Audit checkpoint fixture failed.');
  }
}

const tests = [];
let failure;
try {
  assert.equal(psql(report.database, ['-c', `SELECT count(*) FROM pg_database WHERE datname IN ('${database}','${restoreDb}')`]).toString().trim(), '0');
  psql(report.database, ['-c', `CREATE DATABASE ${database}`]);
  psql(database, [], fs.readFileSync(path.join(__dirname, '../database_schema.sql')));
  const result = exercise('exercise');
  tests.push(...result.tests);
  psql(report.database, ['-c', `CREATE DATABASE ${restoreDb}`]);
  const dump = docker(['exec', '-T', 'postgres', 'pg_dump', '-U', report.database, '--no-owner', database]);
  psql(restoreDb, [], dump);
  tests.push(exercise('restore', result.head));
  for (const test of tests) console.log('PASS ' + test.name);
} catch (error) {
  failure = error instanceof Error ? error.message.split('\n')[0] : 'Audit checkpoint fixture failed.';
  console.error(failure);
} finally {
  let cleanupCompleted = false;
  try {
    exercise('cleanup');
    for (const db of [restoreDb, database]) psql(report.database, ['-c', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
    psql(report.database, ['-c', `DROP ROLE IF EXISTS ${signer},${verifier}`]);
    cleanupCompleted = true;
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({
      passed: tests.filter(test => test.passed).length, total: 5, success: !failure && tests.length === 5 && cleanupCompleted,
      cleanupCompleted, results: tests, failure,
    }, null, 2));
  }
  if (failure || tests.length !== 5 || !cleanupCompleted) process.exitCode = 1;
}
