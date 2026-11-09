const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { isIP } = require('node:net');
const path = require('node:path');

const connectionOptions = ['host', 'port', 'database', 'user', 'password-file', 'ca-file', 'client-image', 'network'];
const databaseName = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;
const dnsName = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const copyPassword = 'umask 077; cat /run/input/pgpass > /run/crypta/pgpass; exec "$@"';

function filePath(value, option) {
  assert(value && path.isAbsolute(value), `Pass an absolute path to --${option}.`);
  const file = fs.realpathSync(value);
  assert(fs.statSync(file).isFile() && !/[,"\r\n]/.test(file), `Invalid file path for --${option}.`);
  return file;
}

function connection(config) {
  const { host, database, user, network, 'client-image': image } = config;
  assert(isIP(host ?? '') || dnsName.test(host ?? ''), 'Pass one PostgreSQL hostname or IP address.');
  const port = config.port ?? '5432';
  assert(/^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535, 'Invalid PostgreSQL port.');
  assert(databaseName.test(database ?? ''), 'Pass a plain PostgreSQL database name.');
  assert(/^[^\s\x00-\x1f\x7f]{1,63}$/.test(user ?? ''), 'Pass a PostgreSQL user.');
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]*@sha256:[a-f0-9]{64}$/.test(image ?? ''), 'Pin --client-image by SHA-256 digest.');
  assert(!network || /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(network), 'Invalid Docker network name.');
  return { host, port, database, user, network, image, pgpass: filePath(config['password-file'], 'password-file'), ca: filePath(config['ca-file'], 'ca-file') };
}

function docker(args, stdio, operation) {
  const result = spawnSync('docker', args, { stdio, windowsHide: true });
  if (result.status !== 0) throw new Error(`${operation} failed (${result.error?.code ?? result.status ?? result.signal}).`);
}

function postgres(connection, tool, args, stdio, operation) {
  const { host, port, database, user, network, image, pgpass, ca } = connection;
  docker(['run', '--rm', '--pull=never', '--read-only', '--security-opt=no-new-privileges',
    ...(network ? ['--network', network] : []), ...(stdio[0] === 'ignore' ? [] : ['-i']),
    '--tmpfs', '/run/crypta:rw,nosuid,nodev,noexec,mode=0700',
    '--mount', `type=bind,source=${pgpass},target=/run/input/pgpass,readonly`,
    '--mount', `type=bind,source=${ca},target=/run/input/ca.pem,readonly`,
    '-e', 'PGPASSFILE=/run/crypta/pgpass', '-e', 'PGSSLROOTCERT=/run/input/ca.pem',
    '-e', 'PGSSLMODE=verify-full', '-e', 'PGGSSENCMODE=disable', '-e', 'PGCONNECT_TIMEOUT=10',
    '--entrypoint', '/bin/sh', image, '-ec', copyPassword, 'crypta-postgres', tool,
    `--host=${host}`, `--port=${port}`, `--username=${user}`, `--dbname=${database}`, '--no-password', ...args], stdio, operation);
}

function readArchive(file, consume) {
  const input = fs.openSync(file, 'r');
  try { return consume(input); }
  finally { fs.closeSync(input); }
}

function checkArchive(image, file, args) {
  readArchive(file, input => docker(['run', '--rm', '--pull=never', '--network=none', '--entrypoint', 'pg_restore',
    '-i', image, ...args], [input, 'ignore', 'ignore'], 'PostgreSQL archive verification'));
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

module.exports = { connectionOptions, databaseName, filePath, connection, postgres, readArchive, checkArchive, sha256File };
