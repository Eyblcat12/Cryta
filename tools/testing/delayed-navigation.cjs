// Actual API reads waiting on a relation lock in a validated isolated test DB.
// No HTTP interception, response fixture, persistent schema change or operational DB.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
module.exports=async function delayedNavigation({test,sql,compose,newPage,uiLogin,origin,createUser,changedPassword,call,expectStatus,admin}){
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(read,check,message){const end=Date.now()+6000;while(Date.now()<end){const value=read();if(check(value))return value;await sleep(100);}throw new Error(message);}
 async function withAssetReadLock(body){
  const tag='t30_nav_delay_'+randomBytes(6).toString('hex');
  assert.match(tag,/^t30_nav_delay_[a-f0-9]{12}$/);
  const process=spawn('docker',[...compose,'exec','-T','postgres','psql','-X','-U','crypta_t30_test','-d','crypta_t30_test','-At','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let spawnError,closed=false;process.on('error',e=>{spawnError=e.code;});const ended=new Promise(resolve=>process.once('close',()=>{closed=true;resolve();}));
  // Drain diagnostics in memory without recording configuration or raw driver output.
  process.stdout.on('data',()=>{});process.stderr.on('data',()=>{});process.stdin.on('error',()=>{});
  process.stdin.end(`SET application_name='${tag}'; SET statement_timeout='20s'; SET lock_timeout='3s'; BEGIN; LOCK TABLE public.crypto_assets IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(15); ROLLBACK;`);
  let holder,releaseEvidence;const start=Date.now();
  const holderRows=()=>JSON.parse(sql(`SELECT COALESCE(json_agg(json_build_object('pid',pid,'waitEvent',wait_event,'state',state)),'[]') FROM pg_stat_activity WHERE datname='crypta_t30_test' AND usename='crypta_t30_test' AND application_name='${tag}'`));
  async function release(){if(releaseEvidence)return releaseEvidence;
   const current=holderRows();
   if(current.length){assert.equal(current.length,1);if(holder)assert.equal(current[0].pid,holder.pid);const cancelled=sql(`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname='crypta_t30_test' AND usename='crypta_t30_test' AND application_name='${tag}' AND pid=${current[0].pid}`);assert.equal(cancelled,'t');}
   await Promise.race([ended,sleep(3000)]);
   if(!closed){const remaining=holderRows();if(remaining.length){assert.equal(remaining.length,1);sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='crypta_t30_test' AND usename='crypta_t30_test' AND application_name='${tag}' AND pid=${remaining[0].pid}`);}await Promise.race([ended,sleep(3000)]);}
   assert(closed,'Owned lock-holder process must exit.');assert.equal(holderRows().length,0);
   releaseEvidence={holderPid:holder?.pid??null,holderRemaining:0,ownedProcessExited:closed,releasedBeforeSafetyTimeout:current.length===1,elapsedMs:Date.now()-start};return releaseEvidence;
  }
  try{
   holder=(await until(holderRows,rows=>{if(spawnError||closed)throw new Error('OWNED_LOCK_HOLDER_EXITED');return rows.length===1&&rows[0].waitEvent==='PgSleep';},'OWNED_LOCK_NOT_HELD'))[0];
   const waitForRead=()=>until(()=>JSON.parse(sql(`SELECT COALESCE(json_agg(json_build_object('pid',pid,'waitEvent',wait_event,'blockers',pg_blocking_pids(pid))),'[]') FROM pg_stat_activity WHERE datname='crypta_t30_test' AND application_name='crypta-api' AND wait_event_type='Lock' AND ${holder.pid}=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT COUNT(*)::int AS total FROM crypto_assets a%'`)),rows=>rows.length>0,'REAL_ASSET_READ_NOT_WAITING_ON_OWNED_LOCK');
   const evidence=await body({waitForRead,release,holderPid:holder.pid});return{...evidence,lock:await release()};
  }finally{await release();}
 }
 async function stage(email,password,startPath='/requests'){
  const f=await newPage();const requests=[],documents=[],scripts=[];
  f.page.on('request',r=>{const u=new URL(r.url());if(u.origin!==origin.origin)return;if(r.resourceType()==='document')documents.push(u.pathname);if(r.resourceType()==='script')scripts.push(u.pathname);if(r.method()==='GET'&&u.pathname==='/api/v1/assets')requests.push(r);});
  await f.page.goto(new URL(startPath,origin).href);await uiLogin(f.page,email,password);await f.page.waitForURL(url=>url.pathname===startPath);await f.page.waitForLoadState('networkidle');
  await f.page.evaluate(()=>{window.__lateNavigationDocument=document;window.__lateNavigationShell=document.querySelector('.app-shell');});
  return{...f,requests,documents,scripts,initialScripts:scripts.length};
 }
 async function startRead(f,lock){const next=f.page.waitForRequest(r=>r.method()==='GET'&&new URL(r.url()).pathname==='/api/v1/assets');await f.page.locator('.sidebar a[href="/assets"]').click();const request=await next;const waiting=await lock.waitForRead();await f.page.locator('.table-shell[aria-busy="true"]').waitFor();return{request,waiting};}
 async function completed(f,request,{sameShell=true}={}){
  // Abort is observable at the browser; the server SQL is independently observed waiting.
  // A cancelled browser read is not claimed to deliver a late200 body to the browser.
  await until(()=>request.failure(),value=>!!value,'ABANDONED_BROWSER_READ_NOT_CANCELLED');
  assert(await f.page.evaluate(()=>window.__lateNavigationDocument===document));
  assert.equal(await f.page.evaluate(()=>window.__lateNavigationShell===document.querySelector('.app-shell')),sameShell);
  assert.equal(f.documents.length,1,'Navigation/account changes must keep one document.');assert.equal(f.scripts.length,f.initialScripts,'Navigation must not redownload application scripts.');
  assert.deepEqual(f.errors,[]);assert.equal(await f.page.locator('.toast').count(),0);
  const businessWrites=f.calls.filter(c=>!/^(GET|HEAD) /.test(c)&&!/^POST \/auth\//.test(c));assert.equal(businessWrites.length,0);
  return{cancelledBrowserRead:true,documentRequests:f.documents.length,scriptRequests:f.scripts.length,noAdditionalScriptDownloads:true,documentIdentityPreserved:true,shellIdentityPreserved:sameShell,businessWrites:0,pageErrors:0,interceptedRequests:0};
 }
 await test('NAV-11 real delayed GET: route change abandons an asset read waiting on PostgreSQL',async()=>{
  const f=await stage('dev.nguyen@congty.com');try{return await withAssetReadLock(async lock=>{
   const {request,waiting}=await startRead(f,lock);await f.page.locator('.sidebar a[href="/requests"]').click();await f.page.waitForURL(url=>url.pathname==='/requests');await f.page.getByRole('heading',{name:'Yêu cầu của tôi',level:1,exact:true}).waitFor();
   const title=await f.page.title();await lock.release();await f.page.waitForLoadState('networkidle');assert.equal(new URL(f.page.url()).pathname,'/requests');assert.equal(await f.page.title(),title);assert.equal(await f.page.getByRole('button',{name:'KEY-DEV-001',exact:true}).count(),0);
   return{...(await completed(f,request)),blockedReadWaiters:waiting,finalPath:'/requests'};
  });}finally{await f.context.close();}
 });
 await test('NAV-07 real delayed GET: logout and another account discard the old owner read',async()=>{
  const f=await stage('dev.nguyen@congty.com');try{return await withAssetReadLock(async lock=>{
   const {request,waiting}=await startRead(f,lock);await f.page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await f.page.locator('.login-card').waitFor();await uiLogin(f.page,'kt.tran@congty.com');await f.page.locator('.role-switcher').waitFor();
   await lock.release();await f.page.getByRole('button',{name:'CRT-FIN-ACTIVE',exact:true}).first().waitFor();await f.page.waitForLoadState('networkidle');assert.equal(await f.page.getByRole('button',{name:'KEY-DEV-001',exact:true}).count(),0);
   return{...(await completed(f,request,{sameShell:false})),blockedReadWaiters:waiting,oldOwnerAssetAbsent:true,newOwnerAssetPresent:true,finalPath:new URL(f.page.url()).pathname};
  });}finally{await f.context.close();}
 });
 await test('NAV-28 real delayed GET: switching ADMIN to USER discards the pending privileged asset read',async()=>{
  const user=await createUser(['ADMIN','USER']);
  const prior=expectStatus(await call('GET','/assets?pageSize=25',undefined,user.accessToken),200);assert(prior.items.some(x=>x.code==='KEY-DEV-001'));
  const f=await stage(user.email,changedPassword,'/policies');try{return await withAssetReadLock(async lock=>{
   const {request,waiting}=await startRead(f,lock);await f.page.locator('.role-switcher').click();await f.page.getByRole('menuitemradio',{name:/Nhân viên/}).click();await f.page.waitForURL(url=>url.pathname==='/dashboard');await f.page.getByRole('button',{name:'Vai trò hiện tại: Nhân viên',exact:true}).waitFor();
   await f.page.locator('.sidebar a[href="/assets"]').click();await f.page.getByRole('heading',{name:'Tài sản của tôi',exact:true,level:1}).waitFor();await lock.release();await f.page.locator('.table-shell[aria-busy="false"]').waitFor();await f.page.waitForLoadState('networkidle');
   assert.equal(await f.page.getByRole('button',{name:'KEY-DEV-001',exact:true}).count(),0);assert.equal(await f.page.getByRole('button',{name:'CRT-FIN-ACTIVE',exact:true}).count(),0);assert(f.calls.some(c=>c.startsWith('GET /assets?')&&c.includes('ownedOnly=true')));
   return{...(await completed(f,request,{sameShell:false})),blockedReadWaiters:waiting,privilegedReadBaselineContainsOtherOwner:true,privilegedAssetAbsent:true,userProjectionRequested:true,finalPath:'/assets'};
  });}finally{await f.context.close();expectStatus(await call('PATCH',`/users/${user.id}/status`,{status:'INACTIVE'},admin.accessToken),200);}
 });
};
