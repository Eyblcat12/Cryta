import { useLayoutEffect,useRef } from 'react';
import type { ReactNode } from 'react';

// Reuse the page's layout without exposing provisional values or controls.
export function LoadingOutline({visible,children}:{visible:boolean;children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{ref.current?.setAttribute('inert','')},[]);
  return <div ref={ref} aria-hidden="true" className={`loading-outline${visible?' loading-outline-visible':''}`}>{children}</div>;
}

export function TableSkeletonRows({rows,columns,visible}:{rows:number;columns:number;visible:boolean}) {
  return <>{Array.from({length:rows},(_,row)=><tr key={row} aria-hidden="true" className={`table-loading-row${visible?' table-loading-row-visible':''}`}>
    {Array.from({length:columns},(_,column)=><td key={column}><span className="skeleton-line"/>{column===0&&<span className="skeleton-line skeleton-line-short"/>}</td>)}
  </tr>)}</>;
}

// Match the established row structure; provisional text and controls stay hidden/inert.
export function ListSkeleton({kind,count,visible}:{kind:'requests'|'notifications'|'timeline';count:number;visible:boolean}) {
  const rows=Array.from({length:count},(_,index)=>kind==='requests'
    ?<div className="request-item" aria-hidden="true" key={index}><span className="request-symbol"/><span className="request-main"><strong> </strong><small> </small></span><span className="status-pill"> </span><span style={{width:17,height:17}}/></div>
    :kind==='notifications'
      ?<article aria-hidden="true" key={index}><span className="activity-icon"/><div><strong> </strong><p> </p><time> </time><div className="notification-actions"><button className="text-button" disabled> </button><button className="text-button" disabled> </button></div></div></article>
      :<li aria-hidden="true" key={index}><span/><div><strong> </strong><small> </small></div></li>);
  return <LoadingOutline visible={visible}>{kind==='timeline'?<ol>{rows}</ol>:rows}</LoadingOutline>;
}

// Reuse detail metadata and timeline geometry while the object's values and
// allowed actions are still unknown. Navigation belongs outside this outline.
export function DetailLoadingOutline({kind,visible}:{kind:'asset'|'request';visible:boolean}) {
  const labels=kind==='asset'?['Loại tài sản','Thuật toán','Ngày hết hạn','Nhà cung cấp']:['Loại yêu cầu','Người phê duyệt'];
  const timeline=<ol>{Array.from({length:3},(_,index)=><li key={index}><span/><div><strong> </strong><small> </small></div></li>)}</ol>;
  return <LoadingOutline visible={visible}><div className="drawer-body detail-loading-outline">
    <div className="drawer-status"><span className="status-pill"> </span><span> </span></div>
    <dl className="detail-grid">{labels.map(label=><div key={label}><dt>{label}</dt><dd> </dd></div>)}</dl>
    {kind==='asset'&&<><div className="detail-block"><span>Mục đích sử dụng</span><p> </p></div><div className="detail-block"><span>Fingerprint công khai</span><code><span style={{width:15,height:15}}/> </code></div></>}
    <div className="mini-timeline"><h3>{kind==='asset'?'Vòng đời tài sản':'Tiến trình xử lý'}</h3>{timeline}</div>
    {kind==='asset'&&<section className="mini-timeline history-timeline">
      <div className="timeline-heading"><h3>Lịch sử hoạt động</h3><span className="icon-button"/></div>
      <div className="timeline-items"><ListSkeleton kind="timeline" count={10} visible={visible}/></div>
      <div className="admin-asset-pagination"><span> </span><div><span className="secondary-button">Trước</span><span className="secondary-button">Sau</span></div></div>
    </section>}
  </div></LoadingOutline>;
}
