const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const command = path.join(__dirname, '../check-backup.cjs');
const database = 'isolated_backup_test';
const archive = Buffer.from('isolated fixture dump');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crypta-backup-check-'));
  t.after(() => {
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  });
  return directory;
}

function makeBackup(directory, time, { legacy = false, manifest = {} } = {}) {
  const createdAtUtc = new Date(time).toISOString();
  const stamp = createdAtUtc.replace(/[-:]/g, '').slice(0, 15);
  const name = legacy ? stamp.replace('T', '-') : stamp;
  const id = legacy ? randomUUID().replace(/-/g, '') : randomUUID();
  const dump = path.join(directory, `crypta-${name}-${id}.dump`);
  fs.writeFileSync(dump, archive);
  fs.writeFileSync(dump + '.json', JSON.stringify({ sourceDatabase: database, createdAtUtc, bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex'), ...manifest }));
  return dump;
}

function check(directory, code, status, minutes = '60') {
  const result = spawnSync(process.execPath, [command, '--directory', directory, '--database', database,
    '--max-age-minutes', minutes], { encoding: 'utf8' });
  assert.equal(result.status, status, result.stdout);
  assert.equal(result.stderr, '');
  const event = JSON.parse(result.stdout);
  assert.equal(event.code, code);
  assert.equal(event.status, ['ok', 'alert', 'error'][status]);
  assert.equal(event.event, 'operations.backup_check');
  assert.equal(event.owner, 'database');
  assert(!result.stdout.includes(directory) && !result.stdout.includes(database));
  return event;
}

test('published pair passes even when an incomplete newer copy is present', t => {
  const directory = fixture(t);
  const now = Date.now();
  makeBackup(directory, now - 60_000);
  const copying = makeBackup(directory, now - 30_000);
  fs.renameSync(copying + '.json', copying + '.json.partial');
  const event = check(directory, 'BACKUP_HEALTHY', 0);
  assert.equal(event.maxAgeSeconds, 3600);
  assert(event.ageSeconds >= 60 && event.ageSeconds < 120);
});

test('legacy pairs use the earlier snapshot start for age', t => {
  const directory = fixture(t);
  const now = Date.now();
  makeBackup(directory, now - 10 * 60_000, { legacy: true });
  check(directory, 'BACKUP_HEALTHY', 0);
  makeBackup(directory, now - 5 * 60_000, { legacy: true, manifest: { createdAtUtc: new Date(now - 10_000).toISOString() } });
  const event = check(directory, 'BACKUP_STALE', 1, '1');
  assert(event.ageSeconds >= 300);
});

test('newer damaged pair alerts even when a healthy older pair exists', t => {
  const directory = fixture(t);
  const now = Date.now();
  makeBackup(directory, now - 60_000, { legacy: true });
  const latest = makeBackup(directory, now - 30_000);
  fs.writeFileSync(latest, Buffer.alloc(archive.length));
  check(directory, 'BACKUP_CORRUPT', 1);
  fs.truncateSync(latest, archive.length - 1);
  check(directory, 'BACKUP_CORRUPT', 1);
});

test('reports a missing pair, missing dump, and unreadable storage', t => {
  const directory = fixture(t);
  check(directory, 'BACKUP_MISSING', 1);
  const dump = makeBackup(directory, Date.now() - 30_000);
  fs.unlinkSync(dump);
  check(directory, 'BACKUP_INCOMPLETE', 1);
  check(path.join(directory, 'missing'), 'BACKUP_STORE_UNREADABLE', 1);
});

test('rejects invalid metadata and future timestamps', t => {
  const directory = fixture(t);
  const now = Date.now();
  const invalid = makeBackup(directory, now - 60_000, { manifest: { sourceDatabase: 'other' } });
  check(directory, 'BACKUP_INVALID_MANIFEST', 1);
  fs.writeFileSync(invalid + '.json', '{');
  check(directory, 'BACKUP_INVALID_MANIFEST', 1);
  makeBackup(directory, now + 60_000);
  check(directory, 'BACKUP_INVALID_MANIFEST', 1);
});

test('rejects an invalid age threshold as a configuration error', t => {
  check(fixture(t), 'BACKUP_CHECK_INVALID_CONFIG', 2, '0');
});
