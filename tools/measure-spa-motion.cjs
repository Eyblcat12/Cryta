// Compare the same fixture navigation with the production motion switch on/off.
// This measures UI only. It never starts a backend or sends writes to a real API.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const {fixture,visible}=require('./test-spa-workspace.cjs');
const output=path.resolve(process.env.CRYPTA_MOTION_OUTPUT||path.join(__dirname,'test-artifacts','spa','motion'));
const origins={on:process.env.CRYPTA_UI_TEST_URL||'http://127.0.0.1:4173',off:process.env.CRYPTA_UI_BASELINE_URL||'http://127.0.0.1:4174'};
const repeats=Number(process.env.CRYPTA_MOTION_REPEATS||1);
const filmstrip=process.env.CRYPTA_MOTION_FILMSTRIP==='1';
assert(Number.isInteger(repeats)&&repeats>=1&&repeats<=5,'CRYPTA_MOTION_REPEATS must be an integer from 1 to 5');
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
async function traceToFile(cdp,file){
  const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');
  const {stream}=await complete;let contents='';
  while(true){const chunk=await cdp.send('IO.read',{handle:stream});contents+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString('utf8'):chunk.data;if(chunk.eof)break}
  await cdp.send('IO.close',{handle:stream});await fs.writeFile(file,contents);
}
async function measure(browser,mode,width,round){
  const f=await fixture(browser,'ADMIN',{policyDelay:350,dashboardDelay:350,trace:false});const {page,context}=f;
  try{
    await page.setViewportSize({width,height:1000});const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:1_600_000/8,uploadThroughput:750_000/8});
    await page.addInitScript(()=>{
      window.__motionMeasurements={longTasks:[],shifts:[],animations:[],steps:[]};
      new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__motionMeasurements.longTasks.push({start:entry.startTime,duration:entry.duration})}).observe({type:'longtask',buffered:true});
      new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__motionMeasurements.shifts.push({start:entry.startTime,value:entry.value,recentInput:entry.hadRecentInput,sources:entry.sources?.map(source=>source.node?.id||source.node?.className||source.node?.nodeName)})}).observe({type:'layout-shift',buffered:true});
      const animate=Element.prototype.animate;
      Element.prototype.animate=function(frames,options){
        const measurement={start:performance.now(),target:this.id,duration:options?.duration,frames};
        const mark=`crypta-motion-setup-${window.__motionMeasurements.animations.length}`;
        window.__motionMeasurements.animations.push(measurement);performance.mark(`${mark}-start`);
        try{return animate.call(this,frames,options)}
        finally{measurement.setupMs=performance.now()-measurement.start;performance.mark(`${mark}-end`);performance.measure(mark,`${mark}-start`,`${mark}-end`)}
      };
      document.addEventListener('click',event=>{const link=event.target.closest?.('a.nav-item');if(link){window.__motionMeasurements.steps.push({path:new URL(link.href).pathname,start:performance.now()})}},true);
      new MutationObserver(()=>{const step=window.__motionMeasurements.steps.at(-1);if(step&&!step.commit&&location.pathname===step.path&&document.querySelector('#page-title'))step.commit=performance.now()}).observe(document,{subtree:true,childList:true,characterData:true});
    });
    await page.goto(origins[mode]+'/dashboard');await visible(page,'Sức khỏe tài sản mật mã');await page.waitForTimeout(900);
    await page.evaluate(()=>{window.__motionMeasurements.longTasks=[];window.__motionMeasurements.shifts=[];window.__motionMeasurements.animations=[];window.__motionMeasurements.steps=[]});
    await cdp.send('Tracing.start',{categories:'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing'+(filmstrip?',disabled-by-default-devtools.screenshot':''),transferMode:'ReturnAsStream'});
    // Drive the same real DOM links in one browser scenario. Locator polling and
    // snapshot evaluations during the 160ms entrance would add automation tasks.
    await page.evaluate(async mobile=>{
      const routes=[['/users','Người dùng và vai trò'],['/policies','Chính sách mật mã'],['/dashboard','Sức khỏe tài sản mật mã']];
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
      for(let index=0;index<12;index++){
        if(mobile){document.querySelector('button[aria-label="Mở điều hướng"]').click();await nextFrame()}
        const [route,title]=routes[index%3];const link=document.querySelector(`a.nav-item[href="${route}"]`);if(!link)throw new Error(`Missing navigation ${route}`);
        link.click();await new Promise(resolve=>setTimeout(resolve,650));
        if(location.pathname!==route||!document.querySelector('#page-title')?.textContent?.includes(title))throw new Error(`Navigation did not commit ${route}`);
      }
    },width<=820);
    const metrics=await page.evaluate(()=>window.__motionMeasurements);
    const mainAnimations=metrics.animations.filter(item=>item.target==='main-content');
    assert.equal(metrics.steps.length,12);assert(metrics.steps.every(item=>item.commit>=item.start));assert.equal(f.mutations.length,0);assert.deepEqual(f.errors,[]);
    assert.equal(mainAnimations.length,mode==='on'?12:0);
    const sample=`${mode}-${width}${repeats>1?`-r${round+1}`:''}`;
    await traceToFile(cdp,path.join(output,`${sample}-trace.json`));
    await page.screenshot({path:path.join(output,`${sample}.png`),fullPage:true});
    const assets=await page.locator('script[src],link[rel=stylesheet]').evaluateAll(items=>items.map(item=>item.getAttribute('src')||item.getAttribute('href')));
    return{sample,round:round+1,mode,width,height:1000,cpuSlowdown:4,network:{latencyMs:80,downloadBitsPerSecond:1600000,uploadBitsPerSecond:750000,fixtureReadDelayMs:350},assets,
      medianCommitMs:median(metrics.steps.map(item=>item.commit-item.start)),longTaskCount:metrics.longTasks.length,maxLongTaskMs:Math.max(0,...metrics.longTasks.map(item=>item.duration)),
      maxMainAnimationSetupMs:Math.max(0,...mainAnimations.map(item=>item.setupMs)),
      layoutShiftSum:metrics.shifts.reduce((sum,item)=>sum+item.value,0),shiftWithoutRecentInputSum:metrics.shifts.filter(item=>!item.recentInput).reduce((sum,item)=>sum+item.value,0),mainAnimations,steps:metrics.steps,longTasks:metrics.longTasks,layoutShifts:metrics.shifts,
      calls:f.calls,fixtureOnly:true};
  }finally{await context.close()}
}
(async()=>{
  await fs.mkdir(output,{recursive:true});const browserChannel=process.env.CRYPTA_TEST_BROWSER||'msedge';const browser=await chromium.launch({headless:true,channel:browserChannel});const results=[];
  try{for(let round=0;round<repeats;round++)for(const width of [1440,390])for(const mode of round%2?['on','off']:['off','on']){const result=await measure(browser,mode,width,round);results.push(result);console.log(`${result.sample}: commit median ${result.medianCommitMs.toFixed(1)}ms; ${result.longTaskCount} long tasks; max animation setup ${result.maxMainAnimationSetupMs.toFixed(2)}ms; shifts without recent input ${result.shiftWithoutRecentInputSum.toFixed(4)}; shifts ${result.layoutShiftSum.toFixed(4)}`)}}
  finally{const browserVersion=browser.version();await browser.close();await fs.writeFile(path.join(output,'comparison.json'),JSON.stringify({browserChannel,browserVersion,origins,repeats,playwrightSnapshotTracing:false,chromeTimelineTracing:true,filmstrip,interactionDriver:'One in-page scenario clicks real DOM navigation links; no external locator polling during the measured route sequence. Pointer/keyboard/hit testing remain covered by the separate browser regression suite.',order:'Round 1 off/on, round 2 on/off; alternate thereafter. Runs are serialized.',results,scope:'Same current source and fixtures, motion on/off. CPU/network emulation; UI only. Playwright snapshot tracing is disabled during performance measurement; Chrome timeline trace remains enabled. Filmstrip is opt-in and must match for before/after comparisons. Animation setup marks measure only synchronous Element.animate, not rendering/compositor work. Compare raw traces before attributing long tasks to motion. Layout shift values are sums for the measured navigation sequence, not the Core Web Vitals CLS session-window metric.'},null,2))}
})().catch(error=>{console.error(error);process.exitCode=1});
