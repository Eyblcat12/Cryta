import { CheckCircle2, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { EmailIssueResponse } from './api/contracts/notifications';
import { EmailDeliveryDialog, emailDeliveryStatus, emailDeliveryTime, emailDeliveryType } from './EmailDeliveryDialog';
import { EmailQueueStatus } from './EmailQueueStatus';
import { TableSkeletonRows } from './LoadingOutline';
import { PageSizeSelect } from './PageSizeSelect';
import { useDelayedPending } from './useDelayedPending';
import { useResource } from './useResource';
import { useUrlTableQuery } from './useUrlTableQuery';
import { StatusPill } from './WorkspaceUi';

export function AdminEmailIssues({refreshKey}:{refreshKey:number}) {
  const {page,pageSize,status,updateQuery}=useUrlTableQuery(['FAILED','RECONCILIATION_REQUIRED'] as const,{defaultPageSize:20,search:false});
  const resource=useResource('email:'+JSON.stringify([page,pageSize,status]),signal=>api.emailIssuesPage({page,pageSize,status},signal),refreshKey);
  const {data:result,loading,error}=resource;
  const pending=useDelayedPending(loading,JSON.stringify([page,pageSize,status]));
  const pages=Math.max(1,Math.ceil((result?.total??0)/pageSize));
  const [selected,setSelected]=useState<string|null>(null);
  const [saved,setSaved]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(!loading&&result?.page===page&&page>pages)updateQuery({page:pages},true)},[loading,page,pages,result]);
  useEffect(()=>{
    if(!saved||selected)return;
    const frame=requestAnimationFrame(()=>heading.current?.focus());
    return ()=>cancelAnimationFrame(frame);
  },[saved,selected]);

  function open(item:EmailIssueResponse) {
    setSaved(false);
    setSelected(item.id);
  }
  function viewDetails(item:EmailIssueResponse) {
    return <button className="secondary-button email-view-details" disabled={loading||!!error}
      aria-label={`Xem chi tiết ${emailDeliveryType(item.type)} · ${item.id}`} onClick={()=>open(item)}>Xem chi tiết</button>;
  }
  const items=result?.items??[];
  const statusPill=(item:EmailIssueResponse)=><StatusPill label={emailDeliveryStatus(item.status)} tone={item.status==='FAILED'?'danger':'warning'}/>;
  return <><EmailQueueStatus revision={refreshKey}/><section id="email-health" className="content-section compact-section" aria-labelledby="email-health-title">
    <div className="section-heading"><div><h2 id="email-health-title" ref={heading} tabIndex={-1}>Danh sách email cần xử lý</h2><p>Tra cứu lần gửi và ghi nhận bằng chứng từ nhật ký SMTP.</p></div><button className="icon-button" aria-label="Làm mới danh sách email" disabled={loading} onClick={resource.retry}><RotateCw size={17}/></button></div>
    <label className="form-field"><span>Lọc trạng thái</span><select value={status} onChange={event=>updateQuery({status:event.target.value,page:1})}><option value="">Tất cả mục cần xử lý</option><option value="FAILED">Gửi thất bại</option><option value="RECONCILIATION_REQUIRED">Kết quả chưa rõ</option></select></label>
    <div className="email-list-read">
      <div className="table-pending" role="status">{pending?(result?'Đang cập nhật…':'Đang tải email cần xử lý…'):''}</div>
    </div>
    {error&&<div className="login-error" role="alert">{error}{result&&' Dữ liệu đang hiển thị chưa được cập nhật.'} <button className="text-button" onClick={resource.retry}>Thử lại</button></div>}
    <div className="table-shell" aria-busy={loading}>
      <div className="table-scroll email-delivery-table"><table className="workspace-data-table">
        <colgroup><col style={{width:'25%'}}/><col style={{width:'21%'}}/><col style={{width:'16%'}}/><col style={{width:'8%'}}/><col style={{width:'15%'}}/><col style={{width:'15%'}}/></colgroup>
        <thead><tr><th scope="col">Thông báo</th><th scope="col">Người nhận</th><th scope="col">Trạng thái</th><th scope="col">Lượt gửi</th><th scope="col">Ngày tạo</th><th scope="col">Thao tác</th></tr></thead>
        <tbody>{loading&&!result?<TableSkeletonRows rows={pageSize} columns={6} visible={pending}/>:items.map(item=><tr key={item.id}>
          <td><strong>{emailDeliveryType(item.type)}</strong><small className="cell-subtitle mono-soft">{item.id}</small></td>
          <td><strong>{item.recipientName}</strong><small className="cell-subtitle">{item.recipientEmail}</small></td>
          <td>{statusPill(item)}</td><td>{item.attemptCount}</td><td>{emailDeliveryTime(item.createdAt)}</td><td>{viewDetails(item)}</td>
        </tr>)}</tbody>
      </table></div>
      {!!items.length&&<ul className="email-delivery-list" aria-label="Danh sách email cần xử lý">{items.map(item=><li key={item.id}>
        <div><strong>{emailDeliveryType(item.type)}</strong><small className="cell-subtitle">{item.recipientName} · {item.recipientEmail}</small>
          <small className="cell-subtitle">{item.attemptCount} lượt · {emailDeliveryTime(item.claimedAt??item.createdAt)}</small></div>
        {statusPill(item)}{viewDetails(item)}
      </li>)}</ul>}
      {loading&&!result&&<ul className="email-delivery-list" aria-hidden="true">{Array.from({length:pageSize},(_,index)=><li key={index} className={pending?'table-loading-row-visible':undefined}>
        <div><span className="skeleton-line"/><span className="skeleton-line skeleton-line-short"/></div>
      </li>)}</ul>}
      {!loading&&!error&&!items.length&&<div className="empty-state"><CheckCircle2 size={22}/><strong>Không có email cần xử lý</strong></div>}
    </div>
    <div className="admin-asset-pagination"><span>Trang {page}/{loading||error?'—':pages} · {loading||error?'—':result?.total??'—'} email</span><PageSizeSelect value={pageSize} onChange={value=>updateQuery({pageSize:value})}/><div><button className="secondary-button" disabled={loading||!!error||page<=1} onClick={()=>updateQuery({page:page-1})}>Trước</button><button className="secondary-button" disabled={loading||!!error||page>=pages} onClick={()=>updateQuery({page:page+1})}>Sau</button></div></div>
    </section>
    {selected&&<EmailDeliveryDialog key={selected} id={selected} revision={refreshKey} onClose={()=>setSelected(null)}
      onSaved={()=>{setSaved(true);setSelected(null)}}/>}
  </>;
}
