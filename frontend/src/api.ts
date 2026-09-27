import type { Asset, AuthUser, RequestItem } from './types';

const API_BASE='/api/v1';
let accessToken:string|undefined;
let refreshing:Promise<AuthSession>|undefined;
type Envelope<T>={data:T;requestId:string};
type AuthSession={accessToken:string;tokenType:string;expiresIn:string;user:AuthUser};

export class ApiError extends Error { constructor(public code:string,message:string,public status:number,public requestId?:string){super(message)} }

async function request<T>(path:string,options:RequestInit={},retry=true):Promise<T>{
  const headers=new Headers(options.headers); if(options.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json'); if(accessToken)headers.set('Authorization',`Bearer ${accessToken}`);
  let response:Response;
  try{response=await fetch(`${API_BASE}${path}`,{...options,headers,credentials:'include'})}catch{throw new ApiError('NETWORK_ERROR','Không thể kết nối máy chủ. Kiểm tra dịch vụ rồi thử lại.',0)}
  if(response.status===401&&retry&&path!=='/auth/login'&&path!=='/auth/refresh'){try{await refresh();return request<T>(path,options,false)}catch{accessToken=undefined}}
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new ApiError(payload?.error?.code??'REQUEST_FAILED',payload?.error?.message??'Yêu cầu không thành công.',response.status,payload?.requestId);
  return (payload as Envelope<T>).data;
}
async function refresh(){if(!refreshing)refreshing=request<AuthSession>('/auth/refresh',{method:'POST'},false).then(s=>(accessToken=s.accessToken,s)).finally(()=>{refreshing=undefined});return refreshing}

function mapAsset(row:any):Asset{return{id:row.id,code:row.code,name:row.purpose,type:row.type,status:row.status,algorithm:[row.algorithm,row.keySize].filter(Boolean).join(' ')||'—',purpose:row.purpose,validFrom:row.validFrom?new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium'}).format(new Date(row.validFrom)):undefined,expiresAt:new Intl.DateTimeFormat('vi-VN').format(new Date(row.expiresAt)),daysLeft:Math.max(0,Math.ceil((new Date(row.expiresAt).getTime()-Date.now())/86400000)),provider:row.providerReference?'Nhà cung cấp đã liên kết':'Chưa liên kết',fingerprint:row.publicKeyFingerprint??row.fingerprint??'Chưa có',ownerName:row.ownerName,departmentName:row.departmentName,policyCode:row.policyCode,policyVersionId:row.policyVersionId,version:row.version}}
function mapRequest(row:any):RequestItem{return{id:row.id,type:row.type,subject:row.reason,status:row.status,submittedAt:new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(row.submittedAt)),emergency:row.emergency,creatorName:row.creatorName,departmentName:row.departmentName,targetAssetCode:row.targetAssetCode,version:row.version}}

export const api={
  async login(email:string,password:string){const session=await request<AuthSession>('/auth/login',{method:'POST',body:JSON.stringify({email,password})},false);accessToken=session.accessToken;return session.user},
  async restore(){const session=await refresh();return session.user},
  async logout(){try{await request('/auth/logout',{method:'POST'},false)}finally{accessToken=undefined}},
  async changePassword(currentPassword:string,newPassword:string){try{return await request('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})},false)}finally{accessToken=undefined}},
  async assets(){return(await request<any[]>('/assets')).map(mapAsset)},
  async requests(){return(await request<any[]>('/requests')).map(mapRequest)},
  async policies(){return request<Array<{id:string;code:string;name:string;version:number;configuration:Record<string,unknown>}>>('/policies')},
  dashboard(){return request<any>('/dashboard')},
  notifications(){return request<any[]>('/notifications')},
  markAllNotificationsRead(){return request('/notifications/read-all',{method:'PATCH'})},
  testEmail(email:string){return request<{sent:boolean;to:string}>('/notifications/test-email',{method:'POST',body:JSON.stringify({email})})},
  users(){return request<any[]>('/users')},
  userReference(){return request<{departments:Array<{id:string;code:string;name:string}>;roles:Array<{code:string;name:string}>}>('/users/reference-data')},
  createUser(body:unknown){return request('/users',{method:'POST',body:JSON.stringify(body)})},
  updateUserStatus(id:string,status:'ACTIVE'|'INACTIVE'|'LOCKED'){return request(`/users/${id}/status`,{method:'PATCH',body:JSON.stringify({status})})},
  auditLogs(){return request<any[]>('/audit-logs?limit=100')},
  createRequest(body:unknown){return request('/requests',{method:'POST',body:JSON.stringify(body)})},
  decide(id:string,body:unknown){return request(`/requests/${id}/decision`,{method:'POST',body:JSON.stringify(body)})},
  cancel(id:string){return request(`/requests/${id}/cancel`,{method:'POST'})},
  emergencyRevoke(assetId:string,reason:string){return request(`/assets/${assetId}/revoke`,{method:'POST',body:JSON.stringify({reason})})},
  createPolicy(body:{code:string;name:string;configuration:Record<string,unknown>}){return request('/policies',{method:'POST',body:JSON.stringify(body)})},
  createPolicyVersion(policyId:string,configuration:Record<string,unknown>){return request(`/policies/${policyId}/versions`,{method:'POST',body:JSON.stringify({configuration})})},
};
