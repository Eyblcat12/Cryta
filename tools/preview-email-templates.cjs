// Render synthetic previews produced by the compiled renderer in the isolated email runner.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
async function main(reportArgument, playwrightDirectory) {
  const root = path.resolve(__dirname, '..'), artifactRoot = await fs.realpath(path.join(__dirname, 'test-artifacts/integration'));
  const reportPath = await fs.realpath(reportArgument); assert.ok(reportPath.startsWith(artifactRoot + path.sep));
  const source = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(source.project, /^crypta-t30-test-[a-f0-9]{12}$/); assert.match(source.testDatabase, /^crypta_email_test_[a-f0-9]{12}$/);
  assert.ok(source.success && source.cleanupCompleted && source.loopbackSmtp && source.externalSmtp === false);
  assert.equal(source.previews.length, 10);
  for (const [file, sha] of Object.entries(source.compiledServiceHashes)) assert.equal(createHash('sha256').update(await fs.readFile(path.join(root, 'backend/dist', file))).digest('hex'), sha);
  const output = path.join(path.dirname(reportPath), 'preview-msedge-' + Date.now()); await fs.mkdir(output);
  const { chromium } = require(path.join(playwrightDirectory, 'playwright'));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [], requests = [], errors = [];
  try {
    const page = await browser.newPage(); page.on('request', request => requests.push(new URL(request.url()).protocol)); page.on('pageerror', () => errors.push('pageerror'));
    for (const preview of source.previews) {
      assert.match(preview.type, /^[A-Z_]+$/);
      await fs.writeFile(path.join(output, preview.type + '.html'), preview.html);
      await fs.writeFile(path.join(output, preview.type + '.txt'), preview.text);
      for (const width of [800, 320]) {
        await page.setViewportSize({ width, height: 900 }); await page.setContent(preview.html); await page.evaluate(() => window.scrollTo(0, 0));
        const evidence = await page.evaluate(() => {
          const links = [...document.querySelectorAll('a')]; const rect = links[0].getBoundingClientRect();
          return { language: document.documentElement.lang, h1: document.querySelectorAll('h1').length,
            width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
            links: links.map(link => link.href), actionHeight: rect.height,
            images: document.images.length, scripts: document.scripts.length, title: document.title };
        });
        assert.equal(evidence.language, 'vi'); assert.equal(evidence.h1, 1); assert.ok(evidence.title.startsWith('Crypta - '));
        assert.ok(evidence.scrollWidth <= width); assert.equal(evidence.links.length, 2); assert.equal(evidence.links[0], evidence.links[1]);
        assert.ok(evidence.actionHeight >= 44 && !evidence.images && !evidence.scripts);
        await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
        const shot = `${preview.type}-${width}.png`; await page.screenshot({ path: path.join(output, shot), fullPage: true });
        results.push({ type: preview.type, width, activeFlow: preview.activeFlow, screenshot: shot, noOverflow: true, actionHeight: evidence.actionHeight, keyboardLink: true });
      }
    }
    assert.equal(requests.length, 0); assert.equal(errors.length, 0);
    const report = { success: true, fixtureOnly: true, browser: 'msedge', browserVersion: browser.version(), source: reportPath,
      compiledServiceHashes: source.compiledServiceHashes, results, networkRequests: 0, pageErrors: 0,
      limitation: 'Browser HTML previews with synthetic data; no real mailbox, email-client rendering or account-link flow acceptance.' };
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); console.log(`PASS ${results.length} email previews; report ${path.join(output, 'results.json')}`);
  } finally { await browser.close(); }
}
main(...process.argv.slice(2)).catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
