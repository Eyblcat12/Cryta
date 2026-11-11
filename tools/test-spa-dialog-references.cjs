// Production-build dialog reference checks; every business HTTP request is fixture-only.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,firefox}=require(path.join(process.argv[2],'playwright'));
const {fixture}=require('./test-spa-workspace.cjs');
const origin=process.env.CRYPTA_UI_TEST_URL||'http://127.0.0.1:4173';
const channel=process.env.CRYPTA_TEST_BROWSER||'msedge';
const width=Number(process.env.CRYPTA_DIALOG_WIDTH||1440),theme=process.env.CRYPTA_DIALOG_THEME||'light';
const output=path.resolve(process.env.CRYPTA_DIALOG_OUTPUT||path.join(__dirname,'test-artifacts','spa',`dialog-references-${Date.now()}`));
const kinds=[{kind:'departments',role:'ADMIN',endpoint:'/users/reference-data',group:'Danh mục phòng ban',control:'Phòng ban',pending:'Đang tải danh mục phòng ban…',option:'Đơn vị mẫu (IT)',submit:'Tạo tài khoản',error:'Danh mục phòng ban tạm thời không khả dụng.',empty:'Chưa có phòng ban hoạt động để tạo tài khoản.'},{kind:'policies',role:'USER',endpoint:'/policies',group:'Chính sách cấp mới',control:'Chính sách',pending:'Đang tải chính sách…',option:'Chính sách RSA v1',submit:'Gửi yêu cầu',error:'Chính sách tạm thời không khả dụng.',empty:'Chưa có chính sách phù hợp để cấp mới tài sản này.'}];
const results=[];
let browser;
async function scenario(config,name,body){
  if(process.env.CRYPTA_DIALOG_FILTER&&!name.includes(process.env.CRYPTA_DIALOG_FILTER))return;
  const f=await fixture(browser,config.role);const item={name,status:'passed',evidence:{}};
  const mode={status:200,empty:false,delay:0,gate:null};const reads=[];
  await f.page.setViewportSize({width,height:1000});await f.page.addInitScript(value=>localStorage.setItem('crypta-theme',value),theme);
  await f.page.addInitScript(endpoint=>{
    window.__referenceReads=[];window.__referenceAnnouncements=[];
    const original=window.fetch;
    window.fetch=async function(...args){
      const url=typeof args[0]==='string'?args[0]:args[0].url;
      if(!url.endsWith(endpoint))return original.apply(this,args);
      const record={start:performance.now()};window.__referenceReads.push(record);
      const response=await original.apply(this,args);record.end=performance.now();record.status=response.status;return response;
    };
    new MutationObserver(()=>{
      for(const element of document.querySelectorAll('[role=status]')){
        const text=element.textContent.trim();if(!/^Đang tải (danh mục phòng ban|chính sách)/.test(text))continue;
        if(!window.__referenceAnnouncements.some(item=>item.text===text))window.__referenceAnnouncements.push({text,time:performance.now()});
      }
    }).observe(document,{childList:true,subtree:true,characterData:true});
  },config.endpoint);
  await f.page.route('**/api/v1/**',async route=>{
    if(route.request().method()!=='GET'||new URL(route.request().url()).pathname!==`/api/v1${config.endpoint}`)return route.fallback();
    reads.push({method:'GET',endpoint:config.endpoint,status:mode.status});
    if(mode.gate)await mode.gate;if(mode.delay)await new Promise(resolve=>setTimeout(resolve,mode.delay));
    const data=config.kind==='departments'?{departments:mode.empty?[]:[{id:'department-1',code:'IT',name:'Đơn vị mẫu'}],roles:[]}:mode.empty?[]:[{id:'version-1',policyId:'policy-1',name:'Chính sách RSA',code:'RSA',version:1,configuration:{algorithm:'RSA',minimum_key_size:2048,maximum_validity_days:365,warning_days:[30,7,1]}}];
    const body=mode.status===200?{data}:{error:{code:mode.status===403?'FORBIDDEN':'UNAVAILABLE',message:mode.status===403?'Quyền đọc danh mục đã thay đổi.':config.error}};
    try{await route.fulfill({status:mode.status,contentType:'application/json',body:JSON.stringify(body)})}catch(error){if(!/closed|disposed|Invalid InterceptionId/.test(error.message))throw error}
  });
  const open=async()=>{
    await f.page.goto(origin+(config.kind==='departments'?'/users':'/requests/new'));
    if(config.kind==='departments')await f.page.getByRole('button',{name:'Thêm người dùng',exact:true}).click();
    const dialog=f.page.getByRole('dialog');await dialog.waitFor();return dialog;
  };
  try{await body({...f,mode,reads,open,config,evidence:item.evidence});assert.deepEqual(f.errors,[]);assert.equal(f.mutations.length,0)}
  catch(error){item.status='failed';item.error=error.stack;process.exitCode=1;await f.page.screenshot({path:path.join(output,`${results.length+1}-failed.png`),fullPage:true})}
  finally{item.evidence.reads=reads;await f.context.tracing.stop({path:path.join(output,`${results.length+1}.zip`)});await f.context.close();results.push(item);console.log(`${item.status==='passed'?'PASS':'FAIL'} ${name}${item.error?'\n'+item.error:''}`)}
}
async function fillDraft(dialog,config){
  if(config.kind==='departments'){await dialog.getByLabel(/Họ và tên/).fill('Người dùng kiểm thử danh mục');await dialog.getByLabel(/Email tổ chức/).fill('references@example.test')}
  else await dialog.locator('textarea').fill('Giữ lý do cấp mới khi danh mục tạm thời lỗi');
}
async function confirmDraft(dialog,config){
  if(config.kind==='departments'){assert.equal(await dialog.getByLabel(/Họ và tên/).inputValue(),'Người dùng kiểm thử danh mục');assert.equal(await dialog.getByLabel(/Email tổ chức/).inputValue(),'references@example.test')}
  else assert.equal(await dialog.locator('textarea').inputValue(),'Giữ lý do cấp mới khi danh mục tạm thời lỗi');
}
(async()=>{
  await fs.mkdir(output,{recursive:true});const initialHtml=await(await fetch(origin)).text();const buildAssets=[...initialHtml.matchAll(/\/assets\/[^"']+/g)].map(match=>match[0]);browser=channel==='firefox'?await firefox.launch({headless:true}):await chromium.launch({channel,headless:true});const browserVersion=browser.version(),browserEngine=browser.browserType().name();
  try{
    await scenario(kinds[0],'CreateUser initial password has a linked accessible label and keyboard focus without exposing its value',async({page,open,evidence})=>{
      const dialog=await open();await dialog.getByRole('option',{name:'Đơn vị mẫu (IT)',exact:true}).waitFor({state:'attached'});
      const password=dialog.getByLabel(/Mật khẩu ban đầu/);assert.equal(await password.count(),1,'Initial password must have an associated accessible name');
      await dialog.locator('label').filter({hasText:/^Mật khẩu ban đầu/}).click();assert.equal(await password.evaluate(element=>element===document.activeElement),true);assert.equal(await password.getAttribute('type'),'password');
      await page.keyboard.press('Tab');assert.equal(await dialog.getByRole('button',{name:'Hiện',exact:true}).evaluate(element=>element===document.activeElement),true);
      evidence.passwordValueRecorded=false;
    });
    for(const config of kinds){
      await scenario(config,`${config.kind} fast reference read finishes below 180ms without a delayed status flash`,async({page,open,evidence})=>{
        const dialog=await open();await dialog.getByRole('option',{name:config.option,exact:true}).waitFor({state:'attached'});
        const group=dialog.getByRole('group',{name:config.group,exact:true});assert.equal(await group.count(),1);assert.equal(await group.getAttribute('aria-busy'),'false');assert.equal((await group.getByRole('status').textContent()).trim(),'');
        const metrics=await page.evaluate(()=>({reads:window.__referenceReads,announcements:window.__referenceAnnouncements}));assert(metrics.reads.length===1);assert(metrics.reads[0].end-metrics.reads[0].start<180,'Fast fixture must actually finish below the indicator threshold');assert.deepEqual(metrics.announcements,[]);evidence.metrics=metrics;
      });
      await scenario(config,`${config.kind} slow reference read shows a delayed named status, preserves focus and locks only reference-dependent actions`,async({page,mode,open,mutations,evidence})=>{
        let release;mode.gate=new Promise(resolve=>release=resolve);const dialog=await open();
        const group=dialog.getByRole('group',{name:config.group,exact:true});assert.equal(await group.count(),1);assert.equal(await group.getAttribute('aria-busy'),'true');
        assert.equal(await dialog.getByRole('combobox',{name:new RegExp('^'+config.control)}).isDisabled(),true);assert.equal(await dialog.getByRole('button',{name:config.submit,exact:true}).isDisabled(),true);
        await fillDraft(dialog,config);const focused=config.kind==='departments'?dialog.getByLabel(/Email tổ chức/):dialog.locator('textarea');await group.getByRole('status').filter({hasText:config.pending}).waitFor();assert.equal(await focused.evaluate(element=>element===document.activeElement),true);assert.equal(await dialog.getByRole('button',{name:'Đóng',exact:true}).isEnabled(),true);
        const metrics=await page.evaluate(()=>({reads:window.__referenceReads,announcements:window.__referenceAnnouncements}));assert(metrics.announcements.length===1);assert(metrics.announcements[0].time-metrics.reads[0].start>=150,'Status must be delayed, not appear with the initial request');evidence.metrics=metrics;
        await dialog.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(mutations.length,0);
        await page.screenshot({path:path.join(output,`${config.kind}-slow.png`),fullPage:true});release();mode.gate=null;await dialog.getByRole('option',{name:config.option,exact:true}).waitFor({state:'attached'});await confirmDraft(dialog,config);assert.equal(await group.getAttribute('aria-busy'),'false');
      });
      await scenario(config,`${config.kind} initial 503 retains draft and GET retry recovers its reference without any POST`,async({page,mode,open,reads,calls})=>{
        mode.status=503;const dialog=await open();await dialog.getByRole('alert').filter({hasText:config.error}).waitFor();await fillDraft(dialog,config);assert.equal(await dialog.getByRole('button',{name:config.submit,exact:true}).isDisabled(),true);
        const priorShell=calls.filter(call=>/GET \/(dashboard\/summary|notifications\?)/.test(call)).length;await page.screenshot({path:path.join(output,`${config.kind}-503.png`),fullPage:true});mode.status=200;
        await dialog.getByRole('alert').getByRole('button',{name:'Thử lại',exact:true}).click();await dialog.getByRole('option',{name:config.option,exact:true}).waitFor({state:'attached'});await confirmDraft(dialog,config);assert.equal(reads.length,2);assert.equal(calls.filter(call=>/GET \/(dashboard\/summary|notifications\?)/.test(call)).length,priorShell);
      });
      await scenario(config,`${config.kind} confirmed 403 exposes no reference options and prevents submission`,async({page,mode,open})=>{
        mode.status=403;const dialog=await open();await dialog.getByRole('alert').filter({hasText:'Quyền đọc danh mục đã thay đổi.'}).waitFor();await fillDraft(dialog,config);
        const control=dialog.getByRole('combobox',{name:new RegExp('^'+config.control)});assert.equal(await control.isDisabled(),true);assert.equal(await control.locator('option[value]:not([value=""])').count(),0);assert.equal(await dialog.getByRole('button',{name:config.submit,exact:true}).isDisabled(),true);
        await dialog.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await confirmDraft(dialog,config);await page.screenshot({path:path.join(output,`${config.kind}-403.png`),fullPage:true});
      });
      await scenario(config,`${config.kind} verified empty reference has a named placeholder, empty status and disabled reference actions`,async({page,mode,open})=>{
        mode.empty=true;const dialog=await open();await dialog.getByRole('status').filter({hasText:config.empty}).waitFor();
        const control=dialog.getByRole('combobox',{name:new RegExp('^'+config.control)});assert.equal(await control.isDisabled(),true);assert((await control.locator('option').allTextContents()).some(text=>/Chưa có/.test(text)));assert.equal(await dialog.getByRole('button',{name:config.submit,exact:true}).isDisabled(),true);
        await page.screenshot({path:path.join(output,`${config.kind}-empty.png`),fullPage:true});
      });
    }
  }finally{await browser.close();const finalHtml=await(await fetch(origin)).text();assert.deepEqual([...finalHtml.matchAll(/\/assets\/[^"']+/g)].map(match=>match[0]),buildAssets,'The preview bundle changed while the suite ran');await fs.writeFile(path.join(output,'results.json'),JSON.stringify({origin,browserChannel:channel,browserEngine,browserVersion,buildAssets,width,theme,fixtureOnly:true,scope:'CreateUser and CREATE request reference loading, errors, retry, empty data and password label; no real API/SMTP/DB writes and no screen-reader claim.',results},null,2))}
  assert(results.length>0,'No matching dialog reference checks');console.log(`${results.filter(item=>item.status==='passed').length}/${results.length} dialog reference checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
