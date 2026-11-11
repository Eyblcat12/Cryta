// Production-build UI checks with isolated HTTP fixtures; no real API writes.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const {fixture,visible}=require('./test-spa-workspace.cjs');
const origin=process.env.CRYPTA_UI_TEST_URL||'http://127.0.0.1:4173';
const channel=process.env.CRYPTA_TEST_BROWSER||'msedge';
const width=Number(process.env.CRYPTA_PICKER_WIDTH||1440);
const theme=process.env.CRYPTA_PICKER_THEME||'light';
const output=path.resolve(process.env.CRYPTA_PICKER_OUTPUT||path.join(__dirname,'test-artifacts','spa',`asset-picker-${Date.now()}`));
const results=[];
const read=endpoint=>request=>request.method()==='GET'&&new URL(request.url()).pathname===`/api/v1${endpoint}`;
async function waitForSelected(page,id='asset-300'){
  await page.waitForFunction(value=>document.querySelector('#request-asset')?.value===value,id);
  await page.getByRole('dialog').getByRole('button',{name:'Gửi yêu cầu',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[role=dialog] button[type=submit]')?.disabled);
}
async function check(name,body,options={}){
  if(process.env.CRYPTA_PICKER_FILTER&&!name.includes(process.env.CRYPTA_PICKER_FILTER))return;
  const f=await fixture(browser,'USER',options);const item={name,status:'passed'};
  await f.page.setViewportSize({width,height:1000});await f.page.addInitScript(value=>localStorage.setItem('crypta-theme',value),theme);
  try{await body(f);assert.deepEqual(f.errors,[])}
  catch(error){item.status='failed';item.error=error.stack;process.exitCode=1;await f.page.screenshot({path:path.join(output,`${results.length+1}-failed.png`),fullPage:true})}
  finally{await f.context.tracing.stop({path:path.join(output,`${results.length+1}.zip`)});await f.context.close();results.push(item);console.log(`${item.status==='passed'?'PASS':'FAIL'} ${name}${item.error?'\n'+item.error:''}`)}
}
let browser;
(async()=>{
  await fs.mkdir(output,{recursive:true});browser=await chromium.launch({channel,headless:true});const browserVersion=browser.version();
  try{
    await check('Selected asset list search holds drafts and locks actions through pending and 503, then same-query GET retry recovers',async({page,state,mutations,calls})=>{
      await page.goto(origin+'/requests/new?type=RENEW&assetId=asset-300');await waitForSelected(page);
      const dialog=page.getByRole('dialog'),select=page.locator('#request-asset'),reason=dialog.locator('textarea'),send=dialog.getByRole('button',{name:'Gửi yêu cầu',exact:true});
      await reason.fill('Giữ lý do gia hạn khi mạng tạm thời lỗi');
      let release;state.tableReadEndpoint='/assets';state.tableReadGate=new Promise(resolve=>release=resolve);state.assetFail=true;
      await dialog.getByRole('textbox',{name:'Tìm tài sản để gia hạn hoặc thu hồi',exact:true}).fill('ASSET-0300');
      const pending=page.waitForRequest(read('/assets'));await dialog.getByRole('button',{name:'Tìm',exact:true}).click();await pending;
      assert.equal(await select.isDisabled(),true);assert.equal(await send.isDisabled(),true,'A pending reference read must prevent submitting a stale asset/policy');
      assert.equal(await select.inputValue(),'asset-300');assert.equal(await reason.inputValue(),'Giữ lý do gia hạn khi mạng tạm thời lỗi');
      release();state.tableReadGate=null;await dialog.getByRole('alert').filter({hasText:'Tài sản tạm thời không khả dụng.'}).waitFor();
      assert.equal(await select.isDisabled(),true);assert.equal(await send.isDisabled(),true);assert.equal(await select.inputValue(),'asset-300');assert.equal(mutations.length,0);
      await page.screenshot({path:path.join(output,'list-503.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      state.assetFail=false;const detailCount=calls.filter(call=>call==='GET /assets/asset-300').length;
      await dialog.getByRole('button',{name:'Thử lại',exact:true}).click();await waitForSelected(page);
      assert(calls.filter(call=>call==='GET /assets/asset-300').length>detailCount,'Retry must revalidate the selected object, not only the list');
      assert.equal(await reason.inputValue(),'Giữ lý do gia hạn khi mạng tạm thời lỗi');assert.equal(mutations.length,0);
      await send.click();await visible(page,'Yêu cầu của tôi');assert.equal(mutations.length,1);assert.equal(mutations[0].body.targetAssetId,'asset-300');assert.equal(mutations[0].body.policyVersionId,'version-1');
    });
    await check('Confirmed list 403 removes the unauthorized selected asset and keeps the reason without a POST',async({page,state,mutations})=>{
      await page.goto(origin+'/requests/new?type=RENEW&assetId=asset-300');await waitForSelected(page);
      const dialog=page.getByRole('dialog'),reason=dialog.locator('textarea');await reason.fill('Giữ lý do khi quyền tài sản thay đổi');state.assetDenied=true;
      await dialog.getByRole('textbox',{name:'Tìm tài sản để gia hạn hoặc thu hồi',exact:true}).fill('ASSET-0300');
      await dialog.getByRole('button',{name:'Tìm',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Quyền xem tài sản đã thay đổi.'}).waitFor();
      await page.waitForFunction(()=>document.querySelector('#request-asset')?.value==='');
      assert.equal(await page.locator('#request-asset option').filter({hasText:'ASSET-0300'}).count(),0);assert.equal(await page.locator('#request-asset').isDisabled(),true);
      assert.equal(await dialog.getByRole('button',{name:'Gửi yêu cầu',exact:true}).isDisabled(),true);assert.equal(await reason.inputValue(),'Giữ lý do khi quyền tài sản thay đổi');assert.equal(mutations.length,0);
      await page.screenshot({path:path.join(output,'list-403.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    });
    await check('Selected-detail 503 retains the requested ID and reason, with GET-only retry recovering a beyond-page asset',async({page,mutations,calls})=>{
      let failure=true;const ownCalls=[];
      await page.route('**/api/v1/assets/*',async route=>{
        if(!read('/assets/asset-300')(route.request()))return route.fallback();ownCalls.push(route.request().method());
        if(failure)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE',message:'Chi tiết tài sản tạm thời không khả dụng.'}})});
        return route.fallback();
      });
      await page.goto(origin+'/requests/new?type=RENEW&assetId=asset-300');const dialog=page.getByRole('dialog');await dialog.getByRole('alert').filter({hasText:'Chi tiết tài sản tạm thời không khả dụng.'}).waitFor();
      await dialog.locator('textarea').fill('Gia hạn tài sản ngoài trang đầu khi dịch vụ hồi phục');
      assert.equal(await page.locator('#request-asset').inputValue(),'asset-300','A recoverable detail failure must retain the requested reference ID');
      assert.equal(await dialog.getByRole('button',{name:'Gửi yêu cầu',exact:true}).isDisabled(),true);assert.equal(mutations.length,0);
      await page.screenshot({path:path.join(output,'detail-503.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      failure=false;await dialog.getByRole('button',{name:'Thử lại',exact:true}).click();await waitForSelected(page);
      assert.equal(await dialog.locator('textarea').inputValue(),'Gia hạn tài sản ngoài trang đầu khi dịch vụ hồi phục');assert.equal(mutations.length,0);assert.deepEqual(ownCalls,['GET','GET']);assert(calls.includes('GET /assets/asset-300'));
    });
    await check('A newly selected row cannot submit until its current detail read confirms eligibility and policy',async({page,mutations})=>{
      let release,started;const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
      await page.route('**/api/v1/assets/*',async route=>{
        if(!read('/assets/asset-2')(route.request()))return route.fallback();started();await gate;
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{id:'asset-2',code:'ASSET-0002',purpose:'Tài sản 2',type:'KEY',status:'ACTIVE',algorithm:'RSA',keySize:2048,expiresAt:'2027-09-30T00:00:00Z',ownerId:'session-USER',departmentId:'department-1',policyVersionId:'version-current',version:4}})});
      });
      await page.goto(origin+'/requests/new?type=RENEW');const dialog=page.getByRole('dialog');await page.locator('#request-asset option[value="asset-2"]').waitFor({state:'attached'});
      await dialog.locator('textarea').fill('Kiểm tra chính sách hiện tại trước khi gửi yêu cầu');await page.locator('#request-asset').selectOption('asset-2');await seen;
      assert.equal(await dialog.getByRole('button',{name:'Gửi yêu cầu',exact:true}).isDisabled(),true);
      await dialog.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(mutations.length,0);
      release();await waitForSelected(page,'asset-2');assert.equal(mutations.length,0);await dialog.getByRole('button',{name:'Gửi yêu cầu',exact:true}).click();await visible(page,'Yêu cầu của tôi');assert.equal(mutations.length,1);assert.equal(mutations[0].body.targetAssetId,'asset-2');assert.equal(mutations[0].body.policyVersionId,'version-current','Use the current object policy, not the older list-row policy');
    });
    await check('Confirmed selected-detail 403 removes the denied row option, preserves the reason, and permits GET recovery',async({page,state,mutations})=>{
      state.detailDenied='asset-2';await page.goto(origin+'/requests/new?type=RENEW');const dialog=page.getByRole('dialog');await page.locator('#request-asset option[value="asset-2"]').waitFor({state:'attached'});
      await dialog.locator('textarea').fill('Giữ lý do và chọn lại khi quyền chi tiết thay đổi');await page.locator('#request-asset').selectOption('asset-2');await dialog.getByRole('alert').filter({hasText:'Quyền xem tài sản này đã thay đổi.'}).waitFor();
      await page.waitForFunction(()=>document.querySelector('#request-asset')?.value==='');assert.equal(await page.locator('#request-asset option[value="asset-2"]').count(),0);assert.equal(await page.locator('#request-asset').isDisabled(),true);
      assert.equal(await dialog.getByRole('button',{name:'Gửi yêu cầu',exact:true}).isDisabled(),true);assert.equal(await dialog.locator('textarea').inputValue(),'Giữ lý do và chọn lại khi quyền chi tiết thay đổi');assert.equal(mutations.length,0);
      await page.screenshot({path:path.join(output,'detail-403.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await dialog.getByRole('button',{name:'Thử lại',exact:true}).click();await page.locator('#request-asset').waitFor();await page.waitForFunction(()=>!document.querySelector('#request-asset').disabled);await page.locator('#request-asset').selectOption('asset-3');await waitForSelected(page,'asset-3');assert.equal(mutations.length,0);
    });
  }finally{await browser.close();const html=await(await fetch(origin)).text();const buildAssets=[...html.matchAll(/\/assets\/[^"']+/g)].map(match=>match[0]);await fs.writeFile(path.join(output,'results.json'),JSON.stringify({origin,browserChannel:channel,browserVersion,buildAssets,width,theme,fixtureOnly:true,scope:'Asset selection references, recoverable reads, confirmed list denial and mutation guard; fixture-only browser proof, not real DB authorization or screen reader proof.',results},null,2))}
  assert(results.length>0,'No matching picker checks');console.log(`${results.filter(item=>item.status==='passed').length}/${results.length} asset picker checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
