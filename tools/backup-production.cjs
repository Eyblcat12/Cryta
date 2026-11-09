const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { connectionOptions, filePath, connection, postgres, checkArchive, sha256File } = require('./postgres-operator.cjs');

const stringOptions = [...connectionOptions, 'release-manifest', 'output'];
const options = Object.fromEntries(stringOptions.map(name => [name, { type: 'string' }]));

async function backup(config) {
  const source = connection(config);
  assert(config.output && path.isAbsolute(config.output), 'Pass a protected absolute --output directory.');
  const releaseFile = filePath(config['release-manifest'], 'release-manifest');
  const release = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
  assert(/^[a-f0-9]{40}$/.test(release.revision ?? '') && /^[0-9A-Za-z.-]{1,64}$/.test(release.version ?? ''), 'Invalid release manifest.');

  fs.mkdirSync(config.output, { recursive: true, mode: 0o700 });
  const createdAtUtc = new Date().toISOString();
  const stamp = createdAtUtc.replace(/[-:]/g, '').slice(0, 15);
  const archive = path.join(config.output, `crypta-${stamp}-${randomUUID()}.dump`);
  const pending = `${archive}.partial`;
  const pendingManifest = `${archive}.json.partial`;
  let dumpPublished = false;
  let manifestPublished = false;
  try {
    const output = fs.openSync(pending, 'wx', 0o600);
    try {
      postgres(source, 'pg_dump', ['--format=custom', '--lock-wait-timeout=10s'],
        ['ignore', output, 'ignore'], 'Verified PostgreSQL backup');
    } finally {
      fs.closeSync(output);
    }
    const bytes = fs.statSync(pending).size;
    assert(bytes > 0, 'PostgreSQL backup is empty.');
    checkArchive(source.image, pending, ['--list']);
    const manifest = { sourceDatabase: source.database, createdAtUtc, completedAtUtc: new Date().toISOString(),
      bytes, sha256: await sha256File(pending), releaseRevision: release.revision, releaseVersion: release.version, clientImage: source.image };
    fs.writeFileSync(pendingManifest, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(pending, archive);
    dumpPublished = true;
    fs.renameSync(pendingManifest, `${archive}.json`);
    manifestPublished = true;
    console.log(`Backup created: ${archive}`);
  } finally {
    fs.rmSync(pending, { force: true });
    fs.rmSync(pendingManifest, { force: true });
    if (dumpPublished && !manifestPublished) fs.rmSync(archive, { force: true });
  }
}

if (process.argv.length === 2 || process.argv[2] === '--help') {
  console.log('Usage: node tools/backup-production.cjs --host <host> [--port 5432] --database <db> --user <backup-user>\n' +
    '  --password-file <absolute-pgpass> --ca-file <absolute-PEM> --client-image <postgres-image@sha256:digest>\n' +
    '  --release-manifest <absolute-manifest.json> --output <absolute-directory> [--network <docker-network>]');
  if (process.argv.length === 2) process.exitCode = 1;
} else {
  Promise.resolve().then(() => backup(parseArgs({ options }).values)).catch(error => {
    console.error(`Backup failed. ${error.message}`);
    process.exitCode = 1;
  });
}
