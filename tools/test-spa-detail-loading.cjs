// Production-build detail loading checks using isolated HTTP fixtures only.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium,firefox}=require(path.join(process.argv[2],'playwright'));
const {fixture,visible}=require('./test-spa-workspace.cjs');
const origin=process.env.CRYPTA_UI_TEST_URL||'http://127.0.0.1:4173';
const channel=process.env.CRYPTA_TEST_BROWSER||'msedge';
const theme=process.env.CRYPTA_DETAIL_THEME||'light';
const widths=process.env.CRYPTA_DETAIL_WIDTH?[Number(process.env.CRYPTA_DETAIL_WIDTH)]:[1440,390];
const output=path.resolve(process.env.CRYPTA_DETAIL_OUTPUT||path.join(__dirname,'test-artifacts','spa',`detail-loading-${Date.now()}`));
const results=[];let browser;
const asset={id:'asset-300',code:'ASSET-0300',purpose:'Tài sản 300',type:'KEY',status:'ACTIVE',algorithm:'RSA',keySize:2048,expiresAt:'2027-09-30T00:00:00Z',providerReference:'mock/300',publicKeyFingerprint:'public-fingerprint',policyVersionId:'version-1',policyCode:'RSA',version:3,ownerId:'session-USER',departmentId:'department-1',ownerName:'Người dùng mẫu',departmentName:'Đơn vị mẫu'};
const request={id:'request-4',reason:'Yêu cầu kiểm thử 4',type:'CREATE',status:'PENDING',submittedAt:'2026-09-30T01:00:00Z',creatorId:'session-USER',departmentId:'department-1',creatorName:'Người gửi mẫu',departmentName:'Đơn vị mẫu',version:7,emergency:false};
function gate(){let release,started;const promise=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);return{promise,release,started,seen}}
function history(count=0,lineage=false,long=false){return{items:Array.from({length:Math.min(count,10)},(_,i)=>({id:`event-${i+1}`,action:'ASSET_CREATED',occurredAt:'2026-09-30T01:00:00Z',actorName:long?'Người thực hiện có tên và phòng ban rất dài '.repeat(7):`Người thực hiện ${i+1}`,requestId:null})),total:count,page:1,pageSize:10,lineage:{replaces:null,replacedBy:[],assets:lineage?[{id:'asset-299',code:long?'ASSET-0299-'+'CHUOI_DAI_'.repeat(15):'ASSET-0299',relation:'predecessor'}]:[]}}}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function geometry(page){return page.locator('.resource-region[aria-label="Chi tiết"]').evaluate(region=>{
  const box=selector=>{const element=region.querySelector(selector);if(!element)return null;const r=element.getBoundingClientRect();return{y:r.y,height:r.height,bottom:r.bottom,width:r.width}};
  return{resource:box('.resource-body'),frame:box('.asset-detail-page'),header:box('.drawer-header'),body:box('.drawer-body'),metadata:box('.detail-grid'),timeline:box('.mini-timeline'),history:box('.history-timeline'),footer:box('.drawer-footer'),outline:!!region.querySelector('.detail-loading-outline'),busy:region.getAttribute('aria-busy')};
})}
async function assertNoOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Detail text must wrap without body overflow.')}
async function installDetailReads(f){
  const entries=new Map(),reads=[];
  await f.page.route('**/api/v1/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname.slice('/api/v1'.length),entry=entries.get(endpoint);
    if(route.request().method()!=='GET'||!entry)return route.fallback();
    reads.push(endpoint);entry.gate?.started();if(entry.gate)await entry.gate.promise;if(entry.delay)await new Promise(resolve=>setTimeout(resolve,entry.delay));
    const status=entry.status??200;
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{data:entry.body}:{error:{code:status===403?'FORBIDDEN':'UNAVAILABLE',message:status===403?'Không còn quyền xem chi tiết.':'Chi tiết tạm thời không khả dụng.'}})}).catch(error=>{if(!/closed|disposed|Invalid InterceptionId/.test(error.message))throw error});
  });
  return{entries,reads};
}
async function openMenu(page,width){if(width<821){await page.getByRole('button',{name:'Mở điều hướng',exact:true}).click();await page.locator('.sidebar-open').waitFor()}}
async function check(name,role,width,body){
  if(process.env.CRYPTA_DETAIL_FILTER&&!name.includes(process.env.CRYPTA_DETAIL_FILTER))return;
  const f=await fixture(browser,role),item={name,width,theme,status:'passed',evidence:{}};
  await f.page.setViewportSize({width,height:1000});await f.page.addInitScript(value=>localStorage.setItem('crypta-theme',value),theme);
  await f.page.addInitScript(()=>{
    window.__detailPendingAnnouncements=[];
    const observer=new MutationObserver(()=>{
      const region=document.querySelector('.resource-region[aria-label="Chi tiết"]'),text=region?.querySelector('.resource-pending')?.textContent;
      if(text&&!window.__detailPendingAnnouncements.includes(text))window.__detailPendingAnnouncements.push(text);
    });observer.observe(document,{subtree:true,childList:true,characterData:true});
  });
  const index=results.length+1;const reads=await installDetailReads(f);
  try{await body(f,reads,item,index);assert.deepEqual(f.errors,[]);await assertNoOverflow(f.page)}
  catch(error){item.status='failed';item.error=error.stack;process.exitCode=1;await f.page.screenshot({path:path.join(output,`${index}-failed.png`),fullPage:true}).catch(()=>{})}
  finally{await f.context.tracing.stop({path:path.join(output,`${index}.zip`)});await f.context.close();results.push(item);console.log(`${item.status==='passed'?'PASS':'FAIL'} ${name}${item.error?'\n'+item.error:''}`)}
}
(async()=>{
  await fs.mkdir(output,{recursive:true});browser=await(channel==='firefox'?firefox.launch({headless:true}):chromium.launch({channel,headless:true}));const browserVersion=browser.version();
  try{
    for(const width of widths){
      for(const kind of ['asset','request']){
        const role=kind==='asset'?'USER':'APPROVER',endpoint=kind==='asset'?'/assets/asset-300':'/requests/request-4',title=kind==='asset'?'Tài sản 300':'Yêu cầu kiểm thử 4';
        await check(`${kind} initial geometry matches metadata/timeline/history while GET is pending at ${width}`,role,width,async({page,mutations},{entries},item,index)=>{
          const detailGate=gate(),historyGate=gate();entries.set(endpoint,{body:kind==='asset'?asset:request,gate:detailGate});if(kind==='asset')entries.set('/assets/asset-300/history',{body:history(15),gate:historyGate});
          await page.goto(origin+endpoint);await detailGate.seen;await page.locator('.resource-region[aria-busy=true]').waitFor();
          await page.waitForTimeout(230);await settle(page);item.evidence.pending=await geometry(page);
          const region=page.locator('.resource-region[aria-label="Chi tiết"]');assert.equal(await region.locator('.resource-pending').textContent(),'Đang tải chi tiết…');
          assert.equal(await region.getByRole('button',{name:/Yêu cầu gia hạn|Thu hồi|Phê duyệt|Từ chối/}).count(),0);
          assert.equal(await region.locator('.loading-outline button,.loading-outline a,.loading-outline input,.loading-outline select').count(),0,'Initial outline must not contain provisional business controls.');
          await page.screenshot({path:path.join(output,`${index}-pending.png`),fullPage:true});
          detailGate.release();await visible(page,title);if(kind==='asset')await historyGate.seen;await settle(page);item.evidence.detailReadyHistoryPending=await geometry(page);
          await page.screenshot({path:path.join(output,`${index}-detail-ready.png`),fullPage:true});
          if(kind==='asset'){historyGate.release();await page.locator('.history-timeline[aria-busy=false]').waitFor()}
          item.evidence.final=await geometry(page);assert.equal(mutations.length,0);
          assert.equal(item.evidence.pending.outline,true,'Initial detail must reserve the established metadata/timeline layout.');
          const metadataGrowth=item.evidence.detailReadyHistoryPending.metadata.height-item.evidence.pending.metadata.height;
          // Unknown provider copy may gain one line in the narrow two-column grid.
          // Record that intrinsic text growth; do not mislabel it as a missing frame.
          item.evidence.metadataTextGrowthPx=metadataGrowth;
          assert(Math.abs(metadataGrowth)<=(kind==='asset'&&width<621?22:3),'Metadata reserved rows changed beyond their one-line/known narrow provider footprint.');
          for(const field of ['header','metadata','timeline','footer']){
            const intrinsic=field==='timeline'||field==='footer'?metadataGrowth:0;
            assert(Math.abs(item.evidence.pending[field].y+intrinsic-item.evidence.detailReadyHistoryPending[field].y)<=3,`${field} moved beyond intrinsic metadata text growth: ${JSON.stringify(item.evidence.pending[field])} → ${JSON.stringify(item.evidence.detailReadyHistoryPending[field])}`);
          }
        });
        await check(`${kind} fast GET never announces a loading indicator at ${width}`,role,width,async({page,mutations},{entries},item)=>{
          entries.set(endpoint,{body:kind==='asset'?asset:request,delay:35});if(kind==='asset')entries.set('/assets/asset-300/history',{body:history(0)});
          await page.goto(origin+endpoint);await visible(page,title);await page.waitForTimeout(220);
          item.evidence.announcements=await page.evaluate(()=>window.__detailPendingAnnouncements);
          assert.deepEqual(item.evidence.announcements,[]);assert.equal(mutations.length,0);
        });
        await check(`${kind} same-key refresh holds503 snapshot locks actions and drops403 data at ${width}`,role,width,async({page,mutations},{entries,reads},item,index)=>{
          entries.set(endpoint,{body:kind==='asset'?asset:request});if(kind==='asset')entries.set('/assets/asset-300/history',{body:history(2,true)});
          await page.goto(origin+endpoint);await visible(page,title);if(kind==='asset')await page.locator('.history-timeline[aria-busy=false]').waitFor();
          const refresh=page.getByRole('button',{name:'Làm mới chi tiết',exact:true});assert.equal(await refresh.count(),1,'Detail needs a GET-only action to revalidate metadata/version.');
          const before=await geometry(page),refreshGate=gate();entries.set(endpoint,{body:kind==='asset'?asset:request,status:503,gate:refreshGate});await refresh.click();await refreshGate.seen;
          assert.equal(await refresh.isDisabled(),true);assert.equal(await page.locator('#page-title').textContent(),title);
          assert.equal(await page.getByRole('button',{name:/Yêu cầu gia hạn|^Thu hồi$|^Phê duyệt$|^Từ chối$/}).count(),0,'Stale metadata cannot drive business actions.');
          await page.waitForTimeout(230);item.evidence.pending=await geometry(page);assert(Math.abs(item.evidence.pending.footer.y-before.footer.y)<=3);
          refreshGate.release();await page.getByRole('alert').filter({hasText:'Chi tiết tạm thời không khả dụng.'}).waitFor();assert.equal(await page.locator('#page-title').textContent(),title);
          item.evidence.held503=await geometry(page);await page.screenshot({path:path.join(output,`${index}-503.png`),fullPage:true});
          entries.set(endpoint,{body:kind==='asset'?asset:request});await page.getByRole('alert').getByRole('button',{name:'Thử lại',exact:true}).click();await page.locator('.resource-region[aria-busy=false]').waitFor();await page.getByRole('alert').waitFor({state:'hidden'});
          entries.set(endpoint,{status:403});await refresh.click();await page.getByRole('alert').filter({hasText:'Không còn quyền xem chi tiết.'}).waitFor();
          assert.equal(await page.locator('.asset-detail-page').count(),0);assert.equal(await page.getByRole('heading',{name:title,exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/Yêu cầu gia hạn|^Thu hồi$|^Phê duyệt$|^Từ chối$/}).count(),0);
          await page.screenshot({path:path.join(output,`${index}-403.png`),fullPage:true});assert.equal(mutations.length,0);item.evidence.getReads=reads.filter(value=>value===endpoint).length;assert.equal(item.evidence.getReads,4,'Initial read, refresh503, retry and refresh403 must each issue exactly one GET.');item.evidence.mutations=0;
        });
      }
      await check(`asset empty history, lineage and multiline data remain readable at ${width}`,'USER',width,async({page,mutations},{entries},item,index)=>{
        const longAsset={...asset,providerReference:'mock/300',purpose:'Mục đích sử dụng và mô tả tài sản tiếng Việt rất dài '.repeat(15),publicKeyFingerprint:'PUBLIC_FINGERPRINT_'.repeat(24),ownerName:'Tên chủ sở hữu có nhiều chữ '.repeat(8)};
        entries.set('/assets/asset-300',{body:longAsset});entries.set('/assets/asset-300/history',{body:history(0)});
        await page.goto(origin+'/assets/asset-300');await page.locator('.history-timeline[aria-busy=false]').waitFor();
        await page.getByText('Chưa có sự kiện được ghi nhận cho tài sản này.',{exact:true}).waitFor();assert.equal(await page.locator('.history-timeline ol li').count(),0);await assertNoOverflow(page);item.evidence.emptyGeometry=await geometry(page);
        entries.set('/assets/asset-300/history',{body:history(2,true,true)});await page.getByRole('button',{name:'Làm mới lịch sử tài sản',exact:true}).click();await page.locator('.history-timeline[aria-busy=false]').waitFor();
        assert.equal(await page.locator('.history-timeline ol li').count(),2);assert.equal(await page.locator('.timeline-lineage a').count(),1);await assertNoOverflow(page);
        item.evidence.lineageGeometry=await geometry(page);await page.screenshot({path:path.join(output,`${index}-multiline.png`),fullPage:true});assert.equal(mutations.length,0);
      });
      await check(`pending detail allows Back/menu and ignores late data at ${width}`,'USER',width,async({page,mutations},{entries},item)=>{
        const held=gate();entries.set('/assets/asset-300',{body:asset,gate:held});await page.goto(origin+'/assets');await visible(page,'Tài sản của tôi');
        await page.locator('.table-shell[aria-busy=false]').waitFor();
        // A direct pending detail has a safe list fallback; navigation stays live.
        await page.goto(origin+'/assets/asset-300');await held.seen;await page.getByRole('button',{name:'Về danh sách',exact:true}).last().click();await visible(page,'Tài sản của tôi');held.release();await settle(page);assert.equal(new URL(page.url()).pathname,'/assets');assert.equal(await page.getByRole('heading',{name:'Tài sản 300',exact:true}).count(),0);
        const menuGate=gate();entries.set('/assets/asset-300',{body:asset,gate:menuGate});await page.goto(origin+'/assets/asset-300');await menuGate.seen;await openMenu(page,width);await page.locator('.nav-groups a[href="/notifications"]').click();await visible(page,'Thông báo');menuGate.release();await settle(page);
        assert.equal(new URL(page.url()).pathname,'/notifications');assert.equal(await page.getByRole('heading',{name:'Tài sản 300',exact:true}).count(),0);assert.equal(mutations.length,0);item.evidence={backWhilePending:true,menuWhilePending:true,lateDetailIgnored:true,mutations:0};
      });
    }
  }finally{
    await browser.close();const html=await(await fetch(origin)).text();const buildAssets=[...html.matchAll(/\/assets\/[^"']+/g)].map(match=>match[0]);
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({origin,browserChannel:channel,browserVersion,buildAssets,widths,theme,fixtureOnly:true,scope:'Detail initial geometry/fast180ms/slow status, same-key503 hold and403 drop, unknown/empty history, lineage/multiline, Back/menu and late-response boundaries. No real DB or native screen reader acceptance.',results},null,2));
  }
  assert(results.length>0,'No matching detail checks');console.log(`${results.filter(item=>item.status==='passed').length}/${results.length} detail loading checks passed; ${path.join(output,'results.json')}`);
})().catch(error=>{console.error(error);process.exitCode=1});
