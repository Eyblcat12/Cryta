const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { isIP } = require('node:net');
const path = require('node:path');
const { parseArgs } = require('node:util');

const stringOptions = ['host', 'port', 'database', 'user', 'password-file', 'ca-file',
  'client-image', 'release-manifest', 'output', 'network'];
const options = Object.fromEntries(stringOptions.map(name => [name, { type: 'string' }]));
const dnsName = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const copyPassword = 'umask 077; cat /run/input/pgpass > /run/crypta/pgpass; exec pg_dump "$@"';

function readFilePath(value, option) {
  assert(value && path.isAbsolute(value), `Pass an absolute path to --${option}.`);
  const file = fs.realpathSync(value);
  assert(fs.statSync(file).isFile() && !/[,"\r\n]/.test(file), `Invalid file path for --${option}.`);
  return file;
}

function docker(args, stdio, operation) {
  const result = spawnSync('docker', args, { stdio, windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`${operation} failed (${result.error?.code ?? result.status ?? result.signal}).`);
  }
}

async function backup(config) {
  const { host, database, user, network, 'client-image': image } = config;
  assert(isIP(host ?? '') || dnsName.test(host ?? ''), 'Pass one PostgreSQL hostname or IP address.');
  const port = config.port ?? '5432';
  assert(/^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535, 'Invalid PostgreSQL port.');
  assert(/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(database ?? ''), 'Pass a plain PostgreSQL database name.');
  assert(/^[^\s\x00-\x1f\x7f]{1,63}$/.test(user ?? ''), 'Pass a PostgreSQL user.');
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]*@sha256:[a-f0-9]{64}$/.test(image ?? ''), 'Pin --client-image by SHA-256 digest.');
  assert(!network || /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(network), 'Invalid Docker network name.');
  assert(config.output && path.isAbsolute(config.output), 'Pass a protected absolute --output directory.');
  const pgpass = readFilePath(config['password-file'], 'password-file');
  const ca = readFilePath(config['ca-file'], 'ca-file');
  const releaseFile = readFilePath(config['release-manifest'], 'release-manifest');
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
      docker(['run', '--rm', '--pull=never', '--read-only', '--security-opt=no-new-privileges',
        ...(network ? ['--network', network] : []),
        '--tmpfs', '/run/crypta:rw,nosuid,nodev,noexec,mode=0700',
        '--mount', `type=bind,source=${pgpass},target=/run/input/pgpass,readonly`,
        '--mount', `type=bind,source=${ca},target=/run/input/ca.pem,readonly`,
        '-e', 'PGPASSFILE=/run/crypta/pgpass', '-e', 'PGSSLROOTCERT=/run/input/ca.pem',
        '-e', 'PGSSLMODE=verify-full', '-e', 'PGGSSENCMODE=disable', '-e', 'PGCONNECT_TIMEOUT=10',
        '--entrypoint', '/bin/sh', image, '-ec', copyPassword, 'crypta-backup',
        `--host=${host}`, `--port=${port}`, `--username=${user}`, `--dbname=${database}`,
        '--no-password', '--format=custom', '--lock-wait-timeout=10s'], ['ignore', output, 'ignore'], 'Verified PostgreSQL backup');
    } finally {
      fs.closeSync(output);
    }
    const bytes = fs.statSync(pending).size;
    assert(bytes > 0, 'PostgreSQL backup is empty.');
    const input = fs.openSync(pending, 'r');
    try {
      docker(['run', '--rm', '--pull=never', '--network=none', '--entrypoint', 'pg_restore', '-i', image, '--list'],
        [input, 'ignore', 'ignore'], 'PostgreSQL archive verification');
    } finally {
      fs.closeSync(input);
    }
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(pending)) hash.update(chunk);
    const manifest = { sourceDatabase: database, createdAtUtc, completedAtUtc: new Date().toISOString(),
      bytes, sha256: hash.digest('hex'), releaseRevision: release.revision, releaseVersion: release.version, clientImage: image };
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
