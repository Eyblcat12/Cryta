const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { auditAnchorKeyId } = require('./dist/audit/audit-anchor-format');

const [phase, stamp, expectedRestoreHead] = process.argv.slice(2);
assert.match(stamp, /^[0-9a-f]{12}$/);
assert.ok(['exercise', 'restore', 'cleanup'].includes(phase));
const directory = path.join('/tmp', 'crypta-audit-anchor-' + stamp);
const anchors = path.join(directory, 'anchors');
const publicKeys = path.join(directory, 'keys');
const signer = 'crypta_anchor_sign_' + stamp;
const verifier = 'crypta_anchor_verify_' + stamp;
const source = 'crypta_anchor_test_' + stamp;
const restored = 'crypta_anchor_test_' + stamp + 'b';
const deployment = 'crypta-test-' + stamp;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const base = new URL(process.env.DATABASE_URL);
assert.equal(base.hostname, 'postgres');
assert.equal(base.pathname, '/crypta_t30_test');

function urlFor(database, role, password) {
  const url = new URL(base);
  url.pathname = '/' + database;
  if (role) { url.username = role; url.password = password; }
  return url.href;
}

function cli(operation, database, head, keyPath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['dist/audit/audit-anchor.cli.js', operation], {
      env: { ...process.env, AUDIT_ANCHOR_DATABASE_URL: database, AUDIT_ANCHOR_DEPLOYMENT: deployment,
        AUDIT_ANCHOR_DIRECTORY: anchors, AUDIT_ANCHOR_PUBLIC_KEYS_DIRECTORY: publicKeys,
        AUDIT_ANCHOR_SIGNING_KEY_FILE: keyPath, AUDIT_ANCHOR_EXPECTED_HEAD: head, AUDIT_ANCHOR_TEST_PLAINTEXT: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 25_000,
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', () => resolve({ ok: false, code: 'FIXTURE_PROCESS_FAILED' }));
    child.on('close', code => resolve(code === 0 ? { ok: true, result: JSON.parse(stdout) } : { ok: false, code: stderr.trim() }));
  });
}

function passed(result, label) {
  assert.equal(result.ok, true, label + ' (' + (result.code ?? 'ok') + ')');
  return result.result;
}

async function key(name) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const file = path.join(directory, name + '.pem');
  await fs.writeFile(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(publicKeys, auditAnchorKeyId(publicKey) + '.pem'), publicKey.export({ type: 'spki', format: 'pem' }),
    { flag: 'wx', mode: 0o600 });
  return file;
}

async function exercise() {
  const tests = [];
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.mkdir(anchors, { mode: 0o700 });
  await fs.mkdir(publicKeys, { mode: 0o700 });
  const signingKey = await key('signer-one');
  const nextKey = await key('signer-two');
  const secrets = { signer: randomBytes(32).toString('hex'), verifier: randomBytes(32).toString('hex') };
  await fs.writeFile(path.join(directory, 'role-fixture.json'), JSON.stringify(secrets), { flag: 'wx', mode: 0o600 });
  const adminUrl = urlFor(source);
  const migrated = spawnSync(process.execPath, ['dist/database/migrate.js'], {
    env: { ...process.env, DATABASE_URL: adminUrl }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  });
  assert.equal(migrated.status, 0, 'Migrate the disposable audit database');
  const pool = new Pool({ connectionString: adminUrl, max: 3, statement_timeout: 8_000 });
  const admin = await pool.connect();
  const signUrl = urlFor(source, signer, secrets.signer);
  const verifyUrl = urlFor(source, verifier, secrets.verifier);
  const insert = (client, action) => client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,outcome,metadata)
    VALUES ('SYSTEM',$1,'AUDIT_FIXTURE','SUCCESS','{"exact":9007199254740993}'::jsonb) RETURNING id::text`, [action]);
  try {
    for (const [name, password] of [[signer, secrets.signer], [verifier, secrets.verifier]]) {
      await admin.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
    }
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${signer},${verifier};
      GRANT SELECT ON public.audit_anchor_rows TO ${signer},${verifier};
      GRANT EXECUTE ON FUNCTION public.capture_audit_anchor_rows(bigint,integer) TO ${signer}`);
    assert.deepEqual((await admin.query(`SELECT has_function_privilege($1,'public.capture_audit_anchor_rows(bigint,integer)','EXECUTE') AS verifier_capture,
      has_table_privilege($2,'public.audit_logs','UPDATE') AS signer_write`, [verifier, signer])).rows[0],
    { verifier_capture: false, signer_write: false });
    tests.push({ name: 'The signer and verifier have separated database privileges', passed: true });

    const writer = await pool.connect();
    let first;
    try {
      await writer.query('BEGIN');
      const earlier = (await insert(writer, 'ANCHOR_EARLIER')).rows[0].id;
      const later = (await insert(admin, 'ANCHOR_LATER')).rows[0].id;
      assert.ok(BigInt(earlier) < BigInt(later));
      const sealing = cli('seal', signUrl, 'none', signingKey);
      let waited = false;
      for (let i = 0; i < 40; i++) {
        const lock = (await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='crypta-audit-anchor' AND wait_event_type='Lock'")).rowCount;
        if (lock) { waited = true; break; }
        await delay(25);
      }
      await writer.query('COMMIT');
      first = passed(await sealing, 'First checkpoint');
      assert.ok(waited, 'Capture must wait for the earlier uncommitted writer');
      assert.equal(first.rows, 2);
      assert.equal(first.throughId, later);
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined);
      writer.release();
    }
    tests.push({ name: 'Concurrent commit order preserves both rows in the first checkpoint', passed: true });
    const gap = (await admin.query("SELECT nextval('audit_logs_id_seq')::text AS id")).rows[0].id;
    await insert(admin, 'ANCHOR_ROTATED_KEY');
    const publication = await Promise.all([cli('seal', signUrl, first.head, nextKey), cli('seal', signUrl, first.head, nextKey)]);
    assert.equal(publication.filter(result => result.ok).length, 1);
    assert.match(publication.find(result => !result.ok).code, /^AUDIT_ANCHOR_(?:HEAD_MISMATCH|CONCURRENT_PUBLISH)$/);
    const second = publication.find(result => result.ok).result;
    assert.equal(second.sequence, 2);
    const verified = passed(await cli('verify', verifyUrl, second.head), 'Verify two rotated checkpoints');
    assert.equal(verified.anchoredRows, '3');
    assert.equal(verified.unanchoredRows, '0');
    tests.push({ name: 'One checkpoint wins concurrent publication and key rotation preserves the chain', passed: true });

    await admin.query('CREATE TEMP TABLE audit_anchor_saved AS SELECT * FROM audit_logs');
    const mutations = [
      ["UPDATE audit_logs SET metadata='{}'::jsonb WHERE action='ANCHOR_EARLIER'", 'AUDIT_ANCHOR_CONTENT_MISMATCH:1'],
      ["DELETE FROM audit_logs WHERE action='ANCHOR_LATER'", 'AUDIT_ANCHOR_CONTENT_MISMATCH:1'],
      [`INSERT INTO audit_logs(id,actor_type,action,entity_type,outcome) VALUES (${gap},'SYSTEM','ANCHOR_FAKE','AUDIT_FIXTURE','SUCCESS')`, 'AUDIT_ANCHOR_CONTENT_MISMATCH:2'],
    ];
    for (const [mutation, code] of mutations) {
      try {
        await admin.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_log_immutable; ${mutation};
          ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_log_immutable`);
        assert.deepEqual(await cli('verify', verifyUrl, second.head), { ok: false, code });
      } finally {
        await admin.query(`ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_log_immutable;
          DELETE FROM audit_logs; INSERT INTO audit_logs SELECT * FROM audit_anchor_saved;
          ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_log_immutable`);
      }
    }
    const last = path.join(anchors, '000000000002.json');
    await fs.rename(last, last + '.held');
    try { assert.deepEqual(await cli('verify', verifyUrl, second.head), { ok: false, code: 'AUDIT_ANCHOR_HEAD_MISMATCH' }); }
    finally { await fs.rename(last + '.held', last); }
    await insert(admin, 'ANCHOR_UNSEALED');
    const withSuffix = passed(await cli('verify', verifyUrl, second.head), 'Unsealed suffix is visible');
    assert.equal(withSuffix.unanchoredRows, '1');
    tests.push({ name: 'The verifier detects edits, deletion, inserted IDs and a missing head', passed: true });
    return { head: second.head, tests };
  } finally {
    admin.release();
    await pool.end();
  }
}

async function main() {
  if (phase === 'cleanup') {
    await fs.rm(directory, { recursive: true, force: true });
    return { cleaned: true };
  }
  if (phase === 'exercise') return exercise();
  assert.match(expectedRestoreHead, /^[a-f0-9]{64}$/);
  const { verifier: password } = JSON.parse(await fs.readFile(path.join(directory, 'role-fixture.json'), 'utf8'));
  const proof = passed(await cli('verify', urlFor(restored, verifier, password), expectedRestoreHead), 'Verify pg_dump restore');
  assert.equal(proof.anchoredRows, '3');
  assert.equal(proof.unanchoredRows, '1');
  return { name: 'A pg_dump restored into a separate database verifies against the same head', passed: true };
}

main().then(result => console.log(JSON.stringify(result))).catch(error => {
  const line = String(error.stack).match(/\[stdin\]:(\d+):\d+/)?.[1];
  console.error((error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.code ?? error.name) + ' at fixture line ' + line);
  process.exitCode = 1;
});
