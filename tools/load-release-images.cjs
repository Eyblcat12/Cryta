// Verify a trusted Crypta release package before optionally importing its images.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hex = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');

function run(command, args, description, timeout = 30_000) {
  const result = spawnSync(command, args, { timeout, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${description} failed (${result.error?.code ?? result.status ?? result.signal}).`);
  return result.stdout;
}

function validateLabels(labels, manifest, image) {
  assert.equal(labels?.['org.opencontainers.image.revision'], manifest.revision, 'Image revision does not match.');
  assert.equal(labels?.['org.opencontainers.image.version'], manifest.version, 'Image version does not match.');
  assert.equal(labels?.['org.crypta.context.sha256'], image.contextSha256, 'Image context does not match.');
}

function archiveImages(archive, manifest) {
  const files = run('tar', ['-tf', archive], 'Image archive listing').toString().trim().split(/\r?\n/);
  function readEntry(entry) {
    assert.equal(files.filter(name => name === entry).length, 1, `Missing or repeated archive entry: ${entry}`);
    return run('tar', ['-xOf', archive, entry], 'Image archive metadata read');
  }
  function readBlob(reference) {
    assert.match(reference, digest);
    const data = readEntry(`blobs/sha256/${reference.slice(7)}`);
    assert.equal(`sha256:${sha256(data)}`, reference, 'OCI descriptor digest does not match.');
    return JSON.parse(data);
  }

  const tags = manifest.images.map(image => image.tag).sort();
  const dockerEntries = JSON.parse(readEntry('manifest.json'));
  assert.equal(dockerEntries.length, tags.length, 'Unexpected number of images in the archive.');
  assert.ok(dockerEntries.every(entry => entry.RepoTags?.length === 1), 'Every archived image must have one release tag.');
  assert.deepEqual(dockerEntries.flatMap(entry => entry.RepoTags).sort(), tags, 'Archive tags do not match the release manifest.');
  const index = files.includes('index.json') ? JSON.parse(readEntry('index.json')) : undefined;
  if (index) {
    assert.equal(index.schemaVersion, 2);
    assert.deepEqual(index.manifests.map(item => item.annotations?.['io.containerd.image.name']).sort(),
      tags.map(tag => `docker.io/${tag}`), 'OCI archive tags do not match the release manifest.');
  }

  return manifest.images.map(image => {
    const entry = dockerEntries.find(candidate => candidate.RepoTags[0] === image.tag);
    const match = /^(?:blobs\/sha256\/([a-f0-9]{64})|([a-f0-9]{64})\.json)$/.exec(entry.Config);
    assert.ok(match, 'Unexpected archive image config path.');
    const bytes = readEntry(entry.Config);
    const configHash = sha256(bytes);
    assert.equal(configHash, match[1] ?? match[2], 'Archived image config digest does not match.');
    const configId = `sha256:${configHash}`;
    const config = JSON.parse(bytes);
    assert.equal(`${config.os}/${config.architecture}`, image.platform, 'Archive image platform does not match.');
    validateLabels(config.config.Labels, manifest, image);
    let ociId;
    if (index) {
      const descriptor = index.manifests.find(item => item.annotations['io.containerd.image.name'] === `docker.io/${image.tag}`);
      assert.equal(descriptor.annotations['org.opencontainers.image.ref.name'], manifest.version, 'OCI reference does not match.');
      assert.ok([descriptor.digest, configId].includes(image.imageId), 'OCI image identity does not match.');
      const root = readBlob(descriptor.digest);
      let imageManifest = root;
      if (root.manifests) {
        const native = root.manifests.filter(item => `${item.platform?.os}/${item.platform?.architecture}` === image.platform);
        assert.equal(native.length, 1, 'OCI index must contain exactly one release platform image.');
        imageManifest = readBlob(native[0].digest);
      }
      assert.equal(imageManifest.config?.digest, configId, 'Docker and OCI image configs differ.');
      ociId = descriptor.digest;
    } else {
      assert.equal(image.imageId, configId, 'Legacy Docker image identity does not match.');
    }
    return { ...image, configId, ociId };
  });
}

function loadImages(archive, manifest, images) {
  const platform = run('docker', ['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}'], 'Docker daemon platform').toString().trim();
  const readTags = () => new Set(run('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'],
    'Local image listing').toString().trim().split(/\r?\n/));
  const originalTags = readTags();
  for (const image of images) {
    assert.equal(image.platform, platform, 'Release image platform does not match the Docker daemon.');
    assert.ok(!originalTags.has(image.tag), `Image tag already exists locally: ${image.tag}`);
  }
  const verifyLoaded = image => {
    const [local] = JSON.parse(run('docker', ['image', 'inspect', image.tag], 'Loaded image inspection'));
    assert.ok([image.imageId, image.configId, image.ociId].includes(local.Id), 'Loaded image identity does not match.');
    assert.equal(`${local.Os}/${local.Architecture}`, image.platform, 'Loaded image platform does not match.');
    validateLabels(local.Config.Labels, manifest, image);
    return local.Id;
  };
  try {
    run('docker', ['image', 'load', '--input', archive], 'Release image import', 300_000);
    return images.map(image => ({ ...image, loadedId: verifyLoaded(image) }));
  } catch (error) {
    const remaining = [];
    let currentTags;
    try { currentTags = readTags(); }
    catch { throw new Error(`${error.message} Could not inspect local tags after the failed import.`); }
    for (const image of images.filter(item => currentTags.has(item.tag))) {
      try {
        verifyLoaded(image);
        run('docker', ['image', 'rm', image.tag], 'Incomplete import cleanup');
      } catch { remaining.push(image.tag); }
    }
    if (remaining.length) throw new Error(`${error.message} Review these tags before retrying: ${remaining.join(', ')}.`);
    throw error;
  }
}

function loadWithLock(archive, manifest, images) {
  const lockPath = path.join(os.tmpdir(), `crypta-image-load-${manifest.version}.lock`);
  const lock = fs.openSync(lockPath, 'wx');
  try { return loadImages(archive, manifest, images); }
  finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

async function main(directoryArg, mode) {
  assert.ok(directoryArg, 'Usage: node tools/load-release-images.cjs <package-directory> [--load]');
  assert.ok(mode === undefined || mode === '--load', 'The optional flag is --load.');
  const directory = fs.realpathSync(directoryArg);
  const manifestPath = path.join(directory, 'manifest.json');
  const archive = path.join(directory, 'images.tar');
  assert.ok(fs.lstatSync(manifestPath).isFile() && fs.lstatSync(archive).isFile(), 'Expected regular package files.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  assert.ok(manifest.version.length <= 64);
  assert.deepEqual(manifest.images.map(image => image.component).sort(), ['backend', 'frontend']);
  for (const image of manifest.images) {
    assert.equal(image.tag, `crypta/${image.component}:${manifest.version}`);
    assert.match(image.imageId, digest);
    assert.match(image.contextSha256, hex);
    assert.match(image.platform, /^linux\/[a-z0-9_]+$/);
  }
  assert.equal(manifest.archive.file, 'images.tar');
  assert.match(manifest.archive.sha256, hex);
  assert.equal(fs.statSync(archive).size, manifest.archive.sizeBytes, 'Image archive size does not match.');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  assert.equal(hash.digest('hex'), manifest.archive.sha256, 'Image archive checksum does not match.');

  const images = archiveImages(archive, manifest);
  console.log(JSON.stringify({ revision: manifest.revision, version: manifest.version, loaded: mode === '--load',
    images: mode === '--load' ? loadWithLock(archive, manifest, images) : images }, null, 2));
}

main(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
