// Real Edge/Chrome page zoom in a fresh test profile; no CSS zoom or viewport emulation.
// Business HTTP is fixture-only. This does not exercise a screen reader.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const {fixture}=require('./test-spa-workspace.cjs');
const origin=process.env.CRYPTA_UI_TEST_URL||'http://127.0.0.1:4173';
const channel=process.env.CRYPTA_TEST_BROWSER||'chrome';
const output=path.resolve(process.env.CRYPTA_ZOOM_OUTPUT||path.join(__dirname,'test-artifacts','spa',`zoom-${Date.now()}`));
const results=[];
const routes={USER:['/dashboard','/assets','/requests','/notifications','/assets/asset-300'],APPROVER:['/dashboard','/approvals','/approvals/history','/notifications','/requests/request-1'],ADMIN:['/dashboard','/users','/users/access','/policies','/audit','/operations/email','/notifications']};
const geometry=()=>({innerWidth,innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio,visualScale:visualViewport.scale,cssZoom:getComputedStyle(document.documentElement).zoom,bodyZoom:getComputedStyle(document.body).zoom,overflow:document.documentElement.scrollWidth-innerWidth});
async function setNativeZoom(settings,evidence){
  if(channel==='msedge'){
    await settings.goto('edge://settings/accessibility');
    const zoom=settings.getByLabel('Page zoom 100%',{exact:true});await zoom.waitFor();
    evidence.settingsUrl=settings.url();evidence.settingsBefore=await zoom.getAttribute('aria-label');await zoom.click();
    await settings.getByRole('menuitemradio',{name:'200%',exact:true}).click();
    await settings.getByLabel('Page zoom 200%',{exact:true}).waitFor();evidence.settingsAfter='Page zoom 200%';
  }else{
    await settings.goto('chrome://settings/appearance');const zoom=settings.locator('#zoomLevel');await zoom.waitFor();assert.equal(await zoom.inputValue(),'1');
    evidence.settingsUrl=settings.url();evidence.settingsBefore='100%';await zoom.selectOption('2');assert.equal(await zoom.inputValue(),'2');evidence.settingsAfter='200%';
  }
  evidence.settingsZoom='200%';
}
async function checkDialog(page,name){
  const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByRole('button',{name:'Đóng',exact:true}).focus();
  for(let i=0;i<16;i++){
    await page.keyboard.press('Tab');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const current=await page.evaluate(()=>{
      const active=document.activeElement,rect=active.getBoundingClientRect(),dialog=active.closest('[role=dialog]');
      const footer=dialog?.querySelector('form footer'),footerRect=footer?.getBoundingClientRect();
      return {tag:active.tagName,label:active.getAttribute('aria-label')||active.closest('label')?.textContent?.slice(0,80)||active.textContent?.slice(0,80),inside:!!dialog,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,viewport:{width:innerWidth,height:innerHeight},covered:!!footerRect&&!footer.contains(active)&&getComputedStyle(footer).position==='sticky'&&rect.bottom>footerRect.top+1};
    });
    assert(current.inside,`${name}: Tab escaped the dialog`);assert(current.width>0&&current.height>0);
    assert(current.left>=-1&&current.right<=current.viewport.width+1,`${name}: focused control clipped horizontally`);
    assert(current.top>=-1&&current.bottom<=current.viewport.height+1,`${name}: focused control clipped vertically ${JSON.stringify(current)}`);
    assert(!current.covered,`${name}: sticky footer covers focused control`);
  }
}
(async()=>{
  assert(['chrome','msedge'].includes(channel),'Native settings zoom harness supports Chrome and Edge only');
  await fs.mkdir(output,{recursive:true});let browserVersion,browserEngine;
  const initialResponse=await fetch(origin);assert.equal(initialResponse.status,200,'Production preview must be available');
  const initialHtml=await initialResponse.text(),assets=[...initialHtml.matchAll(/\/assets\/[^"']+/g)].map(match=>match[0]);
  for(const role of ['USER','APPROVER','ADMIN'])for(const theme of ['light','dark']){
    if(process.env.CRYPTA_ZOOM_FILTER&&!`${role}-${theme}`.includes(process.env.CRYPTA_ZOOM_FILTER))continue;
    const name=`${role}-${theme}`,profile=path.join(output,`profile-${name}`);await fs.mkdir(profile,{recursive:false});
    const context=await chromium.launchPersistentContext(profile,{channel,headless:true,viewport:null,args:['--window-size=1440,1000']});
    const evidence={profile,headless:true,viewportEmulation:false,pages:[],dialogs:[]};
    try{
      browserVersion=context.browser().version();browserEngine=context.browser().browserType().name();
      const settings=context.pages()[0];await settings.goto('data:text/html,<style>body{height:2000px}</style>');evidence.before=await settings.evaluate(geometry);
      await setNativeZoom(settings,evidence);
      const f=await fixture({newContext:async()=>context},role,{notificationItems:true,historyItems:true,auditItems:true,emailItems:true,emailEnabled:true});const {page}=f;
      for(const route of routes[role]){
        await page.goto(origin+route);await page.locator('#page-title').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('[aria-busy]')].every(element=>element.getAttribute('aria-busy')!=='true'));
        if(theme==='dark'&&await page.locator('html').getAttribute('data-theme')!=='dark')await page.getByRole('button',{name:'Chuyển sang giao diện tối',exact:true}).click();
        const view=await page.evaluate(geometry);assert.equal(view.outerWidth,evidence.before.outerWidth);assert.equal(view.outerHeight,evidence.before.outerHeight);assert(Math.abs(view.innerWidth*2-evidence.before.innerWidth)<=20);
        assert.equal(view.dpr,evidence.before.dpr*2);assert.equal(view.visualScale,1);assert.equal(view.cssZoom,'1');assert.equal(view.bodyZoom,'1');assert(view.overflow<=1,`${route}: body overflow ${view.overflow}px`);
        evidence.pages.push({route,geometry:view,title:await page.locator('#page-title').textContent()});
      }
      const trigger=page.getByRole('button',{name:'Mở điều hướng',exact:true});await trigger.click();await page.waitForFunction(()=>!!document.activeElement.closest('.sidebar'));
      await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.sidebar')),true);await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Mở điều hướng');
      const skip=page.getByRole('link',{name:'Bỏ qua điều hướng',exact:true});await skip.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'main-content');
      if(role==='USER'){
        await page.goto(origin+'/requests/new');await page.getByRole('dialog').getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});await checkDialog(page,'request');evidence.dialogs.push('request');
      }else if(role==='APPROVER'){
        await page.goto(origin+'/requests/request-1');await page.getByRole('button',{name:'Từ chối',exact:true}).click();await checkDialog(page,'reject');evidence.dialogs.push('reject');
      }else{
        await page.goto(origin+'/users');await page.getByRole('button',{name:'Thêm người dùng',exact:true}).click();await page.getByRole('dialog').getByRole('option',{name:'Đơn vị mẫu (IT)'}).waitFor({state:'attached'});await checkDialog(page,'create-user');evidence.dialogs.push('create-user');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
        await page.goto(origin+'/operations/email');await page.getByRole('button',{name:'Gửi thử',exact:true}).click();await checkDialog(page,'test-email');evidence.dialogs.push('test-email');
      }
      assert.equal(f.mutations.length,0);assert.deepEqual(f.errors,[]);const capture=await context.newCDPSession(page);const screenshot=await capture.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await fs.writeFile(path.join(output,`${name}-dialog.png`),Buffer.from(screenshot.data,'base64'));
      results.push({name,passed:true,evidence});console.log(`PASS real browser zoom 200% ${name}`);
    }catch(error){const page=context.pages().at(-1);const capture=await context.newCDPSession(page);const screenshot=await capture.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await fs.writeFile(path.join(output,`${name}-failed.png`),Buffer.from(screenshot.data,'base64'));results.push({name,passed:false,error:error.message,evidence});console.error(`FAIL real browser zoom 200% ${name}: ${error.message}`)}
    finally{await context.close()}
  }
  const html=await(await fetch(origin)).text();assert.deepEqual([...html.matchAll(/\/assets\/[^"']+/g)].map(match=>match[0]),assets,'Production preview changed during native zoom checks');
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({browserChannel:channel,browserEngine,browserVersion,assets,fixtureOnly:true,method:`Fresh private profile per role/theme; ${channel==='msedge'?'Edge Settings Accessibility native Page zoom menu':'Chrome Settings Appearance native Page zoom select'} 100% -> 200%, headless browser, viewport:null; outer width/height unchanged; CSS width half, DPR double; visualViewport scale and document/body CSS zoom remain 1.`,scope:'3 roles, 2 themes; listed pages, mobile menu/skip keyboard and four dialog kinds. Not a screen-reader or all-state audit.',results},null,2));
  console.log(`${results.filter(item=>item.passed).length}/${results.length} real-zoom groups passed`);if(results.some(item=>!item.passed))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
