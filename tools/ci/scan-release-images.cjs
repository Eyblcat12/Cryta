// Scan the exact local release images. The scanner receives no Docker socket.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const scanner = 'docker.io/aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb';
const artifacts = path.resolve(__dirname, '../test-artifacts');
const sha = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function docker(args, operation, timeout = 120_000) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${operation} failed (${result.error?.code ?? result.status ?? result.signal}).`);
  return result.stdout;
}

function checkLabels(labels, manifest, image) {
  assert.equal(labels?.['org.opencontainers.image.revision'], manifest.revision);
  assert.equal(labels?.['org.opencontainers.image.version'], manifest.version);
  assert.equal(labels?.['org.crypta.context.sha256'], image.contextSha256);
}

function scanImage(directory, cacheMount, manifest, image) {
  assert.match(image.imageId, imageId);
  assert.match(image.contextSha256, sha);
  assert.equal(image.tag, `crypta/${image.component}:${manifest.version}`);
  const verifyTag = () => {
    const [local] = JSON.parse(docker(['image', 'inspect', image.tag], 'Release image inspection'));
    assert.equal(local.Id, image.imageId);
    assert.equal(`${local.Os}/${local.Architecture}`, image.platform);
    checkLabels(local.Config.Labels, manifest, image);
  };
  const archive = path.join(directory, `.scan-${randomUUID()}.tar`);
  try {
    verifyTag();
    docker(['image', 'save', '--output', archive, image.tag], 'Release image export');
    verifyTag();
    const result = JSON.parse(docker(['run', '--rm', '--network', 'none', '--mount', cacheMount,
      '--mount', `type=bind,source=${archive},target=/input.tar,readonly`, scanner,
      'image', '--input', '/input.tar', '--platform', image.platform, '--skip-db-update', '--skip-java-db-update',
      '--offline-scan', '--ignorefile', '/dev/null', '--scanners', 'vuln', '--pkg-types', 'os,library',
      '--severity', 'HIGH,CRITICAL', '--list-all-pkgs', '--format', 'json', '--quiet', '--timeout', '2m'], 'Offline release scan', 150_000));
    assert.match(result.Metadata.ImageID, imageId);
    assert.ok(result.Metadata.RepoTags.includes(image.tag));
    assert.equal(`${result.Metadata.ImageConfig.os}/${result.Metadata.ImageConfig.architecture}`, image.platform);
    checkLabels(result.Metadata.ImageConfig.config.Labels, manifest, image);
    const os = result.Results.find(target => target.Class === 'os-pkgs' && target.Type === 'alpine');
    assert.ok(os?.Packages?.length, 'No Alpine packages were scanned.');
    const libraries = result.Results.filter(target => target.Class === 'lang-pkgs').flatMap(target => target.Packages ?? []);
    if (image.component === 'backend') {
      assert.ok(libraries.some(pkg => pkg.Name === '@nestjs/core' && pkg.FilePath?.startsWith('app/node_modules/')),
        'Application Node dependencies were not scanned.');
    }
    const findings = result.Results.flatMap(target => (target.Vulnerabilities ?? []).map(finding => ({
      id: finding.VulnerabilityID, severity: finding.Severity, package: finding.PkgName,
      installedVersion: finding.InstalledVersion, fixedVersion: finding.FixedVersion, packagePath: finding.PkgPath,
    })));
    console.log(`${image.component}: ${findings.length} Critical/High findings`);
    return { component: image.component, tag: image.tag, imageId: image.imageId, configId: result.Metadata.ImageID,
      platform: image.platform, osPackages: os.Packages.length, libraryPackages: libraries.length, findings };
  } finally { fs.rmSync(archive, { force: true }); }
}

function scanRelease(manifestArg, cacheArg) {
  assert.ok(manifestArg, 'Pass a release manifest.json from tools/build-release-images.cjs.');
  const manifestPath = fs.realpathSync(manifestArg);
  const directory = path.dirname(manifestPath);
  const releases = fs.realpathSync(path.join(artifacts, 'releases'));
  assert.equal(path.dirname(directory), releases);
  assert.equal(path.basename(manifestPath), 'manifest.json');
  const manifest = readJson(manifestPath);
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  assert.match(manifest.version, /^[0-9A-Za-z.-]{1,64}$/);
  assert.equal(path.basename(directory), `${manifest.version}-${manifest.revision.slice(0, 12)}`);
  assert.deepEqual(manifest.images.map(image => image.component).sort(), ['backend', 'frontend']);

  const output = path.join(directory, 'image-security.json');
  assert.ok(!fs.existsSync(output), 'This release already has a scan report.');
  const cache = path.resolve(cacheArg ?? path.join(artifacts, 'trivy-cache'));
  fs.mkdirSync(cache, { recursive: true });
  const cacheMount = `type=bind,source=${cache},target=/root/.cache/trivy`;
  const report = { revision: manifest.revision, version: manifest.version, scanner,
    databaseUpdatedAt: null, images: [], passed: false };
  try {
    docker(['run', '--rm', '--mount', cacheMount, scanner,
      'image', '--download-db-only', '--quiet', '--timeout', '4m'], 'Trivy database download', 270_000);
    const database = readJson(path.join(cache, 'db', 'metadata.json'));
    assert.ok(Date.parse(database.UpdatedAt) > 0 && Date.parse(database.NextUpdate) > Date.now(), 'Trivy database is stale or invalid.');
    report.databaseUpdatedAt = database.UpdatedAt;
    for (const image of manifest.images) report.images.push(scanImage(directory, cacheMount, manifest, image));
    assert.ok(report.images.every(image => image.findings.length === 0), 'Release image contains Critical/High vulnerabilities.');
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  }
  console.log(`Release image security report: ${output}`);
}

try { scanRelease(process.argv[2], process.argv[3]); }
catch (error) { console.error(error.message); process.exitCode = 1; }
