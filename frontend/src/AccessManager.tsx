import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { UnsavedChangesDialog, useUnsavedChanges } from './UnsavedChanges';
import { useResource } from './useResource';
import { MutationGuardNotice } from './MutationNotice';
import { useMutationGuard } from './useWorkspaceMutations';


import type { UserResponse as User } from './api/contracts/users';

export function AccessManager({currentUserId,refreshKey}:{currentUserId:string;refreshKey:number}) {
  const [target,setTarget]=useState<User|null>(null);
  const operation=useMutationGuard(`user:${target?.id??''}`);
  const [role,setRole]=useState('USER');
  const [scopes,setScopes]=useState<string[]>([]);
  const [confirmed,setConfirmed]=useState(false);
  const referenceResource=useResource('access-reference',signal=>api.userReference(signal),refreshKey);
  const departments=referenceResource.data?.departments??[];
  const referenceLoaded=!!referenceResource.data&&!referenceResource.loading&&!referenceResource.error;
  const referenceError=referenceResource.error;
  const activeScopes=scopes.filter(id=>departments.some(department=>department.id===id));
  const hasInvalidScope=referenceLoaded&&activeScopes.length!==scopes.length;
  const scopeValid=role!=='APPROVER'||(scopes.length>0&&!hasInvalidScope);
  const [searchInput,setSearchInput]=useState('');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const listResource=useResource('access-users:'+JSON.stringify([page,search]),signal=>api.userPage({page,pageSize:20,search},signal),refreshKey);
  const {data:result,loading,error:listError}=listResource;
  const [busy,setBusy]=useState(false);
  const [saveError,setSaveError]=useState('');
  const [notice,setNotice]=useState('');
  const [discardPrompt,setDiscardPrompt]=useState(false);
  const [pendingTargetId,setPendingTargetId]=useState<string|null>(null);

  const initialRole=target?(target.roles.includes('ADMIN')?'ADMIN':target.roles.includes('APPROVER')?'APPROVER':'USER'):'USER';
  const initialScopes=[...(target?.approverDepartmentIds??[])].sort().join(',');
  const effectiveScopes=role==='APPROVER'?[...scopes].sort().join(','):'';
  const dirty=Boolean(target)&&(role!==initialRole||effectiveScopes!==(initialRole==='APPROVER'?initialScopes:''));
  const blocker=useUnsavedChanges(dirty);

  const inaccessible=[403,404].includes(listResource.errorStatus??0)||[403,404].includes(referenceResource.errorStatus??0);
  useEffect(()=>{if(inaccessible){setTarget(null);setRole('USER');setScopes([]);setConfirmed(false);setSaveError('');setDiscardPrompt(false);setPendingTargetId(null)}},[inaccessible]);

  function select(id:string){
    if(target?.id===id)return;
    if(dirty){setPendingTargetId(id);setDiscardPrompt(true);return}
    applyTarget(id);
  }
  function applyTarget(id:string){
    setConfirmed(false);
    const user=result?.items.find(item=>item.id===id);
    if(!user){setTarget(null);return}
    setTarget(user);
    setRole(user.roles.includes('ADMIN')?'ADMIN':user.roles.includes('APPROVER')?'APPROVER':'USER');
    setScopes(user.approverDepartmentIds??[]);
    setNotice('');setSaveError('');
  }

  async function save(event:React.FormEvent){
    event.preventDefault();if(!target||busy||operation||loading||listError||!referenceLoaded||!confirmed||!scopeValid)return;
    setBusy(true);setSaveError('');
    try{await api.updateUserAccess(target.id,{roles:[role],approverDepartmentIds:role==='APPROVER'?scopes:[]});setTarget(null);setNotice('Đã cập nhật quyền. Người dùng cần đăng nhập lại.');}
    catch(reason){setSaveError(reason instanceof ApiError?reason.message:'Không cập nhật được quyền.')}
    finally{setBusy(false)}
  }

  function cancel(){setPendingTargetId(null);if(dirty){setDiscardPrompt(true);return}setTarget(null)}
  function stay(){setDiscardPrompt(false);setPendingTargetId(null);if(blocker.state==='blocked')blocker.reset()}
  function discard(){setDiscardPrompt(false);setPendingTargetId(null);if(blocker.state==='blocked'){blocker.proceed();return}if(pendingTargetId!==null){applyTarget(pendingTargetId);return}setTarget(null);setRole('USER');setScopes([])}

  const pages=Math.max(1,Math.ceil((result?.total??0)/20));
  return <section className="content-section" aria-labelledby="access-title">
    <div className="section-heading"><div><h2 id="access-title">Phân quyền và phạm vi phòng ban</h2><p>Thay đổi quyền sẽ kết thúc các phiên đăng nhập của tài khoản.</p></div></div>
    <form className="admin-asset-controls" onSubmit={event=>{event.preventDefault();setPage(1);setSearch(searchInput.trim())}}><label><span className="sr-only">Tìm tài khoản để phân quyền</span><input value={searchInput} maxLength={100} onChange={event=>setSearchInput(event.target.value)} placeholder="Tìm theo tên, email hoặc phòng ban"/></label><button className="secondary-button" type="submit">Tìm tài khoản</button>{search&&<button className="text-button" type="button" onClick={()=>{setSearchInput('');setSearch('');setPage(1)}}>Xóa tìm kiếm</button>}</form>
    {listError&&<div role="alert" className="login-error">{listError} <button type="button" onClick={listResource.retry}>Thử lại</button></div>}
    <div className="help-content" aria-busy={loading}>
      <label className="form-field"><span>Người dùng</span><select aria-label="Người dùng" value={target?.id??''} onChange={event=>select(event.target.value)} disabled={loading||busy||Boolean(listError)}><option value="">{loading?'Đang tải tài khoản…':'Chọn tài khoản'}</option>{!loading&&!listError&&result?.items.filter((user:User)=>user.id!==currentUserId).map((user:User)=><option key={user.id} value={user.id}>{user.displayName} — {user.email}</option>)}{target&&!inaccessible&&(loading||listError||!result?.items.some((user:User)=>user.id===target.id))&&<option value={target.id}>{target.displayName} — {target.email} (đã chọn)</option>}</select></label>
      {!loading&&!listError&&result?.total===0&&<p role="status">Không có tài khoản phù hợp. Thử từ khóa khác.</p>}
      {!loading&&!listError&&result&&<div className="admin-asset-pagination"><span>Trang {page}/{pages} · {result.total} tài khoản</span><div><button type="button" className="secondary-button" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>Trước</button><button type="button" className="secondary-button" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>Sau</button></div></div>}
    </div>
    {target&&!inaccessible&&<form className="help-content" onSubmit={save}><fieldset className="mutation-fields" disabled={busy||operation?.phase==='pending'}><p>Đang chỉnh quyền: <strong>{target.displayName}</strong> ({target.email})</p><label className="form-field"><span>Vai trò</span><select aria-label="Vai trò" value={role} onChange={event=>{setRole(event.target.value);setConfirmed(false)}} disabled={busy}><option value="USER">Nhân viên</option><option value="APPROVER">Người phê duyệt</option><option value="ADMIN">Quản trị bảo mật</option></select></label>{role==='APPROVER'&&<fieldset><legend>Phòng ban được phê duyệt</legend><div className="scope-options">{departments.map(department=><label key={department.id}><input type="checkbox" disabled={busy} checked={scopes.includes(department.id)} onChange={event=>{setScopes(event.target.checked?[...scopes,department.id]:scopes.filter(id=>id!==department.id));setConfirmed(false)}}/>{department.name}</label>)}</div>{hasInvalidScope&&<p role="alert">Có phạm vi thuộc đơn vị đã ngừng hoạt động. <button type="button" className="text-button" onClick={()=>{setScopes(activeScopes);setConfirmed(false)}}>Bỏ phạm vi không còn hiệu lực</button></p>}</fieldset>}<label className="form-field"><span><input type="checkbox" required disabled={busy} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> Xác nhận thay đổi quyền của tài khoản đã chọn.</span></label><div className="heading-actions"><button type="button" className="quiet-button" disabled={busy} onClick={cancel}>Hủy thay đổi</button><button className="primary-button" disabled={busy||!!operation||loading||!!listError||!referenceLoaded||!confirmed||!scopeValid}>{busy?'Đang lưu…':'Lưu quyền truy cập'}</button></div><MutationGuardNotice operationKey={`user:${target.id}`}/>{saveError&&<div role="alert" className="login-error">{saveError}</div>}</fieldset></form>}
    {referenceError&&<div role="alert" className="login-error">{referenceError} <button type="button" onClick={referenceResource.retry}>Thử lại</button></div>}
    {notice&&<p role="status">{notice}</p>}
    <UnsavedChangesDialog open={discardPrompt||blocker.state==='blocked'} onStay={stay} onDiscard={discard}/>
  </section>;
}
