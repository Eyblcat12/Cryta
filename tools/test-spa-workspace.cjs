// Production-build browser regression using isolated API fixtures. No real API writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const playwrightDir = process.argv[2];
const playwright = playwrightDir ? require(path.join(playwrightDir,'playwright')) : require('playwright');
const origin = process.env.CRYPTA_UI_TEST_URL || 'http://127.0.0.1:4173';
const output = path.resolve(process.env.CRYPTA_UI_TEST_OUTPUT||path.join(__dirname,'test-artifacts','spa',process.env.CRYPTA_TEST_BROWSER==='chrome'?'chrome':''));
const results=[];
const testFilter=process.env.CRYPTA_UI_TEST_FILTER??'';
const motionMode=process.env.CRYPTA_UI_TEST_MOTION??'on';
assert.ok(['on','off'].includes(motionMode),'Use CRYPTA_UI_TEST_MOTION=on or off for the matching frontend build.');
const motionEnabled=motionMode==='on';
const routeAnimationCount=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>
  requestAnimationFrame(()=>resolve(window.__routeAnimations)))));
const assets=Array.from({length:320},(_,i)=>({id:`asset-${i+1}`,code:`ASSET-${String(i+1).padStart(4,'0')}`,purpose:`Tài sản ${i+1}`,type:'KEY',status:i%7===0?'EXPIRED':'ACTIVE',algorithm:'RSA',keySize:2048,expiresAt:'2027-09-30T00:00:00Z',providerReference:`mock/${i+1}`,publicKeyFingerprint:'public-fingerprint',policyVersionId:'version-1',policyCode:'RSA',version:3,ownerId:'session-USER',departmentId:'department-1',ownerName:'Người dùng mẫu',departmentName:'Đơn vị mẫu'}));
const requests=Array.from({length:75},(_,i)=>({id:`request-${i+1}`,reason:`Yêu cầu kiểm thử ${i+1}`,type:'CREATE',status:i%3===0?'PENDING':'COMPLETED',submittedAt:'2026-09-30T01:00:00Z',creatorId:'session-USER',departmentId:'department-1',creatorName:'Người gửi mẫu',departmentName:'Đơn vị mẫu',version:7,emergency:i%6===0}));
const policy={id:'version-1',policyId:'policy-1',name:'Chính sách RSA',code:'RSA',version:1,configuration:{algorithm:'RSA',minimum_key_size:2048,maximum_validity_days:365,warning_days:[30,7,1]}};
const users=Array.from({length:35},(_,i)=>({id:`person-${i+1}`,displayName:`Nhân viên ${i+1}`,email:`person${i+1}@example.test`,departmentName:'Đơn vị mẫu',roles:['USER'],status:'ACTIVE',approverDepartmentIds:[]}));
const auditItems=Array.from({length:35},(_,i)=>({id:`audit-${i+1}`,action:'AUTH_LOGIN',entityId:`entity-${i+1}`,occurredAt:'2026-09-30T01:00:00Z',actorName:`Người dùng ${i+1}`,outcome:'SUCCESS'}));
const emailItems=Array.from({length:35},(_,i)=>({id:`email-${i+1}`,type:'REQUEST_APPROVED',status:'FAILED',attemptCount:1,createdAt:'2026-09-30T01:00:00Z',claimedAt:null,failedAt:'2026-09-30T01:01:00Z',recipientEmail:`recipient${i+1}@example.test`,recipientName:`Người nhận ${i+1}`}));
function dashboardFixture(role,state){
  const metrics={total:state.ownerTotal??320,total_assets:state.adminTotal??320,active:state.priorityAsset?273:274,expiring:state.priorityAsset?1:0,pending:25,emergency:13,approved:4,rejected:1,avg_wait_hours:'2.5',active_users:35,admin_users:1,approver_users:1,sod_conflicts:0,failed_jobs:0,email_reconciliation:0,departments:1};
  const priority=state.priorityAsset?{...assets[299],status:'EXPIRING_SOON',expiresAt:'2026-10-05T00:00:00Z'}:null;
  const trend=role==='APPROVER'?[{period:'2026-09-29',value:4},{period:'2026-09-30',value:6}]:[{period:'2026-08',value:4},{period:'2026-09',value:6}];
  const composition=role==='ADMIN'?[{label:'ACTIVE',value:274},{label:'EXPIRED',value:46}]:role==='APPROVER'?[{label:'APPROVED',value:4},{label:'REJECTED',value:1},{label:'PENDING',value:25}]:[{label:'KEY',value:metrics.total}];
  return {role,metrics,trend,composition,services:{email:state.emailEnabled?'ENABLED':'DISABLED',cryptoProvider:'MOCK',expiryScan:'ACTIVE'},...(role==='USER'?{lifecycle:{live:274,within30:priority?1:0,within180:0,after180:priority?273:274,priority}}:{})};
}
function paged(items,params){const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||25);return {items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize}}
function matches(item,q){return JSON.stringify(item).toLocaleLowerCase('vi').includes(q.toLocaleLowerCase('vi'))}

async function fixture(browser,role='USER',options={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:options.reduced?'reduce':'no-preference'});
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  if(options.trace!==false)await context.tracing.start({screenshots:true,snapshots:true});
  const errors=[],calls=[],mutations=[];
  const state={notificationFail:false,assetDelay:0,decisionConflict:false,...options};
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__routeAnimations=0;
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(...args){if(this.id==='main-content')window.__routeAnimations++;return animate.apply(this,args)};
  });
  if(options.noAnimation)await page.addInitScript(()=>{Element.prototype.animate=undefined;document.startViewTransition=undefined});
  if(options.brokenAnimation)await page.addInitScript(()=>{Element.prototype.animate=function(){throw new Error('Fixture animation unavailable')}});
  const user={id:`session-${role}`,email:`${role.toLowerCase()}@example.test`,displayName:`Tài khoản ${role}`,departmentId:'department-1',departmentName:'Đơn vị mẫu',roles:options.roles??[role],approverDepartmentIds:(options.roles??[role]).includes('APPROVER')?['department-1']:[],mustChangePassword:options.mustChangePassword??false};
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.slice('/api/v1'.length),params=url.searchParams;
    calls.push(`${request.method()} ${endpoint}${url.search}`);
    if(request.method()==='GET'&&state.tableReadEndpoint===endpoint&&state.tableReadGate)await state.tableReadGate;
    let data,status=200;
    if(endpoint==='/auth/login'){
      if(state.loginUser)Object.assign(user,state.loginUser);
      state.guest=false;state.expire=false;state.refreshDenied=false;state.refreshOutage=false;
      data={accessToken:'isolated-login-token',user};
    }else if(endpoint==='/auth/refresh'){
      if(state.guest||state.refreshDenied){status=401;data={error:{code:'INVALID_SESSION',message:'Phiên kiểm thử hết hạn.'}}}
      else if(state.refreshOutage){status=503;data={error:{code:'UNAVAILABLE',message:'Dịch vụ phiên tạm thời không khả dụng.'}}}
      else {if(state.refreshUser)Object.assign(user,state.refreshUser);state.expire=false;data={accessToken:'isolated-fixture-token',user}}
    }else if(endpoint==='/auth/oidc/status'){data={enabled:false}}
    else if(state.expire){status=401;data={error:{code:'INVALID_SESSION',message:'Phiên kiểm thử hết hạn.'}}}
    else if(request.method()!=='GET'){
      mutations.push({endpoint,body:request.postDataJSON()});
      if(endpoint==='/auth/logout')state.guest=true;
      if(endpoint==='/requests')state.createdRequests=[...(state.createdRequests??[]),{...requests[0],id:'fixture-created',reason:request.postDataJSON().reason,type:request.postDataJSON().type,creatorId:user.id}];
      if(endpoint==='/users')state.createdUser={id:'fixture-created',email:request.postDataJSON().email,displayName:request.postDataJSON().displayName,roles:request.postDataJSON().roles,status:'ACTIVE',approverDepartmentIds:[]};
      if(endpoint==='/policies/policy-1/versions')state.policyVersion=(state.policyVersion??1)+1;
      if(endpoint==='/auth/change-password'){user.mustChangePassword=false;state.guest=true}
      if(endpoint==='/notifications/read-all')state.notificationReadAll=true;
      else if(endpoint.includes('/notifications/')&&endpoint.endsWith('/read'))state.readNotificationIds=[...new Set([...(state.readNotificationIds??[]),endpoint.split('/')[2]])];
      if(/^\/users\/[^/]+\/status$/.test(endpoint))state.userStatuses={...state.userStatuses,[endpoint.split('/')[2]]:request.postDataJSON().status};
      if(endpoint.endsWith('/decision')&&!state.decisionConflict)state.decisions={...state.decisions,[endpoint.split('/')[2]]:request.postDataJSON().decision};
      if(endpoint.endsWith('/decision')&&state.decisionConflict){status=409;data={error:{code:'STALE_VERSION',message:'Phiên bản đã thay đổi. Hãy tải lại.'}}}
      else if(endpoint==='/users')data={id:'fixture-created',email:request.postDataJSON().email.toLowerCase()};
      else if(/^\/users\/[^/]+\/status$/.test(endpoint))data={id:endpoint.split('/')[2],status:request.postDataJSON().status};
      else if(endpoint.endsWith('/access'))data={updated:true};
      else if(endpoint.endsWith('/versions'))data={id:'fixture-version',version:state.policyVersion,policyId:endpoint.split('/')[2]};
      else if(endpoint.endsWith('/decision'))data={id:endpoint.split('/')[2],status:request.postDataJSON().decision};
      else if(endpoint.endsWith('/cancel'))data={id:endpoint.split('/')[2],status:'CANCELLED'};
      else if(endpoint.startsWith('/notifications/')&&endpoint.includes('read'))data={updated:1};
      else if(endpoint==='/notifications/test-email')data={sent:true,to:request.postDataJSON().email};
      else if(state.emailRecovery&&endpoint==='/notifications/delivery-issues/email-1/reconcile'){
        state.emailReconciled=true;
        status=503;
        data={error:{code:'UNAVAILABLE',message:'Phản hồi sau thao tác không khả dụng.'}};
      }
      else data={id:'fixture-created',status:'PENDING'};
      if(state.mutationStarted)state.mutationStarted(endpoint);
      if(state.mutationGate&&!endpoint.startsWith('/auth/'))await state.mutationGate;
      if(state.mutationDelay)await new Promise(resolve=>setTimeout(resolve,state.mutationDelay));
      if(endpoint===state.lostResponse){await route.abort('failed');return}
      if(endpoint===state.invalidAcknowledgment)data={};
      if(endpoint===state.mutationOutage){status=503;data={error:{code:'UNAVAILABLE',message:'Phản hồi thao tác chưa rõ.'},requestId:'fixture-correlation'}};
    }else if(endpoint==='/dashboard/summary'){
      const result=dashboardFixture(params.get('role')??role,state);data={role:result.role,metrics:result.metrics,services:result.services};
      if(state.summaryDelay)await new Promise(resolve=>setTimeout(resolve,state.summaryDelay));
      if(state.summaryFail){status=503;data={error:{code:'UNAVAILABLE',message:'Chỉ số tạm thời không khả dụng.'}}}
    }else if(endpoint==='/dashboard'){
      data=dashboardFixture(params.get('role')??role,state);
      if(state.dashboardDelay)await new Promise(resolve=>setTimeout(resolve,state.dashboardDelay));
      if(state.dashboardFail){status=503;data={error:{code:'UNAVAILABLE',message:'Tổng quan tạm thời không khả dụng.'}}}
    }else if(endpoint==='/policies'||endpoint==='/policies/admin'){
      data=state.emptyPolicies?[]:[...(state.certificateFirst?[{...policy,id:'cert-version',policyId:'cert-policy',code:'CERT',name:'Chính sách chứng thư',configuration:{maximum_validity_days:365,certificate_profile:'TLS',warning_days:[30,7,1]}}]:[]),{...policy,version:state.policyVersion??1},...(state.secondPolicy?[{...policy,id:'version-2',policyId:'policy-2',code:'SECOND',name:'Chính sách thứ hai',configuration:{...policy.configuration,maximum_validity_days:180}}]:[])];
      if(endpoint==='/policies/admin')data=data.map(row=>({id:row.policyId,code:row.code,name:row.name,active:true,latest:row,effectiveVersion:row.version,effectiveFrom:null}));
      if(state.policyDelay)await new Promise(resolve=>setTimeout(resolve,state.policyDelay));
      if(state.policyFail){status=503;data={error:{code:'UNAVAILABLE',message:'Chính sách tạm thời không khả dụng.'}}}
      if(state.policyDenied){status=403;data={error:{code:'FORBIDDEN',message:'Quyền xem chính sách đã thay đổi.'}}}
    }
    else if(endpoint==='/notifications'){
      if(!params.has('read')&&state.notificationListDelay)await new Promise(resolve=>setTimeout(resolve,state.notificationListDelay));
      if(state.notificationDelay&&params.get('read')==='false')await new Promise(resolve=>setTimeout(resolve,state.notificationDelay));
      if(state.notificationFail&&params.get('read')==='false'){status=503;data={error:{code:'UNAVAILABLE',message:'Thông báo tạm thời không khả dụng.'}}}
      else if(state.notificationItems){const items=Array.from({length:15},(_,i)=>({id:`notification-${i+1}`,type:'REQUEST_APPROVED',createdAt:'2026-09-30T01:00:00Z',readAt:state.notificationReadAll||state.readNotificationIds?.includes(`notification-${i+1}`)?'2026-09-30T02:00:00Z':null,...(state.notificationNoTarget?{}:role==='APPROVER'?{requestId:state.notificationMissing?'missing':'request-1'}:{assetId:state.notificationMissing?'missing':'asset-300',assetCode:'ASSET-0300'})}));data=paged(params.get('read')==='false'?items.filter(item=>!item.readAt):items,params)}
      else data={items:[],total:0,page:Number(params.get('page')||1),pageSize:Number(params.get('pageSize')||10)};
      if(!params.has('read')&&state.notificationListFail){status=503;data={error:{code:'UNAVAILABLE',message:'Danh sách thông báo tạm thời không khả dụng.'}}}
      if(!params.has('read')&&state.notificationListDenied){status=403;data={error:{code:'FORBIDDEN',message:'Quyền xem thông báo đã thay đổi.'}}}
    }else if(endpoint==='/assets'){
      state.onAssetRequest?.(params.get('page'));
      if(state.assetDelay)await new Promise(resolve=>setTimeout(resolve,state.assetDelay));
      let items=assets.map((a,i)=>({...a,...(state.priorityAsset&&i===299?{status:'EXPIRING_SOON',expiresAt:'2026-10-05T00:00:00Z'}:{}),ownerId:state.assetOwnerId??(state.mixedOwners&&i>=20?'another-owner':user.id)})).filter(a=>(!params.has('ownedOnly')||a.ownerId===user.id)&&(!params.has('status')||a.status===params.get('status'))&&(!params.has('search')||matches(a,params.get('search')))&&(!params.has('eligible')||['ACTIVE','EXPIRING_SOON'].includes(a.status)));
      data=params.size?paged(items,params):items.slice(0,250);
      if(state.assetFail){status=503;data={error:{code:'UNAVAILABLE',message:'Tài sản tạm thời không khả dụng.'}}}
      if(state.assetDenied){status=403;data={error:{code:'FORBIDDEN',message:'Quyền xem tài sản đã thay đổi.'}}}
    }else if(/^\/assets\/[^/]+\/history$/.test(endpoint)){
      if(state.historyDelay)await new Promise(resolve=>setTimeout(resolve,state.historyDelay));
      const items=state.historyItems?Array.from({length:15},(_,i)=>({id:`history-${i+1}`,action:'ASSET_CREATED',occurredAt:'2026-09-30T01:00:00Z',actorName:`Người thực hiện ${i+1}`,requestId:null})):[];
      data={...paged(items,params),lineage:{replaces:null,replacedBy:[],assets:state.lineage&&endpoint.includes('asset-300/')?[{id:'asset-299',code:'ASSET-0299',relation:'predecessor'}]:[]}};
      if(state.historyFail){status=503;data={error:{code:'UNAVAILABLE',message:'Lịch sử tạm thời không khả dụng.'}}}
      if(state.historyDenied){status=403;data={error:{code:'FORBIDDEN',message:'Quyền xem lịch sử đã thay đổi.'}}}
    }
    else if(/^\/assets\/[^/]+$/.test(endpoint)){
      const found=assets.find(a=>a.id===endpoint.split('/')[2]);data=found?{...found,ownerId:state.assetOwnerId??user.id}:undefined;
      if(state.detailDenied===endpoint.split('/')[2]){status=403;data={error:{code:'FORBIDDEN',message:'Quyền xem tài sản này đã thay đổi.'}}}
      if(!data){status=404;data={error:{code:'NOT_FOUND',message:'Không tìm thấy tài sản.'}}}
    }else if(endpoint==='/requests'){
      state.onRequest?.(params);
      if(state.requestDelay)await new Promise(resolve=>setTimeout(resolve,state.requestDelay));
      let items=[...(state.createdRequests??[]),...requests.map((r,i)=>({...r,creatorId:state.requestCreatorId??(state.mixedCreators&&i>=5?'another-owner':role==='APPROVER'?'request-owner':user.id),departmentId:state.requestDepartmentId??'department-1'}))].filter(r=>(!params.has('createdByMe')||r.creatorId===user.id)&&(!params.has('status')||r.status===params.get('status'))&&(!params.has('excludePending')||r.status!=='PENDING')&&(!params.has('search')||matches(r,params.get('search')))&&(!params.has('emergency')||r.emergency===true));
      data=params.size?paged(items,params):items;
      if(state.requestFail){status=503;data={error:{code:'UNAVAILABLE',message:'Hàng chờ tạm thời không khả dụng.'}}}
      if(state.requestDenied){status=403;data={error:{code:'FORBIDDEN',message:'Quyền xem hàng chờ đã thay đổi.'}}}
    }else if(/^\/requests\/[^/]+$/.test(endpoint)){
      const found=requests.find(r=>r.id===endpoint.split('/')[2]);data=found?{...found,status:state.decisions?.[found.id]??found.status,version:state.requestVersion===undefined?found.version:state.requestVersion,creatorId:state.requestCreatorId??(role==='APPROVER'?'request-owner':user.id),departmentId:state.requestDepartmentId??'department-1'}:undefined;
      if(state.requestDetailFail){status=503;data={error:{code:'UNAVAILABLE',message:'Chi tiết tạm thời không khả dụng.'}}}
      if(!data){status=404;data={error:{code:'NOT_FOUND',message:'Không tìm thấy yêu cầu.'}}}
    }else if(endpoint==='/users/reference-data'){
      data={departments:[{id:'department-1',code:'IT',name:'Đơn vị mẫu'}],roles:[]};
      if(state.referenceFail){status=503;data={error:{code:'UNAVAILABLE',message:'Danh mục phòng ban tạm thời không khả dụng.'}}}
    }
    else if(endpoint==='/users'){data=paged([...(state.createdUser?[state.createdUser]:[]),...users.slice(0,state.userCount??users.length).map(u=>({...u,...(state.userOverrides?.[u.id]??{}),status:state.userStatuses?.[u.id]??u.status}))].filter(u=>(!params.has('status')||u.status===params.get('status'))&&(!params.has('search')||matches(u,params.get('search')))&&(!params.has('userId')||u.id===params.get('userId'))&&(!params.has('email')||u.email.toLowerCase()===params.get('email').toLowerCase())),params);
      if(state.userReadGate)await state.userReadGate;
      if(state.userDelay)await new Promise(resolve=>setTimeout(resolve,state.userDelay));
      if(state.userFail){status=503;data={error:{code:'UNAVAILABLE',message:'Tài khoản tạm thời không khả dụng.'}}}
      if(state.userDenied){status=403;data={error:{code:'FORBIDDEN',message:'Quyền xem tài khoản đã thay đổi.'}}}
    }
    else if(endpoint==='/users/summary')data={total:35,active:35,roles:{USER:35,APPROVER:1,ADMIN:1}};
    else if(endpoint==='/operations/provider-issues')data={items:[],total:0,page:Number(params.get('page')??1),pageSize:Number(params.get('pageSize')??25)};
    else if(endpoint==='/notifications/status'){
      if(state.emailStatusGate)await state.emailStatusGate;
      data={queue:{PENDING:3,SENT:12},collectedAt:'2026-11-08T02:48:00Z',oldestDueSeconds:null,lastFailedAt:null,
        smtpEnabled:false,queueDelayed:false,worker:{state:'DISABLED',lastPollAt:null,lastPollSucceeded:null},...state.emailStatus};
      if(state.emailStatusFail){status=503;data={error:{code:'EMAIL_STATUS_UNAVAILABLE',message:'Không thể đọc tình trạng hàng đợi email.'}}}
    }
    else if(endpoint==='/reports')data=[];
    else if(state.emailRecovery&&endpoint==='/notifications/delivery-issues/email-1'){
      if(state.emailDetailGate)await state.emailDetailGate;
      data={...emailItems[0],status:state.emailReconciled?'FAILED':'RECONCILIATION_REQUIRED',attemptCount:2,
        failure:state.emailReconciled?'VERIFIED_UNSENT':'OUTCOME_UNKNOWN',smtpStatus:null,sentAt:null,messageIdPrefix:'notification-email-1'};
    }
    else if(endpoint==='/audit-logs'||endpoint==='/notifications/delivery-issues'){
      const isAudit=endpoint==='/audit-logs';
      const delay=isAudit?state.auditDelay:state.emailDelay;
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      const emailRows=state.emailRecovery?emailItems.map((item,index)=>index===0&&!state.emailReconciled
        ?{...item,status:'RECONCILIATION_REQUIRED',attemptCount:2}:item):emailItems;
      data=paged(isAudit?(state.auditItems?auditItems:[]):(state.emailItems?emailRows:[]),params);
      if(endpoint==='/audit-logs'&&state.auditFail){status=503;data={error:{code:'UNAVAILABLE',message:'Audit Log tạm thời không khả dụng.'}}}
      if(!isAudit&&state.emailFail){status=503;data={error:{code:'UNAVAILABLE',message:'Email tạm thời không khả dụng.'}}}
      if(isAudit?state.auditDenied:state.emailDenied){status=403;data={error:{code:'FORBIDDEN',message:'Quyền xem danh sách đã thay đổi.'}}}
    }
    else {status=404;data={error:{code:'UNMOCKED_ENDPOINT',message:`Fixture missing ${endpoint}`}};errors.push(`Unmocked ${endpoint}`)}
    state.onFixtureResponse?.({endpoint,method:request.method(),status,data});
    try{await route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{data}:data)})}catch(error){if(!/closed|disposed|Invalid InterceptionId/.test(error.message))throw error}
  });
  return {page,context,state,calls,mutations,errors,user};
}
async function visible(page,text){await page.locator('#page-title').filter({hasText:text}).waitFor()}
async function login(page){await page.locator('.login-card input[type=email]').fill('isolated@example.test');await page.locator('.login-card input[type=password]').fill('FixturePassword!123');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click()}
async function test(browser,name,body){
  if(testFilter&&!name.includes(testFilter))return;
  const item={name,status:'passed'};
  try{await body()}catch(error){item.status='failed';item.error=error.stack;process.exitCode=1}
  results.push(item);console.log(`${item.status==='passed'?'PASS':'FAIL'} ${name}${item.error?'\n'+item.error:''}`);
}
async function withFixture(browser,role,body,options){const f=await fixture(browser,role,options);try{await body(f);assert.deepEqual(f.errors,[]);await f.context.tracing.stop()}catch(error){await f.page.screenshot({path:path.join(output,`failure-${results.length+1}.png`),fullPage:true}).catch(()=>{});await f.context.tracing.stop({path:path.join(output,`failure-${results.length+1}.zip`)});throw error}finally{await f.context.close()}}

module.exports={fixture,visible,login};
if(require.main===module)(async()=>{
  await fs.mkdir(output,{recursive:true});
  const requestedBrowser=process.env.CRYPTA_TEST_BROWSER||'msedge';
  const browserEngine=requestedBrowser==='firefox'?'firefox':'chromium';
  const browser=await playwright[browserEngine].launch({headless:true,...(browserEngine==='chromium'?{channel:requestedBrowser}:{})});
  try{

    const listCases=[
      {role:'USER',route:'/requests',section:'#requests',rows:'button.request-item',endpoint:'/requests',refresh:'Làm mới lịch sử yêu cầu',prefix:'request',label:'yêu cầu'},
      {role:'APPROVER',route:'/approvals/history',section:'#requests',rows:'button.request-item',endpoint:'/requests',refresh:'Làm mới lịch sử yêu cầu',prefix:'request',label:'yêu cầu'},
      ...['USER','APPROVER','ADMIN'].map(role=>({role,route:'/notifications',section:'#notifications',rows:'.activity-list article:not([aria-hidden])',endpoint:'/notifications',refresh:'Làm mới thông báo',prefix:'notificationList',label:'thông báo',options:{notificationItems:true}})),
      {role:'USER',route:'/assets/asset-300',section:'.mini-timeline:has-text("Lịch sử hoạt động")',rows:'ol li:not([aria-hidden])',endpoint:'/assets/asset-300/history',refresh:'Làm mới lịch sử tài sản',prefix:'history',label:'lịch sử',options:{historyItems:true}},
    ];
    for(const item of listCases)for(const width of [1440,390])await test(browser,`N4-list loading ${item.role} ${item.route} ${width}px reserves rows without exposing provisional actions`,()=>withFixture(browser,item.role,async({page,state})=>{
      let release;state.tableReadEndpoint=item.endpoint;state.tableReadGate=new Promise(resolve=>{release=resolve});
      try{
        await page.setViewportSize({width,height:1000});await page.goto(origin+item.route);
        const section=page.locator(item.section);await section.waitFor();assert.equal(await section.locator('.admin-asset-pagination').count(),1,'Loading must reserve the pagination controls.');
        const footer=()=>section.locator('.admin-asset-pagination').evaluate(element=>element.getBoundingClientRect().top+scrollY);
        const before=await footer();assert.equal(await section.locator(item.rows).count(),0);
        assert.equal(await section.locator('.loading-outline button:not([disabled]),.loading-outline a').count(),0);
        if(item.prefix!=='history'){
          const status=section.getByRole('status').filter({hasText:`Đang tải ${item.label}…`});
          await status.waitFor();
          assert.equal(await status.evaluate(element=>!!element.closest('[aria-busy="true"]')),false);
          await status.evaluate(element=>element.dataset.testListStatus='persistent');
        }
        state.tableReadGate=null;release();await section.locator(item.rows).first().waitFor();
        assert.equal(await section.locator(item.rows).count(),10);
        if(item.prefix!=='history'){
          const status=section.getByRole('status').filter({hasText:new RegExp(`^Có \\d+ ${item.label}\\.$`)});
          await status.waitFor();
          assert.equal(await status.getAttribute('data-test-list-status'),'persistent');
          assert.match(await status.ariaSnapshot(),/status:/);
        }
        const after=await footer();assert(Math.abs(after-before)<=2,`pagination moved by ${(after-before).toFixed(1)}px`);
        if(item.prefix==='notificationList')assert.equal(await section.getByRole('button',{name:item.refresh,exact:true}).evaluate(element=>element.getBoundingClientRect().width>=36),true,'Refresh must keep its 36px target at narrow widths.');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
        await page.screenshot({path:path.join(output,`n4-list-${item.role}-${item.route.replaceAll('/','-')}-${width}.png`),fullPage:true});
      }finally{state.tableReadGate=null;release()}
    },item.options));
    for(const item of listCases)await test(browser,`N4-list refresh ${item.role} ${item.route} keeps only same-query snapshots and disables stale actions`,()=>withFixture(browser,item.role,async({page,state,mutations})=>{
      await page.goto(origin+item.route);const section=page.locator(item.section);const rows=section.locator(item.rows);await rows.first().waitFor();
      const snapshot=await rows.allTextContents();const count=await rows.count();const writes=mutations.length;
      let release;state.tableReadEndpoint=item.endpoint;state.tableReadGate=new Promise(resolve=>{release=resolve});
      try{
        const refresh=section.getByRole('button',{name:item.refresh,exact:true});assert.equal(await refresh.count(),1,'A GET-only refresh control is required.');await refresh.click();
        await section.getByRole('status').filter({hasText:'Đang cập nhật'}).waitFor();assert.deepEqual(await rows.allTextContents(),snapshot);
        const actions=section.locator('button.request-item:not([disabled]), .activity-list button:not([disabled]), a:not([aria-disabled=true])');assert.equal(await actions.count(),0);
        if(item.prefix==='notificationList')assert.equal(await section.getByRole('button',{name:'Đánh dấu đã đọc',exact:true}).first().isDisabled(),true);
        state[item.prefix+'Fail']=true;state.tableReadGate=null;release();await section.getByRole('alert').waitFor();assert.equal(await rows.count(),count);assert.deepEqual(await rows.allTextContents(),snapshot);assert.equal(await actions.count(),0);
        state[item.prefix+'Fail']=false;state[item.prefix+'Denied']=true;await section.getByRole('button',{name:'Thử lại',exact:true}).click();await section.getByRole('alert').filter({hasText:'Quyền'}).waitFor();assert.equal(await rows.count(),0);assert.equal(mutations.length,writes);
      }finally{state.tableReadGate=null;release()}
    },{...item.options,...(item.prefix==='history'?{lineage:true}:{})}));
    for(const item of listCases)await test(browser,`N4-list page change ${item.role} ${item.route} clears the previous query while pending`,()=>withFixture(browser,item.role,async({page,state,mutations})=>{
      await page.goto(origin+item.route);const section=page.locator(item.section);const rows=section.locator(item.rows);await rows.first().waitFor();
      const initial=await rows.allTextContents();let release;state.tableReadEndpoint=item.endpoint;state.tableReadGate=new Promise(resolve=>{release=resolve});
      try{
        await section.getByRole('button',{name:'Sau',exact:true}).click();await section.getByRole('status').filter({hasText:'Đang tải'}).waitFor();assert.equal(await rows.count(),0);
        assert.equal(await section.locator('.loading-outline button:not([disabled]),.loading-outline a').count(),0);
        state.tableReadGate=null;release();await rows.first().waitFor();assert.notDeepEqual(await rows.allTextContents(),initial);assert.equal(mutations.length,0);
        if(item.prefix!=='history')assert.equal(new URL(page.url()).searchParams.get('page'),'2');
      }finally{state.tableReadGate=null;release()}
    },item.options));

    const tableCases=[
      {role:'ADMIN',route:'/assets',section:'section[aria-labelledby="admin-assets-title"]',delay:'assetDelay',ready:'ASSET-0001'},
      {role:'USER',route:'/assets',section:'section[aria-labelledby="admin-assets-title"]',delay:'assetDelay',ready:'ASSET-0001'},
      {role:'APPROVER',route:'/approvals',section:'#approval-queue',delay:'requestDelay',ready:'request-1'},
      {role:'ADMIN',route:'/audit',section:'section[aria-labelledby="audit-title"]',delay:'auditDelay',ready:'AUTH_LOGIN',data:'auditItems'},
      {role:'ADMIN',route:'/operations/email',section:'#email-health',delay:'emailDelay',ready:'Người nhận 1',data:'emailItems'},
    ];
    for(const item of tableCases)for(const width of [1440,390])await test(browser,`N4-table ${item.role} ${item.route} ${width}px keeps loading rows and columns in place`,()=>withFixture(browser,item.role,async({page,state})=>{
      let release;state.tableReadEndpoint=item.route==='/approvals'?'/requests':item.route==='/audit'?'/audit-logs':item.route==='/operations/email'?'/notifications/delivery-issues':'/assets';state.tableReadGate=new Promise(resolve=>{release=resolve});
      try{
      await page.setViewportSize({width,height:1000});await page.goto(origin+item.route);
      const section=page.locator(item.section);await section.locator('.admin-asset-pagination').waitFor();
      if(item.route==='/operations/email')await page.getByRole('region',{name:'Tình trạng hàng đợi'}).getByText(/Lấy số liệu lúc/).waitFor();
      const geometry=()=>section.evaluate(element=>({footer:element.querySelector('.admin-asset-pagination').getBoundingClientRect().top+scrollY,columns:[...element.querySelectorAll('th')].map(cell=>cell.getBoundingClientRect().width)}));
      const before=await geometry();
      assert.equal(await section.locator('tbody tr:not([aria-hidden])').count(),0);state.tableReadGate=null;release();
      if(item.role==='USER'&&width===390)await section.locator('.asset-mobile-list button.asset-mobile-card').first().waitFor();
      else if(item.route==='/operations/email'&&width===390)await section.getByRole('list', { name: 'Danh sách email cần xử lý' }).getByText(/Người nhận 1 ·/).waitFor();
      else await section.getByText(item.ready,{exact:true}).first().waitFor();
      const after=await geometry();assert(Math.abs(after.footer-before.footer)<=2,`pagination moved by ${(after.footer-before.footer).toFixed(1)}px`);
      assert.equal(before.columns.length,after.columns.length);for(let i=0;i<before.columns.length;i++)assert(Math.abs(before.columns[i]-after.columns[i])<=2,`column ${i} changed width`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      await page.screenshot({path:path.join(output,`n4-table-${item.role}-${item.route.replaceAll('/','-')}-${width}.png`),fullPage:true});
      }finally{state.tableReadGate=null;release()}
    },{[item.delay]:1100,...(item.data?{[item.data]:true}:{})}));

    for (const [width, theme] of [[1440,'light'],[390,'dark']]) {
      await test(browser,`/operations/email reports worker status, stale samples and recovery at ${width}px`,()=>withFixture(browser,'ADMIN',async({page,state})=>{
        let finishRead;
        state.emailStatusGate=new Promise(resolve=>{finishRead=resolve});
        try {
          await page.setViewportSize({width,height:900});
          await page.addInitScript(value=>localStorage.setItem('crypta-theme',value),theme);
          await page.goto(origin+'/operations/email');
          const queue=page.getByRole('region',{name:'Tình trạng hàng đợi'});
          const refresh=queue.getByRole('button',{name:'Làm mới tình trạng'});
          await queue.getByText('Đang tải tình trạng hàng đợi…').waitFor();
          assert.equal(await queue.getByText('SMTP đã chấp nhận',{exact:true}).count(),0);
          state.emailStatusGate=null;finishRead();
          await queue.getByText('SMTP đang tắt',{exact:true}).waitFor();
          assert.equal(await queue.getByText('Không có thư đến hạn').count(),1);
          state.emailStatusFail=true;
          await refresh.focus();
          await page.keyboard.press('Enter');
          await queue.getByRole('alert').filter({hasText:'Đang hiển thị số liệu lần đọc trước.'}).waitFor();
          assert.equal(await queue.getByText('12',{exact:true}).count(),1);
          assert.equal(await refresh.evaluate(button=>document.activeElement===button),true);
          state.emailStatusFail=false;
          state.emailStatus={smtpEnabled:true,queueDelayed:true,oldestDueSeconds:480,
            worker:{state:'STALE',lastPollAt:'2026-11-08T02:40:00Z',lastPollSucceeded:true}};
          await refresh.click();
          await queue.getByText(/Chưa ghi nhận lượt quét worker/).waitFor();
          assert.equal(await queue.getByText('8 phút 0 giây').count(),1);
          assert.equal(await queue.getByRole('alert').count(),0);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
          await queue.screenshot({path:path.join(output,`t28-email-queue-${width}-${theme}.png`),animations:'disabled'});
          state.emailStatus={smtpEnabled:true,worker:{state:'FAILED',lastPollAt:'2026-11-08T02:47:00Z',lastPollSucceeded:false}};
          await refresh.click();
          await queue.getByText('Lượt quét gần nhất của worker gặp lỗi.').waitFor();
        } finally {state.emailStatusGate=null;finishRead()}
      }));
    }
    await test(browser,'/operations/email checks the saved state when reconciliation acknowledgment is lost',()=>withFixture(browser,'ADMIN',async({page,state,mutations})=>{
      let release;
      state.emailDetailGate=new Promise(resolve=>{release=resolve});
      try{
        await page.setViewportSize({width:390,height:900});
        await page.addInitScript(()=>localStorage.setItem('crypta-theme','dark'));
        await page.goto(origin+'/operations/email');
        await page.getByRole('button',{name:'Xem chi tiết Yêu cầu đã được duyệt · email-1',exact:true}).click();
        const dialog=page.getByRole('dialog',{name:'Chi tiết lần gửi'});
        await dialog.getByRole('status').filter({hasText:'Đang tải chi tiết lần gửi…'}).waitFor();
        assert.equal(await dialog.getByRole('button',{name:'Ghi kết quả'}).count(),0);
        state.emailDetailGate=null;release();
        await dialog.getByRole('combobox',{name:'Kết quả đã xác minh'}).selectOption('UNSENT');
        const evidence=dialog.getByRole('textbox',{name:/Mã phiếu đối soát/});
        await evidence.fill('a@b.test');
        const submit=dialog.getByRole('button',{name:'Ghi kết quả'});
        await submit.click();
        await dialog.getByText(/Nhập mã phiếu từ 4 đến 64 ký tự/).waitFor();
        assert.equal(mutations.length,0);
        await evidence.fill('SMTP-2041');
        assert.equal(await dialog.evaluate(element=>getComputedStyle(element.parentElement).position),'fixed');
        await page.screenshot({path:path.join(output,'t28-detail-mobile-dark.png'),animations:'disabled'});
        await submit.click();
        await dialog.getByText(/Chưa xác nhận kết quả: Ghi kết quả đối soát email/).waitFor();
        assert.equal(await evidence.inputValue(),'SMTP-2041');
        assert.equal(await submit.isDisabled(),true);
        assert.equal(mutations.length,1);
        assert.deepEqual(mutations[0].body,{attemptCount:2,evidenceReference:'SMTP-2041',outcome:'UNSENT'});
        await dialog.getByRole('button',{name:'Kiểm tra dữ liệu'}).click();
        await dialog.getByText(/Trạng thái hiện tại của email: Đã xác minh SMTP chưa chấp nhận/).waitFor();
        await dialog.getByRole('checkbox',{name:/Tôi đã đối chiếu/}).check();
        await dialog.getByRole('button',{name:'Kết thúc đối chiếu'}).click();
        await dialog.getByRole('button',{name:'Tải lại chi tiết',exact:true}).click();
        await dialog.getByText('Quản trị viên đã xác minh SMTP chưa chấp nhận thư.').waitFor();
        assert.equal(await submit.isDisabled(),true);
        assert.equal(await evidence.inputValue(),'SMTP-2041');
        assert.equal(mutations.length,1);
      }finally{state.emailDetailGate=null;release()}
    },{emailItems:true,emailRecovery:true}));

    for(const item of tableCases)for(const width of item.role==='USER'?[1440,390]:[1440])await test(browser,`N4-table refresh ${item.role} ${item.route} ${width}px retains only same-query data and locks actions`,()=>withFixture(browser,item.role,async({page,state,mutations,calls})=>{
      await page.setViewportSize({width,height:1000});await page.goto(origin+item.route);
      const section=page.locator(item.section);const mobile=item.role==='USER'&&width===390;
      const rows=()=>section.locator(mobile?'.asset-mobile-list button.asset-mobile-card':'tbody tr:not([aria-hidden])');
      await rows().first().waitFor();const count=await rows().count();assert(count>0);
      const refresh=item.route==='/approvals'?'hàng chờ':item.route==='/audit'?'nhật ký':item.route==='/operations/email'?'danh sách email':'tài sản';
      const prefix=item.route==='/approvals'?'request':item.route==='/audit'?'audit':item.route==='/operations/email'?'email':'asset';
      const endpoint=item.route==='/approvals'?'/requests':item.route==='/audit'?'/audit-logs':item.route==='/operations/email'?'/notifications/delivery-issues':'/assets';
      const snapshot=await rows().allTextContents();const oldMutationCount=mutations.length;
      let release;state.tableReadEndpoint=endpoint;state.tableReadGate=new Promise(resolve=>{release=resolve});
      try{
        await section.getByRole('button',{name:'Làm mới '+refresh,exact:true}).click();
        await section.getByRole('status').filter({hasText:'Đang cập nhật'}).waitFor();
        assert.deepEqual(await rows().allTextContents(),snapshot);
        assert.equal(await section.locator('tbody button:not([disabled]), .asset-mobile-list button:not([disabled])').count(),0);
        state[prefix+'Fail']=true;state.tableReadGate=null;release();
        await section.getByRole('alert').waitFor();assert.equal(await rows().count(),count);assert.deepEqual(await rows().allTextContents(),snapshot);
        state[prefix+'Fail']=false;state[prefix+'Denied']=true;
        await section.getByRole('button',{name:'Thử lại',exact:true}).click();
        await section.getByRole('alert').filter({hasText:'Quyền'}).waitFor();assert.equal(await rows().count(),0);
        assert.equal(mutations.length,oldMutationCount);assert(calls.filter(call=>call.startsWith('GET '+endpoint)).length>=3);
      }finally{state.tableReadGate=null;release()}
    },{...(item.data?{[item.data]:true}:{})}));

    const tableStatusCases = [
      {role:'USER', route:'/assets', section:'#admin-assets', endpoint:'/assets', loading:'tài sản', label:'tài sản', search:'Tìm tài sản'},
      {role:'ADMIN', route:'/assets', section:'#admin-assets', endpoint:'/assets', loading:'tài sản', label:'tài sản', search:'Tìm tài sản'},
      {role:'ADMIN', route:'/users', section:'#users', endpoint:'/users', loading:'tài khoản', label:'tài khoản', search:'Tìm tài khoản'},
      {role:'APPROVER', route:'/approvals', section:'#approval-queue', endpoint:'/requests', loading:'hàng chờ', label:'yêu cầu chờ duyệt', search:'Tìm yêu cầu'},
    ];
    for (const item of tableStatusCases) for (const width of [1440,390]) {
      await test(browser,`T34 table status ${item.role} ${item.route} ${width}px is outside the busy results`,()=>withFixture(browser,item.role,async({page,state})=>{
        let release;
        state.tableReadEndpoint=item.endpoint;
        state.tableReadGate=new Promise(resolve=>{release=resolve});
        const section=page.locator(item.section);
        const expectStatus=async(message)=>{
          const status=section.getByRole('status').filter({hasText:message});
          await status.waitFor();
          assert.equal(await status.evaluate(element=>!!element.closest('[aria-busy="true"]')),false);
          assert.match(await status.ariaSnapshot(),/status:/);
          return status;
        };
        try {
          await page.setViewportSize({width,height:900});
          await page.goto(origin+item.route);
          const status=await expectStatus(`Đang tải ${item.loading}…`);
          assert.equal(await section.locator('[aria-busy="true"]').count(),1);
          await status.evaluate(element=>element.dataset.testTableStatus='persistent');
          state.tableReadGate=null;
          release();
          const count=await expectStatus(new RegExp(`^Có \\d+ ${item.label}\\.$`));
          assert.equal(await count.getAttribute('data-test-table-status'),'persistent');
          const search=section.getByRole('textbox',{name:item.search,exact:true});
          await search.fill('no-results-t34');
          await search.press('Enter');
          const empty=await expectStatus(`Không có ${item.label} phù hợp.`);
          assert.equal(await empty.getAttribute('data-test-table-status'),'persistent');
        } finally { state.tableReadGate=null; release(); }
      }));
    }

    await test(browser,'T22 Audit Log exposes stable loading, results and retry status',()=>withFixture(browser,'ADMIN',async({page,state})=>{
      const assertStatus=async(region,message)=>{
        const status=region.getByRole('status').filter({hasText:message});
        await status.waitFor();
        assert.equal(await status.evaluate(element=>!!element.closest('[aria-busy="true"]')),false);
        const snapshot=await status.ariaSnapshot();
        assert(snapshot.includes('status:')&&snapshot.includes(message),snapshot);
        return status;
      };
      let releaseList;
      state.tableReadEndpoint='/audit-logs';
      state.tableReadGate=new Promise(resolve=>{releaseList=resolve});
      try {
        await page.goto(origin+'/audit');
        const audit=page.getByRole('region',{name:'Audit Log',exact:true});
        const status=await assertStatus(audit,'Đang tải nhật ký…');
        await status.evaluate(element=>element.dataset.testStatus='audit-list');
        assert.equal(await audit.getByRole('table').getAttribute('aria-busy'),'true');
        state.tableReadGate=null;releaseList();
        assert.equal(await (await assertStatus(audit,'Đã tìm thấy 35 sự kiện.')).getAttribute('data-test-status'),'audit-list');
        state.auditItems=false;
        const refresh=audit.getByRole('button',{name:'Làm mới nhật ký'});
        await refresh.press('Enter');
        await assertStatus(audit,'Không có sự kiện phù hợp.');
        state.auditItems=true;
        await refresh.press('Enter');
        await assertStatus(audit,'Đã tìm thấy 35 sự kiện.');

        let releaseDetail;
        const detailGate=new Promise(resolve=>{releaseDetail=resolve});
        await page.route('**/api/v1/audit-logs/audit-1',async route=>{
          await detailGate;
          return route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'Không thể tải chi tiết.'}}});
        },{times:1});
        const event=audit.getByRole('button',{name:'AUTH_LOGIN',exact:true}).first();
        try {
          await event.press('Enter');
          const dialog=page.getByRole('dialog',{name:'Chi tiết sự kiện'});
          const loadingStatus=await assertStatus(dialog,'Đang tải chi tiết sự kiện…');
          await loadingStatus.evaluate(element=>element.dataset.testStatus='audit-detail');
          releaseDetail();
          const retry=dialog.getByRole('alert').getByRole('button',{name:'Thử lại'});
          await retry.waitFor();
          await page.route('**/api/v1/audit-logs/audit-1',route=>route.fulfill({json:{data:{...auditItems[0],changes:[],related:null}}}),{times:1});
          await retry.press('Enter');
          assert.equal(await (await assertStatus(dialog,'Đã tải chi tiết sự kiện.')).getAttribute('data-test-status'),'audit-detail');
          await dialog.getByRole('heading',{name:'Thay đổi đã ghi nhận'}).waitFor();
          const close=dialog.getByRole('button',{name:'Đóng',exact:true});
          assert.equal(await close.evaluate(element=>element===document.activeElement),true);
          await page.keyboard.press('Escape');
          await dialog.waitFor({state:'hidden'});
          await event.evaluate(element=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(element===document.activeElement))))).then(focused=>assert.equal(focused,true));
        } finally {releaseDetail()}
      } finally {state.tableReadGate=null;releaseList()}
    },{auditItems:true}));
    await test(browser,'N1 motion tokens match navigation, page and overlays in both themes',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/users');await visible(page,'Người dùng và vai trò');const read=()=>page.evaluate(()=>{const style=getComputedStyle(document.documentElement);return ['--motion-fast','--motion-page','--motion-overlay','--motion-ease-entrance','--motion-ease-exit'].map(name=>style.getPropertyValue(name).trim())});
      const tokens=await read();assert.deepEqual(tokens.slice(0,3),['120ms','160ms','180ms']);const hoverLink=page.locator('.nav-item').first();assert.equal(await hoverLink.evaluate(element=>getComputedStyle(element).transitionDuration.split(',')[0].trim()),'0s');await hoverLink.hover();assert.equal(await hoverLink.evaluate(element=>getComputedStyle(element).transitionDuration.split(',')[0].trim()),'0.12s');await page.mouse.move(0,0);assert.equal(await page.locator('.nav-item-active').evaluate(element=>getComputedStyle(element).transitionDuration.split(',')[0].trim()),'0s');
      await page.getByRole('button',{name:'Chuyển sang giao diện tối'}).click();assert.deepEqual(await read(),tokens);await page.getByRole('button',{name:'Thêm người dùng'}).click();const form=page.getByRole('dialog');assert.equal(await form.evaluate(element=>getComputedStyle(element).animationDuration),'0.18s');await form.getByRole('button',{name:'Hủy',exact:true}).click();
      await page.evaluate(()=>{const original=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=original.apply(this,args);if(this.id==='main-content')window.__tokenRouteAnimation=animation;return animation}});
      await page.getByRole('link',{name:'Chính sách',exact:true}).click();await visible(page,'Chính sách mật mã');
      assert.equal(await routeAnimationCount(page),Number(motionEnabled));
      const duration=await page.evaluate(()=>window.__tokenRouteAnimation?.effect.getTiming().duration ?? null);
      assert.equal(duration,motionEnabled?parseFloat(tokens[1]):null);
    }));
    for(const role of ['USER','APPROVER','ADMIN'])for(const theme of ['light','dark'])for(const width of [1440,1024,768,390])await test(browser,`L-matrix ${role} ${theme} ${width}px preserves shell, focus, reading colors and overflow containment`,()=>withFixture(browser,role,async({page,mutations})=>{
      await page.setViewportSize({width,height:1000});await page.goto(origin+'/dashboard');await page.locator('.resource-region[aria-busy=false]').waitFor();if(theme==='dark')await page.getByRole('button',{name:'Chuyển sang giao diện tối'}).click();
      await page.locator('.sidebar').evaluate(element=>element.dataset.reviewIdentity='viewport-shell');const destination=role==='USER'?'/assets':role==='APPROVER'?'/approvals':'/users';
      if(width<=820)await page.getByRole('button',{name:'Mở điều hướng',exact:true}).click();await page.locator(`.sidebar a[href="${destination}"]`).click();await page.waitForURL(origin+destination);await page.waitForFunction(()=>document.activeElement?.id==='page-title');
      if(role==='USER')await page.getByRole('button',{name:/ASSET-0001/}).waitFor();else await page.getByRole('row').filter({hasText:role==='ADMIN'?'person1@example.test':'request-1'}).first().waitFor();
      assert.equal(await page.locator('.sidebar').getAttribute('data-review-identity'),'viewport-shell');const geometry=await page.evaluate(()=>{const title=document.querySelector('#page-title').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,titleLeft:title.left,titleRight:title.right,width:innerWidth}});assert(geometry.overflow<=1);assert(geometry.titleLeft>=0&&geometry.titleRight<=geometry.width);
      const contrast=await page.evaluate(()=>{const style=getComputedStyle(document.documentElement),luminance=hex=>{const value=hex.trim().replace('#',''),rgb=[0,2,4].map(i=>parseInt(value.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722};return [['--text','--surface'],['--text-soft','--surface'],['--text-muted','--surface'],['--on-brand','--brand'],['--on-danger','--danger-action']].map(([a,b])=>{const first=luminance(style.getPropertyValue(a)),second=luminance(style.getPropertyValue(b));return (Math.max(first,second)+0.05)/(Math.min(first,second)+0.05)})});assert(contrast.every(value=>value>=4.5),`selected text/button contrasts: ${contrast}`);
      const search=page.locator('#main-content input').first();await search.focus();await search.fill('Kiểm chứng bàn phím');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('#main-content')),true);assert.equal(await search.inputValue(),'Kiểm chứng bàn phím');assert.equal(mutations.length,0);
      await page.screenshot({path:path.join(output,`l-matrix-${role}-${theme}-${width}.png`),fullPage:true});
    }));
    await test(browser,'L-review resize from an open mobile menu releases the trap and restores valid focus when shrinking',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.setViewportSize({width:390,height:844});await page.goto(origin+'/users');await visible(page,'Người dùng và vai trò');const trigger=page.locator('.mobile-menu');
      await trigger.click();await page.getByRole('link',{name:'Tổng quan',exact:true}).waitFor();await page.setViewportSize({width:1440,height:1000});await page.getByRole('main').waitFor();
      assert.equal(await trigger.getAttribute('aria-expanded'),'false');await page.getByPlaceholder('Tên, email hoặc phòng ban',{exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.sidebar')),false);
      await page.getByRole('link',{name:'Tổng quan',exact:true}).focus();await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.activeElement?.classList.contains('mobile-menu'));
      assert.equal(await page.locator('.sidebar').evaluate(element=>element.inert),true);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.sidebar')),false);
    }));
    await test(browser,'L-review long user names, email, department and multiple roles remain fully readable',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/users');const row=page.getByRole('row').filter({hasText:'nhanvien-co-ten-email-dai'});await row.waitFor();
      const contained=await row.locator('td').evaluateAll(cells=>cells.slice(0,3).map(cell=>{const box=cell.getBoundingClientRect(),style=getComputedStyle(cell),range=document.createRange();range.selectNodeContents(cell);return Array.from(range.getClientRects()).every(rect=>rect.left>=box.left+parseFloat(style.paddingLeft)-1&&rect.right<=box.right-parseFloat(style.paddingRight)+1&&rect.bottom<=box.bottom-parseFloat(style.paddingBottom)+1)}));
      assert.deepEqual(contained,[true,true,true]);await page.screenshot({path:path.join(output,'l-long-user-text.png'),fullPage:true});
    },{userCount:1,userOverrides:{'person-1':{displayName:'Nguyễn Thị Nhân viên phụ trách quản trị chứng thư và chính sách bảo mật',email:'nhanvien-co-ten-email-dai.chi-nhanh-mien-nam@bo-phan-quan-tri-chung-thu.example.test',departmentName:'Phòng quản trị hệ thống thông tin và an toàn tài sản mật mã',roles:['USER','APPROVER']}}}));
    await test(browser,'L-review keyboard acknowledgment stays above the sticky mobile request footer',()=>withFixture(browser,'USER',async({page,mutations})=>{
      await page.setViewportSize({width:390,height:844});await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});await form.locator('textarea').fill('Đối chiếu kết quả trước khi gửi lại');await form.getByRole('button',{name:'Gửi yêu cầu',exact:true}).click();
      const notice=page.getByRole('region',{name:'Kết quả thao tác chưa rõ'});await notice.getByRole('button',{name:'Kiểm tra dữ liệu'}).click();await notice.getByRole('checkbox').check();await page.keyboard.press('Tab');const ack=notice.getByRole('button',{name:'Kết thúc đối chiếu'});await page.waitForFunction(()=>document.activeElement?.textContent==='Kết thúc đối chiếu');
      await page.waitForFunction(()=>{const ack=document.activeElement?.getBoundingClientRect(),footer=document.querySelector('[role=dialog] form footer')?.getBoundingClientRect();return ack&&footer&&ack.bottom<=footer.top-4},{},{timeout:1500});const box=await ack.boundingBox(),footer=await form.locator('form footer').boundingBox();assert(box.y+box.height<=footer.y-4,`focused acknowledgment bottom ${box.y+box.height} overlaps footer at ${footer.y}`);assert.equal(mutations.length,1);await page.screenshot({path:path.join(output,'l-mobile-keyboard-ack.png')});
    },{lostResponse:'/requests'}));
    for(const width of [1440,390])await test(browser,`N4 ${width}px dashboard loading preserves its footprint and conceals provisional controls`,()=>withFixture(browser,'ADMIN',async({page,mutations})=>{
      await page.setViewportSize({width,height:1000});await page.goto(origin+'/dashboard');await page.getByText('Đang tải tổng quan…',{exact:true}).waitFor();
      const outline=page.locator('.loading-outline');assert.equal(await outline.evaluate(element=>element.inert),true);
      assert.equal(await page.getByRole('button',{name:/Mở chính sách/}).count(),0);assert.equal(await page.getByRole('region',{name:'Tổng quan an toàn',exact:true}).count(),0);
      const before=await page.locator('.app-footer').evaluate(element=>element.getBoundingClientRect().top+scrollY);
      await page.screenshot({path:path.join(output,`n4-dashboard-loading-${width}.png`),fullPage:true});
      await page.getByRole('region',{name:'Tổng quan an toàn',exact:true}).waitFor();const after=await page.locator('.app-footer').evaluate(element=>element.getBoundingClientRect().top+scrollY);
      assert(Math.abs(after-before)<=2,`dashboard footer moved ${after-before}px`);assert.equal(await outline.count(),0);assert.equal(mutations.length,0);
    },{dashboardDelay:1500}));
    for(const width of [1440,390])await test(browser,`N4 ${width}px users loading retains pagination and column geometry`,()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.setViewportSize({width,height:1000});await page.goto(origin+'/users');
      await page.locator('#users').getByRole('status').filter({hasText:'Đang tải tài khoản…'}).waitFor();
      assert.equal(await page.locator('.users-table .table-loading-row').count(),25);assert.equal(await page.getByRole('row').count(),1);
      const before=await page.locator('.admin-asset-pagination').evaluate(element=>element.getBoundingClientRect().top+scrollY);
      const widths=await page.locator('.users-table th').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().width));
      await page.screenshot({path:path.join(output,`n4-users-loading-${width}.png`),fullPage:true});await page.getByRole('row').filter({hasText:'person1@example.test'}).waitFor();
      const after=await page.locator('.admin-asset-pagination').evaluate(element=>element.getBoundingClientRect().top+scrollY);assert(Math.abs(after-before)<=2,`users pagination moved ${after-before}px`);
      const nextWidths=await page.locator('.users-table th').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().width));widths.forEach((value,index)=>assert(Math.abs(value-nextWidths[index])<=1));
    },{userDelay:1500}));
    await test(browser,'N4 same-query user refresh keeps rows, locks writes and drops them when permission is lost',()=>withFixture(browser,'ADMIN',async({page,state,mutations})=>{
      await page.goto(origin+'/users');const row=page.getByRole('row').filter({hasText:'person1@example.test'});await row.waitFor();
      state.userDelay=900;state.userFail=true;await row.getByRole('button',{name:'Vô hiệu hóa'}).click();
      await page.locator('#users').getByRole('status').filter({hasText:'Đang cập nhật tài khoản…'}).waitFor();
      assert.equal(await row.count(),1);assert.equal(await row.getByRole('button',{name:'Vô hiệu hóa'}).isDisabled(),true);
      await page.getByRole('alert').filter({hasText:'Tài khoản tạm thời không khả dụng. Đang hiển thị dữ liệu lần tải trước.'}).waitFor();assert.equal(await row.count(),1);assert.equal(await row.getByRole('button',{name:'Vô hiệu hóa'}).isDisabled(),true);
      state.userFail=false;state.userDenied=true;await page.getByRole('button',{name:'Thử lại',exact:true}).click();await page.getByRole('alert').filter({hasText:'Quyền xem tài khoản đã thay đổi.'}).waitFor();assert.equal(await row.count(),0);assert.equal(mutations.length,1);
    }));
    await test(browser,'N4 a different users query clears the previous rows while the new read is pending',()=>withFixture(browser,'ADMIN',async({page,state})=>{
      await page.goto(origin+'/users');await page.getByRole('row').filter({hasText:'person1@example.test'}).waitFor();state.userDelay=1000;
      await page.getByPlaceholder('Tên, email hoặc phòng ban',{exact:true}).fill('person35@example.test');await page.locator('.admin-asset-controls').getByRole('button',{name:'Tìm',exact:true}).click();
      await page.locator('#users').getByRole('status').filter({hasText:'Đang tải tài khoản…'}).waitFor();
      assert.equal(await page.getByRole('row').filter({hasText:'person1@example.test'}).count(),0);await page.getByRole('row').filter({hasText:'person35@example.test'}).waitFor();
    }));
    await test(browser,'NAV-21 loss after leaving a pending form remains visible on the destination page',()=>withFixture(browser,'USER',async({page,state,mutations})=>{
      let release;state.mutationGate=new Promise(resolve=>release=resolve);state.lostResponse='/requests';
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});await form.locator('textarea').fill('Rời trang trước khi mất phản hồi');await form.getByRole('button',{name:'Gửi yêu cầu'}).click();await form.locator('.mutation-notice[role="status"]').waitFor();await form.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();await visible(page,'Yêu cầu của tôi');release();
      const notice=page.getByRole('region',{name:'Kết quả thao tác chưa rõ'});await notice.waitFor();await notice.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await notice.getByText(/chưa xác định được ID/).waitFor();assert.equal(mutations.length,1);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.toast').count(),0);assert.equal(new URL(page.url()).pathname,'/requests');
    }));
    await test(browser,'NAV-21 unknown notice remains readable and keyboard usable in dark mobile layout',()=>withFixture(browser,'USER',async({page,mutations})=>{
      await page.setViewportSize({width:390,height:844});await page.goto(origin+'/assets');await page.getByRole('button',{name:'Chuyển sang giao diện tối'}).click();await page.getByRole('button',{name:'Tạo yêu cầu',exact:true}).click();const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});await form.locator('textarea').fill('Kiểm tra bố cục mất mạng trên mobile');await form.getByRole('button',{name:'Gửi yêu cầu'}).click();const notice=page.getByRole('region',{name:'Kết quả thao tác chưa rõ'});await notice.waitFor();
      const check=notice.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true});await check.focus();await page.keyboard.press('Enter');await notice.getByRole('checkbox').waitFor();await notice.getByRole('checkbox').focus();await page.keyboard.press('Space');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Kết thúc đối chiếu');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'mutation-unknown-request-mobile-dark.png'),fullPage:true});assert.equal(mutations.length,1);
    },{lostResponse:'/requests'}));
    await test(browser,'L/N mobile navigation traps keyboard focus, Escape restores trigger, and selection focuses heading',()=>withFixture(browser,'USER',async({page})=>{
      await page.setViewportSize({width:390,height:844});await page.goto(origin+'/assets');await page.locator('.asset-mobile-card').first().waitFor();
      const sidebar=page.locator('.sidebar');
      const trigger=page.locator('.mobile-menu');
      const dialog=page.getByRole('dialog',{name:'Điều hướng chính'});
      const close=dialog.getByRole('button',{name:'Đóng điều hướng',exact:true});
      const open=async()=>{
        await trigger.press('Enter');
        await page.waitForFunction(()=>document.activeElement?.closest('.sidebar'));
      };
      const restored=async()=>{
        assert.equal(await trigger.getAttribute('aria-expanded'),'false');
        assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
        assert.equal(await sidebar.evaluate(element=>element.inert),true);
        assert.equal(await page.getByRole('main').count(),1);
      };
      assert.equal(await sidebar.evaluate(element=>element.inert),true);
      await open();
      assert.match(await sidebar.ariaSnapshot(),/dialog "Điều hướng chính"/);
      assert.equal(await dialog.getAttribute('aria-modal'),'true');
      assert.equal(await trigger.getAttribute('aria-expanded'),'true');
      assert.equal(await page.getByRole('main').count(),0);
      assert.equal(await page.getByRole('link',{name:'Bỏ qua điều hướng'}).count(),0);
      await page.locator('#main-content').evaluate(element=>element.focus());
      assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('href')),'/dashboard');
      await page.screenshot({path:path.join(output,'mobile-navigation-dialog.png'),animations:'disabled'});
      await page.keyboard.press('Shift+Tab');assert.equal(await close.evaluate(element=>element===document.activeElement),true);
      await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Mở menu tài khoản');
      await page.keyboard.press('Tab');assert.equal(await close.evaluate(element=>element===document.activeElement),true);
      await page.keyboard.press('Escape');await restored();
      await page.getByRole('button',{name:'Chuyển sang giao diện tối'}).click();
      await open();await page.screenshot({path:path.join(output,'mobile-navigation-dialog-dark.png'),animations:'disabled'});
      await close.press('Enter');await restored();
      await open();await page.locator('.scrim').click({position:{x:350,y:350}});await restored();
      await open();await dialog.getByRole('button',{name:'Trợ giúp',exact:true}).press('Enter');
      const help=page.getByRole('dialog',{name:'Sử dụng Crypta an toàn'});
      await help.waitFor();assert.equal(await dialog.count(),0);
      await page.keyboard.press('Escape');await help.waitFor({state:'hidden'});
      await page.waitForFunction(()=>document.activeElement?.classList.contains('mobile-menu'));await restored();
      await open();await page.keyboard.press('Enter');await visible(page,'Tổng quan tài sản mã hóa');
      await page.waitForFunction(()=>document.activeElement?.id==='page-title');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
      await open();await page.goBack();await visible(page,'Tài sản của tôi');
      await page.waitForFunction(()=>document.activeElement?.id==='page-title');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
    }));
    await test(browser,'L/N skip link gives main keyboard focus without changing the workspace route',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/users');await visible(page,'Người dùng và vai trò');const skip=page.getByRole('link',{name:'Bỏ qua điều hướng',exact:true});await skip.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement?.id==='main-content');assert.equal(new URL(page.url()).pathname,'/users');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.includes('Mở phân quyền')),true);
    }));
    await test(browser,'L/N reduced motion changed during navigation cancels enabled motion and subsequent pages stay immediate',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/dashboard');await visible(page,'Sức khỏe tài sản mật mã');
      if(motionEnabled)await page.evaluate(()=>{
        const original=Element.prototype.animate;
        Element.prototype.animate=function(...args){
          const animation=original.apply(this,args);
          if(this.id==='main-content')animation.updatePlaybackRate(0.01);
          return animation;
        };
      });
      await page.getByRole('link',{name:'Người dùng & vai trò',exact:true}).click();
      await visible(page,'Người dùng và vai trò');
      if(motionEnabled)await page.waitForFunction(()=>document.querySelector('#main-content').getAnimations().length>0);
      assert.equal(await routeAnimationCount(page),Number(motionEnabled));
      await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('#main-content').getAnimations().length===0);const count=await page.evaluate(()=>window.__routeAnimations);await page.getByRole('link',{name:'Chính sách',exact:true}).click();await visible(page,'Chính sách mật mã');assert.equal(await page.evaluate(()=>window.__routeAnimations),count);assert.equal(await page.locator('#main-content').evaluate(element=>getComputedStyle(element).opacity),'1');
      await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('link',{name:'Người dùng & vai trò',exact:true}).click();await visible(page,'Người dùng và vai trò');assert.equal(await routeAnimationCount(page),count+Number(motionEnabled));
    }));
    for(const fallback of ['noAnimation','brokenAnimation'])await test(browser,`L/N ${fallback} still navigates, focuses content and preserves the shell`,()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/dashboard');await visible(page,'Sức khỏe tài sản mật mã');await page.locator('.sidebar').evaluate(element=>element.dataset.testIdentity='fallback-shell');await page.getByRole('link',{name:'Người dùng & vai trò',exact:true}).click();await visible(page,'Người dùng và vai trò');await page.waitForFunction(()=>document.activeElement?.id==='page-title');await page.getByRole('link',{name:'Chính sách',exact:true}).click();await visible(page,'Chính sách mật mã');assert.equal(await page.locator('#main-content').evaluate(element=>getComputedStyle(element).opacity),'1');assert.equal(await page.locator('.sidebar').getAttribute('data-test-identity'),'fallback-shell');assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1);
    },{[fallback]:true}));
    await test(browser,'L/N ten rapid route changes with late reads reach the last page without stale rows or errors',()=>withFixture(browser,'ADMIN',async({page,calls})=>{
      await page.goto(origin+'/dashboard');await visible(page,'Sức khỏe tài sản mật mã');await page.locator('.sidebar').evaluate(element=>element.dataset.testIdentity='rapid-shell');const routes=[['Người dùng & vai trò','/users'],['Chính sách','/policies'],['Audit Log','/audit']];
      for(let i=0;i<10;i++){const [label,path]=routes[i%3];await page.getByRole('link',{name:label,exact:true}).click();await page.waitForURL(origin+path)}
      await visible(page,'Người dùng và vai trò');await page.getByRole('row').filter({hasText:'person1@example.test'}).waitFor();assert.equal(await page.locator('.sidebar').getAttribute('data-test-identity'),'rapid-shell');assert.equal(await page.locator('.toast').count(),0);assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1);assert.equal(await page.locator('.policy-table').count(),0);assert(calls.filter(call=>call.startsWith('GET /policies')).length>=1);
    },{policyDelay:900}));
    for(const conflict of [false,true])await test(browser,`NAV-14 queue page two uses the fetched detail version for ${conflict?'a stale conflict':'a confirmed decision'}`,()=>withFixture(browser,'APPROVER',async({page,calls,mutations,state})=>{
      const queueUrl=origin+'/approvals?page=2&pageSize=10',requestId='request-31';
      await page.goto(queueUrl);await page.getByRole('button',{name:requestId,exact:true}).waitFor();
      assert(calls.some(call=>call.startsWith('GET /requests?')&&new URL(origin+call.slice(4)).searchParams.get('page')==='2'&&call.includes('pageSize=10')&&call.includes('status=PENDING')));
      assert.equal(await page.getByRole('button',{name:'request-1',exact:true}).count(),0);
      await page.getByRole('button',{name:requestId,exact:true}).click();await visible(page,'Yêu cầu kiểm thử 31');
      assert.equal(new URL(page.url()).pathname,`/requests/${requestId}`);assert(calls.includes(`GET /requests/${requestId}`));
      await page.getByRole('button',{name:'Phê duyệt',exact:true}).click();const dialog=page.getByRole('dialog');
      const note='Quyết định từ trang hai cần giữ đúng đối tượng';await dialog.locator('textarea').fill(note);
      await dialog.getByRole('button',{name:'Xác nhận phê duyệt'}).click();
      if(conflict){
        await dialog.getByRole('alert').filter({hasText:'Phiên bản đã thay đổi'}).waitFor();assert.equal(await dialog.locator('textarea').inputValue(),note);
        assert.equal(await page.locator('.toast').count(),0);assert.equal(state.decisions?.[requestId],undefined);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(mutations.length,1,'A 409 must not cause an automatic decision retry.');
        await dialog.getByRole('button',{name:'Hủy',exact:true}).click();
      }else{
        await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('.drawer-status')?.textContent?.includes('Đã duyệt'));
        assert.equal(await page.getByRole('button',{name:'Phê duyệt',exact:true}).count(),0);
        assert.equal(state.decisions[requestId],'APPROVED');assert(calls.filter(call=>call===`GET /requests/${requestId}`).length>=2,'The successful decision must refresh its detail.');
      }
      assert.equal(mutations.length,1);assert.equal(mutations[0].endpoint,`/requests/${requestId}/decision`);
      assert.deepEqual(mutations[0].body,{decision:'APPROVED',comment:note,version:'11'});
      await page.locator('.asset-detail-page').getByRole('button',{name:'Về danh sách',exact:true}).last().click();
      await visible(page,'Hàng chờ cần quyết định');await page.getByRole('button',{name:requestId,exact:true}).waitFor();assert.equal(page.url(),queueUrl);
    },{requestVersion:11,decisionConflict:conflict}));
    await test(browser,'NAV-27 menu and Back blockers preserve dirty input in the selected motion mode',()=>withFixture(browser,'ADMIN',async({page,mutations})=>{
      await page.goto(origin+'/users');await page.getByRole('table').getByText('person1@example.test',{exact:true}).waitFor();
      await page.evaluate(()=>{
        const original=Element.prototype.animate;
        Element.prototype.animate=function(...args){const animation=original.apply(this,args);if(this.id==='main-content'&&!window.__nav27Animation){
          // Keep one native animation running deterministically across browser automation round trips.
          // Its effect remains the product's 160 ms; this playback rate is test instrumentation, not a performance sample.
          animation.updatePlaybackRate(0.01);window.__nav27Animation=animation;
        }return animation};
      });
      await page.getByRole('link',{name:'Chính sách',exact:true}).click();await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).click();
      const form=page.getByRole('form',{name:'Tạo phiên bản chính sách'}),field=form.locator('input[type=number]').first();await field.fill('366');
      const running=()=>page.evaluate(()=>{const animation=window.__nav27Animation;return animation instanceof Animation&&animation.playState==='running'&&animation.effect.target.id==='main-content'&&animation.effect.getTiming().duration===160&&animation.currentTime<160});
      assert.equal(await running(),motionEnabled);const animations=await routeAnimationCount(page);
      assert.equal(animations,Number(motionEnabled));
      const checkStayed=async()=>{
        assert.equal(new URL(page.url()).pathname,'/policies');assert.equal(await field.inputValue(),'366');
        assert.equal(await page.locator('.nav-item[href="/policies"]').getAttribute('aria-current'),'page');
        assert.equal(await routeAnimationCount(page),animations);assert.equal(await running(),motionEnabled);assert.equal(mutations.length,0);
      };
      await page.getByRole('link',{name:'Người dùng & vai trò',exact:true}).dispatchEvent('click');const blocker=page.getByRole('alertdialog');await blocker.waitFor();
      assert.equal(await running(),motionEnabled);await blocker.getByRole('button',{name:'Ở lại',exact:true}).click();await blocker.waitFor({state:'hidden'});await checkStayed();
      await page.waitForFunction(()=>document.activeElement?.closest('form')?.getAttribute('aria-label')==='Tạo phiên bản chính sách');
      await page.goBack();await blocker.waitFor();assert.equal(await running(),motionEnabled);await blocker.getByRole('button',{name:'Ở lại',exact:true}).click();await blocker.waitFor({state:'hidden'});await checkStayed();
      await page.goBack();await blocker.waitFor();assert.equal(await running(),motionEnabled);await blocker.getByRole('button',{name:'Bỏ thay đổi'}).click();
      await visible(page,'Người dùng và vai trò');await page.getByRole('table').getByText('person1@example.test',{exact:true}).waitFor();
      assert.equal(await form.count(),0);assert.equal(await page.getByRole('alertdialog').count(),0);
      if(motionEnabled)assert.equal(await page.evaluate(()=>window.__nav27Animation.playState),'idle');
      assert.equal(await routeAnimationCount(page),animations+Number(motionEnabled));assert.equal(mutations.length,0);
      assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1);
    }));
    await test(browser,'NAV-28 ten rapid routes followed by logout discard a pending old-account read before another account enters',()=>withFixture(browser,'ADMIN',async({page,state,calls,mutations})=>{
      await page.goto(origin+'/dashboard');await visible(page,'Sức khỏe tài sản mật mã');await page.locator('.sidebar').evaluate(element=>element.dataset.testIdentity='nav28-old-account');
      let release,readEntered;const gate=new Promise(resolve=>{release=resolve});
      state.userReadGate={then(resolve,reject){readEntered?.();return gate.then(resolve,reject)}};
      try{
        const routes=[['Người dùng & vai trò','/users'],['Chính sách','/policies'],['Audit Log','/audit']];
        for(let index=0;index<10;index++){
          const [label,route]=routes[index%3];const pendingRead=route==='/users'?new Promise(resolve=>{readEntered=resolve}):null;
          await page.getByRole('link',{name:label,exact:true}).click();await page.waitForURL(origin+route);if(pendingRead)await pendingRead;readEntered=null;
        }
        await visible(page,'Người dùng và vai trò');assert.equal(await page.locator('.table-shell').getAttribute('aria-busy'),'true');
        assert(calls.filter(call=>call.startsWith('GET /users?')).length>=4);assert.equal(await page.getByText('OLD-ACCOUNT-ONLY-NAV28',{exact:true}).count(),0);
        await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.locator('.login-card').waitFor();
        assert.equal(await page.locator('.sidebar').count(),0);assert.equal(await page.getByRole('alertdialog').count(),0);
        state.loginUser={id:'session-new-nav28',email:'new-nav28@example.test',displayName:'Tài khoản mới NAV28',roles:['USER'],approverDepartmentIds:[],mustChangePassword:false};
        const boundaryCalls=calls.length;await login(page);await visible(page,'Tổng quan tài sản mã hóa');
        assert.equal(await page.locator('.sidebar').getAttribute('data-test-identity'),null);assert.equal(await page.locator('.nav-item[href="/users"]').count(),0);
        state.userReadGate=null;release();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(new URL(page.url()).pathname,'/dashboard');assert.equal(await page.locator('.users-table,.policy-table').count(),0);
        assert.equal(await page.getByText('OLD-ACCOUNT-ONLY-NAV28',{exact:true}).count(),0);assert.equal(await page.locator('.toast').count(),0);
        assert(!calls.slice(boundaryCalls).some(call=>/^GET \/(users|policies|audit-logs)(?:\?|$)/.test(call)));
        assert.equal(mutations.filter(item=>item.endpoint==='/auth/logout').length,1);
        assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1);
      }finally{state.userReadGate=null;release()}
    },{userOverrides:{'person-1':{displayName:'OLD-ACCOUNT-ONLY-NAV28'}}}));
    await test(browser,'NAV-28 combined rapid routes and display-role switch discard pending ADMIN reads in the USER scope',()=>withFixture(browser,'ADMIN',async({page,state,calls,mutations})=>{
      const marker='ADMIN-ONLY-PENDING-DISPLAY-ROLE-NAV28';
      await page.addInitScript(marker=>{
        window.__nav28RoleDocument=crypto.randomUUID();
        window.__nav28RoleMonitor={markerAppearances:[],toastsAfterBoundary:[],boundary:false};
        new MutationObserver(()=>{
          const review=window.__nav28RoleMonitor;
          if(document.body?.textContent.includes(marker))review.markerAppearances.push({path:location.pathname,boundary:review.boundary});
          if(review.boundary)for(const toast of document.querySelectorAll('.toast'))review.toastsAfterBoundary.push(toast.textContent);
        }).observe(document,{childList:true,characterData:true,subtree:true});
      },marker);
      await page.goto(origin+'/dashboard');await visible(page,'Sức khỏe tài sản mật mã');
      const token=await page.evaluate(()=>{
        window.__nav28AdminShell={document,appShell:document.querySelector('.app-shell'),sidebar:document.querySelector('.sidebar'),topbar:document.querySelector('.topbar'),main:document.querySelector('#main-content')};
        return window.__nav28RoleDocument;
      });
      let release,readEntered,released=false,entered=0,finishResponses;
      const gate=new Promise(resolve=>{release=resolve}),responses=[],allResponses=new Promise(resolve=>{finishResponses=resolve});
      const bounded=async(promise,message)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),10000)})])}finally{clearTimeout(timer)}};
      state.userReadGate={then(resolve,reject){entered++;readEntered?.();return gate.then(resolve,reject)}};
      state.onFixtureResponse=response=>{
        if(response.endpoint==='/users'&&released){
          responses.push({status:response.status,firstName:response.data.items?.[0]?.displayName,rowCount:response.data.items?.length});
          if(responses.length===entered)finishResponses();
        }
      };
      const sameShell=key=>page.evaluate(key=>{
        const saved=window[key];return {document:saved.document===document,appShell:saved.appShell===document.querySelector('.app-shell'),sidebar:saved.sidebar===document.querySelector('.sidebar'),topbar:saved.topbar===document.querySelector('.topbar'),main:saved.main===document.querySelector('#main-content')};
      },key);
      try{
        const routes=[['Người dùng & vai trò','/users'],['Chính sách','/policies'],['Audit Log','/audit']];
        for(let index=0;index<10;index++){
          const [label,route]=routes[index%3],pendingRead=route==='/users'?new Promise(resolve=>{readEntered=resolve}):null;
          await page.getByRole('link',{name:label,exact:true}).click();await page.waitForURL(origin+route);
          if(pendingRead)await bounded(pendingRead,'A Users read must enter the fixture gate during each Users visit');readEntered=null;
          assert.deepEqual(await sameShell('__nav28AdminShell'),{document:true,appShell:true,sidebar:true,topbar:true,main:true},'Same-role rapid navigation preserves the ADMIN shell');
        }
        await visible(page,'Người dùng và vai trò');assert.equal(await page.locator('.table-shell').getAttribute('aria-busy'),'true');
        assert.equal(entered,4);assert.equal(responses.length,0,'All four marked ADMIN responses remain pending before role switching');
        assert.equal(await page.getByText(marker,{exact:true}).count(),0);assert.equal(mutations.length,0);
        await page.getByRole('button',{name:'Vai trò hiện tại: Quản trị bảo mật',exact:true}).click();
        const boundaryCalls=calls.length;await page.evaluate(()=>{window.__nav28RoleMonitor.boundary=true});
        await page.getByRole('menuitemradio',{name:/Nhân viên/}).click();
        await visible(page,'Tổng quan tài sản mã hóa');await page.getByRole('button',{name:'Vai trò hiện tại: Nhân viên',exact:true}).waitFor();
        await page.waitForFunction(()=>!document.querySelector('main [aria-busy="true"]')&&document.activeElement?.id==='page-title');
        assert.equal(released,false,'The USER scope must finish rendering while old ADMIN reads are still pending');
        assert.equal(page.url(),origin+'/dashboard');assert.equal(await page.title(),'Tổng quan · Crypta');
        assert.equal(await page.evaluate(()=>window.__nav28RoleDocument),token);assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1);
        // An explicit display-role boundary owns a new shell; same-role routes above retain the old one.
        assert.deepEqual(await sameShell('__nav28AdminShell'),{document:true,appShell:false,sidebar:false,topbar:false,main:false},'Changing the display role replaces the shell scope without reloading the document');
        await page.evaluate(()=>{window.__nav28UserShell={document,appShell:document.querySelector('.app-shell'),sidebar:document.querySelector('.sidebar'),topbar:document.querySelector('.topbar'),main:document.querySelector('#main-content')}});
        const checkUser=async()=>{
          assert.equal(page.url(),origin+'/dashboard');assert.equal(await page.title(),'Tổng quan · Crypta');
          assert.equal(await page.locator('#page-title').textContent(),'Tổng quan tài sản mã hóa');assert.equal(await page.evaluate(()=>document.activeElement?.id),'page-title');
          assert.deepEqual(await page.locator('a.nav-item[aria-current="page"]').evaluateAll(nodes=>nodes.map(node=>new URL(node.href).pathname)),['/dashboard']);
          assert.deepEqual(await page.locator('a.nav-item.nav-item-active').evaluateAll(nodes=>nodes.map(node=>new URL(node.href).pathname)),['/dashboard']);
          assert.equal(await page.locator('.nav-item[href="/users"],.nav-item[href="/policies"],.nav-item[href="/audit"]').count(),0);
          assert.equal(await page.locator('.users-table,.policy-table').count(),0);assert.equal(await page.getByText(marker,{exact:true}).count(),0);
          assert.equal(await page.locator('.toast,[role="alertdialog"]').count(),0);assert.equal(mutations.length,0);
          assert.deepEqual(await sameShell('__nav28UserShell'),{document:true,appShell:true,sidebar:true,topbar:true,main:true},'The USER shell remains current after late ADMIN fixture responses');
          const after=calls.slice(boundaryCalls);
          assert(!after.some(call=>/^GET \/(users|policies|audit-logs)(?:\?|$)/.test(call)),'No new privileged reads follow the role boundary');
          assert(!after.some(call=>/^GET \/dashboard(?:\/summary)?\?.*role=ADMIN(?:&|$)/.test(call)),'Dashboard reads after the boundary use USER');
          assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1);
        };
        await checkUser();state.userReadGate=null;released=true;release();
        await bounded(allResponses,'All pending ADMIN fixture responses must be released');
        assert.equal(responses.length,4);assert(responses.every(response=>response.status===200&&response.firstName===marker&&response.rowCount===25));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await checkUser();
        const monitor=await page.evaluate(()=>window.__nav28RoleMonitor);assert.deepEqual(monitor.markerAppearances,[]);assert.deepEqual(monitor.toastsAfterBoundary,[]);
        await fs.writeFile(path.join(output,'nav28-display-role.json'),JSON.stringify({browserChannel:requestedBrowser,browserVersion:browser.version(),fixtureOnly:true,rapidRoutes:10,pendingAdminReads:entered,releasedResponses:responses,
          sameRoleShellPreserved:true,roleBoundaryShellReplaced:true,userShellPreservedAfterLateReads:true,documentTokenPreserved:true,documentNavigations:1,
          userUrl:page.url(),userTitle:await page.title(),userFocus:'page-title',activeMenu:'/dashboard',callsAfterBoundary:calls.slice(boundaryCalls),mutations:mutations.length,monitor,
          scope:'Real role-control click and intercepted HTTP fixtures. The ADMIN payload is released by the fixture after USER renders; aborted or stale reads must never appear in the USER DOM. No source/build changes, real API writes, account changes, or performance claims.'},null,2));
      }finally{state.userReadGate=null;state.onFixtureResponse=null;release()}
    },{roles:['ADMIN','USER'],userOverrides:{'person-1':{displayName:'ADMIN-ONLY-PENDING-DISPLAY-ROLE-NAV28'}},policyDelay:900,auditDelay:900,auditItems:true}));
    await test(browser,'Scroll restoration respects menu navigation and a user wheel during delayed query rows',()=>withFixture(browser,'ADMIN',async({page,state})=>{
      const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.setViewportSize({width:1440,height:800});
      await page.goto(origin+'/users?pageSize=10');await page.getByRole('table').getByText('person1@example.test',{exact:true}).waitFor();
      await page.evaluate(()=>window.scrollTo({top:900,behavior:'instant'}));await frames();
      const saved=await page.evaluate(()=>scrollY);await page.getByRole('link',{name:'Chính sách',exact:true}).click();await visible(page,'Chính sách mật mã');await frames();assert.equal(await page.evaluate(()=>scrollY),0);
      let releaseBack,releaseQuery;state.userReadGate=new Promise(resolve=>{releaseBack=resolve});
      try{
        await page.goBack();await visible(page,'Người dùng và vai trò');await page.locator('.table-shell[aria-busy="true"]').waitFor();
        const pendingRange=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
        assert(pendingRange<saved,`The pending list scroll range (${pendingRange}) must be below the saved offset (${saved}).`);
        await page.getByRole('link',{name:'Audit Log',exact:true}).click();await page.getByRole('table').locator('tbody tr:not([aria-hidden])').first().waitFor();await frames();
        const auditRange=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
        assert(auditRange>saved,`The audit scroll range (${auditRange}) must exceed the saved offset (${saved}).`);
        assert.equal(await page.evaluate(()=>scrollY),0);state.userReadGate=null;releaseBack();await frames();assert.equal(await page.evaluate(()=>scrollY),0);
        await page.getByRole('link',{name:'Người dùng & vai trò',exact:true}).click();await page.getByRole('table').getByText('person1@example.test',{exact:true}).waitFor();
        await page.setViewportSize({width:1440,height:1600});
        state.userReadGate=new Promise(resolve=>{releaseQuery=resolve});await page.getByLabel('Số dòng mỗi trang').selectOption('10');
        await page.locator('.table-shell[aria-busy="true"]').waitFor();
        assert(await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight)<=2,'The pending query must leave no room for automatic table alignment yet.');
        await page.evaluate(()=>{window.__navScrollWheelReceived=new Promise(resolve=>window.addEventListener('wheel',()=>resolve(),{once:true}))});
        await page.mouse.move(700,500);await page.mouse.wheel(0,400);await page.evaluate(()=>window.__navScrollWheelReceived);await frames();
        // A wheel on a page with no scroll range can remain in the compositor after its DOM event.
        // Let input settle before adding tall rows; otherwise native wheel motion is mistaken for app restoration.
        await page.evaluate(()=>new Promise(resolve=>{
          let lastMovement=performance.now();const moved=()=>{lastMovement=performance.now()};
          window.addEventListener('scroll',moved,{passive:true});
          const check=()=>{if(performance.now()-lastMovement>=450){window.removeEventListener('scroll',moved);resolve()}else requestAnimationFrame(check)};
          requestAnimationFrame(check);
        }));
        const manualOffset=await page.evaluate(()=>scrollY);assert(manualOffset<=2,'The compact loading outline should leave the wheel gesture at the top.');
        state.userReadGate=null;releaseQuery();await page.getByRole('table').getByText('person1@example.test',{exact:true}).waitFor();await frames();
        assert(await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight)>manualOffset+200,'Loaded rows must have room for an unwanted automatic alignment.');
        assert(Math.abs(await page.evaluate(()=>scrollY)-manualOffset)<=2,'Late query rows must not override the user wheel gesture.');assert.equal(await page.getByLabel('Số dòng mỗi trang').inputValue(),'10');
      }finally{state.userReadGate=null;releaseBack?.();releaseQuery?.()}
    },{auditItems:true,userOverrides:Object.fromEntries(users.map(user=>[user.id,{displayName:'Tên người dùng dài phục vụ kiểm tra cuộn '.repeat(20)}]))}));
    await test(browser,'NAV-21 lost request response stays locked across close and reopen, and inspection only reads',()=>withFixture(browser,'USER',async({page,state,mutations,calls})=>{
      await page.goto(origin+'/requests/new');let form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});
      await form.locator('textarea').fill('NAV21 private-note-sentinel');await form.getByRole('button',{name:'Gửi yêu cầu'}).click();
      const notice=page.getByRole('region',{name:'Kết quả thao tác chưa rõ'});await notice.waitFor();assert.equal(await form.getByRole('button',{name:'Gửi yêu cầu'}).isDisabled(),true);assert.equal(mutations.length,1);
      assert.equal(await page.locator('.toast').count(),0);assert.equal(await form.locator('textarea').inputValue(),'NAV21 private-note-sentinel');
      await form.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();await visible(page,'Yêu cầu của tôi');await notice.waitFor();
      await page.getByRole('button',{name:'Tạo yêu cầu',exact:true}).first().click();form=page.getByRole('dialog');await notice.waitFor();assert.equal(await form.getByRole('button',{name:'Gửi yêu cầu'}).isDisabled(),true);
      const before=calls.length;await notice.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await notice.getByText(/chưa xác định được ID/).waitFor();assert.equal(mutations.length,1);assert(calls.slice(before).every(call=>call.startsWith('GET ')));
      await notice.getByText('Kết quả lần gửi trước vẫn chưa được xác nhận.',{exact:true}).waitFor();assert.equal(await notice.getByRole('button',{name:'Kết thúc đối chiếu'}).isDisabled(),true);
      await notice.getByRole('checkbox').check();await notice.getByRole('button',{name:'Kết thúc đối chiếu'}).click();await notice.waitFor({state:'hidden'});assert.equal(await form.getByRole('button',{name:'Gửi yêu cầu'}).isDisabled(),false);assert.equal(mutations.length,1);
      const stored=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));assert(!stored.includes('private-note-sentinel'));assert(!page.url().includes('private-note-sentinel'));
    },{lostResponse:'/requests'}));
    await test(browser,'NAV-21 failed GET inspection retains the unknown lock and never resends the decision',()=>withFixture(browser,'APPROVER',async({page,state,mutations,calls})=>{
      await page.goto(origin+'/requests/request-1');await page.getByRole('button',{name:'Phê duyệt',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Xác nhận phê duyệt'}).click();
      const notice=page.getByRole('region',{name:'Kết quả thao tác chưa rõ'});await notice.waitFor();state.requestDetailFail=true;
      await notice.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await notice.getByRole('alert').filter({hasText:'Chi tiết tạm thời'}).waitFor();assert.equal(await notice.getByRole('button',{name:'Kết thúc đối chiếu'}).count(),0);assert.equal(mutations.length,1);
      state.requestDetailFail=false;await notice.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await notice.getByText(/Dữ liệu hiện tại: Đã duyệt/).waitFor();
      assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Xác nhận phê duyệt'}).isDisabled(),true);assert.equal(mutations.length,1);assert(calls.filter(call=>call==='GET /requests/request-1').length>=3);
    },{lostResponse:'/requests/request-1/decision'}));
    await test(browser,'NAV-21 pending request survives route discard and a late acknowledgment refreshes without redirect',()=>withFixture(browser,'USER',async({page,state,mutations,calls})=>{
      let release;state.mutationGate=new Promise(resolve=>release=resolve);
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});await form.locator('textarea').fill('Đang gửi rồi chuyển trang');await form.getByRole('button',{name:'Gửi yêu cầu'}).click();
      await form.getByRole('status').filter({hasText:'đang chờ máy chủ'}).waitFor();assert.equal(await form.locator('textarea').isDisabled(),true);
      await form.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();await visible(page,'Yêu cầu của tôi');await page.getByRole('status').filter({hasText:'đang chờ máy chủ'}).waitFor();
      const before=calls.filter(call=>call.startsWith('GET /requests?')).length;release();await page.getByRole('status').filter({hasText:'Yêu cầu đã được gửi để phê duyệt.'}).waitFor();await page.locator('.request-item').filter({hasText:'fixture-created'}).waitFor();
      assert.equal(new URL(page.url()).pathname,'/requests');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(mutations.length,1);assert(calls.filter(call=>call.startsWith('GET /requests?')).length>before);
    }));
    await test(browser,'NAV-21 old decision completion cannot close a newly opened decision dialog',()=>withFixture(browser,'APPROVER',async({page,state,mutations})=>{
      let release;state.mutationGate=new Promise(resolve=>release=resolve);
      await page.goto(origin+'/requests/request-1');await page.getByRole('button',{name:'Phê duyệt',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Xác nhận phê duyệt'}).click();await page.getByRole('dialog').locator('.mutation-notice[role="status"]').waitFor();
      await page.getByRole('dialog').getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('button',{name:'Về danh sách',exact:true}).last().click();await visible(page,'Hàng chờ cần quyết định');await page.getByRole('button',{name:'request-7',exact:true}).click();await page.getByRole('button',{name:'Từ chối',exact:true}).click();
      const fresh=page.getByRole('dialog');await fresh.locator('textarea').fill('Ghi chú mới vẫn được giữ');release();await page.getByRole('status').filter({hasText:'Quyết định đã được ghi nhận.'}).waitFor();
      assert.equal(await fresh.count(),1);assert.equal(await fresh.locator('textarea').inputValue(),'Ghi chú mới vẫn được giữ');assert.equal(new URL(page.url()).pathname,'/requests/request-7');assert.equal(mutations.length,1);
    }));
    await test(browser,'NAV-21 lost create-user response reads exact email and preserves lock after reopen',()=>withFixture(browser,'ADMIN',async({page,mutations,calls})=>{
      await page.goto(origin+'/users');await page.getByRole('button',{name:'Thêm người dùng'}).click();let form=page.getByRole('dialog');await form.locator('input').nth(0).fill('Tài khoản mất phản hồi');await form.locator('input').nth(1).fill('lost-user@example.test');await form.getByRole('button',{name:'Tạo tài khoản'}).click();
      const notice=page.getByRole('region',{name:'Kết quả thao tác chưa rõ'});await notice.waitFor();assert.equal(await form.getByRole('button',{name:'Tạo tài khoản'}).isDisabled(),true);await notice.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await notice.getByText(/Dữ liệu hiện tại: lost-user@example.test/).waitFor();assert(calls.some(call=>call.startsWith('GET /users?')&&call.includes('email=lost-user%40example.test')));
      await form.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();await notice.waitFor();await page.getByRole('button',{name:'Thêm người dùng'}).click();form=page.getByRole('dialog');await notice.waitFor();assert.equal(await form.getByRole('button',{name:'Tạo tài khoản'}).isDisabled(),true);assert.equal(mutations.length,1);
    },{lostResponse:'/users'}));
    await test(browser,'NAV-21 old create-user completion cannot close a new form or replace its fields',()=>withFixture(browser,'ADMIN',async({page,state,mutations})=>{
      let release;state.mutationGate=new Promise(resolve=>release=resolve);
      await page.goto(origin+'/users');await page.getByRole('button',{name:'Thêm người dùng'}).click();let form=page.getByRole('dialog');await form.locator('input').nth(0).fill('Tài khoản đang gửi');await form.locator('input').nth(1).fill('pending-user@example.test');await form.getByRole('button',{name:'Tạo tài khoản'}).click();await form.locator('.mutation-notice[role="status"]').waitFor();
      await form.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();await page.getByRole('button',{name:'Thêm người dùng'}).click();form=page.getByRole('dialog');await form.locator('.mutation-notice[role="status"]').waitFor();assert.equal(await form.locator('input').first().isDisabled(),true);
      release();await page.getByRole('status').filter({hasText:'Đã tạo tài khoản.'}).waitFor();assert.equal(await form.count(),1);assert.equal(await form.locator('input').first().inputValue(),'');assert.equal(mutations.length,1);
    }));
    for(const kind of ['policy','access','status','notification','email'])await test(browser,`NAV-21 ${kind} unknown outcome locks the matching write and exposes read-only inspection`,()=>withFixture(browser,kind==='notification'?'USER':'ADMIN',async({page,state,mutations,calls})=>{
      let writeButton;
      if(kind==='policy'){await page.goto(origin+'/policies');await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).click();const form=page.getByRole('form',{name:'Tạo phiên bản chính sách'});await form.locator('input[type=number]').first().fill('366');await form.getByRole('checkbox').check();writeButton=form.getByRole('button',{name:'Phát hành phiên bản'});state.lostResponse='/policies/policy-1/versions'}
      else if(kind==='access'){await page.goto(origin+'/users/access');await page.getByRole('button',{name:'Sau',exact:true}).click();await page.getByLabel('Người dùng',{exact:true}).selectOption('person-30');await page.getByLabel('Vai trò',{exact:true}).selectOption('ADMIN');await page.getByRole('checkbox').check();writeButton=page.getByRole('button',{name:'Lưu quyền truy cập'});state.lostResponse='/users/person-30/access'}
      else if(kind==='status'){await page.goto(origin+'/users?page=2');writeButton=page.getByRole('row').filter({hasText:'person26@example.test'}).getByRole('button',{name:/^(Vô hiệu hóa|Kích hoạt)$/});state.lostResponse='/users/person-26/status'}
      else if(kind==='notification'){await page.goto(origin+'/notifications?page=2');writeButton=page.locator('#notifications .section-heading').getByRole('button',{name:'Đánh dấu đã đọc',exact:true});state.lostResponse='/notifications/read-all'}
      else{await page.goto(origin+'/operations/email');await page.getByRole('button',{name:'Gửi thử',exact:true}).click();await page.getByRole('dialog').getByRole('textbox',{name:/Email nhận/}).fill('recipient@example.test');writeButton=page.getByRole('button',{name:'Gửi email thử',exact:true});state.lostResponse='/notifications/test-email'}
      await writeButton.click();const notice=page.getByRole('region',{name:'Kết quả thao tác chưa rõ'});await notice.waitFor();assert.equal(mutations.length,1);assert.equal(await page.locator('.toast').filter({hasText:/Đã cập nhật|Đã phát hành|xác nhận gửi/}).count(),0);
      const before=calls.length;await notice.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await notice.getByText('Kết quả lần gửi trước vẫn chưa được xác nhận.',{exact:true}).waitFor();assert(calls.slice(before).every(call=>call.startsWith('GET ')));assert.equal(mutations.length,1);
      if(['status','access'].includes(kind))assert(calls.some(call=>call.startsWith('GET /users?')&&call.includes('userId=person-')));
      if(kind==='notification'){await page.locator('#notifications').getByRole('button',{name:'Đánh dấu đã đọc',exact:true}).waitFor();assert.equal(await page.locator('#notifications .section-heading').getByRole('button',{name:'Đánh dấu đã đọc',exact:true}).isDisabled(),true)}
      else assert.equal(await writeButton.isDisabled(),true);
      await page.screenshot({path:path.join(output,`mutation-unknown-${kind}.png`),fullPage:true});
    },{notificationItems:kind==='notification',emailEnabled:kind==='email'}));
    for(const failure of ['invalidAcknowledgment','mutationOutage'])await test(browser,`NAV-21 ${failure} cannot be mistaken for successful submission`,()=>withFixture(browser,'USER',async({page,mutations})=>{
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});await form.locator('textarea').fill('Không báo thành công khi phản hồi lỗi');await form.getByRole('button',{name:'Gửi yêu cầu'}).click();
      await page.getByRole('region',{name:'Kết quả thao tác chưa rõ'}).waitFor();assert.equal(await form.getByRole('button',{name:'Gửi yêu cầu'}).isDisabled(),true);assert.equal(await page.locator('.toast').count(),0);assert.equal(mutations.length,1);
    },{[failure]:'/requests'}));
    await test(browser,'NAV-21 logout clears unknown outcome and a different account starts without metadata',()=>withFixture(browser,'USER',async({page,state,mutations})=>{
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});await form.locator('textarea').fill('Chỉ thuộc phiên cũ');await form.getByRole('button',{name:'Gửi yêu cầu'}).click();await page.getByRole('region',{name:'Kết quả thao tác chưa rõ'}).waitFor();
      await form.getByRole('button',{name:'Đóng',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();await visible(page,'Yêu cầu của tôi');await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.locator('.login-card').waitFor();state.loginUser={id:'new-user',displayName:'Phiên mới'};state.lostResponse='';await login(page);await visible(page,'Yêu cầu của tôi');await page.getByRole('button',{name:'Tạo yêu cầu',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('region',{name:'Kết quả thao tác chưa rõ'}).count(),0);assert.equal(await page.getByRole('dialog').locator('textarea').inputValue(),'');assert.equal(mutations.filter(item=>item.endpoint==='/requests').length,1);
    },{lostResponse:'/requests'}));
    await test(browser,'Bell and read actions update the total unread count beyond the current notification page',()=>withFixture(browser,'USER',async({page,mutations,calls})=>{
      await page.goto(origin+'/dashboard');await page.getByRole('button',{name:'15 thông báo chưa đọc',exact:true}).click();await visible(page,'Thông báo');await page.getByRole('button',{name:'Sau',exact:true}).click();await page.locator('#notifications .activity-list article').nth(4).waitFor();
      await page.locator('#notifications .activity-list article').first().getByRole('button',{name:'Đánh dấu đã đọc',exact:true}).click();await page.getByRole('button',{name:'14 thông báo chưa đọc',exact:true}).waitFor();assert.equal(await page.locator('.activity-unread').count(),4);assert.equal(new URL(page.url()).searchParams.get('page'),'2');
      await page.locator('#notifications .section-heading').getByRole('button',{name:'Đánh dấu đã đọc',exact:true}).click();await page.locator('.topbar').getByRole('button',{name:'Thông báo',exact:true}).waitFor();assert.equal(await page.locator('.activity-unread').count(),0);
      assert.deepEqual(mutations.map(item=>item.endpoint),['/notifications/notification-11/read','/notifications/read-all']);assert(calls.filter(call=>call.includes('read=false')&&call.includes('pageSize=1')).length>=3);
    },{notificationItems:true}));
    await test(browser,'Automatic compatible policy selection does not make a pristine request dirty',()=>withFixture(browser,'USER',async({page,mutations})=>{
      await page.goto(origin+'/requests/new');await page.waitForFunction(()=>document.querySelector('[role=dialog] select')?.value==='KEY'&&document.querySelectorAll('[role=dialog] select')[1]?.value==='version-1');
      assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}),false);
      await page.getByRole('dialog').getByRole('button',{name:'Hủy',exact:true}).click();await visible(page,'Yêu cầu của tôi');assert.equal(await page.getByRole('alertdialog').count(),0);assert.equal(mutations.length,0);
    },{certificateFirst:true}));
    await test(browser, 'Certificate form preserves a draft when there is no compatible policy', () => withFixture(browser, 'USER', async ({ page, mutations }) => {
      await page.goto(origin + '/requests/new');
      const dialog = page.getByRole('dialog');
      const type = dialog.getByRole('combobox', { name: /Loại tài sản/ });
      const picker = dialog.getByLabel('Chính sách', { exact: true });
      const reason = dialog.getByLabel('Lý do nghiệp vụ');
      await picker.selectOption('version-1');
      await reason.fill('Giữ lý do khi đổi loại tài sản');
      await type.selectOption('CERTIFICATE');
      await dialog.getByRole('status').filter({ hasText: 'Chưa có chính sách phù hợp để cấp mới tài sản này.' }).waitFor();
      assert.ok(await picker.isDisabled());
      assert.ok(await dialog.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).isDisabled());
      assert.ok(await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).isEnabled());
      assert.equal(await reason.inputValue(), 'Giữ lý do khi đổi loại tài sản');
      await type.selectOption('KEY');
      await picker.selectOption('version-1');
      assert.ok(await dialog.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).isEnabled());
      assert.equal(mutations.length, 0);
    }));
    await test(browser,'Create-user Back and local close preserve input until discard is confirmed',()=>withFixture(browser,'ADMIN',async({page,mutations})=>{
      await page.goto(origin+'/dashboard');await page.getByRole('link',{name:'Người dùng & vai trò',exact:true}).click();await page.getByRole('button',{name:'Thêm người dùng'}).click();const form=page.getByRole('dialog');await form.locator('input').first().fill('Giữ tên chưa tạo');
      await page.goBack();await page.getByRole('alertdialog').getByRole('button',{name:'Ở lại',exact:true}).click();assert.equal(new URL(page.url()).pathname,'/users');assert.equal(await form.locator('input').first().inputValue(),'Giữ tên chưa tạo');
      await form.getByRole('button',{name:'Hủy',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Ở lại',exact:true}).click();assert.equal(await form.locator('input').first().inputValue(),'Giữ tên chưa tạo');
      await page.goBack();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();await visible(page,'Sức khỏe tài sản mật mã');await form.waitFor({state:'hidden'});assert.equal(mutations.length,0);
    }));
    await test(browser,'Admin warning cards open lists filtered to the status displayed by each card',()=>withFixture(browser,'ADMIN',async({page,calls})=>{
      await page.goto(origin+'/dashboard');await page.getByRole('button',{name:/Tài sản đã hết hạn/}).waitFor();await page.screenshot({path:path.join(output,'admin-warning-links-light.png'),fullPage:true});await page.getByRole('button',{name:'Chuyển sang giao diện tối'}).click();await page.screenshot({path:path.join(output,'admin-warning-links-dark.png'),fullPage:true});
      await page.getByRole('button',{name:/Tài sản đã hết hạn/}).click();await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('status'),'EXPIRED');assert.equal(await page.locator('.admin-asset-controls select').inputValue(),'EXPIRED');
      await page.getByRole('link',{name:'Tổng quan',exact:true}).click();await page.getByRole('button',{name:/Tài sản sắp hết hạn/}).click();await page.getByText('Không có tài sản phù hợp',{exact:true}).first().waitFor();assert.equal(new URL(page.url()).searchParams.get('status'),'EXPIRING_SOON');
      assert(calls.some(call=>call.startsWith('GET /assets?')&&call.includes('status=EXPIRED')));assert(calls.some(call=>call.startsWith('GET /assets?')&&call.includes('status=EXPIRING_SOON')));
    }));
    await test(browser,'Urgent dashboard warning opens the emergency queue and keeps its filter across history',()=>withFixture(browser,'APPROVER',async({page,calls})=>{
      await page.goto(origin+'/dashboard');await page.getByRole('link',{name:'Xem hàng chờ khẩn cấp'}).waitFor();await page.screenshot({path:path.join(output,'approver-warning-link.png'),fullPage:true});await page.getByRole('link',{name:'Xem hàng chờ khẩn cấp'}).click();await page.getByRole('button',{name:'request-1',exact:true}).waitFor();const listUrl=page.url();assert.equal(new URL(listUrl).searchParams.get('emergency'),'1');assert.equal(await page.locator('.filter-tabs').getByRole('button',{name:/Khẩn cấp/}).getAttribute('aria-pressed'),'true');assert(calls.some(call=>call.includes('status=PENDING')&&call.includes('emergency=true')));
      await page.getByRole('button',{name:'request-1',exact:true}).click();await page.locator('.asset-detail-page').waitFor();await page.getByRole('button',{name:'Về danh sách',exact:true}).last().click();await page.getByRole('button',{name:'request-1',exact:true}).waitFor();assert.equal(page.url(),listUrl);
    }));
    await test(browser,'Owner expiry warning opens the personal filtered list',()=>withFixture(browser,'USER',async({page,calls})=>{
      await page.goto(origin+'/dashboard');await page.getByRole('link',{name:'Xem tài sản sắp hết hạn'}).waitFor();await page.screenshot({path:path.join(output,'user-warning-link.png'),fullPage:true});await page.getByRole('link',{name:'Xem tài sản sắp hết hạn'}).click();await page.getByRole('button',{name:'ASSET-0300',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('status'),'EXPIRING_SOON');assert(calls.some(call=>call.includes('status=EXPIRING_SOON')&&call.includes('ownedOnly=true')));
    },{priorityAsset:true}));
    await test(browser,'Notification permission failure stays on the current page and never marks the item read',()=>withFixture(browser,'USER',async({page,state,mutations,calls})=>{
      await page.goto(origin+'/notifications?page=2');await page.getByRole('button',{name:'Xem chi tiết',exact:true}).first().click();await page.locator('#notifications').getByRole('alert').filter({hasText:'Quyền xem tài sản'}).waitFor();assert.equal(new URL(page.url()).pathname,'/notifications');assert.equal(new URL(page.url()).searchParams.get('page'),'2');assert.equal(mutations.length,0);
      await page.getByRole('button',{name:'Chuyển sang giao diện tối'}).click();assert.equal(await page.locator('#notifications').getByRole('alert').count(),1);state.detailDenied='';await page.getByRole('button',{name:'Xem chi tiết',exact:true}).first().click();await visible(page,'Tài sản 300');await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();assert.equal(mutations.filter(mutation=>mutation.endpoint==='/notifications/notification-11/read').length,1);assert.equal(calls.filter(call=>call==='GET /assets/asset-300').length>=2,true);
    },{notificationItems:true,detailDenied:'asset-300'}));
    await test(browser,'Missing and unavailable notification targets give persistent errors without a read mutation',()=>withFixture(browser,'USER',async({page,state,mutations,calls})=>{
      await page.goto(origin+'/notifications?page=2');await page.getByRole('button',{name:'Xem chi tiết',exact:true}).first().click();await page.locator('#notifications').getByRole('alert').filter({hasText:'Không tìm thấy tài sản'}).waitFor();assert.equal(mutations.length,0);
      state.notificationMissing=false;
      state.notificationNoTarget=true;
      await page.reload();
      const beforeOpen=calls.length;
      await page.getByRole('button',{name:'Xem chi tiết',exact:true}).first().click();
      const alert=page.locator('#notifications').getByRole('alert');
      await alert.filter({hasText:'Không thể mở nội dung thông báo. Có thể quyền xem đã thay đổi.'}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('page'),'2');
      assert.equal(calls.slice(beforeOpen).some(call=>/^GET \/(?:assets|requests)\//.test(call)),false);
      assert.equal(mutations.length,0);
    },{notificationItems:true,notificationMissing:true}));
    await test(browser,'Access target switching asks before discarding role and scope edits',()=>withFixture(browser,'ADMIN',async({page,mutations})=>{
      await page.goto(origin+'/users/access');await page.getByLabel('Người dùng',{exact:true}).selectOption('person-1');await page.getByLabel('Vai trò',{exact:true}).selectOption('APPROVER');await page.getByRole('checkbox').first().check();
      await page.getByLabel('Người dùng',{exact:true}).selectOption('person-2');await page.getByRole('alertdialog').getByRole('button',{name:'Ở lại',exact:true}).click();assert.equal(await page.getByLabel('Người dùng',{exact:true}).inputValue(),'person-1');assert.equal(await page.getByLabel('Vai trò',{exact:true}).inputValue(),'APPROVER');assert.equal(await page.getByRole('checkbox').first().isChecked(),true);
      await page.getByLabel('Người dùng',{exact:true}).selectOption('person-2');await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();assert.equal(await page.getByLabel('Người dùng',{exact:true}).inputValue(),'person-2');assert.equal(await page.getByLabel('Vai trò',{exact:true}).inputValue(),'USER');assert.equal(mutations.length,0);
    }));
    await test(browser,'Policy switching and reopening protect the current draft',()=>withFixture(browser,'ADMIN',async({page,mutations})=>{
      await page.goto(origin+'/policies');await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).first().click();const form=page.getByRole('form',{name:'Tạo phiên bản chính sách'});await form.locator('input[type=number]').first().fill('366');
      await form.getByRole('button',{name:'Hủy',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Ở lại',exact:true}).click();assert.equal(await form.locator('input[type=number]').first().inputValue(),'366');
      await form.getByRole('button',{name:'Hủy',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();
      await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).last().click();await page.getByRole('heading',{name:'Tạo phiên bản · Chính sách thứ hai'}).waitFor();assert.equal(await form.locator('input[type=number]').first().inputValue(),'180');assert.equal(mutations.length,0);
    },{secondPolicy:true}));
    for(const kind of ['request','create-user','policy','access'])await test(browser,`${kind} dirty state protects native reload and tab close, resets on restored values and stores no draft`,()=>withFixture(browser,kind==='request'?'USER':'ADMIN',async({page,mutations})=>{
      const prevented=()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented});
      let field,original,dirtyValue;
      if(kind==='request'){await page.goto(origin+'/requests/new');await page.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});field=page.getByRole('dialog').locator('textarea');original='';dirtyValue='keep-value-sentinel';}
      else if(kind==='create-user'){await page.goto(origin+'/users');await page.getByRole('button',{name:'Thêm người dùng'}).click();await page.waitForFunction(()=>document.querySelector('[role=dialog] button.primary-button')?.disabled===false);field=page.getByRole('dialog').locator('input').first();original='';dirtyValue='keep-value-sentinel';}
      else if(kind==='policy'){await page.goto(origin+'/policies');await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).click();field=page.getByRole('form',{name:'Tạo phiên bản chính sách'}).locator('input[type=number]').first();original='365';dirtyValue='366';}
      else{await page.goto(origin+'/users/access');await page.getByLabel('Người dùng',{exact:true}).selectOption('person-1');field=page.getByLabel('Vai trò',{exact:true});original='USER';dirtyValue='APPROVER';}
      assert.equal(await prevented(),false);await field.click();kind==='access'?await field.selectOption(dirtyValue):await field.fill(dirtyValue);assert.equal(await prevented(),true);
      const dialogPromise=page.waitForEvent('dialog');const reload=page.reload().catch(error=>error);const dialog=await dialogPromise;assert.equal(dialog.type(),'beforeunload');await dialog.dismiss();await reload;assert.equal(await field.inputValue(),dirtyValue);
      const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert.equal(stored.includes('keep-value-sentinel'),false);assert.equal(page.url().includes('keep-value-sentinel'),false);
      kind==='access'?await field.selectOption(original):await field.fill(original);assert.equal(await prevented(),false);
      kind==='access'?await field.selectOption(dirtyValue):await field.fill(dirtyValue);
      const closePrompt = page.waitForEvent('dialog');
      await page.close({ runBeforeUnload: true });
      const cancelledClose = await closePrompt;
      assert.equal(cancelledClose.type(), 'beforeunload');
      await cancelledClose.dismiss();
      assert.equal(await field.inputValue(), dirtyValue);
      const discardPrompt = page.waitForEvent('dialog');
      const closed = page.waitForEvent('close');
      await page.close({ runBeforeUnload: true });
      const confirmedClose = await discardPrompt;
      assert.equal(confirmedClose.type(), 'beforeunload');
      await confirmedClose.accept();
      await closed;
      assert.equal(mutations.length, 0);
    }));
    await test(browser,'Asset pageSize survives details, F5, Back and Forward without stealing filter focus',()=>withFixture(browser,'USER',async({page,calls})=>{
      await page.goto(origin+'/assets?status=ACTIVE&pageSize=50&page=2');await page.getByRole('table').locator('tbody tr').nth(49).waitFor();
      const listUrl=page.url(),first=page.getByRole('table').locator('tbody .table-link').first();
      assert.equal(await page.getByLabel('Số dòng mỗi trang').inputValue(),'50');assert(calls.some(call=>call.startsWith('GET /assets?')&&call.includes('pageSize=50')&&call.includes('page=2')));
      await first.click();await page.locator('.asset-detail-page').waitFor();await page.getByRole('button',{name:'Về danh sách',exact:true}).last().click();await page.getByRole('table').locator('tbody tr').nth(49).waitFor();assert.equal(page.url(),listUrl);
      await page.reload();await page.getByRole('table').locator('tbody tr').nth(49).waitFor();assert.equal(page.url(),listUrl);
      const size=page.getByLabel('Số dòng mỗi trang');await size.focus();await size.selectOption('100');await page.getByRole('table').locator('tbody tr').nth(99).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('page'),null);assert.equal(new URL(page.url()).searchParams.get('status'),'ACTIVE');assert.equal(await size.evaluate(el=>el===document.activeElement),true);
      await page.waitForFunction(()=>{const top=document.querySelector('#admin-assets').getBoundingClientRect().top,header=document.querySelector('.topbar').getBoundingClientRect().bottom;return top>=header&&top<=header+20});
      await page.goBack();await page.getByRole('table').locator('tbody tr').nth(49).waitFor();assert.equal(page.url(),listUrl);
      await page.goForward();await page.getByRole('table').locator('tbody tr').nth(99).waitFor();assert.equal(await size.inputValue(),'100');
    }));
    await test(browser,'Malformed and conflicting URL query values are replaced before the list read',()=>withFixture(browser,'USER',async({page,calls})=>{
      await page.goto(origin+'/assets?page=2&page=3&pageSize=101&status=BAD&q=a&q=b&sort=fake');await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();
      assert.equal(new URL(page.url()).search,'');const reads=calls.filter(call=>call.startsWith('GET /assets?'));assert.equal(reads.length,1);
      const params=new URLSearchParams(reads[0].slice(reads[0].indexOf('?')));assert.equal(params.get('page'),'1');assert.equal(params.get('pageSize'),'25');assert.equal(params.has('search'),false);assert.equal(params.has('status'),false);
      await page.reload();await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();assert.equal(new URL(page.url()).search,'');
    }));
    await test(browser,'Approver history owns its status and pageSize while its parent queue hook is dormant',()=>withFixture(browser,'APPROVER',async({page,calls})=>{
      await page.goto(origin+'/approvals/history?status=COMPLETED&pageSize=25&page=2');await page.locator('.request-item').nth(24).waitFor();
      const listUrl=page.url();assert.equal(new URL(listUrl).searchParams.get('status'),'COMPLETED');assert.equal(await page.getByLabel('Số dòng mỗi trang').inputValue(),'25');
      assert(calls.some(call=>call.startsWith('GET /requests?')&&call.includes('status=COMPLETED')&&call.includes('pageSize=25')&&call.includes('page=2')&&call.includes('excludePending=true')));
      await page.locator('.request-item').first().click();await page.locator('.asset-detail-page').waitFor();await page.getByRole('button',{name:'Về danh sách',exact:true}).last().click();await page.locator('.request-item').nth(24).waitFor();assert.equal(page.url(),listUrl);
      await page.reload();await page.locator('.request-item').nth(24).waitFor();assert.equal(page.url(),listUrl);
    }));
    await test(browser,'Queue search controls retain identity and focus through pending, empty and read failure',()=>withFixture(browser,'APPROVER',async({page,state})=>{
      await page.goto(origin+'/approvals');await page.getByRole('button',{name:'request-1',exact:true}).waitFor();const input=page.locator('#approval-queue input');await input.evaluate(el=>el.dataset.testIdentity='queue-search');
      state.requestDelay=700;const started=new Promise(resolve=>{state.onRequest=params=>{if(params.get('search')==='absent-query')resolve()}});
      await input.fill('absent-query');await input.press('Enter');await started;await page.getByRole('status').filter({hasText:'Đang tải hàng chờ'}).waitFor();
      assert.equal(await input.evaluate(el=>el===document.activeElement),true);assert.equal(await input.getAttribute('data-test-identity'),'queue-search');
      await page.getByText('Không có yêu cầu phù hợp',{exact:true}).waitFor();assert.equal(await input.evaluate(el=>el===document.activeElement),true);
      state.requestDelay=0;state.requestFail=true;await input.fill('Yêu cầu');await input.press('Enter');await page.getByRole('alert').filter({hasText:'Hàng chờ tạm thời'}).waitFor();assert.equal(await input.getAttribute('data-test-identity'),'queue-search');assert.equal(await input.evaluate(el=>el===document.activeElement),true);await page.screenshot({path:path.join(output,'approver-query-error.png'),fullPage:true});
      state.requestFail=false;await page.getByRole('alert').getByRole('button',{name:'Thử lại'}).click();await page.getByRole('button',{name:'request-1',exact:true}).waitFor();assert.equal(await input.inputValue(),'Yêu cầu');
      await page.screenshot({path:path.join(output,'approver-query-recovery.png'),fullPage:true});
    }));
    await test(browser,'Admin contextual search preserves current filters and announces an explicit fallback destination',()=>withFixture(browser,'ADMIN',async({page,calls})=>{
      await page.goto(origin+'/users?status=ACTIVE&pageSize=10&page=2');await page.getByRole('table').getByText('person11@example.test',{exact:true}).waitFor();let search=page.locator('.global-search input');assert.equal(await search.getAttribute('aria-label'),'Tìm người dùng');
      await search.fill('person31@example.test');await search.press('Enter');await page.getByRole('table').getByText('person31@example.test',{exact:true}).waitFor();let url=new URL(page.url());assert.equal(url.pathname,'/users');assert.equal(url.searchParams.get('page'),null);assert.equal(url.searchParams.get('pageSize'),'10');assert.equal(url.searchParams.get('status'),'ACTIVE');assert.equal(url.searchParams.get('q'),'person31@example.test');
      await page.getByRole('link',{name:/Tài sản toàn hệ thống/}).click();await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();search=page.locator('.global-search input');assert.equal(await search.getAttribute('aria-label'),'Tìm tài sản');await search.fill('ASSET-0300');await search.press('Enter');await page.getByRole('button',{name:'ASSET-0300',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/assets');
      await page.getByRole('link',{name:'Chính sách',exact:true}).click();await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).waitFor();search=page.locator('.global-search input');assert.equal(await search.getAttribute('aria-label'),'Tìm Audit Log');await search.fill('AUTH_LOGIN');await search.press('Enter');await page.getByText('Không tìm thấy nhật ký',{exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/audit');assert(calls.some(call=>call.startsWith('GET /audit-logs?')&&call.includes('search=AUTH_LOGIN')));
    }));
    await test(browser,'User request search targets requests and does not fetch assets',()=>withFixture(browser,'USER',async({page,calls})=>{
      await page.goto(origin+'/requests?status=COMPLETED&pageSize=25&page=2');await page.locator('.request-item').nth(24).waitFor();const assetReads=calls.filter(call=>call.startsWith('GET /assets')).length;
      const input=page.locator('.global-search input');assert.equal(await input.getAttribute('aria-label'),'Tìm yêu cầu');await input.fill('Yêu cầu kiểm thử 74');await input.press('Enter');await page.locator('.request-item').filter({hasText:'request-74'}).waitFor();
      const params=new URL(page.url()).searchParams;assert.equal(params.get('page'),null);assert.equal(params.get('pageSize'),'25');assert.equal(params.get('status'),'COMPLETED');assert.equal(calls.filter(call=>call.startsWith('GET /assets')).length,assetReads);
      await input.fill('không-khớp-yêu-cầu');await input.press('Enter');
      await page.locator('#requests').getByRole('status').filter({hasText:'Không có kết quả yêu cầu.'}).waitFor();
      assert.equal(calls.filter(call=>call.startsWith('GET /assets')).length,assetReads);
    }));
    await test(browser,'Approver history search preserves its non-pending scope',()=>withFixture(browser,'APPROVER',async({page,calls})=>{
      await page.goto(origin+'/approvals/history?status=COMPLETED&pageSize=25&page=2');await page.locator('.request-item').nth(24).waitFor();const input=page.locator('.global-search input');assert.equal(await input.getAttribute('aria-label'),'Tìm lịch sử xử lý');await input.fill('Yêu cầu kiểm thử 74');await input.press('Enter');await page.locator('.request-item').filter({hasText:'request-74'}).waitFor();
      assert.equal(new URL(page.url()).pathname,'/approvals/history');assert.equal(new URL(page.url()).searchParams.get('status'),'COMPLETED');assert(calls.some(call=>call.includes('search=Y%C3%AAu')&&call.includes('excludePending=true')));
    }));
    await test(browser,'User status mutation replaces an out-of-range page while preserving its filter and pageSize',()=>withFixture(browser,'ADMIN',async({page,mutations})=>{
      await page.goto(origin+'/users?status=ACTIVE&pageSize=10&page=3');await page.getByRole('table').getByText('person21@example.test',{exact:true}).waitFor();await page.getByRole('button',{name:'Sau',exact:true}).click();await page.getByRole('table').getByText('person31@example.test',{exact:true}).waitFor();
      await page.getByRole('table').getByRole('button',{name:'Vô hiệu hóa',exact:true}).click();await page.getByRole('table').getByText('person21@example.test',{exact:true}).waitFor();let params=new URL(page.url()).searchParams;assert.equal(params.get('page'),'3');assert.equal(params.get('status'),'ACTIVE');assert.equal(params.get('pageSize'),'10');assert.equal(mutations.length,1);assert.equal(mutations[0].endpoint,'/users/person-31/status');
      await page.goBack();await page.goForward();await page.getByRole('table').getByText('person21@example.test',{exact:true}).waitFor();params=new URL(page.url()).searchParams;assert.equal(params.get('page'),'3');assert.equal(mutations.length,1);
    },{userCount:31}));
    for(const [role,route,endpoint,title] of [['USER','/notifications','/notifications','Chưa có thông báo'],['ADMIN','/audit','/audit-logs','Không tìm thấy nhật ký'],['ADMIN','/operations/email','/notifications/delivery-issues','Không có email cần xử lý']])await test(browser,`${route} applies pageSize even with a verified empty result`,()=>withFixture(browser,role,async({page,calls})=>{
      await page.goto(origin+route+'?pageSize=50');await page.getByText(title,{exact:true}).waitFor();assert.equal(await page.getByLabel('Số dòng mỗi trang').inputValue(),'50');assert(calls.some(call=>call.startsWith('GET '+endpoint+'?')&&call.includes('pageSize=50')));
      if(route==='/notifications')await page.locator('#notifications').getByRole('status').filter({hasText:'Danh sách thông báo trống.'}).waitFor();
      await page.getByLabel('Số dòng mỗi trang').selectOption('20');await page.waitForFunction(()=>new URL(location.href).searchParams.get('pageSize')==='20'||new URL(location.href).searchParams.get('pageSize')===null);await page.getByText(title,{exact:true}).waitFor();assert(calls.some(call=>call.startsWith('GET '+endpoint+'?')&&call.includes('pageSize=20')));
    }));
    await test(browser,'Personal projections remain owner/creator scoped with multiple granted roles',()=>withFixture(browser,'USER',async({page,calls})=>{
      await page.goto(origin+'/assets');
      await page.getByRole('button',{name:'Vai trò hiện tại: Người phê duyệt'}).click();
      await page.getByRole('menuitemradio',{name:/Nhân viên/}).click();
      await page.getByRole('button',{name:'Vai trò hiện tại: Nhân viên'}).waitFor();
      await page.getByRole('link',{name:/^Tài sản của tôi/}).click();
      await visible(page,'Tài sản của tôi');
      await page.getByRole('button',{name:'ASSET-0020',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'ASSET-0021',exact:true}).count(),0);assert(calls.some(call=>call.startsWith('GET /assets?')&&call.includes('ownedOnly=true')));
      await page.getByRole('link',{name:/Yêu cầu/}).first().click();await visible(page,'Yêu cầu của tôi');await page.locator('.request-item').last().waitFor();
      assert.equal(await page.locator('.request-item').count(),5);assert(calls.some(call=>call.startsWith('GET /requests?')&&call.includes('createdByMe=true')));
      await page.getByRole('button',{name:'Tạo yêu cầu',exact:true}).click();await page.locator('.request-types label').filter({has:page.locator('input[value=RENEW]')}).click();
      await page.locator('#request-asset option').nth(1).waitFor({state:'attached'});assert(calls.some(call=>call.includes('eligible=true')&&call.includes('ownedOnly=true')));
    },{roles:['USER','APPROVER'],mixedOwners:true,mixedCreators:true}));
    await test(browser,'Admin plus USER remains read-only after selecting USER and cannot deep-link to creation',()=>withFixture(browser,'USER',async({page,mutations,calls})=>{
      await page.goto(origin+'/dashboard');await page.getByRole('button',{name:'Vai trò hiện tại: Quản trị bảo mật'}).click();await page.getByRole('menuitemradio',{name:/Nhân viên/}).click();await page.getByRole('button',{name:'Vai trò hiện tại: Nhân viên'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Tạo yêu cầu mới',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Tạo yêu cầu',exact:true}).count(),0);
      await page.goto(origin+'/assets/asset-300');await visible(page,'Tài sản 300');assert.equal(await page.getByRole('button',{name:/Yêu cầu gia hạn|^Thu hồi$/}).count(),0);
      const policyCalls=calls.filter(call=>call==='GET /policies').length;await page.goto(origin+'/requests/new');await visible(page,'Bạn không có quyền mở trang này');
      assert.equal(await page.getByRole('dialog').count(),0);assert.equal(calls.filter(call=>call==='GET /policies').length,policyCalls);assert.equal(mutations.length,0);
    },{roles:['USER','ADMIN']}));
    await test(browser,'Admin plus APPROVER cannot restore the queue or decision actions through display role',()=>withFixture(browser,'APPROVER',async({page,mutations})=>{
      await page.goto(origin+'/dashboard');await page.getByRole('button',{name:'Vai trò hiện tại: Quản trị bảo mật'}).click();await page.getByRole('menuitemradio',{name:/Người phê duyệt/}).click();
      await page.getByRole('status').filter({hasText:'chỉ xem số liệu'}).waitFor();assert.equal(await page.getByText('Mở Hàng chờ phê duyệt để kiểm tra và đưa ra quyết định.',{exact:true}).count(),0);
      await page.goto(origin+'/requests/request-1');await visible(page,'Yêu cầu kiểm thử 1');await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();assert.equal(await page.getByRole('button',{name:/^Phê duyệt$|^Từ chối$/}).count(),0);
      assert.equal(await page.getByRole('link',{name:/Hàng chờ phê duyệt/}).count(),0);await page.goto(origin+'/approvals');await visible(page,'Bạn không có quyền mở trang này');assert.equal(mutations.length,0);
    },{roles:['ADMIN','APPROVER']}));
    await test(browser,'Approver details conceal self-approval, outside-scope and unconfirmed-version actions',()=>withFixture(browser,'APPROVER',async({page,state,mutations})=>{
      for(const scenario of [{requestCreatorId:'session-APPROVER',requestDepartmentId:'department-1',requestVersion:7},{requestCreatorId:'other',requestDepartmentId:'outside',requestVersion:7},{requestCreatorId:'other',requestDepartmentId:'department-1',requestVersion:null}]){
        Object.assign(state,scenario);await page.goto(origin+'/requests/request-1');await visible(page,'Yêu cầu kiểm thử 1');await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();assert.equal(await page.getByRole('button',{name:/^Phê duyệt$|^Từ chối$/}).count(),0);
      }
      assert.equal(mutations.length,0);
    }));
    await test(browser,'Readable assets belonging to another owner never enable renewal or revocation',()=>withFixture(browser,'USER',async({page,mutations})=>{
      await page.goto(origin+'/assets/asset-300');await visible(page,'Tài sản 300');assert.equal(await page.getByRole('button',{name:/Yêu cầu gia hạn|^Thu hồi$/}).count(),0);
      await page.goto(origin+'/requests/new?type=RENEW&assetId=asset-300');const form=page.getByRole('dialog');await form.getByRole('alert').filter({hasText:'không thuộc quyền sở hữu'}).waitFor();
      await page.waitForFunction(()=>document.querySelector('#request-asset')?.value==='');assert.equal(await form.locator('#request-asset option[value="asset-300"]').count(),0);
      const reason='Không được gia hạn tài sản của người khác';await form.locator('textarea').fill(reason);assert.equal(await form.getByRole('button',{name:'Gửi yêu cầu'}).isDisabled(),true);
      await form.locator('form').evaluate(element=>element.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(mutations.length,0);
      assert.equal(await form.locator('textarea').inputValue(),reason);await form.getByRole('alert').filter({hasText:'không thuộc quyền sở hữu'}).waitFor();assert.equal(await form.locator('#request-asset').inputValue(),'');
    },{roles:['USER','APPROVER'],assetOwnerId:'another-owner'}));
    await test(browser,'Query change hides old asset rows and ignores the delayed response after Back',()=>withFixture(browser,'USER',async({page,state})=>{
      await page.goto(origin+'/assets');await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();state.assetDelay=700;
      const started=new Promise(resolve=>{state.onAssetRequest=number=>{if(number==='2')resolve()}});
      await page.getByRole('button',{name:'Sau',exact:true}).click();await started;await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor({state:'hidden'});assert.equal(await page.locator('.section-heading .filter-button').innerText(),'— mục');
      state.assetDelay=0;await page.goBack();await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();
      await page.waitForTimeout(800);assert.equal(await page.getByRole('button',{name:'ASSET-0026',exact:true}).count(),0);assert.equal(new URL(page.url()).search,'');
    }));
    await test(browser,'Request policy outage retains the reason and retry never submits a mutation',()=>withFixture(browser,'USER',async({page,state,calls,mutations})=>{
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('alert').filter({hasText:'Chính sách tạm thời'}).waitFor();await form.locator('textarea').fill('Giữ lý do khi chính sách chưa tải được');
      assert.equal(await form.getByRole('button',{name:'Gửi yêu cầu'}).isDisabled(),true);state.policyFail=false;await form.getByRole('alert').getByRole('button',{name:'Thử lại'}).click();
      await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});assert.equal(await form.locator('textarea').inputValue(),'Giữ lý do khi chính sách chưa tải được');assert.equal(mutations.length,0);
      assert.equal(calls.filter(call=>call==='GET /policies').length,2);assert.equal(calls.filter(call=>call.startsWith('GET /dashboard/summary')).length,1);
      await form.getByRole('button',{name:'Gửi yêu cầu'}).click();await visible(page,'Yêu cầu của tôi');assert.equal(mutations.length,1);
    },{policyFail:true}));
    await test(browser,'Create-user reference retry preserves input and refreshes only its reference source',()=>withFixture(browser,'ADMIN',async({page,state,calls,mutations})=>{
      await page.goto(origin+'/users');await page.getByRole('button',{name:'Thêm người dùng'}).click();const form=page.getByRole('dialog');await form.getByRole('alert').filter({hasText:'Danh mục phòng ban'}).waitFor();
      await form.locator('input').nth(0).fill('Giữ dữ liệu tài khoản mới');await form.locator('input').nth(1).fill('reference-retry@example.test');assert.equal(await form.getByRole('button',{name:'Tạo tài khoản'}).isDisabled(),true);
      state.referenceFail=false;await form.getByRole('alert').getByRole('button',{name:'Thử lại'}).click();await form.getByRole('button',{name:'Tạo tài khoản'}).waitFor();
      await page.waitForFunction(()=>document.querySelector('[role=dialog] button.primary-button')?.disabled===false);
      assert.equal(await form.locator('input').nth(1).inputValue(),'reference-retry@example.test');assert.equal(mutations.length,0);assert.equal(calls.filter(call=>call==='GET /users/reference-data').length,2);assert.equal(calls.filter(call=>call.startsWith('GET /dashboard/summary')).length,1);
      await form.getByRole('button',{name:'Tạo tài khoản'}).click();await form.waitFor({state:'hidden'});assert.equal(mutations[0].body.email,'reference-retry@example.test');
    },{referenceFail:true}));
    await test(browser,'An audit read failure leaves Users usable and does not fetch dashboard charts',()=>withFixture(browser,'ADMIN',async({page,calls})=>{
      await page.goto(origin+'/audit');await page.getByRole('alert').filter({hasText:'Audit Log tạm thời'}).waitFor();await page.getByRole('link',{name:'Người dùng & vai trò',exact:true}).click();await page.getByRole('table').getByText('person1@example.test',{exact:true}).waitFor();
      assert.equal(await page.getByRole('alert').count(),0);assert.equal(calls.filter(call=>call.startsWith('GET /dashboard?')).length,0);assert.equal(calls.filter(call=>call.startsWith('GET /dashboard/summary')).length,1);
    },{auditFail:true}));
    await test(browser,'Multi-role dashboard requests the granted display role instead of dominant-role data',()=>withFixture(browser,'ADMIN',async({page,calls})=>{
      await page.goto(origin+'/dashboard');await page.locator('.metric-row').getByText('990',{exact:true}).waitFor();await page.getByRole('button',{name:'Vai trò hiện tại: Quản trị bảo mật'}).click();await page.getByRole('menuitemradio',{name:/Nhân viên/}).click();
      await page.locator('.metric-featured strong').getByText('317',{exact:true}).waitFor();assert(calls.includes('GET /dashboard?role=USER'));assert(calls.includes('GET /dashboard/summary?role=USER'));assert.equal(await page.locator('.metric-row').getByText('990',{exact:true}).count(),0);
    },{roles:['ADMIN','USER'],ownerTotal:317,adminTotal:990}));
    await test(browser,'Verified empty policies are distinct from loading and error',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/policies');await page.getByText('Chưa có chính sách',{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Tạo chính sách',exact:true}).isEnabled(),true);
    },{emptyPolicies:true}));
    await test(browser,'Malformed escaped detail ID from client history is recoverable and does not crash the shell',()=>withFixture(browser,'USER',async({page,calls})=>{
      await page.goto(origin+'/dashboard');await page.locator('.metric-featured').waitFor();
      // The preview server rejects malformed percent encodings before serving HTML.
      // This case intentionally exercises the client history/parser, not server fallback.
      await page.evaluate(()=>{const previous=window.history.state??{idx:0};window.history.pushState({...previous,idx:(previous.idx??0)+1},'','/assets/%E0%A4');window.dispatchEvent(new PopStateEvent('popstate',{state:window.history.state}))});
      await page.getByRole('alert').filter({hasText:'Không thể tải dữ liệu'}).waitFor();await page.getByRole('button',{name:'Đăng xuất',exact:true}).waitFor();
      assert.equal(calls.filter(call=>call.startsWith('GET /assets/')).length,0);await page.getByRole('button',{name:'Về danh sách',exact:true}).click();await visible(page,'Tài sản của tôi');
    }));
    await test(browser,'Owner dashboard uses all aggregates and opens a priority asset outside the legacy 250 limit',()=>withFixture(browser,'USER',async({page,calls})=>{
      await page.goto(origin+'/dashboard');await page.locator('.metric-featured strong').getByText('320',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Yêu cầu gia hạn',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#request-asset')?.selectedOptions[0]?.textContent?.includes('ASSET-0300'));
      assert(calls.includes('GET /dashboard?role=USER'));assert(calls.includes('GET /dashboard/summary?role=USER'));assert(!calls.includes('GET /assets'));
      assert.equal(new URL(page.url()).search,'?type=RENEW&assetId=asset-300');
    },{priorityAsset:true}));
    await test(browser,'A loaded dashboard remains usable while shell counters and unread are still pending',()=>withFixture(browser,'USER',async({page})=>{
      await page.goto(origin+'/dashboard');await page.locator('.metric-featured strong').getByText('320',{exact:true}).waitFor();
      assert.equal(await page.locator('.resource-region[aria-label="Tổng quan"]').getAttribute('aria-busy'),'false');
      assert.equal(await page.getByRole('link',{name:/Tài sản của tôi/}).locator('.nav-count').innerText(),'—');
      await page.locator('.route-sync-status').getByText('Đang cập nhật chỉ số điều hướng…').waitFor();
      await page.getByRole('link',{name:/Tài sản của tôi/}).locator('.nav-count').getByText('320',{exact:true}).waitFor();
      await page.screenshot({path:path.join(output,'user-resource-dashboard.png'),fullPage:true});
    },{dashboardDelay:300,summaryDelay:1600,notificationDelay:2200}));
    await test(browser,'Page network reads stay with their owner and shell reads survive normal navigation',()=>withFixture(browser,'ADMIN',async({page,calls})=>{
      await page.goto(origin+'/users');await page.getByRole('table').getByText('person1@example.test',{exact:true}).waitFor();
      await page.getByRole('link',{name:'Chính sách',exact:true}).click();await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).waitFor();
      await page.getByRole('link',{name:/Tài sản toàn hệ thống/}).click();await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();
      await page.getByRole('link',{name:'Audit Log',exact:true}).click();await page.getByText('Không tìm thấy nhật ký',{exact:true}).waitFor();
      await page.getByRole('link',{name:'Người dùng & vai trò',exact:true}).click();await page.getByRole('table').getByText('person1@example.test',{exact:true}).waitFor();
      assert.equal(calls.filter(call=>call.startsWith('GET /dashboard/summary')).length,1);assert.equal(calls.filter(call=>call.includes('read=false')).length,1);
      assert.equal(calls.filter(call=>call.startsWith('GET /dashboard?')).length,0);assert.equal(calls.filter(call=>call==='GET /policies/admin').length,1);assert.equal(calls.filter(call=>call.startsWith('GET /assets?')).length,1);
      assert.equal(calls.filter(call=>call.startsWith('GET /users?')).length,2);
    }));
    await test(browser,'Policy initial failure never appears as empty and retry only reloads policies',()=>withFixture(browser,'ADMIN',async({page,state,calls})=>{
      await page.goto(origin+'/policies');await page.getByRole('alert').filter({hasText:'Chính sách tạm thời'}).waitFor();
      assert.equal(await page.getByText('Chưa có chính sách',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).count(),0);
      state.policyFail=false;await page.getByRole('alert').getByRole('button',{name:'Thử lại'}).click();await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).waitFor();
      assert.equal(calls.filter(call=>call==='GET /policies/admin').length,2);assert.equal(calls.filter(call=>call.startsWith('GET /dashboard/summary')).length,1);assert.equal(calls.filter(call=>call.includes('read=false')).length,1);
    },{policyFail:true}));
    await test(browser,'Policy refetch preserves dirty fields on outage and drops them on 403',()=>withFixture(browser,'ADMIN',async({page,state,calls})=>{
      await page.goto(origin+'/policies');await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).click();const form=page.getByRole('form',{name:'Tạo phiên bản chính sách'});await form.locator('input[type=number]').first().fill('366');
      state.policyFail=true;await page.getByRole('button',{name:'Làm mới chính sách'}).dispatchEvent('click');await page.getByRole('alert').filter({hasText:'Đang hiển thị dữ liệu lần tải trước'}).waitFor();
      assert.equal(await form.locator('input[type=number]').first().inputValue(),'366');assert.equal(await form.getByRole('button',{name:'Phát hành phiên bản'}).isDisabled(),true);
      state.policyFail=false;state.policyDenied=true;await page.getByRole('alert').getByRole('button',{name:'Thử lại'}).dispatchEvent('click');await page.getByRole('alert').filter({hasText:'Quyền xem chính sách'}).waitFor();assert.equal(await form.count(),0);assert.equal(await page.getByRole('alertdialog').count(),0);
      assert.equal(calls.filter(call=>call.startsWith('GET /dashboard/summary')).length,1);
    }));
    await test(browser,'Unknown shell counters do not block an assets page and retry is isolated',()=>withFixture(browser,'USER',async({page,state,calls})=>{
      await page.goto(origin+'/assets');await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();await page.getByRole('alert').filter({hasText:'Chỉ số tạm thời'}).waitFor();
      assert.equal(await page.getByRole('link',{name:/Tài sản của tôi/}).locator('.nav-count').innerText(),'—');state.summaryFail=false;
      await page.getByRole('alert').getByRole('button',{name:'Thử lại'}).click();await page.getByRole('link',{name:/Tài sản của tôi/}).locator('.nav-count').getByText('320',{exact:true}).waitFor();
      assert.equal(calls.filter(call=>call.startsWith('GET /assets?')).length,1);assert.equal(calls.filter(call=>call.includes('read=false')).length,1);
    },{summaryFail:true}));
    await test(browser,'Detail 403 never exposes the previous object and retry does not reload shell resources',()=>withFixture(browser,'USER',async({page,state,calls})=>{
      await page.goto(origin+'/assets/asset-300');await visible(page,'Tài sản 300');state.detailDenied='asset-299';await page.getByRole('link',{name:'ASSET-0299',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'Quyền xem tài sản'}).waitFor();assert.equal(await page.locator('.asset-detail-page').count(),0);assert.equal(await page.locator('.login-card').count(),0);
      state.detailDenied='';await page.getByRole('alert').getByRole('button',{name:'Thử lại'}).click();await visible(page,'Tài sản 299');assert.equal(calls.filter(call=>call.startsWith('GET /dashboard/summary')).length,1);
    },{lineage:true}));
    await test(browser,'Approver dashboard reads aggregates without fetching the queue table',()=>withFixture(browser,'APPROVER',async({page,calls})=>{
      await page.goto(origin+'/dashboard');await page.locator('.metric-row').getByText('25',{exact:true}).waitFor();assert.equal(calls.filter(call=>call.startsWith('GET /requests')).length,0);
      await page.getByRole('link',{name:/Hàng chờ phê duyệt/}).click();await page.getByRole('button',{name:'request-1',exact:true}).waitFor();assert.equal(calls.filter(call=>call.startsWith('GET /requests?')).length,1);
    }));
    await test(browser,'Restore outage offers recovery without rendering business data or discarding the deep link',()=>withFixture(browser,'USER',async({page,state,calls})=>{
      await page.goto(origin+'/assets/asset-300');await page.getByRole('alert').filter({hasText:'Chưa thể xác minh phiên'}).waitFor();
      assert(calls.every(call=>call.includes('/auth/')));assert.equal(await page.locator('.login-card').count(),0);assert.equal(await page.locator('.sidebar').count(),0);
      state.refreshOutage=false;await page.getByRole('button',{name:'Thử khôi phục phiên'}).click();await visible(page,'Tài sản 300');assert.equal(new URL(page.url()).pathname,'/assets/asset-300');
    },{refreshOutage:true}));
    await test(browser,'Guest login restores the original deep link and query',()=>withFixture(browser,'USER',async({page})=>{
      const target='/assets/asset-300?source=bookmark';await page.goto(origin+target);await login(page);
      await visible(page,'Tài sản 300');assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,target);
    },{guest:true}));
    await test(browser,'Multi-role restore selects the granted role compatible with a deep link',()=>withFixture(browser,'USER',async({page})=>{
      await page.goto(origin+'/requests/new?type=RENEW&assetId=asset-300');await page.getByRole('dialog').waitFor();
      await page.waitForFunction(()=>document.querySelector('#request-asset')?.selectedOptions[0]?.textContent?.includes('ASSET-0300'));
      await page.getByRole('button',{name:'Vai trò hiện tại: Nhân viên'}).waitFor();assert.match(page.url(),/\/requests\/new\?type=RENEW/);
    },{roles:['APPROVER','USER']}));
    await test(browser,'Dirty role switching applies only after discard and cancellation leaves no pending switch',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/policies');await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).click();const form=page.getByRole('form',{name:'Tạo phiên bản chính sách'});
      await form.locator('input[type=number]').first().fill('366');
      const switchRole=async()=>{const button=page.getByRole('button',{name:'Vai trò hiện tại: Quản trị bảo mật'});if(await button.getAttribute('aria-expanded')!=='true')await button.dispatchEvent('click');await page.getByRole('menuitemradio',{name:/Nhân viên/}).dispatchEvent('click')};
      await switchRole();await page.getByRole('alertdialog').getByRole('button',{name:'Ở lại',exact:true}).click();
      assert.match(page.url(),/\/policies$/);assert.equal(await form.locator('input[type=number]').first().inputValue(),'366');
      await page.getByRole('button',{name:'Vai trò hiện tại: Quản trị bảo mật'}).waitFor();
      await switchRole();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();
      await visible(page,'Tổng quan tài sản mã hóa');await page.getByRole('button',{name:'Vai trò hiện tại: Nhân viên'}).waitFor();
      assert.equal(await form.count(),0);assert.equal(new URL(page.url()).pathname,'/dashboard');
    },{roles:['ADMIN','USER']}));
    await test(browser,'Session expiry removes dirty forms and restores only the URL after new login',()=>withFixture(browser,'USER',async({page,state})=>{
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});
      await form.locator('textarea').fill('Nội dung của phiên đã hết hạn');state.expire=true;state.refreshDenied=true;
      await form.getByRole('button',{name:'Gửi yêu cầu'}).click();await page.locator('.login-card').waitFor();
      assert.equal(await page.getByRole('alertdialog').count(),0);await page.getByRole('status').filter({hasText:'Phiên đăng nhập đã hết hạn'}).waitFor();
      state.loginUser={id:'another-user',displayName:'Tài khoản mới'};await login(page);await page.getByRole('dialog').waitFor();
      assert.equal(await page.getByRole('dialog').locator('textarea').inputValue(),'');assert.equal(new URL(page.url()).pathname,'/requests/new');
    }));
    await test(browser,'Refresh service outage retains the unsent request for retry',()=>withFixture(browser,'USER',async({page,state})=>{
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});
      await form.locator('textarea').fill('Giữ nội dung khi dịch vụ phiên gián đoạn');state.expire=true;state.refreshOutage=true;
      await form.getByRole('button',{name:'Gửi yêu cầu'}).click();await form.getByRole('alert').filter({hasText:'Dịch vụ phiên tạm thời'}).waitFor();
      assert.equal(await form.locator('textarea').inputValue(),'Giữ nội dung khi dịch vụ phiên gián đoạn');assert.equal(await page.locator('.login-card').count(),0);
      state.expire=false;state.refreshOutage=false;await form.getByRole('button',{name:'Gửi yêu cầu'}).click();await visible(page,'Yêu cầu của tôi');
    }));
    await test(browser,'Mandatory password change blocks business reads and restores the requested path after login',()=>withFixture(browser,'USER',async({page,calls,mutations})=>{
      await page.goto(origin+'/assets/asset-300');const form=page.getByRole('dialog');await form.getByRole('heading',{name:'Đổi mật khẩu ban đầu'}).waitFor();
      assert(calls.every(call=>call.includes('/auth/')));
      await form.getByLabel('Mật khẩu hiện tại',{exact:true}).fill('InitialPassword!123');await form.getByLabel(/^Mật khẩu mới/).fill('NewPassword!456');await form.getByLabel('Nhập lại mật khẩu mới',{exact:true}).fill('NewPassword!456');
      await form.getByRole('button',{name:'Đổi mật khẩu',exact:true}).click();await page.locator('.login-card').waitFor();assert.equal(mutations[0].endpoint,'/auth/change-password');
      await login(page);await visible(page,'Tài sản 300');assert.equal(new URL(page.url()).pathname,'/assets/asset-300');
    },{mustChangePassword:true}));
    await test(browser,'Explicit logout remains signed out after F5 and new login has a fresh shell',()=>withFixture(browser,'USER',async({page,state,calls})=>{
      await page.goto(origin+'/assets');await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();
      await page.locator('.sidebar').evaluate(el=>el.dataset.testIdentity='old-account');await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.locator('.login-card').waitFor();
      const refreshCount=calls.filter(call=>call.includes('/auth/refresh')).length;await page.reload();await page.locator('.login-card').waitFor();assert.equal(calls.filter(call=>call.includes('/auth/refresh')).length,refreshCount);
      state.loginUser={id:'new-session-user',displayName:'Tài khoản khác'};await login(page);await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();
      assert.equal(await page.locator('.sidebar').getAttribute('data-test-identity'),null);
    }));
    await test(browser,'Explicit logout removes dirty policy fields without a discard blocker',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/policies');await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).click();const form=page.getByRole('form',{name:'Tạo phiên bản chính sách'});
      await form.locator('input[type=number]').first().fill('366');await page.getByRole('button',{name:'Đăng xuất',exact:true}).dispatchEvent('click');await page.locator('.login-card').waitFor();
      assert.equal(await page.getByRole('alertdialog').count(),0);assert.equal(await form.count(),0);
      await login(page);await visible(page,'Chính sách mật mã');assert.equal(await form.count(),0);
    }));
    await test(browser,'Revoked role closes its dirty form and does not retry the old mutation',()=>withFixture(browser,'ADMIN',async({page,state,calls,mutations})=>{
      await page.goto(origin+'/policies');await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).click();const form=page.getByRole('form',{name:'Tạo phiên bản chính sách'});
      await form.locator('input[type=number]').first().fill('366');await form.locator('input[type=checkbox]').check();state.expire=true;state.refreshUser={roles:['USER']};
      await form.getByRole('button',{name:'Phát hành phiên bản'}).click();await visible(page,'Tổng quan tài sản mã hóa');
      await page.getByRole('button',{name:'Vai trò hiện tại: Nhân viên'}).waitFor();assert.equal(await form.count(),0);assert.equal(await page.getByRole('alertdialog').count(),0);
      assert.equal(calls.filter(call=>call.startsWith('POST /policies/')).length,1);assert.equal(mutations.length,0);
      assert(!await page.locator('body').innerText().then(text=>text.includes('Đã phát hành')));
    },{roles:['ADMIN','USER']}));
    await test(browser,'Nested routing preserves shell, theme, title and focus',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/dashboard');await visible(page,'Sức khỏe tài sản mật mã');
      await page.locator('.sidebar').evaluate(el=>el.dataset.testIdentity='persistent-shell');
      await page.getByRole('button',{name:'Chuyển sang giao diện tối'}).click();
      let releaseChunk;
      const chunkGate=new Promise(resolve=>{releaseChunk=resolve});
      await page.route(/\/assets\/PoliciesPage-[^/]+\.js$/,async route=>{await chunkGate;await route.continue()});
      try {
        await page.getByRole('link',{name:'Chính sách',exact:true}).click();
        await page.getByRole('status').filter({hasText:'Đang tải chính sách…'}).waitFor();
        await routeAnimationCount(page);
        assert.equal(await page.locator('#page-title').count(),0);
      } finally {releaseChunk()}
      await visible(page,'Chính sách mật mã');
      assert.equal(await page.locator('.sidebar').getAttribute('data-test-identity'),'persistent-shell');
      assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
      await page.waitForFunction(()=>document.activeElement?.id==='page-title');
      assert.equal(await page.title(),'Chính sách · Crypta');
      await page.evaluate(()=>Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
      await page.screenshot({path:path.join(output,'admin-dark-policies.png'),fullPage:true});
    }));
    await test(browser,'User assets search/status/page survive detail, Back, Forward and F5',()=>withFixture(browser,'USER',async({page})=>{
      const query='/assets?q=T%C3%A0i%20s%E1%BA%A3n&status=ACTIVE&page=2';
      await page.goto(origin+query);await page.getByRole('button',{name:'ASSET-0032',exact:true}).waitFor();
      const listUrl=page.url();
      await page.getByRole('button',{name:'ASSET-0032',exact:true}).click();await page.locator('.asset-detail-page').waitFor();
      assert.match(page.url(),/\/assets\/asset-32$/);
      await page.locator('.asset-detail-page').getByRole('button',{name:'Về danh sách',exact:true}).last().click();
      await page.getByRole('button',{name:'ASSET-0032',exact:true}).waitFor();assert.equal(page.url(),listUrl);
      await page.goForward();await page.locator('.asset-detail-page').waitFor();
      await page.goBack();await page.reload();await page.getByRole('button',{name:'ASSET-0032',exact:true}).waitFor();assert.equal(page.url(),listUrl);
    }));
    await test(browser,'Direct asset detail outside legacy 250 limit loads and closes safely',()=>withFixture(browser,'USER',async({page})=>{
      await page.goto(origin+'/assets/asset-300/');await page.locator('.asset-detail-page').getByRole('heading',{name:'Tài sản 300'}).waitFor();
      await page.locator('.asset-detail-page').getByRole('button',{name:'Về danh sách',exact:true}).last().click();await visible(page,'Tài sản của tôi');
      assert.equal(new URL(page.url()).pathname,'/assets');
    }));
    await test(browser,'Detail missing record gives persistent error and safe return',()=>withFixture(browser,'USER',async({page})=>{
      await page.goto(origin+'/assets/missing');await page.getByRole('alert').getByText('Không tìm thấy tài sản.').waitFor();
      await page.getByRole('button',{name:'Về danh sách'}).click();await visible(page,'Tài sản của tôi');
    }));
    await test(browser,'Unread notification failure leaves dashboard and assets usable; retry is isolated',()=>withFixture(browser,'USER',async({page,state,calls})=>{
      state.notificationFail=true;await page.goto(origin+'/dashboard');await visible(page,'Tổng quan tài sản mã hóa');
      await page.getByRole('alert').filter({hasText:'Thông báo tạm thời'}).waitFor();
      const dashboardCalls=calls.filter(call=>call.includes('/dashboard')).length;
      state.notificationFail=false;await page.getByRole('alert').getByRole('button',{name:'Thử lại'}).click();
      await page.getByRole('alert').waitFor({state:'hidden'});assert.equal(calls.filter(call=>call.includes('/dashboard')).length,dashboardCalls);
      await page.getByRole('link',{name:/Tài sản của tôi/}).click();await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();
    }));
    await test(browser,'Admin asset detail has no User request mutations',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/assets/asset-300');await visible(page,'Tài sản 300');await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();
      assert.equal(await page.locator('.asset-detail-page').getByRole('button',{name:'Yêu cầu gia hạn'}).count(),0);
      assert.equal(await page.locator('.asset-detail-page').getByRole('button',{name:'Thu hồi',exact:true}).count(),0);
      await page.goto(origin+'/requests/new');await visible(page,'Bạn không có quyền mở trang này');assert.equal(await page.locator('.asset-detail-page').count(),0);
      await page.goto(origin+'/unknown-page');await visible(page,'Không tìm thấy trang');await page.waitForFunction(()=>document.activeElement?.id==='page-title');
    }));
    await test(browser,'Approver history pages non-pending scope and opens ID details',()=>withFixture(browser,'APPROVER',async({page,calls})=>{
      await page.goto(origin+'/approvals/history?page=2');await visible(page,'Lịch sử quyết định');
      await page.locator('.request-item').first().waitFor();assert(calls.some(call=>call.includes('excludePending=true')));
      assert.equal(await page.locator('.request-list').getByText('Chờ duyệt',{exact:true}).count(),0);
      const listUrl=page.url();await page.locator('.request-item').first().click();await page.locator('.asset-detail-page').waitFor();
      await page.locator('.asset-detail-page').getByRole('button',{name:'Về danh sách',exact:true}).last().click();await visible(page,'Lịch sử quyết định');assert.equal(page.url(),listUrl);
    }));
    await test(browser,'Approver decisions use detail version and retain note after 409',()=>withFixture(browser,'APPROVER',async({page,state,mutations})=>{
      state.decisionConflict=true;await page.goto(origin+'/requests/request-1');await page.locator('.asset-detail-page').waitFor();
      await page.getByRole('button',{name:'Phê duyệt',exact:true}).click();
      const decision=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Phê duyệt request-1'})});
      await decision.locator('textarea').fill('Ghi chú cần được giữ');await decision.getByRole('button',{name:'Xác nhận phê duyệt'}).click();
      await decision.getByRole('alert').waitFor();assert.equal(await decision.locator('textarea').inputValue(),'Ghi chú cần được giữ');
      assert.equal(mutations[0].body.version,'7');assert.equal(mutations[0].endpoint,'/requests/request-1/decision');
    }));
    await test(browser,'Request dirty dialog keeps values, traps Tab and permits confirmed discard',()=>withFixture(browser,'USER',async({page})=>{
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.waitFor();
      await form.locator('textarea').fill('Lý do đang nhập chưa gửi');await form.getByRole('button',{name:'Hủy',exact:true}).click();
      const alert=page.getByRole('alertdialog');await alert.waitFor();
      await alert.getByRole('button',{name:'Bỏ thay đổi'}).focus();await page.keyboard.press('Tab');assert.equal(await alert.getByRole('button',{name:'Ở lại',exact:true}).evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Escape');await alert.waitFor({state:'hidden'});assert.equal(await form.locator('textarea').inputValue(),'Lý do đang nhập chưa gửi');
      await form.getByRole('button',{name:'Hủy',exact:true}).click();await alert.getByRole('button',{name:'Bỏ thay đổi'}).click();await visible(page,'Yêu cầu của tôi');
    }));
    await test(browser,'Renewal picker pages/searches and loads selected asset beyond first 250',()=>withFixture(browser,'USER',async({page,mutations,calls})=>{
      await page.goto(origin+'/requests/new?type=RENEW&assetId=asset-300');const form=page.getByRole('dialog');await form.waitFor();
      await page.waitForFunction(()=>document.querySelector('#request-asset')?.selectedOptions[0]?.textContent?.includes('ASSET-0300'));
      assert(calls.some(call=>call.includes('eligible=true')));
      await form.locator('textarea').fill('Gia hạn tài sản ngoài trang đầu');await form.getByRole('button',{name:'Gửi yêu cầu'}).click();await visible(page,'Yêu cầu của tôi');
      assert.equal(mutations[0].body.targetAssetId,'asset-300');assert.equal(mutations[0].body.policyVersionId,'version-1');
      assert.equal(mutations[0].body.type,'RENEW');
      assert.equal(mutations.length,1);assert.equal(await page.getByRole('alertdialog').count(),0);
    }));
    await test(browser,'Access dirty state survives navigation cancellation',()=>withFixture(browser,'ADMIN',async({page})=>{
      await page.goto(origin+'/users/access');await page.getByLabel('Người dùng',{exact:true}).selectOption('person-1');await page.getByLabel('Vai trò',{exact:true}).selectOption('APPROVER');
      await page.getByRole('link',{name:'Chính sách',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Ở lại',exact:true}).click();
      assert.equal(await page.getByLabel('Vai trò',{exact:true}).inputValue(),'APPROVER');assert.match(page.url(),/\/users\/access$/);
      await page.getByRole('link',{name:'Chính sách',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Bỏ thay đổi'}).click();await visible(page,'Chính sách mật mã');
    }));
    await test(browser,'Back restores list scroll after asynchronous rows load',()=>withFixture(browser,'USER',async({page,state})=>{
      await page.goto(origin+'/assets?page=2');await page.getByRole('button',{name:'ASSET-0030',exact:true}).waitFor();
      await page.evaluate(()=>window.scrollTo({top:420,behavior:'instant'}));await page.waitForFunction(()=>Math.abs(window.scrollY-420)<1);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const scroll=await page.evaluate(()=>window.scrollY);
      await page.getByRole('button',{name:'ASSET-0030',exact:true}).click();await visible(page,'Tài sản 30');await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();state.assetDelay=350;
      await page.locator('.asset-detail-page').getByRole('button',{name:'Về danh sách',exact:true}).last().click();await page.waitForFunction(y=>Math.abs(window.scrollY-y)<5,scroll);
    }));
    await test(browser,'Scoped lineage links use IDs and preserve the list return context',()=>withFixture(browser,'USER',async({page})=>{
      await page.goto(origin+'/assets?q=ASSET-0300');await page.getByRole('button',{name:'ASSET-0300',exact:true}).click();await visible(page,'Tài sản 300');
      await page.getByRole('link',{name:'ASSET-0299',exact:true}).click();await visible(page,'Tài sản 299');
      await page.getByRole('button',{name:'Về danh sách',exact:true}).last().click();assert.equal(new URL(page.url()).search,'?q=ASSET-0300');
    },{lineage:true}));
    await test(browser,'Create request sends once and revalidates the requests route',()=>withFixture(browser,'USER',async({page,mutations})=>{
      await page.goto(origin+'/requests/new');const form=page.getByRole('dialog');await form.getByRole('option',{name:'Chính sách RSA v1'}).waitFor({state:'attached'});
      await form.locator('textarea').fill('Tạo tài sản phục vụ kiểm thử UI');await form.getByRole('button',{name:'Gửi yêu cầu'}).click();await visible(page,'Yêu cầu của tôi');
      assert.equal(mutations.length,1);assert.equal(mutations[0].body.type,'CREATE');assert.equal(mutations[0].body.policyVersionId,'version-1');
    }));
    await test(browser,'Revocation requires confirmation and preserves normal urgency',()=>withFixture(browser,'USER',async({page,mutations})=>{
      await page.goto(origin+'/requests/new?type=REVOKE&assetId=asset-300');const form=page.getByRole('dialog');await page.waitForFunction(()=>document.querySelector('#request-asset')?.selectedOptions[0]?.textContent?.includes('ASSET-0300'));
      await form.locator('textarea').fill('Thu hồi tài sản khi hoàn tất kiểm thử');await form.getByRole('button',{name:'Tiếp tục thu hồi'}).click();
      assert.equal(mutations.length,0);await form.getByRole('button',{name:'Xác nhận thu hồi'}).click();await visible(page,'Yêu cầu của tôi');
      assert.equal(mutations[0].body.type,'REVOKE');assert.equal(mutations[0].body.emergency,false);assert.equal(mutations[0].body.targetAssetId,'asset-300');
      assert.equal(mutations.length,1);assert.equal(await page.getByRole('alertdialog').count(),0);
    }));
    await test(browser,'Admin create-user mutation revalidates the users page',()=>withFixture(browser,'ADMIN',async({page,mutations,calls})=>{
      await page.goto(origin+'/users');await page.getByRole('button',{name:'Thêm người dùng'}).click();const form=page.getByRole('dialog');
      await form.locator('input').nth(0).fill('Nhân viên kiểm thử');await form.locator('input').nth(1).fill('isolated@example.test');await form.getByRole('button',{name:'Tạo tài khoản'}).click();await form.waitFor({state:'hidden'});
      assert.equal(mutations[0].endpoint,'/users');assert.equal(mutations[0].body.email,'isolated@example.test');assert.deepEqual(mutations[0].body.roles,['USER']);
      assert(!calls.some(call=>call.startsWith('GET /audit-logs')||call.startsWith('GET /policies')||call.startsWith('GET /assets')));
    }));
    await test(browser,'Admin policy version mutation retains the expected version contract',()=>withFixture(browser,'ADMIN',async({page,mutations})=>{
      await page.goto(origin+'/policies');await page.getByRole('button',{name:'Tạo phiên bản',exact:true}).click();const form=page.getByRole('form',{name:'Tạo phiên bản chính sách'});
      await form.locator('input[type=number]').first().fill('366');await form.locator('input[type=checkbox]').check();await form.getByRole('button',{name:'Phát hành phiên bản'}).click();await form.waitFor({state:'hidden'});
      assert.equal(mutations[0].endpoint,'/policies/policy-1/versions');assert.equal(mutations[0].body.expectedVersion,1);assert.equal(mutations[0].body.maximumValidityDays,366);
    }));
    await test(browser,'Approver approval succeeds once using the fetched detail version',()=>withFixture(browser,'APPROVER',async({page,mutations})=>{
      await page.goto(origin+'/approvals');await page.getByRole('button',{name:'request-1',exact:true}).click();await visible(page,'Yêu cầu kiểm thử 1');await page.getByRole('button',{name:'Phê duyệt',exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'Xác nhận phê duyệt'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
      assert.equal(mutations.length,1);assert.equal(mutations[0].body.version,'7');assert.equal(mutations[0].body.decision,'APPROVED');
    }));
    for(const role of ['USER','APPROVER','ADMIN'])await test(browser,`${role} notification beyond page one opens details and marks read`,()=>withFixture(browser,role,async({page,mutations})=>{
      await page.goto(origin+'/notifications?page=2');await page.getByRole('button',{name:'Xem chi tiết',exact:true}).first().click();await visible(page,role==='APPROVER'?'Yêu cầu kiểm thử 1':'Tài sản 300');
      await page.locator('.resource-region[aria-label="Chi tiết"][aria-busy="false"]').waitFor();
      assert(mutations.some(mutation=>mutation.endpoint==='/notifications/notification-11/read'));
      await page.getByRole('button',{name:'Về danh sách',exact:true}).last().click();await visible(page,'Thông báo');assert.equal(new URL(page.url()).search,'?page=2');
    },{notificationItems:true}));
    await test(browser,'Reduced-motion, mobile drawer and 200 percent reflow remain usable',()=>withFixture(browser,'USER',async({page})=>{
      await page.setViewportSize({width:390,height:844});await page.goto(origin+'/dashboard');await visible(page,'Tổng quan tài sản mã hóa');
      await page.getByRole('button',{name:'Mở điều hướng'}).click();await page.getByRole('link',{name:/Tài sản của tôi/}).click();await visible(page,'Tài sản của tôi');
      assert.equal(await page.locator('.sidebar-open').count(),0);assert.equal(await page.evaluate(()=>window.__routeAnimations),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      await page.screenshot({path:path.join(output,'user-mobile-assets.png'),fullPage:true});
      await page.locator('.admin-asset-pagination').screenshot({path:path.join(output,'user-mobile-page-size.png')});
      await page.setViewportSize({width:720,height:500});await page.getByRole('button',{name:'Mở điều hướng'}).click();await page.getByRole('link',{name:'Tổng quan',exact:true}).click();await visible(page,'Tổng quan tài sản mã hóa');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      await page.screenshot({path:path.join(output,'user-200percent-reflow.png'),fullPage:true});
    },{reduced:true}));
    await test(browser,'Normal route motion never replays for query or theme changes',()=>withFixture(browser,'USER',async({page})=>{
      // Route entrance starts on the next frame. Observe it before recording
      // the query-only baseline, then allow a frame for any unexpected replay.
      const countAfterFrame=()=>routeAnimationCount(page);
      await page.goto(origin+'/assets');await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();assert.equal(await countAfterFrame(),0);
      await page.getByRole('link',{name:'Tổng quan',exact:true}).click();await visible(page,'Tổng quan tài sản mã hóa');assert.equal(await countAfterFrame(),Number(motionEnabled));
      await page.getByRole('button',{name:'Chuyển sang giao diện tối'}).click();assert.equal(await countAfterFrame(),Number(motionEnabled));
      await page.getByRole('link',{name:/Tài sản của tôi/}).click();await page.getByRole('button',{name:'ASSET-0001',exact:true}).waitFor();
      const count=await countAfterFrame();assert.equal(count,2*Number(motionEnabled));
      await page.getByRole('button',{name:'Sau',exact:true}).click();await page.getByRole('button',{name:'ASSET-0026',exact:true}).waitFor();assert.equal(await countAfterFrame(),count);
    }));
  }finally{const browserVersion=browser.version(),browserChannel=requestedBrowser;await browser.close();const html=await fetch(origin).then(response=>response.text());const buildAssets=[...html.matchAll(/\/assets\/[^\"']+/g)].map(match=>match[0]);await fs.writeFile(path.join(output,testFilter?'results-filtered.json':browserChannel==='msedge'?'results.json':`results-${browserChannel}.json`),JSON.stringify({origin,browserVersion,browserChannel,browserEngine,buildAssets,fixtureOnly:true,motionMode,testFilter,results},null,2))}
  if(testFilter&&results.length===0)throw new Error('CRYPTA_UI_TEST_FILTER did not match any test.');
  console.log(`${results.filter(result=>result.status==='passed').length}/${results.length} browser regressions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
