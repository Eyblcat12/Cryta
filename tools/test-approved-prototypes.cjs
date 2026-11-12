const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
async function main(dependencies,channel='msedge'){
  assert(dependencies);assert(['msedge','chrome'].includes(channel));
  const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'test-artifacts','design-previews','approved-'+Date.now());
  await fs.mkdir(output,{recursive:true});
  const {chromium}=require(path.join(dependencies,'playwright')),browser=await chromium.launch({channel,headless:true});
  const results=[];
  try{
    for(const flow of ['asset-lineage','provider-recovery'])for(const width of [1440,390]){
      const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
      try{
        const source=path.join(root,'tools','design-previews',flow,'index.html'),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(pathToFileURL(source).href);if(width===390)await page.locator('#theme').click();
        if(flow==='asset-lineage'){
          await page.locator('#role').selectOption('APPROVER');await page.locator('#assets tr').first().locator('button').click();
          assert.equal(await page.locator('#owner-actions').isVisible(),false);
          await page.locator('#previous').waitFor({state:'visible'});
          await page.screenshot({path:path.join(output,`${flow}-${width}-detail.png`),fullPage:true,animations:'disabled'});
          await page.locator('#events button').first().click();assert(await page.locator('#request').isVisible());
          await page.keyboard.press('Escape');assert.equal(await page.locator('#request').isVisible(),false);
        }else{
          await page.locator('#rows tr').first().locator('button').click();
          await page.locator('#detail-actions button').filter({hasText:/Áp dụng/}).click();
          await page.locator('#action-dialog').waitFor({state:'visible'});
          await page.screenshot({path:path.join(output,`${flow}-${width}-confirm.png`),fullPage:true,animations:'disabled'});
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);assert.deepEqual(errors,[]);
        results.push({flow,width,theme:width===390?'dark':'light',passed:true,prototypeSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex')});
      }finally{await context.close();}
    }
  }finally{await browser.close();await fs.writeFile(path.join(output,'results.json'),JSON.stringify({createdUtc:new Date().toISOString(),channel,fixtureOnly:true,results,scope:'Approved standalone prototype capture for comparison with real T15/T18 UI; no API or database traffic.'},null,2));}
  process.stdout.write(`${results.length}/4 prototype groups passed; ${path.join(output,'results.json')}\n`);
}
main(...process.argv.slice(2)).catch(error=>{process.stderr.write(String(error.message).slice(0,700));process.exitCode=1});
