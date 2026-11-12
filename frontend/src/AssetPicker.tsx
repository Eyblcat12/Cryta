import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Asset } from './types';
import { useResource } from './useResource';
import { useDelayedPending } from './useDelayedPending';

export function AssetPicker({value,onChange,onValidationChange,invalid,ownerId}:{value:string;onChange:(asset:Asset|null)=>void;onValidationChange:(id:string,ready:boolean)=>void;invalid:boolean;ownerId:string}) {
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState('');
  const [input,setInput]=useState('');
  const [detailRevision,setDetailRevision]=useState(0);
  const [selectionNotice,setSelectionNotice]=useState<{id:string;message:string}|null>(null);
  const change=useRef(onChange);change.current=onChange;
  const reportValidation=useRef(onValidationChange);reportValidation.current=onValidationChange;
  const listKey='eligible-assets:'+JSON.stringify([ownerId,page,search]);
  const resource=useResource(listKey,signal=>api.assetPage({page,pageSize:20,search,eligible:true,ownedOnly:true},signal));
  const {data:result,loading}=resource;
  const listInaccessible=[401,403,404].includes(resource.errorStatus??0);
  const detailKey='eligible-asset-detail:'+JSON.stringify([ownerId,value]);
  const detail=useResource(detailKey,signal=>api.assetDetail(value,signal),detailRevision,Boolean(value)&&!listInaccessible);
  const detailInaccessible=[401,403,404].includes(detail.errorStatus??0);
  const ineligible=!!detail.data&&(detail.data.ownerId!==ownerId||!['ACTIVE','EXPIRING_SOON'].includes(detail.data.status)||!detail.data.policyVersionId);
  const ineligibleMessage='Tài sản này không thuộc quyền sở hữu của bạn, không còn đủ điều kiện hoặc chưa có chính sách để gia hạn, thu hồi.';
  const error=resource.error||detail.error||(ineligible?ineligibleMessage:selectionNotice?.message??'');
  const selected=!listInaccessible&&!detailInaccessible&&!ineligible?detail.data:null;
  const blocked=loading||detail.loading||!!error;
  const ready=!!selected&&!blocked;
  const listPending=useDelayedPending(loading,listKey);
  const detailPending=useDelayedPending(detail.loading,detailKey);
  // Pair readiness with the reference ID: a row snapshot cannot authorize a POST.
  useLayoutEffect(()=>{reportValidation.current(value,ready)},[value,ready]);
  // Commit the confirmed object before the same frame can expose a ready action.
  useLayoutEffect(()=>{
    if(!value)return;
    if(listInaccessible||detailInaccessible||ineligible){
      if(detailInaccessible||ineligible)setSelectionNotice({id:value,message:detail.error||ineligibleMessage});
      change.current(null);return;
    }
    if(detail.data&&!detail.loading&&!detail.error)change.current(detail.data);
  },[value,listInaccessible,detailInaccessible,ineligible,detail.data,detail.loading,detail.error]);
  const pages=Math.max(1,Math.ceil((result?.total??0)/20));
  useEffect(()=>{if(!loading&&result?.page===page&&page>pages)setPage(pages)},[loading,result,page,pages]);
  const items=(result?.items??[]).filter(asset=>asset.id!==selectionNotice?.id&&(!(detailInaccessible||ineligible)||asset.id!==value)&&asset.ownerId===ownerId&&['ACTIVE','EXPIRING_SOON'].includes(asset.status));
  const options=selected&&!items.some(item=>item.id===selected.id)?[selected,...items]:items;
  const retry=()=>{setSelectionNotice(null);resource.retry();setDetailRevision(current=>current+1)};
  return <div className={`form-field ${invalid?'field-error':''}`} aria-busy={loading||detail.loading}>
    <label htmlFor="request-asset">Tài sản <em>*</em></label>
    <div className="password-input-row"><input aria-label="Tìm tài sản để gia hạn hoặc thu hồi" value={input} maxLength={100} onChange={event=>setInput(event.target.value)} placeholder="Mã hoặc mục đích"/><button type="button" className="secondary-button" onClick={()=>{setSearch(input.trim());setPage(1)}}>Tìm</button></div>
    <select id="request-asset" value={value} disabled={blocked} required aria-invalid={invalid} aria-describedby="asset-help" onChange={event=>{setSelectionNotice(null);onChange(options.find(item=>item.id===event.target.value)??null)}}>
      <option value="">Chọn tài sản của bạn</option>{value&&!listInaccessible&&!detailInaccessible&&!ineligible&&!options.some(asset=>asset.id===value)&&<option value={value}>Tài sản đã chọn đang chờ xác nhận</option>}{options.map(asset=><option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}
    </select>
    <small id="asset-help">{invalid?'Hãy chọn tài sản cần xử lý.':'Chỉ tài sản đang hoạt động hoặc sắp hết hạn được phép chọn.'}</small>
    <small role="status" aria-live="polite">{listPending||detailPending?detailPending?'Đang kiểm tra tài sản đã chọn…':'Đang tải tài sản…':' '}</small>
    {error&&<div className="login-error" role="alert">{error} <button type="button" className="text-button" disabled={loading||detail.loading} onClick={retry}>Thử lại</button></div>}
    <div className="admin-asset-pagination"><span>Trang {page}/{blocked?'—':pages} · {blocked?'—':result?.total??'—'} tài sản</span><div><button type="button" className="secondary-button" disabled={blocked||page<=1} onClick={()=>setPage(page-1)}>Trước</button><button type="button" className="secondary-button" disabled={blocked||page>=pages} onClick={()=>setPage(page+1)}>Sau</button></div></div>
  </div>;
}
