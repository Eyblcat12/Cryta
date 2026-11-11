import {
ArrowRight,
Check,
Plus,
RotateCw,
Send,
ShieldAlert,
ShieldCheck,
X,
XCircle
} from 'lucide-react';
import { useEffect,useId,useRef,useState } from 'react';
import { api,ApiError } from './api';
import type { Asset,UserRole } from './types';
import { UnsavedChangesDialog,useUnsavedChanges } from './UnsavedChanges';

import { AssetPicker } from './AssetPicker';
import type { RequestType } from './WorkspaceUi';
import { useDialogBehavior } from './WorkspaceUi';
import { useResource } from './useResource';
import { useDelayedPending } from './useDelayedPending';
import { MutationGuardNotice } from './MutationNotice';
import { useMutationGuard } from './useWorkspaceMutations';
import { draftFields, sameDraft } from './api/contracts/requests';
import type { DraftFields, RequestResponse } from './api/contracts/requests';
function useMounted(){const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);return mounted}

function newDraftId() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function RequestModal({userId,scope,policyRevision,initialType,initialAssetId,initialDraft,onClose,onComplete}:{
  userId:string;scope:string;policyRevision:number;initialType:RequestType;initialAssetId?:string;
  initialDraft?:RequestResponse;onClose:()=>void;onComplete:(id?:string)=>void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const mounted=useMounted();
  const busyRef=useRef(false);
  const useDraft=useRef(!!initialDraft);
  const [draftId]=useState(()=>initialDraft?.id??newDraftId());
  const [savedDraft,setSavedDraft]=useState(initialDraft);
  const saveKey=`request:draft-save:${draftId}`;
  const submitKey=`request:${draftId}`;
  const saveOperation=useMutationGuard(saveKey);
  const submitOperation=useMutationGuard(submitKey);
  const createOperation=useMutationGuard('request:create');
  const operation=saveOperation||submitOperation||(initialDraft?undefined:createOperation);
  const [type, setType] = useState<RequestType>(initialDraft?.type??initialType);
  const policiesResource=useResource(`${scope}:request-policies`,signal=>api.policies(signal),policyRevision,type==='CREATE');
  const policySelectId=useId();
  const policiesPending=useDelayedPending(policiesResource.loading,`${scope}:request-policies:${type}`);
  const policies=policiesResource.data??[];
  const [assetId, setAssetId] = useState(initialDraft?.targetAssetId ?? initialAssetId ?? '');
  const [reason, setReason] = useState(initialDraft?.reason??'');
  const [policyVersionId,setPolicyVersionId]=useState(initialDraft?.policyVersionId??'');
  const [assetType,setAssetType]=useState<'KEY'|'CERTIFICATE'>(initialDraft?.parameters?.assetType==='CERTIFICATE'?'CERTIFICATE':'KEY');
  const [busy,setBusy]=useState<'save'|'submit'|null>(null);
  const [submitError,setSubmitError]=useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [emergency, setEmergency] = useState(!!initialDraft?.emergency);
  const [completed,setCompleted]=useState<{id?:string}|null>(null);
  const reasonInvalid = submitted && reason.trim().length < 10;
  const assetInvalid = submitted && type !== 'CREATE' && !assetId;
  const [selected,setSelected]=useState<Asset|null>(null);
  const [assetValidation,setAssetValidation]=useState({id:'',ready:false});
  const assetReady=assetValidation.id===assetId&&assetValidation.ready;
  const latestPolicies=policies.filter(policy=>!policies.some(other=>other.code===policy.code&&other.version>policy.version));
  const initialPolicyVersionId=latestPolicies.find(policy=>!policy.configuration?.certificate_profile)?.id??'';
  const baseParameters=savedDraft?.type===type&&(type==='CREATE'
    ? (savedDraft.parameters?.assetType??'KEY')===assetType
    : savedDraft.targetAssetId===assetId)?savedDraft.parameters:{};
  const body:DraftFields={
    type,targetAssetId:type==='CREATE'?undefined:assetId||undefined,
    policyVersionId:type==='CREATE'?policyVersionId||undefined
      :(selected?.id===assetId?selected.policyVersionId:undefined)??(savedDraft?.targetAssetId===assetId?savedDraft.policyVersionId??undefined:undefined),
    reason,emergency,
    parameters:type==='CREATE'?{...baseParameters,assetType}:baseParameters??{},
  };
  const dirty=savedDraft?!sameDraft(body,draftFields(savedDraft)):
    type!==initialType||assetId!==(initialAssetId??'')||reason.length>0||(!!policyVersionId&&policyVersionId!==initialPolicyVersionId)||assetType!=='KEY'||emergency;
  const blocker=useUnsavedChanges(dirty&&!completed);
  // Leave only after React and the router have committed the cleared dirty state.
  useEffect(()=>{if(completed)onComplete(completed.id)},[completed,onComplete]);
  useDialogBehavior(dialogRef, closeRef, onClose);
  const compatiblePolicies=latestPolicies.filter(policy=>Boolean(policy.configuration?.certificate_profile)===(assetType==='CERTIFICATE'));
  const policyReady=!policiesResource.loading&&!policiesResource.error&&compatiblePolicies.some(policy=>policy.id===policyVersionId);
  useEffect(()=>{
    if(!initialDraft&&type==='CREATE'&&!compatiblePolicies.some(item=>item.id===policyVersionId))
      setPolicyVersionId(compatiblePolicies[0]?.id??'');
  },[assetType,type,policies,initialDraft]);

  async function persistDraft() {
    useDraft.current=true;
    let saved:RequestResponse;
    try { saved=await api.saveDraft(draftId,body,savedDraft?.version); }
    catch (error) {
      if(!(error instanceof ApiError)||error.code!=='VERSION_CONFLICT')throw error;
      const current=await api.requestSnapshot(draftId);
      if(current.status!=='DRAFT'||current.creatorId!==userId||!Number.isSafeInteger(current.version)||
        current.version!<=0||!sameDraft(body,draftFields(current)))throw error;
      saved=current;
    }
    if(mounted.current)setSavedDraft(saved);
    return saved;
  }

  async function runWrite(action:'save'|'submit',write:()=>Promise<void>) {
    if(busyRef.current||operation)return;
    busyRef.current=true;setBusy(action);setSubmitError('');
    try{await write()}
    catch(error){if(mounted.current)setSubmitError(error instanceof ApiError?error.message:
      action==='save'?'Không thể lưu bản nháp. Hãy thử lại.':'Không thể gửi yêu cầu. Hãy thử lại.')}
    finally{busyRef.current=false;if(mounted.current)setBusy(null)}
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if(busy||operation)return;
    setSubmitted(true);
    if(type==='CREATE'&&!policyReady)return;
    if(type!=='CREATE'&&!assetReady)return;
    if (reason.trim().length < 10 || (type !== 'CREATE' && !assetId)) return;
    if (type === 'REVOKE' && !confirmRevoke) {
      setConfirmRevoke(true);
      return;
    }
    if(!body.policyVersionId){setSubmitError('Không xác định được chính sách hiệu lực cho tài sản.');return}
    await runWrite('submit',async()=>{
      if(!useDraft.current){await api.createRequest(body);if(mounted.current)setCompleted({});return}
      const saved=savedDraft&&sameDraft(body,draftFields(savedDraft))?savedDraft:await persistDraft();
      if(!mounted.current)return;
      await api.submitDraft(saved.id,saved.version!);
      if(mounted.current)setCompleted({id:saved.id});
    });
  };
  const save=()=>runWrite('save',async()=>{
    const saved=savedDraft&&sameDraft(body,draftFields(savedDraft))?savedDraft:await persistDraft();
    if(mounted.current)setCompleted({id:saved.id});
  });

  return <div className="modal-layer" role="presentation">
    <button className="modal-scrim" onClick={onClose} aria-label="Đóng biểu mẫu" />
    <section ref={dialogRef} className="request-modal" role="dialog" aria-modal="true" aria-labelledby="request-modal-title">
      <header><div><p className="eyebrow">{initialDraft?'Bản nháp':'Yêu cầu mới'}</p><h2 id="request-modal-title">{initialDraft?'Sửa bản nháp':'Bạn muốn thực hiện tác vụ nào?'}</h2><span>Yêu cầu sẽ được chuyển đến người phê duyệt khi bạn gửi.</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></header>
      <form onSubmit={submit} noValidate><fieldset className="mutation-fields" disabled={!!busy||operation?.phase==='pending'}>
        {confirmRevoke ? <div className="confirmation-panel" role="alert">
          <span className="confirmation-icon"><ShieldAlert size={24} /></span>
          <div><p className="eyebrow">Xác nhận cuối cùng</p><h3>Thu hồi {selected?.name}</h3><p>Sau khi được phê duyệt và xử lý, tài sản sẽ ngừng hiệu lực và <strong>không thể chuyển lại trạng thái hoạt động</strong>. {emergency ? 'Yêu cầu được đánh dấu khẩn cấp.' : 'Yêu cầu được xử lý theo mức thông thường.'} Quyết định sẽ được ghi Audit Log.</p></div>
        </div> : <>
        <fieldset className="request-types"><legend>Loại yêu cầu</legend>
          {([
            ['CREATE', 'Cấp phát mới', 'Tạo khóa hoặc chứng thư mới', Plus],
            ['RENEW', 'Gia hạn', 'Thay thế tài sản sắp hết hạn', RotateCw],
            ['REVOKE', 'Thu hồi', 'Ngừng hiệu lực một tài sản', XCircle],
          ] as const).map(([value, title, description, Icon]) => <label className={type === value ? 'selected' : ''} key={value}><input type="radio" name="type" value={value} checked={type === value} onChange={() => { setType(value); setSubmitted(false); setConfirmRevoke(false); setEmergency(false); if (value === 'CREATE') setAssetId(''); }} /><span className="request-type-icon"><Icon size={19} /></span><span><strong>{title}</strong><small>{description}</small></span><span className="radio-mark"><Check size={13} /></span></label>)}
        </fieldset>
        {type !== 'CREATE' && <AssetPicker ownerId={userId} value={assetId} invalid={assetInvalid} onValidationChange={(id,ready)=>setAssetValidation(current=>current.id===id&&current.ready===ready?current:{id,ready})} onChange={asset=>{setSelected(asset);setAssetId(asset?.id??'');setConfirmRevoke(false)}}/>}
        {type === 'CREATE' && <div className="form-row"><label className="form-field"><span>Loại tài sản <em>*</em></span><select value={assetType} onChange={e=>setAssetType(e.target.value as 'KEY'|'CERTIFICATE')}><option value="KEY">Khóa mã hóa</option><option value="CERTIFICATE">Chứng thư số</option></select></label><div className="form-field" role="group" aria-label="Chính sách cấp mới" aria-busy={policiesResource.loading}><span><label htmlFor={policySelectId}>Chính sách</label></span><select id={policySelectId} value={policyVersionId} disabled={policiesResource.loading||!!policiesResource.error||!compatiblePolicies.length} onChange={e=>setPolicyVersionId(e.target.value)}>
          {!compatiblePolicies.some(policy=>policy.id===policyVersionId)&&<option value={policyVersionId}>{policiesResource.loading?'Đang tải chính sách…':policiesResource.error?'Chưa tải được chính sách':policyVersionId?'Chính sách đã lưu không còn phù hợp':compatiblePolicies.length?'Chọn chính sách':'Chưa có chính sách phù hợp'}</option>}
          {compatiblePolicies.map(policy=><option value={policy.id} key={policy.id}>{policy.name} v{policy.version}</option>)}</select><small role="status" aria-live="polite">{policiesPending?policiesResource.data?'Đang cập nhật chính sách…':'Đang tải chính sách…':' '}</small></div></div>}
        <label className={`form-field ${reasonInvalid ? 'field-error' : ''}`}><span>Lý do nghiệp vụ <em>*</em></span><textarea value={reason} maxLength={4000} onChange={(event) => { setReason(event.target.value); setConfirmRevoke(false); }} placeholder="Mô tả mục đích sử dụng và phạm vi cần thiết…" aria-invalid={reasonInvalid} aria-describedby="reason-help" /><small id="reason-help">{reasonInvalid ? 'Vui lòng nhập ít nhất 10 ký tự để người duyệt có đủ thông tin.' : 'Không nhập private key, mật khẩu hoặc dữ liệu bí mật.'}</small></label>
        {type === 'REVOKE' && <label className="form-field"><span><input type="checkbox" checked={emergency} onChange={(event) => { setEmergency(event.target.checked); setConfirmRevoke(false); }} /> Đánh dấu khẩn cấp</span><small>Chỉ chọn khi cần ưu tiên xử lý do sự cố hoặc nguy cơ lộ khóa.</small></label>}
        {type === 'REVOKE' ? <div className="inline-alert inline-alert-danger"><ShieldAlert size={19} /><div><strong>Hành động không thể hoàn tác</strong><p>Tài sản đã thu hồi không thể chuyển lại Active. Bạn sẽ xác nhận hậu quả ở bước tiếp theo.</p></div></div> : <div className="policy-preview"><ShieldCheck size={19} /><div><strong>Kiểm tra chính sách tự động</strong><p>Thông số sẽ được kiểm tra trước khi yêu cầu được gửi. Người tạo không thể tự phê duyệt.</p></div></div>}
        </>}
        {type==='CREATE'&&policiesResource.error&&<div className="login-error" role="alert">Chính sách: {policiesResource.error} <button type="button" className="text-button" onClick={policiesResource.retry}>Thử lại</button></div>}
        {type==='CREATE'&&!policiesResource.loading&&!policiesResource.error&&!compatiblePolicies.length&&<p role="status">Chưa có chính sách phù hợp để cấp mới tài sản này.</p>}
        {!initialDraft&&<MutationGuardNotice operationKey="request:create"/>}
        <MutationGuardNotice operationKey={saveKey}/>
        <MutationGuardNotice operationKey={submitKey}/>
        {submitError&&<div className="login-error" role="alert">{submitError}</div>}
        <footer>{confirmRevoke ? <>
          <button type="button" className="quiet-button" disabled={!!busy} onClick={() => setConfirmRevoke(false)}>Quay lại kiểm tra</button>
          <button type="submit" disabled={!!busy||!!operation||!assetReady} className="danger-button">{busy==='submit'?'Đang gửi…':'Xác nhận thu hồi'} <ShieldAlert size={17} /></button>
        </>:<>
          <button type="button" className="quiet-button" disabled={!!busy} onClick={onClose}>Hủy</button>
          <button type="button" className="secondary-button" disabled={!!busy||!!operation} onClick={()=>void save()}>{busy==='save'?'Đang lưu…':'Lưu bản nháp'}</button>
          <button type="submit" disabled={!!busy||!!operation||(type==='CREATE'?!policyReady:!assetReady)} className={type==='REVOKE'?'danger-button':'primary-button'}>{busy==='submit'?'Đang gửi…':type==='REVOKE'?'Tiếp tục thu hồi':'Gửi yêu cầu'} <ArrowRight size={17} /></button>
        </>}</footer>
      </fieldset></form>
    </section>
    <UnsavedChangesDialog open={blocker.state==='blocked'} onStay={()=>blocker.state==='blocked'&&blocker.reset()} onDiscard={()=>blocker.state==='blocked'&&blocker.proceed()}/>
  </div>;
}

export function CancelRequestDialog({requestId,version,onClose,onSuccess}:{
  requestId:string;version:number;onClose:()=>void;onSuccess:()=>void;
}) {
  const mounted=useMounted();
  const closeRef=useRef<HTMLButtonElement>(null);
  const dialogRef=useRef<HTMLElement>(null);
  const sending=useRef(false);
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const operationKey=`request:${requestId}`;
  const operation=useMutationGuard(operationKey);
  useDialogBehavior(dialogRef,closeRef,onClose);
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(sending.current||operation)return;
    sending.current=true;setBusy(true);setError('');
    try {
      await api.cancel(requestId,{version,reason:reason.trim()||undefined});
      if(mounted.current)onSuccess();
    } catch(error) {
      if(mounted.current)setError(error instanceof ApiError?error.message:'Không thể hủy yêu cầu. Hãy thử lại.');
    } finally {
      sending.current=false;if(mounted.current)setBusy(false);
    }
  };
  return <div className="modal-layer" role="presentation">
    <button className="modal-scrim" onClick={onClose} aria-label="Đóng xác nhận hủy"/>
    <section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-request-title">
      <header><div><p className="eyebrow">Dừng yêu cầu</p><h2 id="cancel-request-title">Hủy yêu cầu này?</h2>
        <span>Yêu cầu đã hủy sẽ dừng trước bước duyệt. Lịch sử được giữ để tra cứu.</span></div>
        <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button>
      </header>
      <form onSubmit={submit}><fieldset className="mutation-fields" disabled={busy||operation?.phase==='pending'}>
        <label className="form-field"><span>Lý do hủy</span>
          <textarea value={reason} maxLength={500} onChange={event=>setReason(event.target.value)} aria-describedby="cancel-reason-help"/>
          <small id="cancel-reason-help">Tùy chọn, tối đa 500 ký tự. Không nhập dữ liệu bí mật.</small>
        </label>
        <MutationGuardNotice operationKey={operationKey}/>
        {error&&<div className="login-error" role="alert">{error}</div>}
        <footer><button type="button" className="quiet-button" disabled={busy} onClick={onClose}>Giữ yêu cầu</button>
          <button type="submit" className="danger-button" disabled={busy||!!operation}>{busy?'Đang hủy…':'Xác nhận hủy'}</button>
        </footer>
      </fieldset></form>
    </section>
  </div>;
}

export function TestEmailDialog({onClose,onSuccess}:{onClose:()=>void;onSuccess:(email:string)=>void}){
  const mounted=useMounted();const operation=useMutationGuard('email:test');
  const[email,setEmail]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');const closeRef=useRef<HTMLButtonElement>(null);const dialogRef=useRef<HTMLElement>(null);useDialogBehavior(dialogRef,closeRef,onClose);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(busy||operation)return;setBusy(true);setError('');try{await api.testEmail(email.trim());if(mounted.current)onSuccess(email.trim())}catch(reason){setError(reason instanceof ApiError?reason.message:'Không thể gửi email kiểm tra.');setBusy(false)}};
  return <div className="modal-layer" role="presentation"><button className="modal-scrim" onClick={onClose} aria-label="Đóng gửi email kiểm tra"/><section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="test-email-title"><header><div><p className="eyebrow">Xác minh SMTP</p><h2 id="test-email-title">Gửi email kiểm tra</h2><span>Thư được gửi trực tiếp qua cấu hình SMTP hiện tại.</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></header><form onSubmit={submit}><fieldset className="mutation-fields" disabled={busy||operation?.phase==='pending'}><label className="form-field"><span>Email nhận <em>*</em></span><input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="admin@congty.com" required autoFocus/><small>Chỉ dùng địa chỉ bạn có quyền kiểm tra hộp thư.</small></label><MutationGuardNotice operationKey="email:test"/>{error&&<div className="login-error" role="alert">{error}</div>}<footer><button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Hủy</button><button className="primary-button" disabled={busy||!!operation}><Send size={16}/>{busy?'Đang gửi…':'Gửi email thử'}</button></footer></fieldset></form></section></div>
}

export function DecisionDialog({ action, requestId, level, onClose, onSuccess }: { action: 'APPROVE' | 'REJECT'; requestId: string; level?:1|2; onClose: () => void; onSuccess: (action: 'APPROVE' | 'REJECT', requestId: string,note:string) => Promise<void> }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy,setBusy]=useState(false);const[submitError,setSubmitError]=useState('');
  const invalid = action === 'REJECT' && submitted && note.trim().length < 10;
  useDialogBehavior(dialogRef, closeRef, onClose);
  const operation=useMutationGuard(`request:${requestId}`);
  const submit = async(event: React.FormEvent) => { event.preventDefault(); if(busy||operation)return;setSubmitted(true); if (action === 'REJECT' && note.trim().length < 10) return;setBusy(true);setSubmitError('');try{await onSuccess(action,requestId,note)}catch(error){setSubmitError(error instanceof ApiError?error.message:'Không thể gửi quyết định.');setBusy(false)} };
  const verb = action === 'APPROVE' ? level ? `Duyệt cấp ${level}` : 'Phê duyệt' : 'Từ chối';
  const effect = action === 'APPROVE' && level === 1 ? 'Yêu cầu sẽ chờ một Approver khác trong cùng phạm vi duyệt cấp 2.'
    : action === 'APPROVE' && level === 2 ? 'Yêu cầu đã đủ cấp và sẽ chuyển sang hàng chờ xử lý sau khi xác nhận.'
    : 'Quyết định sẽ được ghi Audit Log và thông báo cho người gửi.';
  return <div className="modal-layer" role="presentation">
    <button className="modal-scrim" onClick={onClose} aria-label="Đóng xác nhận"/>
    <section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title">
      <header><div><p className="eyebrow">Xác nhận quyết định</p><h2 id="decision-title">{verb} {requestId}</h2><span>{effect}</span></div>
        <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></header>
      <form onSubmit={submit} noValidate><fieldset className="mutation-fields" disabled={busy||operation?.phase==='pending'}>
        <div className={`inline-alert ${action === 'APPROVE' ? '' : 'inline-alert-danger'}`}><ShieldCheck size={19}/><div>
          <strong>{action === 'APPROVE' ? 'Kiểm tra trước khi phê duyệt' : 'Người gửi cần biết cách khắc phục'}</strong>
          <p>{action === 'APPROVE' ? 'Máy chủ sẽ kiểm tra phạm vi, phân tách nhiệm vụ và phiên bản khi gửi quyết định.' : 'Lý do từ chối phải cụ thể, không chứa dữ liệu bí mật.'}</p></div></div>
        <label className={`form-field ${invalid ? 'field-error' : ''}`}><span>Ghi chú quyết định {action === 'REJECT' && <em>*</em>}</span>
          <textarea value={note} onChange={event=>setNote(event.target.value)} placeholder={action === 'APPROVE' ? 'Ghi chú tùy chọn cho người gửi…' : 'Nêu rõ lý do và cách sửa yêu cầu…'} aria-invalid={invalid} aria-describedby="decision-help"/>
          <small id="decision-help">{invalid ? 'Vui lòng nhập ít nhất 10 ký tự.' : 'Không nhập private key, token hoặc dữ liệu bí mật.'}</small></label>
        <MutationGuardNotice operationKey={`request:${requestId}`}/>{submitError&&<div className="login-error" role="alert">{submitError}</div>}
        <footer><button type="button" disabled={busy} className="quiet-button" onClick={onClose}>Hủy</button>
          <button type="submit" disabled={busy||!!operation} className={action === 'APPROVE' ? 'primary-button' : 'danger-button'}>{busy?'Đang gửi…':`Xác nhận ${verb.toLowerCase()}`}</button></footer>
      </fieldset></form>
    </section>
  </div>;
}

export function PasswordChangeDialog({onLogout,onSuccess}:{onLogout:()=>Promise<void>;onSuccess:(currentPassword:string,newPassword:string)=>Promise<void>}) {
  const dialogRef=useRef<HTMLElement>(null);const currentRef=useRef<HTMLInputElement>(null);const[currentPassword,setCurrentPassword]=useState('');const[newPassword,setNewPassword]=useState('');const[confirm,setConfirm]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  useDialogBehavior(dialogRef,currentRef,()=>{});
  const valid=newPassword.length>=12&&/[a-z]/.test(newPassword)&&/[A-Z]/.test(newPassword)&&/\d/.test(newPassword)&&/[^A-Za-z0-9]/.test(newPassword)&&newPassword===confirm;
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setError('');if(!valid){setError('Mật khẩu mới cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số, ký tự đặc biệt và hai ô phải khớp.');return}setBusy(true);try{await onSuccess(currentPassword,newPassword)}catch(err){setError(err instanceof ApiError?err.message:'Không thể đổi mật khẩu.');setBusy(false)}};
  return <div className="modal-layer"><div className="modal-scrim"/><section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="password-title"><header><div><p className="eyebrow">Bảo vệ tài khoản</p><h2 id="password-title">Đổi mật khẩu ban đầu</h2><span>Bạn cần đặt mật khẩu riêng trước khi tiếp tục sử dụng Crypta.</span></div><ShieldCheck size={22}/></header><form onSubmit={submit} noValidate><label className="form-field"><span>Mật khẩu hiện tại</span><input ref={currentRef} type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} required/></label><label className="form-field"><span>Mật khẩu mới</span><input type="password" autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} required minLength={12}/><small>Ít nhất 12 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt.</small></label><label className="form-field"><span>Nhập lại mật khẩu mới</span><input type="password" autoComplete="new-password" value={confirm} onChange={event=>setConfirm(event.target.value)} required/></label>{error&&<div className="login-error" role="alert">{error}</div>}<footer><button type="button" className="quiet-button" disabled={busy} onClick={()=>void onLogout()}>Đăng xuất</button><button className="primary-button" disabled={busy||!currentPassword}>{busy?'Đang cập nhật…':'Đổi mật khẩu'}</button></footer></form></section></div>;
}

export function generateInitialPassword(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';const bytes=crypto.getRandomValues(new Uint8Array(16));return `Aa9!${Array.from(bytes,value=>alphabet[value%alphabet.length]).join('')}`}

export function CreateUserDialog({onClose,onSuccess,invitation=false}:{onClose:()=>void;onSuccess:()=>Promise<void>;invitation?:boolean}) {
  const dialogRef=useRef<HTMLElement>(null);const closeRef=useRef<HTMLButtonElement>(null);const[name,setName]=useState('');const[email,setEmail]=useState('');const[departmentId,setDepartmentId]=useState('');const[initialDepartmentId,setInitialDepartmentId]=useState('');const[role,setRole]=useState<UserRole>('USER');const[scopes,setScopes]=useState<string[]>([]);const[password,setPassword]=useState(()=>invitation?'':generateInitialPassword());const initialPassword=useRef(password).current;const[showPassword,setShowPassword]=useState(false);const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[discardPrompt,setDiscardPrompt]=useState(false);
  const mounted=useMounted();const operation=useMutationGuard('user:create');
  const referenceResource=useResource('create-user-reference',signal=>api.userReference(signal));
  const reference=referenceResource.data;
  const departmentSelectId=useId();const initialPasswordId=useId();
  const referencePending=useDelayedPending(referenceResource.loading,'create-user-reference');
  const referenceReady=!!reference&&!referenceResource.loading&&!referenceResource.error;
  const departmentAvailable=!!reference?.departments.some(item=>item.id===departmentId);
  const selectedScopesAvailable=role!=='APPROVER'||scopes.every(id=>reference?.departments.some(item=>item.id===id));
  const dirty=Boolean(name||email||role!=='USER'||scopes.length||password!==initialPassword||(initialDepartmentId&&departmentId!==initialDepartmentId));
  const blocker=useUnsavedChanges(dirty);
  const requestClose=()=>dirty?setDiscardPrompt(true):onClose();
  const stay=()=>{setDiscardPrompt(false);if(blocker.state==='blocked')blocker.reset()};
  const discard=()=>{setDiscardPrompt(false);if(blocker.state==='blocked'){blocker.proceed();return}onClose()};
  useDialogBehavior(dialogRef,closeRef,requestClose);
  useEffect(()=>{if(reference&&!initialDepartmentId){const first=reference.departments[0]?.id??'';setDepartmentId(first);setInitialDepartmentId(first)}},[reference,initialDepartmentId]);
  const toggleScope=(id:string)=>setScopes(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(busy||operation||!referenceReady||!departmentAvailable||!selectedScopesAvailable)return;setError('');if(name.trim().length<2||!email.includes('@')||!departmentId){setError('Hãy nhập đầy đủ họ tên, email và phòng ban.');return}if(role==='APPROVER'&&!scopes.length){setError('Approver phải được gán ít nhất một phạm vi phòng ban.');return}setBusy(true);try{const profile={displayName:name.trim(),email:email.trim(),departmentId,roles:[role],approverDepartmentIds:role==='APPROVER'?scopes:[]};if(invitation)await api.inviteUser(profile);else await api.createUser({...profile,temporaryPassword:password});if(mounted.current)await onSuccess()}catch(err){setError(err instanceof ApiError?err.message:'Không thể tạo tài khoản.');setBusy(false)}};
  return <div className="modal-layer"><button className="modal-scrim" onClick={requestClose} aria-label="Đóng form tạo người dùng"/><section ref={dialogRef} className="request-modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title"><header><div><p className="eyebrow">Quản trị truy cập</p><h2 id="create-user-title">{invitation?'Mời tài khoản':'Thêm người dùng'}</h2><span>{invitation?'Người nhận sẽ nhận liên kết thiết lập mật khẩu. Tài khoản chờ kích hoạt đến khi chấp nhận lời mời.':'Tài khoản mới bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.'}</span></div><button ref={closeRef} className="icon-button" onClick={requestClose} aria-label="Đóng"><X size={20}/></button></header><form onSubmit={submit} noValidate><fieldset className="mutation-fields" disabled={busy||operation?.phase==='pending'}><div className="form-row"><label className="form-field"><span>Họ và tên <em>*</em></span><input value={name} onChange={event=>setName(event.target.value)} autoComplete="off"/></label><label className="form-field"><span>Email tổ chức <em>*</em></span><input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="off"/></label></div><div className="form-row"><div className="form-field" role="group" aria-label="Danh mục phòng ban" aria-busy={referenceResource.loading}><span><label htmlFor={departmentSelectId}>Phòng ban <em>*</em></label></span><select id={departmentSelectId} value={departmentId} onChange={event=>setDepartmentId(event.target.value)} disabled={!referenceReady||!reference?.departments.length}><option value="" disabled>{referenceResource.loading?'Đang tải phòng ban…':referenceResource.error?'Chưa tải được phòng ban':!reference?.departments.length?'Chưa có phòng ban hoạt động':'Chọn phòng ban'}</option>{reference?.departments.map(item=><option value={item.id} key={item.id}>{item.name} ({item.code})</option>)}</select><small role="status" aria-live="polite">{referencePending?reference?'Đang cập nhật danh mục phòng ban…':'Đang tải danh mục phòng ban…':' '}</small></div><label className="form-field"><span>Vai trò chính <em>*</em></span><select value={role} onChange={event=>{setRole(event.target.value as UserRole);setScopes([])}}><option value="USER">Nhân viên</option><option value="APPROVER">Người phê duyệt</option><option value="ADMIN">Security Admin</option></select></label></div>{role==='APPROVER'&&<fieldset className="scope-options"><legend>Phạm vi phê duyệt <em>*</em></legend>{reference?.departments.map(item=><label key={item.id}><input type="checkbox" disabled={!referenceReady} checked={scopes.includes(item.id)} onChange={()=>toggleScope(item.id)}/><span>{item.name}</span></label>)}</fieldset>}{!invitation&&<div className="form-field"><span><label htmlFor={initialPasswordId}>Mật khẩu ban đầu <em>*</em></label></span><div className="password-input-row"><input id={initialPasswordId} type={showPassword?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password"/><button type="button" className="quiet-button" onClick={()=>setShowPassword(value=>!value)}>{showPassword?'Ẩn':'Hiện'}</button><button type="button" className="quiet-button" onClick={()=>setPassword(generateInitialPassword())}>Tạo lại</button></div><small>Gửi mật khẩu qua kênh an toàn; không đưa vào email thông thường hoặc Audit Log.</small></div>}{referenceResource.error&&<div className="login-error" role="alert">Danh mục phòng ban: {referenceResource.error} <button type="button" className="text-button" disabled={referenceResource.loading} onClick={referenceResource.retry}>Thử lại</button></div>}{reference&&!referenceResource.loading&&!referenceResource.error&&!reference.departments.length&&<p role="status">Chưa có phòng ban hoạt động để tạo tài khoản.</p>}<MutationGuardNotice operationKey="user:create"/>{error&&<div className="login-error" role="alert">{error}</div>}<footer><button type="button" className="quiet-button" disabled={busy} onClick={requestClose}>Hủy</button><button className="primary-button" disabled={busy||!!operation||!referenceReady||!departmentAvailable||!selectedScopesAvailable}>{busy?'Đang gửi…':invitation?'Gửi lời mời':'Tạo tài khoản'}</button></footer></fieldset></form></section><UnsavedChangesDialog open={discardPrompt||blocker.state==='blocked'} onStay={stay} onDiscard={discard}/></div>;
}

export function HelpDialog({onClose}:{onClose:()=>void}){const dialogRef=useRef<HTMLElement>(null);const closeRef=useRef<HTMLButtonElement>(null);useDialogBehavior(dialogRef,closeRef,onClose);return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Đóng trợ giúp"/><section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><header><div><p className="eyebrow">Hướng dẫn nhanh</p><h2 id="help-title">Sử dụng Crypta an toàn</h2><span>Các bước chính cho quy trình tài sản mật mã.</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></header><div className="help-content"><div><strong>Nhân viên</strong><p>Tạo yêu cầu cấp mới, gia hạn hoặc thu hồi. Không nhập private key, token hay mật khẩu vào phần lý do.</p></div><div><strong>Người phê duyệt</strong><p>Kiểm tra người gửi, phạm vi, tài sản và lý do. Nếu dữ liệu đã thay đổi, tải lại trước khi quyết định.</p></div><div><strong>Security Admin</strong><p>Theo dõi tài sản, Audit Log, email lỗi và quyền người dùng. Không thể tự phê duyệt yêu cầu nghiệp vụ.</p></div><div className="inline-alert"><ShieldCheck size={18}/><div><strong>Khi cần hỗ trợ kỹ thuật</strong><p>Gửi mã request hoặc asset và thời điểm xảy ra lỗi; không gửi secret hay tệp private key.</p></div></div></div><footer><button className="primary-button" onClick={onClose}>Đã hiểu</button></footer></section></div>}
