import type { Asset, AuthUser, RequestItem,UserRole } from './types';
import type { AssetResponse,AssetHistoryEvent,AssetHistoryResponse } from './api/contracts/assets';
import type { DraftFields, RequestResponse } from './api/contracts/requests';
import type { NotificationResponse,EmailIssueResponse,EmailDeliveryDetail,EmailReconciliation,EmailRetry } from './api/contracts/notifications';
import type { UserResponse,UserReferenceResponse } from './api/contracts/users';
import type { DepartmentResponse,DepartmentDetail } from './api/contracts/departments';
import type { AdminPolicy, PolicyConfigurationInput, PolicyResponse, PolicyVersion } from './api/contracts/policies';
import { recoveryAcknowledgment, type ProviderIssue, type ProviderIssueDetail, type RecoveryAction } from './api/contracts/provider-recovery';
import type { AuditDetail, AuditFilters, AuditResponse } from './api/contracts/audit';
import type { PageResponse } from './api/contracts/page';
import type { DashboardResponse,DashboardSummaryResponse } from './api/contracts/dashboard';
import type { MfaChallenge, MfaCodes, MfaStepUp } from './api/contracts/mfa';
import { sessionPermissions } from './sessionRouting';
import { bindMutationOwner,clearMutations,rejectMutation,startMutation,updateMutation,validAcknowledgment } from './workspaceMutations';
import type { MutationInput } from './workspaceMutations';
import { mutationResources } from './workspaceRefresh';
import { announceCookieSessionBoundary,cookieSessionBoundaryMatches,currentCookieSessionBoundary,subscribeCookieSessionBoundary,withSessionCookieLock } from './sessionCookieLock';
import type { ReportDataset, ReportFilters, ReportFormat, ReportJob, ReportPreview } from './api/contracts/reports';

const API_BASE='/api/v1';
let accessToken:string|undefined;
let refreshing:Promise<AuthSession>|undefined;
let sessionGeneration=0;
let sessionBoundary=currentCookieSessionBoundary();
let mfaAttempt: { challenge: string; generation: number; boundary: typeof sessionBoundary } | undefined;
let permissionKey:string|undefined;
const activeRequests=new Set<AbortController>();
export type SessionEvent={type:'refreshed';user:AuthUser}|{type:'expired'};
const sessionListeners=new Set<(event:SessionEvent)=>void>();
export function subscribeSession(listener:(event:SessionEvent)=>void){sessionListeners.add(listener);return()=>{sessionListeners.delete(listener)}}
function announceSession(event:SessionEvent){for(const listener of sessionListeners)listener(event)}
function endedSession(value:boolean){if(typeof window==='undefined')return;try{if(value)window.sessionStorage.setItem('crypta-session-ended','1');else window.sessionStorage.removeItem('crypta-session-ended')}catch{/* In-memory boundaries still work if storage is unavailable. */}}
function sessionEnded(){if(typeof window==='undefined')return false;try{return window.sessionStorage.getItem('crypta-session-ended')==='1'}catch{return false}}
function beginSession(preserveCredentials=false){sessionGeneration++;mfaAttempt=undefined;if(!preserveCredentials){accessToken=undefined;permissionKey=undefined;clearMutations()}refreshing=undefined;for(const controller of activeRequests)controller.abort();activeRequests.clear();return sessionGeneration}
function expireSession(){beginSession();endedSession(true);announceSession({type:'expired'})}
subscribeCookieSessionBoundary(expireSession);
type Envelope<T>={data:T;requestId:string};
type AuthSession={accessToken:string;tokenType:string;expiresIn:string;user:AuthUser};
const challengeRoutes = new Set(['/auth/mfa/verify','/auth/mfa/recover','/auth/mfa/enrollment/verify','/auth/mfa/enrollment/finish']);

export class ApiError extends Error { constructor(public code:string,message:string,public status:number,public requestId?:string,public outcome?:'unknown'|'rejected'){super(message)} }

async function publicAccountRequest<T>(path: string, signal?: AbortSignal, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('NETWORK_ERROR', 'Không thể kết nối máy chủ. Kiểm tra kết nối rồi thử lại.', 0);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.data) {
    throw new ApiError(payload.error?.code ?? 'ACCOUNT_ACTION_FAILED',
      payload.error?.message ?? 'Không thể xác nhận kết quả. Hãy thử lại.', response.status);
  }
  return payload.data as T;
}

async function mutate<T>(input:MutationInput,path:string,options:RequestInit):Promise<T>{
  const operation=startMutation(input);
  if(!operation)throw new ApiError('OPERATION_UNRESOLVED','Thao tác trước đang chờ hoặc chưa rõ kết quả. Hãy kiểm tra dữ liệu trước khi gửi lại.',409,undefined,'rejected');
  try{
    const result=await request<T>(path,options);
    if(!validAcknowledgment(input,result))throw new ApiError('INVALID_ACKNOWLEDGMENT','Phản hồi chưa đủ để xác nhận kết quả thao tác.',502,undefined,'unknown');
    updateMutation(operation.id,{phase:'confirmed',resultId:typeof (result as {id?:unknown})?.id==='string'?(result as {id:string}).id:undefined});
    return result;
  }catch(error){
    if(error instanceof ApiError&&(error.outcome==='rejected'||(error.status>=400&&error.status<500))){rejectMutation(operation.id);throw error}
    updateMutation(operation.id,{phase:'unknown',requestId:error instanceof ApiError?error.requestId:undefined});
    if(error instanceof DOMException&&error.name==='AbortError')throw error;
    throw new ApiError('MUTATION_UNKNOWN','Chưa xác nhận kết quả thao tác. Hãy kiểm tra dữ liệu trước khi gửi lại.',error instanceof ApiError?error.status:0,error instanceof ApiError?error.requestId:undefined,'unknown');
  }
}

function dashboardMetrics(data:DashboardSummaryResponse,role?:UserRole) {
  const required=role==='USER'?['total','active','expiring','pending']:role==='APPROVER'?['pending','emergency','avg_wait_hours','approved','rejected']:['total_assets','expiring','active_users','admin_users','approver_users','sod_conflicts','failed_jobs','email_reconciliation','departments'];
  if(!data?.metrics||(role&&(data.role!==role||required.some(key=>data.metrics[key]===undefined))))throw new ApiError('INVALID_DASHBOARD','Chưa nhận được số liệu đúng cho vai trò hiện tại. Hãy thử tải lại.',502);
  const metrics:Record<string,number>={};
  for(const [key,value] of Object.entries(data.metrics)){
    if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()===''||!Number.isFinite(Number(value)))throw new ApiError('INVALID_DASHBOARD','Số liệu tổng quan không hợp lệ. Hãy thử tải lại.',502);
    metrics[key]=Number(value);
  }
  return metrics;
}

async function request<T>(path:string,options:RequestInit={},retry=true,decode?: (response:Response)=>Promise<T>):Promise<T>{
  const generation=sessionGeneration;
  const boundary=sessionBoundary;
  const controller=new AbortController();
  activeRequests.add(controller);
  const abort=()=>controller.abort(options.signal?.reason);
  if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
  const assertCurrent=()=>{if(generation!==sessionGeneration||controller.signal.aborted||!cookieSessionBoundaryMatches(boundary))throw new DOMException('Request abandoned','AbortError')};
  try{
    assertCurrent();
    const headers=new Headers(options.headers);
    if(options.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
    if(accessToken)headers.set('Authorization',`Bearer ${accessToken}`);
    let response:Response;
    try{response=await fetch(`${API_BASE}${path}`,{...options,signal:controller.signal,headers,credentials:'include'})}catch{assertCurrent();throw new ApiError('NETWORK_ERROR','Không thể kết nối máy chủ. Kiểm tra dịch vụ rồi thử lại.',0)}
    assertCurrent();
    if(response.ok&&decode){const result=await decode(response);assertCurrent();return result}
    const payload=await response.json().catch(()=>({}));
    assertCurrent();
    if(response.status===401&&retry&&path!=='/auth/login'&&path!=='/auth/oidc/finish'&&path!=='/auth/refresh'&&!challengeRoutes.has(path)&&payload?.error?.code!=='MFA_CODE_INVALID'){
      try{await refresh()}catch(error){
        assertCurrent();
        if(error instanceof ApiError&&error.status===401){expireSession();throw new ApiError('SESSION_EXPIRED','Phiên đăng nhập đã hết hạn hoặc bị thu hồi.',401)}
        // The original write was rejected with 401, so a refresh outage cannot have applied it.
        if(error instanceof ApiError)throw new ApiError(error.code,error.message,error.status,error.requestId,'rejected');
        throw error;
      }
      assertCurrent();return await request<T>(path,options,false,decode);
    }
    if(!response.ok){
      if(response.status===401&&path!=='/auth/login'&&path!=='/auth/oidc/finish'&&path!=='/auth/refresh'&&path!=='/auth/logout'&&!challengeRoutes.has(path)&&payload?.error?.code!=='MFA_CODE_INVALID')expireSession();
      throw new ApiError(payload?.error?.code??'REQUEST_FAILED',payload?.error?.message??'Yêu cầu không thành công.',response.status,payload?.requestId);
    }
    if(!payload||typeof payload!=='object'||!Object.prototype.hasOwnProperty.call(payload,'data'))throw new ApiError('INVALID_RESPONSE','Phản hồi máy chủ không hợp lệ. Hãy kiểm tra dữ liệu.',502,payload?.requestId);
    return (payload as Envelope<T>).data;
  }finally{options.signal?.removeEventListener('abort',abort);activeRequests.delete(controller)}
}
async function refresh(){
  if(!refreshing){
    const generation=sessionGeneration,boundary=sessionBoundary;
    const current=()=>generation===sessionGeneration&&cookieSessionBoundaryMatches(boundary);
    const pending=withSessionCookieLock(current,()=>request<AuthSession>('/auth/refresh',{method:'POST'},false)).then(session=>{
      if(!current())throw new DOMException('Session changed','AbortError');
      const nextPermissions=sessionPermissions(session.user);
      // Do not retry an operation or accept sibling data authorized in the old scope.
      if(permissionKey!==undefined&&permissionKey!==nextPermissions)beginSession();
      permissionKey=nextPermissions;
      accessToken=session.accessToken;bindMutationOwner(session.user.id);announceSession({type:'refreshed',user:session.user});return session;
    }).finally(()=>{if(refreshing===pending)refreshing=undefined});
    refreshing=pending;
  }
  return refreshing;
}

function mapAsset(row:AssetResponse):Asset{return{id:row.id,code:row.code,name:row.purpose,type:row.type,status:row.status,algorithm:[row.algorithm,row.keySize].filter(Boolean).join(' ')||'—',purpose:row.purpose,validFrom:row.validFrom?new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium'}).format(new Date(row.validFrom)):undefined,expiresAt:new Intl.DateTimeFormat('vi-VN').format(new Date(row.expiresAt)),daysLeft:Math.max(0,Math.ceil((new Date(row.expiresAt).getTime()-Date.now())/86400000)),provider:row.providerMode==='MOCK'?'Mô phỏng':row.providerMode==='HTTP'?'Provider HTTP':row.providerReference?'Chưa xác minh nhà cung cấp':'Chưa liên kết',fingerprint:row.publicKeyFingerprint??row.fingerprint??'Chưa có',ownerId:row.ownerId,departmentId:row.departmentId,ownerName:row.ownerName,departmentName:row.departmentName,policyCode:row.policyCode,policyVersionId:row.policyVersionId,policyVersion:row.policyVersion,version:row.version}}
function mapRequest(row:RequestResponse):RequestItem {
  return {
    id:row.id,type:row.type,subject:row.reason||'Yêu cầu chưa có lý do',status:row.status,
    submittedAt:row.submittedAt?new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(row.submittedAt)):'Chưa gửi',
    submitted:row.submittedAt!==null,cancellationReason:row.cancellationReason,emergency:row.emergency,decision:row.decision,
    approval:row.approval,approvalHistory:row.approvalHistory,
    creatorId:row.creatorId,departmentId:row.departmentId,creatorName:row.creatorName,departmentName:row.departmentName,
    targetAssetCode:row.targetAssetCode,version:row.version,
  };
}

function acceptSession(session: AuthSession) {
  accessToken=session.accessToken;
  permissionKey=sessionPermissions(session.user);
  bindMutationOwner(session.user.id);
  endedSession(false);
  return session.user;
}

function bindMfaChallenge(result: MfaChallenge) {
  mfaAttempt={challenge:result.challenge,generation:sessionGeneration,boundary:sessionBoundary};
  return result;
}

function currentMfaAttempt(challenge: string) {
  const attempt=mfaAttempt;
  const current=()=>!!attempt&&mfaAttempt===attempt&&attempt.challenge===challenge&&
    attempt.generation===sessionGeneration&&cookieSessionBoundaryMatches(attempt.boundary);
  if(!current())throw new ApiError('MFA_CHALLENGE_EXPIRED','Phiên xác thực đã hết hạn. Hãy đăng nhập lại.',401);
  return current;
}

async function mfaRequest<T>(path: string, body: { challenge: string } & Record<string, string | boolean>) {
  const current=currentMfaAttempt(body.challenge);
  const result=await request<T>(path,{method:'POST',body:JSON.stringify(body),cache:'no-store'},false);
  if(!current())throw new DOMException('Session changed','AbortError');
  return result;
}

async function completeMfa(path: string, body: { challenge: string } & Record<string, string | boolean>) {
  const current=currentMfaAttempt(body.challenge);
  const result=await withSessionCookieLock(current,()=>mfaRequest<AuthSession>(path,body));
  // The lock validates the previous boundary after fetch has installed the cookie.
  // Change the boundary only after that check so this response can enter the workspace.
  if(!current())throw new DOMException('Session changed','AbortError');
  beginSession();
  sessionBoundary=announceCookieSessionBoundary();
  return acceptSession(result);
}

async function authenticate(path: '/auth/login' | '/auth/oidc/finish', body: object) {
  const generation=beginSession(),boundary=sessionBoundary=announceCookieSessionBoundary();
  const current=()=>generation===sessionGeneration&&cookieSessionBoundaryMatches(boundary);
  const result=await withSessionCookieLock(current,()=>request<AuthSession|MfaChallenge>(path,{method:'POST',body:JSON.stringify(body),cache:'no-store'},false));
  if(!current())throw new DOMException('Session changed','AbortError');
  if('mfa' in result){endedSession(true);return bindMfaChallenge(result)}
  return acceptSession(result);
}

type LogoutResponse = { loggedOut: boolean; redirect?: string };

export const api={
  login(email:string,password:string){return authenticate('/auth/login',{email,password})},
  oidcStatus(signal?:AbortSignal){return request<{enabled:boolean}>('/auth/oidc/status',{signal,cache:'no-store'},false)},
  startOidc(){return request<{redirect:string}>('/auth/oidc/start',{method:'POST',body:'{}',cache:'no-store'},false)},
  finishOidc(){return authenticate('/auth/oidc/finish',{})},
  reportJobs(dataset:ReportDataset,signal?:AbortSignal){
    return request<ReportJob[]>('/reports?'+new URLSearchParams({dataset}),{signal,cache:'no-store'});
  },
  previewReport(dataset:ReportDataset,filters:ReportFilters,signal?:AbortSignal){
    return request<ReportPreview>('/reports/preview',{method:'POST',body:JSON.stringify({dataset,filters}),signal,cache:'no-store'});
  },
  createReport(dataset:ReportDataset,filters:ReportFilters,format:ReportFormat,requestKey:string){
    return request<ReportJob>('/reports',{method:'POST',body:JSON.stringify({dataset,filters,format,requestKey}),cache:'no-store'});
  },
  cancelReport(id:string){return request<ReportJob>(`/reports/${encodeURIComponent(id)}/cancel`,{method:'POST',cache:'no-store'})},
  reportFile(id:string,format:ReportFormat){
    return request<Blob>(`/reports/${encodeURIComponent(id)}/file`,{cache:'no-store'},true,async response=>{
      const type=response.headers.get('content-type')?.split(';')[0];
      if(type!==(format==='CSV'?'text/csv':'application/pdf'))throw new ApiError('REPORT_FILE_INVALID','Định dạng tệp nhận được không hợp lệ.',502);
      return response.blob();
    });
  },
  abandonMfa(){mfaAttempt=undefined},
  verifyMfa(challenge:string,totpCode:string){return completeMfa('/auth/mfa/verify',{challenge,totpCode})},
  async recoverMfa(challenge:string,recoveryCode:string){return bindMfaChallenge(await mfaRequest<MfaChallenge>('/auth/mfa/recover',{challenge,recoveryCode}))},
  verifyMfaEnrollment(challenge:string,totpCode:string){return mfaRequest<MfaCodes>('/auth/mfa/enrollment/verify',{challenge,totpCode})},
  finishMfaEnrollment(challenge:string){return completeMfa('/auth/mfa/enrollment/finish',{challenge,savedRecoveryCodes:true})},
  mfaStatus(signal?:AbortSignal){return request<{remaining:number}>('/auth/mfa/status',{signal,cache:'no-store'})},
  async stepUpMfa(currentPassword:string|undefined,totpCode:string,purpose:MfaStepUp){
    const result=await request<MfaChallenge|MfaCodes>('/auth/mfa/step-up',{method:'POST',body:JSON.stringify({currentPassword,totpCode,purpose}),cache:'no-store'});
    return 'mfa' in result?bindMfaChallenge(result):result;
  },
  abandonWorkspaceRequests(){beginSession(true)},
  async restore(){if(sessionEnded())throw new ApiError('SESSION_ENDED','Hãy đăng nhập để bắt đầu phiên mới.',401);const session=await refresh();return session.user},
  async logout(){const token=accessToken;const generation=beginSession(),boundary=sessionBoundary=announceCookieSessionBoundary();endedSession(true);const current=()=>generation===sessionGeneration&&cookieSessionBoundaryMatches(boundary);const assertCurrent=()=>{if(!current())throw new DOMException('Session changed','AbortError')};try{return await withSessionCookieLock(current,async()=>{
    try{return await request<LogoutResponse>('/auth/logout',{method:'POST',headers:token?{Authorization:`Bearer ${token}`}:undefined},false)}catch(error){
      if(!(error instanceof ApiError)||error.status!==401)throw error;
      assertCurrent();
      // The lock already covers this rotation. Do not reacquire it or restore
      // the temporary logout credential into an already-ended client session.
      const session=await request<AuthSession>('/auth/refresh',{method:'POST'},false);
      assertCurrent();
      return request<LogoutResponse>('/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${session.accessToken}`}},false);
    }
  })}finally{if(generation===sessionGeneration)beginSession()}},
  async changePassword(currentPassword:string,newPassword:string){const generation=sessionGeneration;const result=await withSessionCookieLock(()=>generation===sessionGeneration,()=>request('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})},false));if(generation!==sessionGeneration)throw new DOMException('Session changed','AbortError');beginSession();endedSession(true);sessionBoundary=announceCookieSessionBoundary();return result},
  async assets(signal?:AbortSignal){return(await request<AssetResponse[]>('/assets',{signal})).map(mapAsset)},
  async assetDetail(id:string,signal?:AbortSignal){return mapAsset(await request<AssetResponse>(`/assets/${id}`,{signal}))},
  async assetPage(options:{page:number;pageSize:number;status?:string;search?:string;eligible?:boolean;ownedOnly?:boolean;approvalScope?:boolean},signal?:AbortSignal){const params=new URLSearchParams({page:String(options.page),pageSize:String(options.pageSize)});if(options.status)params.set('status',options.status);if(options.search)params.set('search',options.search);if(options.eligible)params.set('eligible','true');if(options.ownedOnly)params.set('ownedOnly','true');if(options.approvalScope)params.set('approvalScope','true');const result=await request<PageResponse<AssetResponse>>(`/assets?${params}`,{signal});return {...result,items:result.items.map(mapAsset)}},
  assetHistory(id:string){return request<AssetHistoryEvent[]>(`/assets/${id}/history`)},
  assetHistoryPage(id:string,page:number,signal?:AbortSignal){return request<AssetHistoryResponse>(`/assets/${id}/history?page=${page}&pageSize=10`,{signal})},
  async requests(signal?:AbortSignal){return(await request<RequestResponse[]>('/requests',{signal})).map(mapRequest)},
  async requestDetail(id:string,signal?:AbortSignal){return mapRequest(await request<RequestResponse>(`/requests/${id}`,{signal}))},
  requestSnapshot(id:string,signal?:AbortSignal){return request<RequestResponse>(`/requests/${encodeURIComponent(id)}`,{signal})},
  async requestPage(options:{page:number;pageSize:number;status?:string;type?:string;search?:string;emergency?:boolean;excludePending?:boolean;createdByMe?:boolean;approvalScope?:boolean},signal?:AbortSignal){const params=new URLSearchParams({page:String(options.page),pageSize:String(options.pageSize)});if(options.status)params.set('status',options.status);if(options.type)params.set('type',options.type);if(options.search)params.set('search',options.search);if(options.emergency!==undefined)params.set('emergency',String(options.emergency));if(options.excludePending)params.set('excludePending','true');if(options.createdByMe)params.set('createdByMe','true');if(options.approvalScope)params.set('approvalScope','true');const result=await request<PageResponse<RequestResponse>>(`/requests?${params}`,{signal});return {...result,items:result.items.map(mapRequest)}},
  notificationPage(options:{page:number;pageSize:number;read?:boolean},signal?:AbortSignal){const params=new URLSearchParams({page:String(options.page),pageSize:String(options.pageSize)});if(options.read!==undefined)params.set('read',String(options.read));return request<PageResponse<NotificationResponse>>(`/notifications?${params}`,{signal})},
  async policies(signal?:AbortSignal){return request<PolicyResponse[]>('/policies',{signal})},
  adminPolicies(signal?: AbortSignal) { return request<AdminPolicy[]>('/policies/admin', { signal }); },
  policyHistory(id: string, signal?: AbortSignal) { return request<PolicyVersion[]>(`/policies/${id}/versions`, { signal }); },
  async dashboard(signal?:AbortSignal,role?:UserRole){
    const data=await request<DashboardResponse>(`/dashboard${role?`?role=${role}`:''}`,{signal});
    const metrics=dashboardMetrics(data,role);
    const invalidLifecycle=role==='USER'&&(!data.lifecycle||(['live','within30','within180','after180'] as const).some(key=>{
      const value=data.lifecycle?.[key];return value===undefined||value===null||!Number.isFinite(Number(value));
    }));
    if(role&&(!Array.isArray(data.trend)||!Array.isArray(data.composition)||invalidLifecycle))throw new ApiError('INVALID_DASHBOARD','Dữ liệu biểu đồ hoặc phân bố thời hạn chưa đầy đủ. Hãy thử tải lại.',502);
    return {...data,metrics,lifecycle:data.lifecycle?{...data.lifecycle,priority:data.lifecycle.priority?mapAsset(data.lifecycle.priority):null}:undefined};
  },
  async dashboardSummary(role:UserRole,signal?:AbortSignal){const data=await request<DashboardSummaryResponse>(`/dashboard/summary?role=${role}`,{signal});return {...data,metrics:dashboardMetrics(data,role)}},
  createPolicy(body: PolicyConfigurationInput & { code: string; name: string }) {
    const code = body.code.trim().toUpperCase();
    return mutate<AdminPolicy>({ kind:'policy-create', key:'policy:new', expectedCode:code, resources:mutationResources.policy, reviewPath:'/policies' },
      '/policies', { method:'POST', body:JSON.stringify({ ...body, code }) });
  },
  createPolicyVersion(id: string, body: PolicyConfigurationInput & { expectedVersion: number }) {
    return mutate<PolicyVersion>({ kind:'policy-version', key:`policy:${id}`, targetId:id, expectedVersion:body.expectedVersion,
      resources:mutationResources.policy, reviewPath:'/policies' }, `/policies/${id}/versions`, { method:'POST', body:JSON.stringify(body) });
  },
  deactivatePolicy(id: string, expectedVersion: number) {
    return mutate({ kind:'policy-deactivate', key:`policy:${id}`, targetId:id, expectedVersion,
      resources:mutationResources.policy, reviewPath:'/policies' }, `/policies/${id}/deactivate`, { method:'PATCH', body:JSON.stringify({ expectedVersion }) });
  },
  markAllNotificationsRead(){return mutate({kind:'notification-read',key:'notifications:read',resources:mutationResources.notification,reviewPath:'/notifications'},'/notifications/read-all',{method:'PATCH'})},
  markNotificationRead(id:string){return mutate({kind:'notification-read',key:'notifications:read',targetId:id,resources:mutationResources.notification,reviewPath:'/notifications'},`/notifications/${id}/read`,{method:'PATCH'})},
  testEmail(email:string){return mutate<{sent:boolean;to:string}>({kind:'email-test',key:'email:test',resources:['email'],reviewPath:'/operations/email'},'/notifications/test-email',{method:'POST',body:JSON.stringify({email})})},
  emailIssuesPage(options:{page:number;pageSize:number;status?:string},signal?:AbortSignal){const params=new URLSearchParams({page:String(options.page),pageSize:String(options.pageSize)});if(options.status)params.set('status',options.status);return request<PageResponse<EmailIssueResponse>>(`/notifications/delivery-issues?${params}`,{signal})},
  emailDelivery(id: string, signal?: AbortSignal) {
    return request<EmailDeliveryDetail>(`/notifications/delivery-issues/${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
  },
  reconcileEmailDelivery(id: string, body: EmailReconciliation) {
    const expectedStatus = body.outcome === 'ACCEPTED' ? 'SENT' : 'FAILED';
    return mutate<{ id: string; status: 'SENT' | 'FAILED' }>({
      kind: 'email-reconciliation', key: `email:${id}`, targetId: id, expectedStatus,
      resources: ['email', 'summary', 'dashboard', 'audit'], reviewPath: '/operations/email',
    }, `/notifications/delivery-issues/${encodeURIComponent(id)}/reconcile`, { method: 'POST', body: JSON.stringify(body) });
  },
  retryEmailDelivery(id: string, body: EmailRetry) {
    return mutate<{ id: string; status: 'PENDING'; scheduledFor: string }>({
      kind: 'email-retry', key: `email:${id}`, targetId: id,
      resources: ['email', 'summary', 'dashboard', 'audit'], reviewPath: '/operations/email',
    }, `/notifications/delivery-issues/${encodeURIComponent(id)}/retry`, { method: 'POST', body: JSON.stringify(body) });
  },
  providerIssues(options:{page:number;pageSize:number;status?:string},signal?:AbortSignal){
    const params=new URLSearchParams({page:String(options.page),pageSize:String(options.pageSize)});
    if(options.status)params.set('status',options.status);
    return request<PageResponse<ProviderIssue>>(`/operations/provider-issues?${params}`,{signal});
  },
  providerIssue(id:string,signal?:AbortSignal){return request<ProviderIssueDetail>(`/operations/provider-issues/${encodeURIComponent(id)}`,{signal})},
  recoverProviderIssue(id:string,body:{action:RecoveryAction;version:number;reason:string}){
    return mutate({kind:'provider-recovery',key:`provider:${id}`,targetId:id,expectedStatus:recoveryAcknowledgment[body.action],
      expectedVersion:body.version,resources:mutationResources.providerRecovery,reviewPath:'/operations/provider'},
    `/operations/provider-issues/${encodeURIComponent(id)}/actions`,{method:'POST',body:JSON.stringify(body)});
  },
  users(){return request<UserResponse[]>('/users')},
  accountActionAvailability(signal?: AbortSignal) { return publicAccountRequest<{ enabled: boolean }>('/auth/account-actions', signal); },
  async requestPasswordReset(email: string, signal?: AbortSignal) {
    const result = await publicAccountRequest<{ accepted: boolean }>('/auth/password-reset', signal, { email });
    if (result.accepted !== true) throw new ApiError('INVALID_ACKNOWLEDGMENT', 'Chưa xác nhận yêu cầu. Hãy thử lại.', 502);
  },
  async completeAccountAction(mode: 'reset'|'invitation', token: string, newPassword: string, signal?: AbortSignal) {
    const path = mode === 'reset' ? '/auth/password-reset/complete' : '/auth/invitation/accept';
    const result = await publicAccountRequest<{ changed: boolean; loginRequired: boolean }>(path, signal, { token, newPassword });
    if (result.changed !== true || result.loginRequired !== true) throw new ApiError('INVALID_ACKNOWLEDGMENT', 'Chưa xác nhận kết quả. Hãy thử đăng nhập bằng mật khẩu mới.', 502);
  },
  inviteUser(body: { displayName:string; email:string; departmentId:string; roles:UserRole[]; approverDepartmentIds:string[] }) {
    return mutate({kind:'user-invite',key:'user:create',email:body.email.trim().toLowerCase(),resources:mutationResources.user,reviewPath:'/users'},'/users/invitations',{method:'POST',body:JSON.stringify(body)});
  },
  resendInvitation(id: string) {
    return mutate({kind:'user-invite-resend',key:`user:${id}`,targetId:id,resources:mutationResources.user,reviewPath:'/users'},`/users/${encodeURIComponent(id)}/invitation`,{method:'POST'});
  },
  departmentPage(options:{page:number;pageSize:number;active?:boolean;search?:string},signal?:AbortSignal){const params=new URLSearchParams({page:String(options.page),pageSize:String(options.pageSize)});if(options.active!==undefined)params.set('active',String(options.active));if(options.search)params.set('search',options.search);return request<PageResponse<DepartmentResponse>>(`/departments?${params}`,{signal})},
  department(id:string,signal?:AbortSignal){return request<DepartmentDetail>(`/departments/${encodeURIComponent(id)}`,{signal})},
  saveDepartment(id:string,body:{code:string;name:string;version?:number}){return mutate<DepartmentResponse>({kind:'department-save',key:`department:${id}`,targetId:id,expectedVersion:body.version,resources:mutationResources.user,reviewPath:'/users?section=departments'},`/departments/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(body)})},
  departmentStatus(id:string,active:boolean,version:number){return mutate<DepartmentResponse>({kind:'department-status',key:`department:${id}`,targetId:id,expectedStatus:String(active),expectedVersion:version,resources:mutationResources.user,reviewPath:'/users?section=departments'},`/departments/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({active,version})})},
  transferDepartment(id:string,departmentId:string,version:number){return mutate<{updated:boolean;departmentId:string;version:number}>({kind:'user-department',key:`user:${id}`,targetId:id,expectedDepartmentId:departmentId,expectedVersion:version,resources:mutationResources.user,reviewPath:'/users'},`/users/${encodeURIComponent(id)}/department`,{method:'PUT',body:JSON.stringify({departmentId,version})})},
  userPage(options:{page:number;pageSize:number;status?:string;search?:string;userId?:string;email?:string},signal?:AbortSignal){const params=new URLSearchParams({page:String(options.page),pageSize:String(options.pageSize)});if(options.status)params.set('status',options.status);if(options.search)params.set('search',options.search);if(options.userId)params.set('userId',options.userId);if(options.email)params.set('email',options.email);return request<PageResponse<UserResponse>>(`/users?${params}`,{signal})},
  updateUserAccess(id:string,body:unknown){return mutate({kind:'user-access',key:`user:${id}`,targetId:id,resources:mutationResources.user,reviewPath:'/users/access'},`/users/${id}/access`,{method:'PUT',body:JSON.stringify(body)})},
  userReference(signal?:AbortSignal){return request<UserReferenceResponse>('/users/reference-data',{signal})},
  createUser(body:unknown){const email=typeof (body as {email?:unknown})?.email==='string'?(body as {email:string}).email.trim().toLowerCase():undefined;return mutate({kind:'user-create',key:'user:create',email,resources:mutationResources.user,reviewPath:'/users'},'/users',{method:'POST',body:JSON.stringify(body)})},
  updateUserStatus(id:string,status:'ACTIVE'|'INACTIVE'|'LOCKED'){return mutate({kind:'user-status',key:`user:${id}`,targetId:id,expectedStatus:status,resources:mutationResources.user,reviewPath:'/users'},`/users/${id}/status`,{method:'PATCH',body:JSON.stringify({status})})},
  auditPage({page, pageSize, ...filters}: {page: number; pageSize: number} & AuditFilters, signal?: AbortSignal) {
    const params = new URLSearchParams({page: String(page), pageSize: String(pageSize)});
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return request<PageResponse<AuditResponse>>(`/audit-logs?${params}`, {signal});
  },
  auditDetail(id: string, signal?: AbortSignal) {
    return request<AuditDetail>(`/audit-logs/${encodeURIComponent(id)}`, {signal});
  },
  createRequest(body:unknown){return mutate({kind:'request-create',key:'request:create',resources:mutationResources.request,reviewPath:'/requests'},'/requests',{method:'POST',body:JSON.stringify(body)})},
  saveDraft(id:string,body:DraftFields,version?:number){
    const detail=`/requests/${encodeURIComponent(id)}`;
    return mutate<RequestResponse>({kind:'request-draft-save',key:`request:draft-save:${id}`,targetId:id,
      expectedVersion:version,resources:['requests'],reviewPath:detail},`/requests/drafts/${encodeURIComponent(id)}`,
      {method:'PUT',body:JSON.stringify({...body,version})});
  },
  submitDraft(id:string,version:number){
    const detail=`/requests/${encodeURIComponent(id)}`;
    return mutate<RequestResponse>({kind:'request-draft-submit',key:`request:${id}`,targetId:id,
      expectedVersion:version,resources:mutationResources.request,reviewPath:detail},`${detail}/submit`,
      {method:'POST',body:JSON.stringify({version})});
  },
  decide(id:string,body:{decision:'APPROVED'|'REJECTED';comment?:string;version?:string}, firstApproval=false){
    const partial=firstApproval&&body.decision==='APPROVED';
    return mutate({kind:'request-decision',key:`request:${id}`,targetId:id,expectedStatus:partial?'PENDING':body.decision,
      ...(partial&&{expectedVersion:Number(body.version)}),resources:mutationResources.decision,reviewPath:`/requests/${id}`},
    `/requests/${id}/decision`,{method:'POST',body:JSON.stringify(body)});
  },
  cancel(id:string,body?:{version:number;reason?:string}){
    const detail=`/requests/${encodeURIComponent(id)}`;
    return mutate({kind:'request-cancel',key:`request:${id}`,targetId:id,expectedStatus:'CANCELLED',
      expectedVersion:body?.version,resources:mutationResources.request,reviewPath:detail},
      `${detail}/cancel`,{method:'POST',body:body&&JSON.stringify(body)});
  },
};
