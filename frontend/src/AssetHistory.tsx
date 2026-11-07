import { useEffect,useId,useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Link,useLocation } from 'react-router';
import { api } from './api';
import { assetHistoryLabel } from './assetHistoryLabels';
import { ListSkeleton } from './LoadingOutline';
import { useDelayedPending } from './useDelayedPending';
import { useResource } from './useResource';

export function AssetHistory({id,revision=0,version,canOpenRequests=false}:{id:string;revision?:number;version?:number;canOpenRequests?:boolean}) {
  const location=useLocation();
  const titleId=useId();
  const [paging,setPaging]=useState({id,page:1});
  const page=paging.id===id?paging.page:1;
  const setPage=(next:number|((current:number)=>number))=>setPaging({id,page:typeof next==='function'?next(page):next});
  const key=`history:${id}:${page}:${version??0}`;
  const resource=useResource(key,signal=>api.assetHistoryPage(id,page,signal),revision);
  const {data:result,loading,error}=resource;
  const pending=useDelayedPending(loading,key);
  const blocked=loading||!!error;
  const pages=Math.max(1,Math.ceil((result?.total??0)/10));
  useEffect(()=>{if(!loading&&!error&&result?.page===page&&page>pages)setPage(pages)},[loading,error,result,page,pages]);
  return <section className="mini-timeline history-timeline" aria-labelledby={titleId} aria-busy={loading}>
    <div className="timeline-heading"><h3 id={titleId}>Lịch sử hoạt động</h3><button className="icon-button" aria-label="Làm mới lịch sử tài sản" disabled={loading} onClick={resource.retry}><RotateCw size={16}/></button></div>
    {!!result?.lineage.assets?.length&&<p className="timeline-lineage">{result.lineage.assets.map(asset=><span key={asset.id}>{asset.relation==='predecessor'?'Thay thế: ':'Được thay thế bởi: '}<Link to={`/assets/${encodeURIComponent(asset.id)}`} state={location.state} replace aria-disabled={blocked||undefined} tabIndex={blocked?-1:undefined} onClick={event=>{if(blocked)event.preventDefault()}}>{asset.code}</Link>. </span>)}</p>}
    {!result?.lineage.assets?.length&&(result?.lineage.replaces||result?.lineage.replacedBy.length)?<p className="timeline-lineage">{result?.lineage.replaces&&<>Thay thế: <strong>{result.lineage.replaces}</strong>. </>}{Boolean(result?.lineage.replacedBy.length)&&<>Được thay thế bởi: <strong>{result!.lineage.replacedBy.join(', ')}</strong>.</>}</p>:null}
    {error&&<div className="login-error" role="alert">{error}{result&&' Dữ liệu đang hiển thị chưa được cập nhật.'} <button className="text-button" onClick={resource.retry}>Thử lại</button></div>}
    <div className="timeline-items">
      {pending&&<div className="table-pending list-pending" role="status" aria-live="polite">{result?'Đang cập nhật…':'Đang tải lịch sử…'}</div>}
      {loading&&!result?<ListSkeleton kind="timeline" count={10} visible={pending}/>:result?.items.length?<ol>{result.items.map(item=><li key={item.id} className="done"><span/><div><strong>{assetHistoryLabel(item.action)}</strong><small>{new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.occurredAt))} · {item.actorName}{item.requestId&&<> · {canOpenRequests?<Link to={`/requests/${encodeURIComponent(item.requestId)}`} state={location.state} replace title={item.requestId} aria-label={`Yêu cầu ${item.requestId}`} aria-disabled={blocked||undefined} tabIndex={blocked?-1:undefined} onClick={event=>{if(blocked)event.preventDefault()}}>Yêu cầu {item.requestId.slice(0,8)}…</Link>:`Yêu cầu ${item.requestId}`}</>}</small></div></li>)}</ol>:!loading&&!error?<p>Chưa có sự kiện được ghi nhận cho tài sản này.</p>:null}
    </div>
    <div className="admin-asset-pagination"><span>Trang {page}/{blocked?'—':pages} · {blocked?'—':result?.total??'—'} sự kiện</span><div><button className="secondary-button" disabled={blocked||page<=1} onClick={()=>setPage(value=>value-1)}>Trước</button><button className="secondary-button" disabled={blocked||page>=pages} onClick={()=>setPage(value=>value+1)}>Sau</button></div></div>
  </section>;
}
