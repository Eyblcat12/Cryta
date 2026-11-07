// Attribute measured animation setup marks to the renderer's actual root tasks.
// Overlap with an animation lifetime is evidence to inspect, not proof of causality.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const RENDER_CATEGORIES=['UpdateLayoutTree','Layout','PrePaint','Paint','Layerize'];
const ROUTE_WINDOW_US=650000;
// Complete events may be nested or duplicated. Clip first, then merge intervals:
// summing durations would count the same time more than once (notably Paint).
function intervalUnionMs(events,startUs,endUs){
  const intervals=[];
  for(const event of events){
    if(event.ph!=='X'||!Number.isFinite(event.ts)||!Number.isFinite(event.dur)||event.dur<=0)continue;
    const start=Math.max(startUs,event.ts),end=Math.min(endUs,event.ts+event.dur);
    if(end>start)intervals.push([start,end]);
  }
  intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let total=0,start=0,end=0;
  for(let index=0;index<intervals.length;index++){
    const interval=intervals[index];
    if(index===0){[start,end]=interval;continue;}
    if(interval[0]<=end)end=Math.max(end,interval[1]);
    else{total+=end-start;[start,end]=interval;}
  }
  if(intervals.length)total+=end-start;
  return total/1000;
}
function summarizeRouteWork(reports){
  const groups=new Map();
  for(const report of reports){
    for(const window of report.routeWindows??[]){
      const key=JSON.stringify([report.mode,report.width,window.path]);
      if(!groups.has(key))groups.set(key,{mode:report.mode,width:report.width,path:window.path,windows:[],samples:new Set(),rounds:new Set()});
      const group=groups.get(key);group.windows.push(window);group.samples.add(report.sample);group.rounds.add(report.round);
    }
  }
  return [...groups.values()].map(group=>{
    const mean=read=>group.windows.reduce((total,window)=>total+read(window),0)/group.windows.length;
    return {mode:group.mode,width:group.width,path:group.path,windowCount:group.windows.length,sampleCount:group.samples.size,rounds:[...group.rounds].sort((a,b)=>a-b),meanRenderWorkByCategoryMs:Object.fromEntries(RENDER_CATEGORIES.map(name=>[name,mean(window=>window.renderWorkByCategoryMs[name])])),meanRenderWorkUnionMs:mean(window=>window.renderWorkUnionMs),meanFrameCallbackMs:mean(window=>window.frameCallbackMs)};
  }).sort((a,b)=>b.width-a.width||a.path.localeCompare(b.path)||a.mode.localeCompare(b.mode));
}
function children(events,root){
  return events.filter(event=>event.ph==='X'&&event.name!=='RunTask'&&event.ts>=root.ts&&event.ts+event.dur<=root.ts+root.dur)
    .sort((a,b)=>b.dur-a.dur).slice(0,8).map(event=>({name:event.name,durationMs:event.dur/1000,offsetMs:(event.ts-root.ts)/1000,...(event.args?.data?.functionName?{functionName:event.args.data.functionName}:{}),...(event.args?.data?.url?{url:event.args.data.url,line:event.args.data.lineNumber,column:event.args.data.columnNumber}:{})}));
}
function summarize(sample,comparison,directory){
  const tracePath=path.join(directory,`${sample.sample}-trace.json`);
  const trace=JSON.parse(fs.readFileSync(tracePath,'utf8')).traceEvents;
  const mains=trace.filter(event=>event.ph==='M'&&event.name==='thread_name'&&event.args?.name==='CrRendererMain');assert.equal(mains.length,1,'Expected one measured renderer main thread.');
  const main=mains[0],events=trace.filter(event=>event.pid===main.pid&&event.tid===main.tid);
  const roots=events.filter(event=>event.ph==='X'&&event.name==='RunTask').sort((a,b)=>a.ts-b.ts);
  const starts=events.filter(event=>/^crypta-motion-setup-\d+-start$/.test(event.name)&&event.ph==='I');
  assert.equal(starts.length,sample.mainAnimations.length);
  const animations=starts.map(start=>{
    const end=events.find(event=>event.name===start.name.replace(/-start$/,'-end')&&event.ph==='I');assert(end);
    const root=roots.find(event=>event.ts<=start.ts&&event.ts+event.dur>=end.ts);assert(root,'Setup marks must have a containing renderer root task.');
    const index=Number(start.name.match(/setup-(\d+)/)[1]),duration=sample.mainAnimations[index].duration;
    const overlap=roots.filter(event=>event.dur>50000&&event.ts<start.ts+duration*1000&&event.ts+event.dur>start.ts);
    return {index,setupMs:(end.ts-start.ts)/1000,rootMs:root.dur/1000,beforeSetupMs:(start.ts-root.ts)/1000,afterSetupMs:(root.ts+root.dur-end.ts)/1000,rootChildren:children(events,root),longTasksOverlappingAnimation:overlap.map(event=>({durationMs:event.dur/1000,offsetFromSetupMs:(event.ts-start.ts)/1000,containsSetup:event===root,children:children(events,event)}))};
  });
  const long=roots.filter(event=>event.dur>50000);
  let routeWindows;
  if(comparison.interactionDriver){
    const clicks=events.filter(event=>event.ph==='X'&&event.name==='EventDispatch'&&event.args?.data?.type==='click').sort((a,b)=>a.ts-b.ts);
    const mobile=sample.width<=820;assert.equal(clicks.length,sample.steps.length*(mobile?2:1));
    const navigationClicks=mobile?clicks.filter((_,index)=>index%2===1):clicks;
    const renderEvents=events.filter(event=>event.ph==='X'&&RENDER_CATEGORIES.includes(event.name));
    const renderByCategory=Object.fromEntries(RENDER_CATEGORIES.map(name=>[name,renderEvents.filter(event=>event.name===name)]));
    const frameEvents=events.filter(event=>event.ph==='X'&&event.name==='FireAnimationFrame');
    routeWindows=navigationClicks.map((click,index)=>{
      const end=click.ts+ROUTE_WINDOW_US;
      const renderWorkByCategoryMs=Object.fromEntries(RENDER_CATEGORIES.map(name=>[name,intervalUnionMs(renderByCategory[name],click.ts,end)]));
      const renderWorkUnionMs=intervalUnionMs(renderEvents,click.ts,end),frameCallbackMs=intervalUnionMs(frameEvents,click.ts,end);
      assert(renderWorkUnionMs<=ROUTE_WINDOW_US/1000&&frameCallbackMs<=ROUTE_WINDOW_US/1000);
      for(const value of Object.values(renderWorkByCategoryMs))assert(value<=renderWorkUnionMs+1e-9);
      assert(renderWorkUnionMs<=Object.values(renderWorkByCategoryMs).reduce((total,value)=>total+value,0)+1e-9);
      return {index,path:sample.steps[index].path,windowDurationMs:ROUTE_WINDOW_US/1000,renderWorkByCategoryMs,renderWorkUnionMs,frameCallbackMs,longTasks:long.filter(event=>event.ts<end&&event.ts+event.dur>click.ts).map(event=>({durationMs:event.dur/1000,offsetFromClickMs:(event.ts-click.ts)/1000,children:children(events,event)}))};
    });
  }
  return {sample:sample.sample,mode:sample.mode,width:sample.width,height:sample.height,round:sample.round,assets:sample.assets,cpuSlowdown:sample.cpuSlowdown,network:sample.network,fixtureOnly:sample.fixtureOnly,traceFile:path.basename(tracePath),medianCommitMs:sample.medianCommitMs,observerLongTaskCount:sample.longTaskCount,rendererLongTaskCount:long.length,maxRendererTaskMs:Math.max(0,...long.map(event=>event.dur/1000)),layoutShiftSum:sample.layoutShiftSum,shiftWithoutRecentInputSum:sample.shiftWithoutRecentInputSum,
    animationCount:animations.length,maxSetupRootMs:Math.max(0,...animations.map(item=>item.rootMs)),setupRootsOver50ms:animations.filter(item=>item.rootMs>50).length,animations,
    ...(routeWindows?{routeWindows}:{}),largestRendererTasks:long.sort((a,b)=>b.dur-a.dur).slice(0,8).map(event=>({durationMs:event.dur/1000,children:children(events,event)}))};
}
function analyzeComparison(inputPath){
  const comparisonPath=path.resolve(inputPath),directory=path.dirname(comparisonPath);
  const source=fs.readFileSync(comparisonPath,'utf8'),comparison=JSON.parse(source),reports=[];
  for(const sample of comparison.results){reports.push(summarize(sample,comparison,directory));if(global.gc)global.gc();}
  const output=path.join(directory,'root-task-analysis.json');
  const analysis={schemaVersion:2,sourceComparison:{file:comparisonPath,sha256:crypto.createHash('sha256').update(source).digest('hex')},analyzer:{file:path.resolve(__filename),sha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')},browserChannel:comparison.browserChannel,browserVersion:comparison.browserVersion,repeats:comparison.repeats,origins:comparison.origins,order:comparison.order,interactionDriver:comparison.interactionDriver,measurementScope:comparison.scope,playwrightSnapshotTracing:comparison.playwrightSnapshotTracing??null,chromeTimelineTracing:comparison.chromeTimelineTracing??null,filmstrip:comparison.filmstrip??null,routeWindow650ms:{start:'Navigation click EventDispatch start on CrRendererMain; mobile uses the second click of each drawer/menu pair.',durationMs:ROUTE_WINDOW_US/1000,renderCategories:RENDER_CATEGORIES,renderWorkByCategoryMs:'Union of complete-event intervals per category, clipped to the route window.',renderWorkUnionMs:'Union across all five categories, not the sum of category unions.',frameCallbackMs:'Union of FireAnimationFrame complete-event intervals, clipped to the same window. May overlap render work; do not add these metrics.',scope:'Renderer main thread only; excludes compositor/GPU work and intervals outside the window.'},scope:'Main renderer RunTask and synchronous animation setup marks. All tasks >50ms overlapping the 160ms animation are retained, including layout/paint work. Trace root counts also include automation/DevTools work and differ from the web PerformanceObserver long-task entries. Route-window unions describe occupied intervals, not elapsed navigation latency or causal attribution. Overlap and on/off count differences do not prove motion caused a task; setup below 50ms alone is not acceptance.',routeWorkMeans:summarizeRouteWork(reports),results:reports};
  fs.writeFileSync(output,JSON.stringify(analysis,null,2));
  console.log(JSON.stringify(reports.map(item=>({sample:item.sample,rootLongTasks:item.rendererLongTaskCount,animations:item.animationCount,maxSetupRootMs:item.maxSetupRootMs,setupRootsOver50ms:item.setupRootsOver50ms,overlappingLongTasks:item.animations.flatMap(item=>item.longTasksOverlappingAnimation).length})),null,2));
  return analysis;
}
module.exports={intervalUnionMs,summarizeRouteWork,analyzeComparison};
if(require.main===module){
  assert(process.argv[2],'Usage: node --expose-gc tools/analyze-spa-motion.cjs <comparison.json>');
  analyzeComparison(process.argv[2]);
}
