// Build local release images from Git objects. No checkout or registry push.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, timeout: 30_000,
    maxBuffer: 24 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.error?.code ?? result.status ?? result.signal}).`);
  return result.stdout;
}

function build(revision, version) {
  assert.match(revision ?? '', /^[0-9a-f]{40}$/, 'Pass the full Git commit SHA.');
  assert.match(version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, 'Pass a release version such as 0.2.0-rc.1.');
  assert(version.length <= 64);
  assert.equal(run('git', ['rev-parse', `${revision}^{commit}`]).toString().trim(), revision);
  const commitTime = run('git', ['show', '-s', '--format=%cI', revision]).toString().trim();
  assert.match(commitTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  run('docker', ['version', '--format', '{{.Server.Version}}']);
  const directory = path.join(__dirname, 'test-artifacts', 'releases', `${version}-${revision.slice(0, 12)}`);
  assert(!fs.existsSync(directory), 'A manifest already exists for this version and commit.');
  const jobs = ['backend', 'frontend'].map(component => ({ component, tag: `crypta/${component}:${version}` }));
  const localTags = new Set(run('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']).toString().trim().split(/\r?\n/));
  for (const job of jobs) assert(!localTags.has(job.tag), `Image tag already exists locally: ${job.tag}`);

  const configuration = run('git', ['show', `${revision}:.env.example`]);
  const archiveHash = value => createHash('sha256').update(value).digest('hex');
  for (const job of jobs) {
    const files = run('git', ['ls-tree', '-r', '--name-only', revision, '--', job.component]).toString().trim().split(/\r?\n/);
    assert(!files.some(file => /(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('/.env.example')),
      `Committed .env files are not allowed in the ${job.component} build context.`);
  }
  const created = [];
  try {
    for (const job of jobs) {
      const archive = run('git', ['archive', '--format=tar', `--mtime=${commitTime}`, `${revision}:${job.component}`]);
      const contextSha256 = archiveHash(archive);
      run('docker', ['build', '--file', 'Dockerfile', '--tag', job.tag,
        '--label', `org.opencontainers.image.revision=${revision}`, '--label', `org.opencontainers.image.version=${version}`,
        '--label', `org.crypta.context.sha256=${contextSha256}`, '-'], { input: archive, timeout: 300_000 });
      created.push(job.tag);
      const [image] = JSON.parse(run('docker', ['image', 'inspect', job.tag]));
      assert.equal(image.Config.Labels['org.opencontainers.image.revision'], revision);
      assert.equal(image.Config.Labels['org.opencontainers.image.version'], version);
      assert.equal(image.Config.Labels['org.crypta.context.sha256'], contextSha256);
      Object.assign(job, { imageId: image.Id, platform: `${image.Os}/${image.Architecture}`, contextSha256 });
    }
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ revision, version, commitTime, createdUtc: new Date().toISOString(),
      images: jobs, configurationExampleSha256: archiveHash(configuration) }, null, 2), { flag: 'wx' });
    console.log(`Release images and manifest: ${path.join(directory, 'manifest.json')}`);
  } catch (error) {
    const leftover = [];
    for (const tag of created) {
      try {
        const [image] = JSON.parse(run('docker', ['image', 'inspect', tag]));
        if (image.Config.Labels['org.opencontainers.image.revision'] === revision && image.Config.Labels['org.opencontainers.image.version'] === version)
          run('docker', ['image', 'rm', tag]);
      } catch { leftover.push(tag); }
    }
    if (leftover.length) throw new Error(`${error.message} Cleanup also failed for: ${leftover.join(', ')}.`);
    throw error;
  }
}

try { build(process.argv[2], process.argv[3]); }
catch (error) { console.error(error.message); process.exitCode = 1; }
