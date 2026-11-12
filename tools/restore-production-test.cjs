const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { connectionOptions, databaseName, filePath, connection, postgres, readArchive, checkArchive, sha256File } = require('./postgres-operator.cjs');

const stringOptions = [...connectionOptions, 'maintenance-database', 'backup'];
const options = Object.fromEntries(stringOptions.map(name => [name, { type: 'string' }]));
const restoreOptions = ['--exit-on-error', '--no-owner', '--no-acl'];
const restrictAudit = `DO $restore$
BEGIN
  IF to_regclass('public.audit_anchor_rows') IS NOT NULL THEN
    REVOKE ALL ON public.audit_anchor_rows FROM PUBLIC;
  END IF;
  IF to_regprocedure('public.capture_audit_anchor_rows(bigint,integer)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.capture_audit_anchor_rows(bigint,integer) FROM PUBLIC;
  END IF;
END;
$restore$;`;

function sql(target, query, operation) {
  postgres(target, 'psql', ['-X', '--set=ON_ERROR_STOP=1', `--command=${query}`], ['ignore', 'ignore', 'ignore'], operation);
}

async function restore(config) {
  const target = connection(config);
  assert(/^crypta_restore_[a-z0-9_]{1,48}$/.test(target.database), 'Use a new crypta_restore_* database.');
  const maintenance = { ...target, database: config['maintenance-database'] ?? 'postgres' };
  assert(databaseName.test(maintenance.database) && maintenance.database.toLowerCase() !== target.database, 'Invalid maintenance database.');
  const archive = filePath(config.backup, 'backup');
  const manifest = JSON.parse(fs.readFileSync(`${archive}.json`, 'utf8'));
  assert(databaseName.test(manifest.sourceDatabase ?? '') && /^[a-f0-9]{64}$/.test(manifest.sha256 ?? '') &&
    Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0, 'Invalid backup manifest.');
  assert(target.database !== manifest.sourceDatabase.toLowerCase(), 'Refusing to use the backup source database name.');

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'crypta-restore-'));
  const snapshot = path.join(staging, 'input.dump');
  let created = false;
  try {
    fs.copyFileSync(archive, snapshot, fs.constants.COPYFILE_EXCL);
    assert(fs.statSync(snapshot).size === manifest.bytes && await sha256File(snapshot) === manifest.sha256,
      'Backup archive does not match its manifest.');
    // Decode all table data before contacting the destination, including data after the archive catalog.
    checkArchive(target.image, snapshot, [...restoreOptions, '--file=/dev/null']);
    const name = `"${target.database}"`;
    sql(maintenance, `CREATE DATABASE ${name} TEMPLATE template0 ALLOW_CONNECTIONS false;`, 'Create fresh restore database');
    created = true;
    sql(maintenance, `BEGIN; REVOKE ALL ON DATABASE ${name} FROM PUBLIC; ALTER DATABASE ${name} ALLOW_CONNECTIONS true; COMMIT;`,
      'Restrict restore database access');
    readArchive(snapshot, input => postgres(target, 'pg_restore', [...restoreOptions, '--single-transaction'],
      [input, 'ignore', 'ignore'], 'PostgreSQL restore'));
    sql(target, `BEGIN; ${restrictAudit} SELECT count(*) FROM public.users; COMMIT;`, 'Verify restored Crypta database');
    console.log(`Restore verified in separate database: ${target.database}`);
  } catch (error) {
    if (created) console.error(`The new restore database ${target.database} is retained for inspection.`);
    throw error;
  } finally {
    fs.rmSync(snapshot, { force: true });
    fs.rmdirSync(staging);
  }
}

if (process.argv.length === 2 || process.argv[2] === '--help') {
  console.log('Usage: node tools/restore-production-test.cjs --host <restore-host> [--port 5432]\n' +
    '  --database <new-crypta_restore_name> --user <restore-operator> [--maintenance-database postgres]\n' +
    '  --password-file <absolute-pgpass> --ca-file <absolute-PEM> --client-image <postgres-image@sha256:digest>\n' +
    '  --backup <absolute-dump-with-sidecar-manifest> [--network <docker-network>]');
  if (process.argv.length === 2) process.exitCode = 1;
} else {
  Promise.resolve().then(() => restore(parseArgs({ options }).values)).catch(error => {
    console.error(`Restore failed. ${error.message}`);
    process.exitCode = 1;
  });
}
