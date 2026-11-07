import type { WorkspaceResource } from './workspaceRefresh';

export type MutationKind='request-create'|'request-draft-save'|'request-draft-submit'|'request-decision'|'request-cancel'|'user-create'|'user-invite'|'user-invite-resend'|'user-status'|'user-access'|'user-department'|'department-save'|'department-status'|'policy-create'|'policy-version'|'policy-deactivate'|'notification-read'|'email-test'|'provider-recovery';
export interface MutationInput {
  kind:MutationKind; key:string; targetId?:string; email?:string; expectedStatus?:string; expectedVersion?:number; expectedDepartmentId?:string; expectedCode?:string;
  resources:readonly WorkspaceResource[]; reviewPath:string;
}
export interface WorkspaceMutation extends MutationInput {
  id:number; owner:string; startedAt:number; phase:'pending'|'unknown'|'confirmed';
  requestId?:string; resultId?:string; reviewing:boolean; review?:string; reviewError?:string; reviewedAt?:number;
}
let owner='';let sequence=0;
let snapshot:readonly WorkspaceMutation[]=[];
const listeners=new Set<()=>void>();
const reviewControllers=new Map<number,AbortController>();
function publish(next:readonly WorkspaceMutation[]){snapshot=next;for(const listener of listeners)listener()}
export function mutationSnapshot(){return snapshot}
export function subscribeMutations(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
export function clearMutations(){owner='';for(const controller of reviewControllers.values())controller.abort();reviewControllers.clear();publish([])}
export function bindMutationOwner(id:string){if(owner!==id){clearMutations();owner=id}}
export function mutationFor(key:string){return snapshot.find(item=>item.key===key&&item.phase!=='confirmed')}
export function startMutation(input:MutationInput){
  if(snapshot.some(item=>item.key===input.key))return null;
  // Copy only the declared metadata. Never retain a write payload, password or note.
  const item:WorkspaceMutation={id:++sequence,owner,startedAt:Date.now(),phase:'pending',reviewing:false,
    kind:input.kind,key:input.key,targetId:input.targetId,email:input.email,expectedStatus:input.expectedStatus,expectedVersion:input.expectedVersion,expectedDepartmentId:input.expectedDepartmentId,expectedCode:input.expectedCode,
    resources:[...input.resources],reviewPath:input.reviewPath};
  publish([...snapshot.filter(previous=>previous.key!==input.key),item]);return item;
}
export function updateMutation(id:number,changes:Partial<Pick<WorkspaceMutation,'phase'|'requestId'|'resultId'|'reviewing'|'review'|'reviewError'|'reviewedAt'>>){
  if(!snapshot.some(item=>item.id===id))return;
  publish(snapshot.map(item=>item.id===id?{...item,...changes}:item));
}
export function dismissMutation(id:number){
  const item=snapshot.find(item=>item.id===id);
  if(!item||item.phase==='pending'||item.reviewing||(item.phase==='unknown'&&!item.reviewedAt))return false;
  publish(snapshot.filter(item=>item.id!==id));return true;
}
export function rejectMutation(id:number){publish(snapshot.filter(item=>item.id!==id))}
export async function inspectMutation(id:number,read:(item:WorkspaceMutation,signal:AbortSignal)=>Promise<string>){
  const item=snapshot.find(item=>item.id===id);
  if(!item||item.phase!=='unknown'||item.reviewing)return;
  const controller=new AbortController();reviewControllers.set(id,controller);
  updateMutation(id,{reviewing:true,review:undefined,reviewError:undefined,reviewedAt:undefined});
  try{
    const review=await read(item,controller.signal);
    if(!controller.signal.aborted)updateMutation(id,{reviewing:false,review,reviewedAt:Date.now()});
  }catch(error){
    if(!controller.signal.aborted)updateMutation(id,{reviewing:false,reviewError:error instanceof DOMException&&error.name==='AbortError'?'Đã dừng kiểm tra khi thay đổi không gian làm việc. Hãy kiểm tra lại.':error instanceof Error?error.message:'Không thể kiểm tra dữ liệu. Hãy thử lại.'});
  }finally{if(reviewControllers.get(id)===controller)reviewControllers.delete(id)}
}
export const mutationLabels:Record<MutationKind,string>={
  'user-invite':'Mời tài khoản','user-invite-resend':'Gửi lại lời mời',
  'department-save':'Lưu đơn vị','department-status':'Đổi trạng thái đơn vị','user-department':'Chuyển đơn vị',
  'request-create':'Gửi yêu cầu','request-decision':'Gửi quyết định','request-cancel':'Hủy yêu cầu',
  'request-draft-save':'Lưu bản nháp','request-draft-submit':'Gửi bản nháp',
  'user-create':'Tạo tài khoản','user-status':'Cập nhật trạng thái tài khoản','user-access':'Cập nhật quyền truy cập',
  'policy-create':'Tạo chính sách','policy-version':'Phát hành chính sách','policy-deactivate':'Ngừng áp dụng chính sách',
  'notification-read':'Đánh dấu thông báo đã đọc','email-test':'Gửi email kiểm tra',
  'provider-recovery':'Xử lý đối soát provider',
};
export const mutationSuccess:Record<MutationKind,string>={
  'user-invite':'Đã đưa lời mời vào hàng đợi email.','user-invite-resend':'Đã đưa lời mời mới vào hàng đợi email.',
  'department-save':'Đã lưu đơn vị.','department-status':'Đã cập nhật trạng thái đơn vị.','user-department':'Đã chuyển đơn vị. Người dùng cần đăng nhập lại.',
  'request-create':'Yêu cầu đã được gửi để phê duyệt.','request-decision':'Quyết định đã được ghi nhận.',
  'request-draft-save':'Đã lưu bản nháp.','request-draft-submit':'Yêu cầu đã được gửi để phê duyệt.',
  'request-cancel':'Đã hủy yêu cầu.','user-create':'Đã tạo tài khoản. Người dùng phải đổi mật khẩu ở lần đăng nhập đầu tiên.',
  'user-status':'Đã cập nhật trạng thái tài khoản.','user-access':'Đã cập nhật quyền. Người dùng cần đăng nhập lại.',
  'policy-create':'Đã tạo chính sách.','policy-version':'Đã phát hành phiên bản chính sách.','policy-deactivate':'Đã ngừng áp dụng chính sách.',
  'notification-read':'Đã cập nhật trạng thái đã đọc.',
  'email-test':'Máy chủ đã xác nhận gửi email kiểm tra.',
  'provider-recovery':'Đã ghi nhận thao tác đối soát.',
};
export function validAcknowledgment(item:MutationInput,value:unknown){
  if(!value||typeof value!=='object')return false;
  const data=value as Record<string,unknown>;
  const identified=typeof data.id==='string'&&data.id.length>0;
  switch(item.kind){
    case 'department-save':return data.id===item.targetId&&typeof data.active==='boolean'&&data.version===(item.expectedVersion??0)+1;
    case 'department-status':return data.id===item.targetId&&String(data.active)===item.expectedStatus&&data.version===item.expectedVersion!+1;
    case 'user-department':return typeof data.updated==='boolean'&&data.departmentId===item.expectedDepartmentId&&data.version===item.expectedVersion!+(data.updated?1:0);
    case 'request-create':return identified&&data.status==='PENDING';
    case 'request-draft-save':return data.id===item.targetId&&data.status==='DRAFT'&&data.version===(item.expectedVersion??0)+1;
    case 'request-draft-submit':return data.id===item.targetId&&data.status==='PENDING'&&data.version===item.expectedVersion!+1;
    case 'request-cancel':return data.id===item.targetId&&data.status===item.expectedStatus&&
      (item.expectedVersion===undefined||data.version===item.expectedVersion+1);
    case 'request-decision':case 'user-status':return data.id===item.targetId&&data.status===item.expectedStatus;
    case 'provider-recovery':return data.id===item.targetId&&data.status===item.expectedStatus&&data.version===item.expectedVersion!+1;
    case 'user-create':return identified&&typeof item.email==='string'&&data.email===item.email;
    case 'user-invite':return identified&&typeof item.email==='string'&&data.email===item.email&&data.invitationPending===true&&data.status==='INACTIVE';
    case 'user-invite-resend':return data.id===item.targetId&&data.invitationPending===true&&data.queued===true;
    case 'policy-create':return identified&&data.code===item.expectedCode&&data.active===true&&data.effectiveVersion===1;
    case 'policy-version':return identified&&data.policyId===item.targetId&&Number.isSafeInteger(item.expectedVersion)&&data.version===item.expectedVersion!+1;
    case 'policy-deactivate':return data.id===item.targetId&&data.active===false&&data.latestVersion===item.expectedVersion;
    case 'user-access':return data.updated===true;
    case 'notification-read':return Number.isSafeInteger(data.updated)&&Number(data.updated)>=0;
    case 'email-test':return data.sent===true;
  }
}
