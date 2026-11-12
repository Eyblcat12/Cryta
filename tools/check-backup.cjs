const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { databaseName, sha256File } = require('./postgres-operator.cjs');

const manifestName = /^crypta-(\d{8})[T-](\d{6})-(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.dump\.json$/;
const options = {
  directory: { type: 'string' },
  database: { type: 'string' },
  'max-age-minutes': { type: 'string' },
  help: { type: 'boolean' },
};

function utcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) return NaN;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 19) === value.slice(0, 19) ? instant : NaN;
}

async function checkBackup({ directory, database, maxAgeMs }) {
  // Only a published manifest commits the pair. Ignore files still being copied or written.
  const candidates = (await fs.readdir(directory)).flatMap(name => {
    const match = manifestName.exec(name);
    return match ? [{ name, stamp: match[1] + match[2] }] : [];
  }).sort((a, b) => a.stamp.localeCompare(b.stamp) || a.name.localeCompare(b.name));
  const newest = candidates.at(-1);
  if (!newest) return { code: 'BACKUP_MISSING' };

  const manifestPath = path.join(directory, newest.name);
  const manifestInfo = await fs.lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.size > 16_384) return { code: 'BACKUP_INVALID_MANIFEST' };
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) return { code: 'BACKUP_INVALID_MANIFEST' };
    throw error;
  }
  const { stamp } = newest;
  const stampTime = utcTimestamp(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`);
  const started = utcTimestamp(manifest?.createdAtUtc);
  const completed = manifest?.completedAtUtc === undefined ? started : utcTimestamp(manifest.completedAtUtc);
  const now = Date.now();
  if (manifest?.sourceDatabase !== database || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '') ||
      !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 ||
      !Number.isFinite(stampTime) || stampTime > now || !Number.isFinite(started) || started > now ||
      !Number.isFinite(completed) || completed < started || completed > now) return { code: 'BACKUP_INVALID_MANIFEST' };

  const dump = manifestPath.slice(0, -'.json'.length);
  const dumpInfo = await fs.lstat(dump).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!dumpInfo) return { code: 'BACKUP_INCOMPLETE' };
  if (!dumpInfo.isFile() || dumpInfo.size !== manifest.bytes) return { code: 'BACKUP_CORRUPT' };

  const ageMs = now - Math.min(stampTime, started);
  const ageSeconds = Math.floor(ageMs / 1000);
  if (ageMs > maxAgeMs) return { code: 'BACKUP_STALE', ageSeconds };
  if (await sha256File(dump) !== manifest.sha256) return { code: 'BACKUP_CORRUPT', ageSeconds };
  return { code: 'BACKUP_HEALTHY', ageSeconds };
}

async function main() {
  const log = result => console.log(JSON.stringify({ event: 'operations.backup_check', owner: 'database',
    checkedAtUtc: new Date().toISOString(), ...result }));
  let config;
  try {
    const args = parseArgs({ options }).values;
    if (args.help) {
      console.log('Usage: node tools/check-backup.cjs --directory <backup-directory> --database <db> --max-age-minutes <minutes>');
      return;
    }
    const minutes = args['max-age-minutes'] ?? '';
    const maxAgeMs = Number(minutes) * 60_000;
    if (!args.directory || !databaseName.test(args.database ?? '') || !/^[1-9]\d*$/.test(minutes) || !Number.isSafeInteger(maxAgeMs)) throw new Error();
    config = { directory: path.resolve(args.directory), database: args.database, maxAgeMs };
  } catch {
    log({ status: 'error', code: 'BACKUP_CHECK_INVALID_CONFIG' });
    process.exitCode = 2;
    return;
  }
  const result = await checkBackup(config).catch(() => ({ code: 'BACKUP_STORE_UNREADABLE' }));
  const healthy = result.code === 'BACKUP_HEALTHY';
  log({ status: healthy ? 'ok' : 'alert', ...result, maxAgeSeconds: config.maxAgeMs / 1000 });
  process.exitCode = healthy ? 0 : 1;
}

void main();
