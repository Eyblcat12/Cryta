const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const [playwrightDirectory, mermaidScript, output] = process.argv.slice(2);
  await fs.mkdir(output);
  const { chromium } = require(path.join(playwrightDirectory, 'playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.setContent('<html><body style="margin:24px"><main id="figure"></main></body></html>');
    await page.addScriptTag({ path: path.resolve(mermaidScript) });
    await page.evaluate(() => mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' }));
    for (const file of ['01_luong_hoat_dong_he_thong.md', '02_so_do_he_thong_tong_quat.md', '03_tong_quan_san_pham.md', 'docs/ERD_HIEN_HANH.md']) {
      const text = await fs.readFile(file, 'utf8');
      let diagram = 0;
      for (const [, source] of text.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) {
        const id = path.basename(file, '.md') + '-' + (++diagram);
        const svg = await page.evaluate(async ({ source, id }) =>
          (await mermaid.render('review' + id.replace(/\W/g, ''), source)).svg, { source, id });
        assert.ok(svg.includes('<svg'));
        await fs.writeFile(path.join(output, id + '.svg'), svg);
        await page.evaluate(svg => { document.getElementById('figure').innerHTML = svg; }, svg);
        await page.locator('#figure').screenshot({ path: path.join(output, id + '.png') });
        results.push({ file, diagram, svg: id + '.svg', rendered: true });
      }
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ diagrams: results.length, results }, null, 2) + '\n');
    console.log(`Rendered ${results.length} Mermaid diagrams`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
