import {
Activity,
AlertTriangle,
ArrowRight,
Bell,
CalendarClock,
Check,
CheckCircle2,
ChevronRight,
ClipboardList,
Clock3,
Database,
FileKey2,
KeyRound,
Plus,
RotateCw,
Search,
Send,
ShieldAlert,
ShieldCheck,
SlidersHorizontal,
Users,
XCircle
} from 'lucide-react';
import { lazy,Suspense,useEffect,useState } from 'react';
import { approvalProgressLabel } from './requestApproval';
import { Link,useLocation } from 'react-router';
import { DepartmentManager,TransferDepartmentDialog } from './DepartmentManager';
import { AccessManager } from './AccessManager';
import { MutationGuardNotice } from './MutationNotice';
import { useMutationGuard } from './useWorkspaceMutations';
import { useWorkspaceMutations } from './useWorkspaceMutations';
import { api,ApiError } from './api';
import type { WorkspaceView } from './routes';
import type { Asset,RequestItem } from './types';
import { useUrlTableQuery } from './useUrlTableQuery';
import { PageSizeSelect } from './PageSizeSelect';
import { useResource } from './useResource';

import { useOpenDetail } from './detailNavigation';
import { TestEmailDialog } from './WorkspaceDialogs';
import type { DashboardData } from './dashboardTypes';
import type { NotificationResponse } from './api/contracts/notifications';
import type { UserResponse } from './api/contracts/users';
import { assetStatus,OverviewInsights,PageHeader,requestStatus,StatusPill } from './WorkspaceUi';
import { ListSkeleton,LoadingOutline,TableSkeletonRows } from './LoadingOutline';
import { useDelayedPending } from './useDelayedPending';
import { useReportExports } from './ReportExports';

const AdminAuditTable = lazy(() => import('./AuditLogPage').then(module => ({ default: module.AdminAuditTable })));

export function UserRequestHistory({refreshKey,initialExpanded=false,history=false,createdByMe=false,approvalScope=false,onOpen,onReload}:{refreshKey:number;initialExpanded?:boolean;history?:boolean;createdByMe?:boolean;approvalScope?:boolean;onOpen:(request:RequestItem)=>void;onReload:()=>Promise<void>}) {
  const [expanded,setExpanded]=useState(initialExpanded);
  const {page,pageSize:selectedPageSize,status,search,searchInput,setSearchInput,updateQuery}=useUrlTableQuery(Object.keys(requestStatus).filter(status=>!history||status!=='PENDING'),{defaultPageSize:10});
  const pageSize=expanded?selectedPageSize:3;
  const resource=useResource('requests:'+JSON.stringify([history,createdByMe,approvalScope,page,pageSize,status,search]),signal=>api.requestPage({page,pageSize,status,search,excludePending:history,createdByMe,approvalScope},signal),refreshKey);
  const {data:result,loading,error}=resource;
  const pending=useDelayedPending(loading,JSON.stringify([history,createdByMe,page,pageSize,status,search]));
  const reports=useReportExports('REQUESTS',{status,search,excludePending:history?'true':undefined,
    createdByMe:createdByMe?'true':undefined,approvalScope:approvalScope?'true':undefined},
  createdByMe?'OWN':'DEPARTMENTS',{enabled:expanded,disabled:loading||!!error,
    filterLabel:[status&&requestStatus[status as keyof typeof requestStatus]?.label,search&&`Từ khóa “${search}”`].filter(Boolean).join(' · ')});
  const pages=Math.max(1,Math.ceil((result?.total??0)/pageSize));
  useEffect(()=>{if(!loading&&result?.page===page&&page>pages)updateQuery({page:pages},true)},[loading,page,pages,result]);
  return <section id="requests" className="content-section compact-section" aria-labelledby="requests-title">
    <div className="section-heading"><div><h2 id="requests-title">{history?'Lịch sử xử lý':`Yêu cầu ${expanded?'của tôi':'gần đây'}`}</h2><p>{expanded?'Tra cứu toàn bộ lịch sử theo trạng thái và từ khóa.':'Theo dõi tiến độ xử lý.'}</p></div><div className="table-heading-actions">{reports.action}<button className="icon-button" aria-label="Làm mới lịch sử yêu cầu" disabled={loading} onClick={()=>void onReload()}><RotateCw size={17}/></button></div></div>
    {expanded&&<form className="admin-asset-controls" onSubmit={event=>{event.preventDefault();updateQuery({page:1,q:searchInput})}}><label><span className="sr-only">Tìm yêu cầu</span><input value={searchInput} maxLength={100} onChange={event=>setSearchInput(event.target.value)} placeholder="Mã, tài sản hoặc lý do"/></label><label><span className="sr-only">Lọc trạng thái yêu cầu</span><select value={status} onChange={event=>updateQuery({status:event.target.value,page:1})}><option value="">Tất cả trạng thái</option>{Object.entries(requestStatus).filter(([value])=>!history||value!=='PENDING').map(([value,meta])=><option key={value} value={value}>{meta.label}</option>)}</select></label><button className="secondary-button" type="submit"><Search size={16}/> Tìm</button>{(search||status)&&<button className="text-button" type="button" onClick={()=>{setSearchInput('');updateQuery({q:'',status:'',page:1})}}>Xóa bộ lọc</button>}</form>}
    {error&&<div className="login-error" role="alert">{error}{result&&' Dữ liệu đang hiển thị chưa được cập nhật.'} <button className="text-button" onClick={resource.retry}>Thử lại</button></div>}
    <div className="request-list" aria-busy={loading}>{pending&&<div className="table-pending list-pending" role="status" aria-live="polite">{result?'Đang cập nhật…':'Đang tải yêu cầu…'}</div>}{loading&&!result?<ListSkeleton kind="requests" count={pageSize} visible={pending}/>:result?.items.length?result.items.map(request=><button className="request-item" key={request.id} disabled={loading||!!error} onClick={()=>onOpen(request)}><span className={`request-symbol request-${request.type.toLowerCase()}`}>{request.type==='CREATE'?<Plus size={17}/>:request.type==='RENEW'?<RotateCw size={17}/>:<XCircle size={17}/>}</span><span className="request-main"><strong>{request.subject}</strong><small>{request.id} · {request.submittedAt}</small></span>{request.emergency&&<span className="emergency-label">Khẩn cấp</span>}<StatusPill {...requestStatus[request.status]}/><ChevronRight size={17}/></button>):!error?<div className="empty-state"><Search size={22}/><strong>{search||status?'Không có yêu cầu phù hợp':'Chưa có yêu cầu'}</strong><p>{search||status?'Thử từ khóa hoặc trạng thái khác.':'Yêu cầu bạn tạo sẽ xuất hiện tại đây.'}</p></div>:null}</div>
    {expanded&&<div className="admin-asset-pagination"><span>Trang {page}/{loading||error?'—':pages} · {loading||error?'—':result?.total??'—'} yêu cầu</span><PageSizeSelect value={pageSize} onChange={value=>updateQuery({pageSize:value})}/><div><button className="secondary-button" disabled={loading||!!error||page<=1} onClick={()=>updateQuery({page:page-1})}>Trước</button><button className="secondary-button" disabled={loading||!!error||page>=pages} onClick={()=>updateQuery({page:page+1})}>Sau</button></div></div>}
    {!initialExpanded&&<button className="section-footer-button" aria-expanded={expanded} onClick={()=>{setExpanded(value=>!value);updateQuery({page:1,status:'',q:''});setSearchInput('')}}>{expanded?'Thu gọn danh sách':'Tra cứu toàn bộ lịch sử'} <ArrowRight className={expanded?'rotate-up':''} size={16}/></button>}
    {reports.panel}
  </section>;
}

export function NotificationPanel({refreshKey,unreadCount,onNotify,onOpenAsset,onOpenRequest}:{refreshKey:number;unreadCount:number|null;onNotify:(message:string)=>void;onOpenAsset:(asset:Asset)=>void;onOpenRequest:(request:RequestItem)=>void}) {
  const {page,pageSize,updateQuery}=useUrlTableQuery([],{defaultPageSize:10,search:false});
  const setPage=(nextPage:number,replace=false)=>updateQuery({page:nextPage},replace);
  const [marking,setMarking]=useState(false);
  const [opening,setOpening]=useState('');
  const [openError,setOpenError]=useState<{id:string;message:string}|null>(null);
  const resource=useResource('notifications:'+JSON.stringify([page,pageSize]),signal=>api.notificationPage({page,pageSize},signal),refreshKey);
  const {data:result,loading,error}=resource;
  const pending=useDelayedPending(loading,JSON.stringify([page,pageSize]));
  const operation=useMutationGuard('notifications:read');
  const markAll=async()=>{setMarking(true);try{await api.markAllNotificationsRead()}catch(reason){onNotify(reason instanceof ApiError?reason.message:'Không thể cập nhật thông báo.')}finally{setMarking(false)}};
  const open=async(item:NotificationResponse)=>{
    setOpening(item.id);setOpenError(null);
    try{
      if(item.assetId)onOpenAsset(await api.assetDetail(item.assetId));
      else if(item.requestId)onOpenRequest(await api.requestDetail(item.requestId));
      else throw new ApiError('MISSING_TARGET','Thông báo này không còn liên kết tới tài sản hoặc yêu cầu.',404);
    }catch(reason){setOpenError({id:item.id,message:reason instanceof ApiError?reason.message:'Không thể mở nội dung thông báo. Có thể quyền xem đã thay đổi.'});setOpening('');return}
    if(!item.readAt&&!operation){try{await api.markNotificationRead(item.id)}catch(reason){onNotify(reason instanceof ApiError?`Đã mở nội dung, nhưng chưa đánh dấu đã đọc: ${reason.message}`:'Đã mở nội dung, nhưng chưa đánh dấu đã đọc.')}}
    setOpening('');
  };
  const markOne=async(item:NotificationResponse)=>{setOpening(item.id);try{await api.markNotificationRead(item.id)}catch(reason){onNotify(reason instanceof ApiError?reason.message:'Không thể đánh dấu đã đọc.')}finally{setOpening('')}};
  const pages=Math.max(1,Math.ceil((result?.total??0)/pageSize));
  useEffect(()=>{if(!loading&&result?.page===page&&page>pages)setPage(pages,true)},[loading,page,pages,result]);
  return <section id="notifications" className="content-section compact-section" aria-labelledby="notifications-title">
    <div className="section-heading notification-heading"><div><h2 id="notifications-title">Thông báo</h2><p>Cập nhật liên quan đến công việc và tài sản của bạn.</p></div><div className="table-heading-actions"><button className="text-button" disabled={loading||!!error||!unreadCount||marking||!!operation} onClick={()=>void markAll()}><Check size={15}/>{marking?'Đang cập nhật…':'Đánh dấu đã đọc'}</button><button className="icon-button" aria-label="Làm mới thông báo" disabled={loading} onClick={resource.retry}><RotateCw size={17}/></button></div></div>
    {error&&<div className="login-error" role="alert">{error}{result&&' Dữ liệu đang hiển thị chưa được cập nhật.'} <button className="text-button" onClick={resource.retry}>Thử lại</button></div>}
    <MutationGuardNotice operationKey="notifications:read"/><div className="activity-list" aria-busy={loading}>{pending&&<div className="table-pending list-pending" role="status" aria-live="polite">{result?'Đang cập nhật…':'Đang tải thông báo…'}</div>}{loading&&!result?<ListSkeleton kind="notifications" count={pageSize} visible={pending}/>:result?.items.length?result.items.map(item=><article key={item.id}><span className={`activity-icon ${item.type.includes('EXPIRED')||item.type.includes('REJECTED')||item.type==='REQUEST_FAILED'?'activity-warning':'activity-success'}`}><Bell size={17}/></span><div><strong>{item.type==='REQUEST_SECOND_APPROVAL'?'Yêu cầu cần phê duyệt cấp hai':item.type==='REQUEST_APPROVED'?'Yêu cầu đã được duyệt':item.type==='REQUEST_REJECTED'?'Yêu cầu bị từ chối':item.type==='REQUEST_COMPLETED'?'Yêu cầu đã hoàn tất':item.type==='REQUEST_FAILED'?'Yêu cầu kết thúc do lỗi xử lý':item.type==='REQUEST_RECONCILIATION_REQUIRED'?'Kết quả xử lý cần được kiểm tra':item.type==='ASSET_EXPIRING'?'Tài sản sắp hết hạn':item.type==='ASSET_EXPIRED'?'Tài sản đã hết hạn':item.type==='ASSET_REVOKED'?'Tài sản đã thu hồi':'Yêu cầu mới'}</strong><p>{item.assetCode??item.description??item.requestId}</p><time>{new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.createdAt))}</time><div className="notification-actions"><button className="text-button" disabled={loading||!!error||opening===item.id} onClick={()=>void open(item)}>Xem chi tiết</button>{!item.readAt&&<button className="text-button" disabled={loading||!!error||opening===item.id||!!operation} onClick={()=>void markOne(item)}>Đánh dấu đã đọc</button>}</div>{openError?.id===item.id&&<div className="login-error" role="alert">{openError.message}</div>}</div>{!item.readAt&&<span className="activity-unread" aria-label="Chưa đọc"/>}</article>):!error?<div className="empty-state"><Bell size={22}/><strong>Chưa có thông báo</strong><p>Cập nhật mới sẽ xuất hiện tại đây.</p></div>:null}</div>
    <div className="admin-asset-pagination"><span>Trang {page}/{loading||error?'—':pages} · {loading||error?'—':result?.total??'—'} thông báo</span><PageSizeSelect value={pageSize} onChange={value=>updateQuery({pageSize:value})}/><div><button className="secondary-button" disabled={loading||!!error||page<=1} onClick={()=>setPage(page-1)}>Trước</button><button className="secondary-button" disabled={loading||!!error||page>=pages} onClick={()=>setPage(page+1)}>Sau</button></div></div>
  </section>;
}

export function ApproverDashboard({ view,refreshKey,dashboard,onOpenRequest,onReload,canReviewQueue=true }: { onOpenRequest:(request:RequestItem)=>void;onReload:()=>Promise<void>;view:'dashboard'|'queue'|'history';refreshKey:number;dashboard:Partial<DashboardData>|null|undefined;canReviewQueue?:boolean; }) {
  const {page,pageSize,search,searchInput,setSearchInput,filters,updateQuery}=useUrlTableQuery([],{enabled:view==='queue',filters:{emergency:['1']}});
  const emergencyOnly=filters.emergency==='1';
  const setEmergencyOnly=(value:boolean)=>updateQuery({filters:{emergency:value?'1':''}});
  const clearQueueFilters=()=>{setSearchInput('');updateQuery({q:'',filters:{emergency:''},page:1})};
  const normalized=search;
  const resource=useResource('queue:'+JSON.stringify([view,page,pageSize,normalized,emergencyOnly]),signal=>api.requestPage({page,pageSize,status:'PENDING',search:normalized,emergency:emergencyOnly?true:undefined,approvalScope:true},signal),refreshKey,view==='queue');
  const {data:queuePage,loading,error}=resource;
  const reports=useReportExports('REQUESTS',{status:'PENDING',search:normalized,emergency:emergencyOnly?'true':undefined,approvalScope:'true'},
    'DEPARTMENTS',{enabled:view==='queue',disabled:loading||!!error,
      filterLabel:['Chờ phê duyệt',emergencyOnly&&'Chỉ khẩn cấp',normalized&&`Từ khóa “${normalized}”`].filter(Boolean).join(' · ')});
  const pending=useDelayedPending(loading,JSON.stringify([view,page,pageSize,normalized,emergencyOnly]));
  const allQueue=queuePage?.items??[];
  const pages=Math.max(1,Math.ceil((queuePage?.total??0)/pageSize));
  useEffect(()=>{if(!loading&&queuePage?.page===page&&page>pages)updateQuery({page:pages},true)},[loading,page,pages,queuePage]);
  const queue=allQueue.map(request=>({id:request.id,version:Number(request.version??0),person:request.creatorName??'Không xác định',department:request.departmentName??'Không xác định',type:request.type==='CREATE'?'Cấp mới':request.type==='RENEW'?'Gia hạn':'Thu hồi',asset:request.targetAssetCode??(request.type==='CREATE'?'Tài sản mới':'Không xác định'),reason:request.subject,age:request.submittedAt,emergency:Boolean(request.emergency),approval:request.approval}));
  const selected = queue[0];
  if(view==='history')return <><PageHeader eyebrow="Trung tâm phê duyệt" title="Lịch sử quyết định" description="Tra cứu các yêu cầu đã rời hàng chờ theo quyền xem của bạn."/><UserRequestHistory refreshKey={refreshKey} initialExpanded history approvalScope onOpen={onOpenRequest} onReload={onReload}/></>;

  if(view==='dashboard')return <>
    <section className="metric-row three-metrics" aria-label="Tổng quan phê duyệt"><article className="metric"><div className="metric-icon metric-icon-blue"><ClipboardList size={20} /></div><div><span>Chờ xử lý</span><strong>{dashboard?.metrics?.pending??'—'}</strong></div><span className="metric-caption">Trong phạm vi được giao</span></article><article className="metric"><div className="metric-icon metric-icon-amber"><ShieldAlert size={20} /></div><div><span>Khẩn cấp</span><strong>{dashboard?.metrics?.emergency??'—'}</strong></div><span className="metric-caption">Cần quyết định sớm</span></article><article className="metric"><div className="metric-icon metric-icon-green"><Clock3 size={20} /></div><div><span>Thời gian chờ TB</span><strong>{dashboard?.metrics?.avg_wait_hours??'—'} giờ</strong></div><span className="metric-caption">Tính từ hàng chờ hiện tại</span></article></section>
    <OverviewInsights role="APPROVER" dashboard={dashboard}/>
    {canReviewQueue&&Number(dashboard?.metrics?.emergency)>0&&<section className="expiry-banner danger-banner" aria-label="Yêu cầu khẩn cấp"><div className="expiry-symbol"><ShieldAlert size={22}/></div><div className="expiry-copy"><div className="banner-title-line"><h2>Có yêu cầu khẩn cấp đang chờ</h2><StatusPill label="Ưu tiên cao" tone="danger"/></div><p>Mở Hàng chờ phê duyệt để kiểm tra và đưa ra quyết định.</p></div><Link className="secondary-button" to="/approvals?emergency=1">Xem hàng chờ khẩn cấp <ArrowRight size={17}/></Link></section>}
  </>;

  const urgent=allQueue.find(item=>item.emergency);
  return <>
    <PageHeader eyebrow="Trung tâm phê duyệt" title="Hàng chờ cần quyết định" description="Ưu tiên yêu cầu rủi ro cao, kiểm tra policy và phân tách nhiệm vụ trước khi xử lý." actions={<button className="primary-button" disabled={loading||!!error||!selected} onClick={()=>{const request=urgent??allQueue[0];if(request)onOpenRequest(request)}}><ShieldAlert size={18}/>{urgent?'Xử lý yêu cầu khẩn cấp':'Mở yêu cầu đầu tiên'}</button>}/>
    <section id="approval-queue" className="content-section" aria-labelledby="queue-title">
      <div className="section-heading"><div><h2 id="queue-title">Hàng chờ phê duyệt</h2><p>Yêu cầu thuộc phạm vi phòng ban được giao.</p></div><div className="table-heading-actions">{reports.action}<span className="filter-button"><SlidersHorizontal size={16}/>{loading||error?'—':queuePage?.total??'—'} yêu cầu</span><button className="icon-button" aria-label="Làm mới hàng chờ" disabled={loading} onClick={resource.retry}><RotateCw size={17}/></button></div></div>
      <div className="table-shell">
        <form className="table-toolbar" onSubmit={event=>{event.preventDefault();updateQuery({q:searchInput})}}>
          <div className="filter-tabs" role="group" aria-label="Lọc hàng chờ"><button type="button" className={!emergencyOnly?'filter-active':''} aria-pressed={!emergencyOnly} onClick={()=>setEmergencyOnly(false)}>Tất cả <span>{dashboard?.metrics?.pending??'—'}</span></button><button type="button" className={emergencyOnly?'filter-active':''} aria-pressed={emergencyOnly} onClick={()=>setEmergencyOnly(true)}>Khẩn cấp <span>{dashboard?.metrics?.emergency??'—'}</span></button></div>
          <label className="inline-search"><Search size={16}/><span className="sr-only">Tìm yêu cầu</span><input value={searchInput} maxLength={100} onChange={event=>setSearchInput(event.target.value)} placeholder="Người gửi, tài sản hoặc lý do"/></label><button className="secondary-button" type="submit">Tìm</button>
          {(normalized||emergencyOnly)&&<button type="button" className="text-button" onClick={clearQueueFilters}>Xóa bộ lọc</button>}
        </form>
        <div className="table-scroll" aria-busy={loading}>
          <table className="workspace-data-table"><colgroup><col style={{width:'18%'}}/><col style={{width:'22%'}}/><col style={{width:'10%'}}/><col style={{width:'17%'}}/><col style={{width:'18%'}}/><col style={{width:'11%'}}/><col style={{width:'4%'}}/></colgroup><thead><tr><th>Mã</th><th>Người gửi</th><th>Loại</th><th>Tài sản</th><th>Ngày gửi</th><th>Mức độ</th><th><span className="sr-only">Mở</span></th></tr></thead><tbody>{loading&&!queuePage?<TableSkeletonRows rows={pageSize} columns={7} visible={pending}/>:queue.map(item=><tr key={item.id}><td><button className="table-link" disabled={loading||!!error} onClick={()=>{const request=allQueue.find(request=>request.id===item.id);if(request)onOpenRequest(request)}}>{item.id}</button>{item.approval&&<small className="cell-subtitle">{approvalProgressLabel(item.approval)}</small>}</td><td><strong>{item.person}</strong><small className="cell-subtitle">{item.department}</small></td><td>{item.type}</td><td><span className="mono-soft">{item.asset}</span></td><td>{item.age}</td><td>{item.emergency?<StatusPill label="Khẩn cấp" tone="danger"/>:<StatusPill label="Bình thường" tone="neutral"/>}</td><td><button className="row-action" disabled={loading||!!error} aria-label={'Mở '+item.id} onClick={()=>{const request=allQueue.find(request=>request.id===item.id);if(request)onOpenRequest(request)}}><ChevronRight size={18}/></button></td></tr>)}</tbody></table>
          {pending&&<div className="table-pending" role="status" aria-live="polite">{queuePage?'Đang cập nhật…':'Đang tải hàng chờ…'}</div>}
          {error&&<div className="empty-state" role="alert"><strong>{error}</strong>{queuePage&&<p>Dữ liệu đang hiển thị chưa được cập nhật.</p>}<button className="secondary-button" onClick={resource.retry}>Thử lại</button></div>}
          {!loading&&!error&&!selected&&<div className="empty-state"><CheckCircle2 size={28}/><strong>{normalized||emergencyOnly?'Không có yêu cầu phù hợp':'Không có yêu cầu chờ xử lý'}</strong><p>{normalized||emergencyOnly?'Thử bỏ bộ lọc hoặc tìm từ khóa khác.':'Hệ thống sẽ gửi thông báo khi có yêu cầu mới.'}</p></div>}
        </div>
      </div>
      <div className="admin-asset-pagination"><span>Trang {page}/{loading||error?'—':pages} · {loading||error?'—':queuePage?.total??'—'} yêu cầu</span><PageSizeSelect value={pageSize} onChange={value=>updateQuery({pageSize:value})}/><div><button className="secondary-button" disabled={loading||!!error||page<=1} onClick={()=>updateQuery({page:page-1})}>Trước</button><button className="secondary-button" disabled={loading||!!error||page>=pages} onClick={()=>updateQuery({page:page+1})}>Sau</button></div></div>
      {reports.panel}
    </section>
  </>;

}

export function AdminDashboard({view,navigate,dashboard,refreshKey,currentUserId,accountActionsEnabled,onCreateUser,onNotify}:{view:WorkspaceView;navigate:(path:string)=>void;dashboard:Partial<DashboardData>|null|undefined;refreshKey:number;currentUserId:string;accountActionsEnabled?:boolean;onCreateUser:()=>void;onNotify:(message:string)=>void}) {
  const openDetail=useOpenDetail(currentUserId,'ADMIN');
  const expiredCount=Number(dashboard?.composition?.find(item=>item.label==='EXPIRED')?.value??0);const approvers=Number(dashboard?.metrics?.approver_users??0);const sodConflicts=Number(dashboard?.metrics?.sod_conflicts??0);
  const emailIssues=Number(dashboard?.metrics?.failed_jobs??0)+Number(dashboard?.metrics?.email_reconciliation??0);
  const [testEmailOpen,setTestEmailOpen]=useState(false);
  if(view==='assets')return <><PageHeader eyebrow="Danh mục toàn tổ chức" title="Tài sản mật mã" description="Tra cứu tài sản theo quyền quản trị và mở từng bản ghi để xem vòng đời."/><AdminAssetsTable refreshKey={refreshKey} onOpen={asset=>openDetail(`/assets/${encodeURIComponent(asset.id)}`)}/></>;
  if(view==='users')return <AdminUsersArea refreshKey={refreshKey} currentUserId={currentUserId} accountActionsEnabled={accountActionsEnabled} onCreateUser={onCreateUser} onNotify={onNotify} navigate={navigate}/>;
  if(view==='access')return <><PageHeader eyebrow="Quản trị truy cập" title="Phân quyền và phạm vi" description="Gán vai trò và phòng ban phê duyệt theo nguyên tắc phân tách nhiệm vụ." actions={<button className="secondary-button" onClick={()=>navigate('/users')}><Users size={17}/> Danh sách người dùng</button>}/><AccessManager refreshKey={refreshKey} currentUserId={currentUserId}/></>;
  if(view==='audit')return <><PageHeader eyebrow="Truy vết an toàn" title="Audit Log" description="Tra cứu nhật ký chỉ đọc và đối chiếu thay đổi theo mã truy vết."/>
    <Suspense fallback={<p role="status">Đang tải nhật ký…</p>}><AdminAuditTable refreshKey={refreshKey}/></Suspense></>;
  if(view==='email')return <><PageHeader eyebrow="Vận hành thông báo" title="Email cần xử lý" description="Kiểm tra thư gửi thất bại hoặc có kết quả chưa rõ trước khi xử lý tiếp." actions={<button className="secondary-button" disabled={dashboard?.services?.email!=='ENABLED'} onClick={()=>setTestEmailOpen(true)}><Send size={16}/> Gửi thử</button>}/><AdminEmailIssues refreshKey={refreshKey} failed={dashboard?.metrics?.failed_jobs??null} uncertain={dashboard?.metrics?.email_reconciliation??null}/>{testEmailOpen&&<TestEmailDialog onClose={()=>setTestEmailOpen(false)} onSuccess={()=>{setTestEmailOpen(false)}}/>}</>;
  return <>
    <section className="metric-row" aria-label="Tổng quan an toàn"><article className="metric"><div className="metric-icon"><Database size={20} /></div><div><span>Tổng tài sản</span><strong>{dashboard?.metrics?.total_assets}</strong></div><span className="metric-caption">{dashboard?.metrics?.departments??0} phòng ban</span></article><article className="metric"><div className="metric-icon metric-icon-amber"><CalendarClock size={20} /></div><div><span>Sắp hết hạn</span><strong>{dashboard?.metrics?.expiring??0}</strong></div><span className="metric-caption">Cần theo dõi</span></article><article className="metric"><div className="metric-icon metric-icon-blue"><Users size={20} /></div><div><span>Tài khoản hoạt động</span><strong>{dashboard?.metrics?.active_users??0}</strong></div><span className="metric-caption">{approvers} người phê duyệt</span></article><article className="metric"><div className="metric-icon metric-icon-amber"><AlertTriangle size={20} /></div><div><span>Email cần xử lý</span><strong>{emailIssues}</strong></div><span className="metric-trend"><Activity size={14} /> Lỗi hoặc cần đối soát</span></article></section>
    <OverviewInsights role="ADMIN" dashboard={dashboard} />
    <div className="admin-overview-grid"><section className="content-section compact-section"><div className="section-heading"><div><h2>Cảnh báo ưu tiên</h2><p>Các vấn đề có thể dẫn đến gián đoạn.</p></div></div><div className="admin-alert-list"><button onClick={() => navigate('/assets?status=EXPIRING_SOON')}><span className="alert-number alert-warning">{dashboard?.metrics?.expiring??'—'}</span><span><strong>Tài sản sắp hết hạn</strong><small>Trạng thái sắp hết hạn hiện tại</small></span><ChevronRight size={18} /></button><button onClick={() => navigate('/assets?status=EXPIRED')}><span className="alert-number alert-warning">{expiredCount}</span><span><strong>Tài sản đã hết hạn</strong><small>Trạng thái hết hạn hiện tại</small></span><ChevronRight size={18} /></button><button onClick={() => navigate('/operations/email')}><span className="alert-number alert-info">{emailIssues}</span><span><strong>Email cần kiểm tra</strong><small>Lỗi chắc chắn hoặc kết quả gửi chưa rõ</small></span><ChevronRight size={18} /></button></div></section><section className="content-section compact-section"><div className="section-heading"><div><h2>Trạng thái dịch vụ</h2><p>Chế độ cấu hình; không thay thế kiểm tra kết nối thực tế.</p></div></div><div className="service-list"><div><span><Database size={18} /><strong>Crypto Provider</strong></span><StatusPill label={dashboard?.services?.cryptoProvider==='HTTP'?'Đã cấu hình HTTP':'Mô phỏng'} tone={dashboard?.services?.cryptoProvider==='HTTP'?'neutral':'warning'} /></div><div><span><Bell size={18} /><strong>Email SMTP</strong></span><button className="text-button" onClick={()=>navigate('/operations/email')}>Mở vận hành <ChevronRight size={14}/></button></div><div><span><CalendarClock size={18} /><strong>Expiry Scan</strong></span><StatusPill label="Đã cấu hình định kỳ" tone="neutral" /></div></div></section></div>
    <div className="admin-overview-grid"><section className="content-section compact-section"><div className="section-heading"><div><h2>Chính sách hiện hành</h2><p>Xem cấu hình và phát hành phiên bản tại trang Chính sách.</p></div></div><button className="secondary-button" onClick={()=>navigate('/policies')}>Mở chính sách <ChevronRight size={16}/></button></section><section className="content-section compact-section"><div className="section-heading"><div><h2>Quyền nhạy cảm</h2><p>Dữ liệu tài khoản thật.</p></div></div><div className="policy-summary"><div><span>Security Admin</span><strong>{dashboard?.metrics?.admin_users??0} người</strong></div><div><span>Approver</span><strong>{approvers} người</strong></div><div><span>Cùng giữ Admin + Approver</span><strong className={sodConflicts?'danger-text':'success-text'}>{sodConflicts} người</strong></div></div></section></div>
  </>;
}

export function AdminEmailIssues({refreshKey,failed,uncertain}:{refreshKey:number;failed:number|null;uncertain:number|null}) {
  const {page,pageSize,status,updateQuery}=useUrlTableQuery(['FAILED','RECONCILIATION_REQUIRED'] as const,{defaultPageSize:20,search:false});
  const resource=useResource('email:'+JSON.stringify([page,pageSize,status]),signal=>api.emailIssuesPage({page,pageSize,status},signal),refreshKey);
  const {data:result,loading,error}=resource;
  const pending=useDelayedPending(loading,JSON.stringify([page,pageSize,status]));
  const pages=Math.max(1,Math.ceil((result?.total??0)/pageSize));
  useEffect(()=>{if(!loading&&result?.page===page&&page>pages)updateQuery({page:pages},true)},[loading,page,pages,result]);
  return <section id="email-health" className="content-section compact-section" aria-labelledby="email-health-title">
    <div className="section-heading"><div><h2 id="email-health-title">Email cần xử lý</h2><p>Chỉ đọc. Không gửi lại khi chưa xác minh trạng thái với nhà cung cấp và người nhận.</p></div><button className="icon-button" aria-label="Làm mới danh sách email" disabled={loading} onClick={resource.retry}><RotateCw size={17}/></button></div>
    <div className="policy-summary"><div><span>Gửi thất bại</span><strong>{failed??'—'}</strong></div><div><span>Kết quả chưa rõ</span><strong>{uncertain??'—'}</strong></div></div>
    {(uncertain??0)>0&&<p role="alert">Một số thư có thể đã được SMTP chấp nhận. Đối chiếu Message-ID với nhà cung cấp trước khi quyết định xử lý.</p>}
    <label className="form-field"><span>Lọc trạng thái</span><select value={status} onChange={event=>updateQuery({status:event.target.value,page:1})}><option value="">Tất cả mục cần xử lý</option><option value="FAILED">Gửi thất bại</option><option value="RECONCILIATION_REQUIRED">Kết quả chưa rõ</option></select></label>
    {error&&<div className="login-error" role="alert">{error}{result&&' Dữ liệu đang hiển thị chưa được cập nhật.'} <button className="text-button" onClick={resource.retry}>Thử lại</button></div>}
    <div className="table-shell" aria-busy={loading}><div className="table-scroll"><table className="workspace-data-table"><colgroup><col style={{width:'19%'}}/><col style={{width:'25%'}}/><col style={{width:'16%'}}/><col style={{width:'15%'}}/><col style={{width:'8%'}}/><col style={{width:'17%'}}/></colgroup><thead><tr><th>Thông báo</th><th>Người nhận</th><th>Loại</th><th>Trạng thái</th><th>Lượt gửi</th><th>Ngày tạo</th></tr></thead><tbody>{loading&&!result?<TableSkeletonRows rows={pageSize} columns={6} visible={pending}/>:result?.items.map(item=><tr key={item.id}><td><span className="mono-soft">{item.id}</span></td><td><strong>{item.recipientName}</strong><small className="cell-subtitle">{item.recipientEmail}</small></td><td>{item.type}</td><td><StatusPill label={item.status==='FAILED'?'Gửi thất bại':'Cần đối soát'} tone="danger"/></td><td>{item.attemptCount}</td><td>{new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.createdAt))}</td></tr>)}</tbody></table>{pending&&<div className="table-pending" role="status" aria-live="polite">{result?'Đang cập nhật…':'Đang tải email cần xử lý…'}</div>}{!loading&&!error&&!result?.items.length&&<div className="empty-state"><CheckCircle2 size={22}/><strong>Không có email cần xử lý</strong></div>}</div></div>
    <div className="admin-asset-pagination"><span>Trang {page}/{loading||error?'—':pages} · {loading||error?'—':result?.total??'—'} email</span><PageSizeSelect value={pageSize} onChange={value=>updateQuery({pageSize:value})}/><div><button className="secondary-button" disabled={loading||!!error||page<=1} onClick={()=>updateQuery({page:page-1})}>Trước</button><button className="secondary-button" disabled={loading||!!error||page>=pages} onClick={()=>updateQuery({page:page+1})}>Sau</button></div></div>
  </section>;
}

function AdminUsersArea(props:Parameters<typeof AdminUsersTable>[0]&{navigate:(path:string)=>void}){
  const location=useLocation(),departments=new URLSearchParams(location.search).get('section')==='departments';
  return <><PageHeader eyebrow="Quản trị truy cập" title="Người dùng và vai trò" description="Quản lý tài khoản và đơn vị; thay đổi vai trò và phạm vi ở màn hình Phân quyền." actions={<button className="secondary-button" onClick={()=>props.navigate('/users/access')}><ShieldCheck size={17}/> Mở phân quyền</button>}/><nav className="organization-tabs" aria-label="Quản lý người dùng"><Link to="/users" aria-current={!departments?'page':undefined}>Tài khoản</Link><Link to="/users?section=departments" aria-current={departments?'page':undefined}>Đơn vị</Link></nav>{departments?<DepartmentManager refreshKey={props.refreshKey} onNotify={props.onNotify}/>:<AdminUsersTable {...props}/>}</>;
}

export function AdminUsersTable({refreshKey,currentUserId,accountActionsEnabled,onCreateUser,onNotify}:{refreshKey:number;currentUserId:string;accountActionsEnabled?:boolean;onCreateUser:()=>void;onNotify:(message:string)=>void}) {
  const {page,pageSize,status,search,searchInput,setSearchInput,filters,updateQuery}=useUrlTableQuery(['ACTIVE','INACTIVE','LOCKED'] as const, {
    filters: { userId: value => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) },
  });
  const { userId } = filters;
  const [changingUser,setChangingUser]=useState('');
  const [transferTarget,setTransferTarget]=useState<UserResponse|null>(null);
  const resource=useResource('users:'+JSON.stringify([page,pageSize,status,search,userId]),signal=>api.userPage({page,pageSize,status,search,userId},signal),refreshKey);
  const {data:result,loading,error}=resource;
  const pending=useDelayedPending(loading,resource.data?'users-refresh':'users-initial');
  const operations=useWorkspaceMutations();
  const changeStatus=async(target:UserResponse)=>{const next=target.status==='ACTIVE'?'INACTIVE':'ACTIVE';setChangingUser(target.id);try{await api.updateUserStatus(target.id,next);}catch(reason){onNotify(reason instanceof ApiError?reason.message:'Không thể cập nhật tài khoản.')}finally{setChangingUser('')}};
  const resend=async(target:UserResponse)=>{setChangingUser(target.id);try{await api.resendInvitation(target.id)}catch(reason){onNotify(reason instanceof ApiError?reason.message:'Không thể gửi lại lời mời.')}finally{setChangingUser('')}};
  const pages=Math.max(1,Math.ceil((result?.total??0)/pageSize));
  useEffect(()=>{if(!loading&&!error&&result?.page===page&&page>pages)updateQuery({page:pages},true)},[loading,error,result,page,pages]);
  return <section id="users" className="content-section" aria-labelledby="users-title">
    <div className="section-heading"><div><h2 id="users-title">Quản trị tài khoản</h2><p>Vô hiệu hóa sẽ thu hồi toàn bộ phiên đăng nhập hiện tại.</p></div><div className="heading-actions"><span className="filter-button"><Users size={16}/>{loading||error?'—':result?.total??'—'} tài khoản</span><button className="primary-button" onClick={onCreateUser}><Plus size={17}/> {accountActionsEnabled?'Mời tài khoản':'Thêm người dùng'}</button></div></div>
    <form className="admin-asset-controls" onSubmit={event=>{event.preventDefault();updateQuery({page:1,q:searchInput.trim()})}}><label><span className="sr-only">Tìm tài khoản</span><input value={searchInput} maxLength={100} onChange={event=>setSearchInput(event.target.value)} placeholder="Tên, email hoặc phòng ban"/></label><label><span className="sr-only">Lọc trạng thái tài khoản</span><select value={status} onChange={event=>updateQuery({status:event.target.value,page:1})}><option value="">Tất cả trạng thái</option><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Vô hiệu hóa</option><option value="LOCKED">Bị khóa</option></select></label><button type="submit" className="secondary-button"><Search size={16}/> Tìm</button>{(search||status||userId)&&<button type="button" className="text-button" onClick={()=>{setSearchInput('');updateQuery({q:'',status:'',page:1,filters:{userId:''}})}}>Xóa bộ lọc</button>}</form>
    {userId && <p className="audit-applied" role="status">Mã tài khoản {userId}</p>}
    {error&&<div className="login-error" role="alert">{error}{result&&' Đang hiển thị dữ liệu lần tải trước.'} <button className="text-button" onClick={resource.retry}>Thử lại</button></div>}
    <div className="table-shell" aria-busy={loading}><div className="table-scroll"><table className="users-table"><colgroup>{[26,15,12,15,17,15].map((width,index)=><col key={index} style={{width:`${width}%`}}/>)}</colgroup><thead><tr><th>Người dùng</th><th>Phòng ban</th><th>Vai trò</th><th>Trạng thái</th><th>Lần đăng nhập cuối</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{loading&&!result?<TableSkeletonRows rows={pageSize} columns={6} visible={pending}/>:result?.items.map(target=><tr key={target.id}><td><strong>{target.displayName}</strong><small className="cell-subtitle">{target.email}</small></td><td>{target.departmentName}</td><td>{target.roles?.join(', ')||'—'}</td><td><StatusPill label={target.status==='ACTIVE'?'Hoạt động':target.status==='LOCKED'?'Bị khóa':target.invitationPending?'Chờ chấp nhận lời mời':'Vô hiệu hóa'} tone={target.status==='ACTIVE'?'success':target.status==='LOCKED'?'danger':'neutral'}/></td><td>{target.lastLoginAt?new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(target.lastLoginAt)):'Chưa đăng nhập'}</td><td><button className={target.status==='ACTIVE'?'danger-quiet-button':'secondary-button'} disabled={loading||!!error||changingUser===target.id||target.invitationPending||target.id===currentUserId||operations.some(item=>item.key===`user:${target.id}`&&item.phase!=='confirmed')} title={target.id===currentUserId?'Không thể vô hiệu hóa chính mình':''} onClick={()=>void changeStatus(target)}>{changingUser===target.id?'Đang lưu…':target.status==='ACTIVE'?'Vô hiệu hóa':'Kích hoạt'}</button>{accountActionsEnabled&&target.invitationPending&&target.status==='INACTIVE'&&<button className="text-button" disabled={loading||!!error||changingUser===target.id||operations.some(item=>item.key===`user:${target.id}`&&item.phase!=='confirmed')} onClick={()=>void resend(target)}>Gửi lại lời mời</button>}<button className="text-button" disabled={loading||!!error||changingUser===target.id||!Number.isSafeInteger(target.version)||operations.some(item=>item.key===`user:${target.id}`&&item.phase!=='confirmed')} onClick={()=>setTransferTarget(target)}>Chuyển đơn vị</button></td></tr>)}</tbody></table><div className="table-pending" role="status" aria-live="polite">{pending&&(result?'Đang cập nhật tài khoản…':'Đang tải tài khoản…')}</div>{!loading&&!error&&!result?.items.length&&<div className="empty-state"><Search size={22}/><strong>Không có tài khoản phù hợp</strong><p>Thử từ khóa hoặc trạng thái khác.</p></div>}</div></div>
    <div className="admin-asset-pagination"><span>Trang {page}/{loading||error?'—':pages} · {loading||error?'—':result?.total??'—'} tài khoản</span><PageSizeSelect value={pageSize} onChange={value=>updateQuery({pageSize:value})}/><div><button className="secondary-button" disabled={loading||!!error||page<=1} onClick={()=>updateQuery({page:page-1})}>Trước</button><button className="secondary-button" disabled={loading||!!error||page>=pages} onClick={()=>updateQuery({page:page+1})}>Sau</button></div></div>
  {transferTarget&&<TransferDepartmentDialog key={transferTarget.id} target={transferTarget} onClose={()=>setTransferTarget(null)} onSaved={()=>{setTransferTarget(null);onNotify('Đã chuyển đơn vị. Người dùng cần đăng nhập lại.')}}/>}
  </section>;
}

export function AdminAssetsTable({refreshKey,personal=false,approvalScope=false,onOpen}:{refreshKey:number;personal?:boolean;approvalScope?:boolean;onOpen?:(asset:Asset)=>void}) {
  const {page,pageSize,status,search,searchInput,setSearchInput,updateQuery}=useUrlTableQuery(Object.keys(assetStatus));
  const resource=useResource('assets:'+JSON.stringify([personal,approvalScope,page,pageSize,status,search]),signal=>api.assetPage({page,pageSize,status,search,ownedOnly:personal,approvalScope},signal),refreshKey);
  const {data:result,loading,error}=resource;
  const reports=useReportExports('ASSETS',{status,search,ownedOnly:personal?'true':undefined,approvalScope:approvalScope?'true':undefined},
    personal?'OWN':approvalScope?'DEPARTMENTS':'GLOBAL',{disabled:loading||!!error,
      filterLabel:[status&&assetStatus[status as keyof typeof assetStatus]?.label,search&&`Từ khóa “${search}”`].filter(Boolean).join(' · ')});
  const pending=useDelayedPending(loading,JSON.stringify([personal,approvalScope,page,pageSize,status,search]));
  const totalPages=Math.max(1,Math.ceil((result?.total??0)/pageSize));
  useEffect(()=>{if(!loading&&!error&&result?.page===page&&page>totalPages)updateQuery({page:totalPages},true)},[loading,page,result,totalPages]);
  return <section id="admin-assets" className="content-section" aria-labelledby="admin-assets-title">
    <div className="section-heading"><div><h2 id="admin-assets-title">{personal?'Tài sản của tôi':approvalScope?'Tài sản trong phạm vi':'Tài sản toàn hệ thống'}</h2><p>{personal?'Tra cứu theo mã hoặc mục đích; bộ lọc áp dụng trên toàn bộ tài sản của bạn.':approvalScope?'Tra cứu trong phạm vi được phép xem; mở tài sản để theo dõi lịch sử và chuỗi gia hạn.':'Tra cứu theo mã, mục đích, owner hoặc phòng ban; kết quả được lọc trên toàn dữ liệu.'}</p></div><div className="table-heading-actions">{reports.action}<span className="filter-button"><SlidersHorizontal size={16}/>{loading||error?'—':result?.total??'—'} mục</span><button className="icon-button" aria-label="Làm mới tài sản" disabled={loading} onClick={resource.retry}><RotateCw size={17}/></button></div></div>
    <form className="admin-asset-controls" onSubmit={event=>{event.preventDefault();updateQuery({page:1,q:searchInput.trim()})}}>
      <label><span className="sr-only">Tìm tài sản</span><input value={searchInput} maxLength={100} onChange={event=>setSearchInput(event.target.value)} placeholder={personal?'Mã hoặc mục đích':'Mã, mục đích, owner, phòng ban'} /></label>
      <label><span className="sr-only">Lọc trạng thái</span><select value={status} onChange={event=>updateQuery({status:event.target.value,page:1})}><option value="">Tất cả trạng thái</option>{Object.entries(assetStatus).map(([value,meta])=><option key={value} value={value}>{meta.label}</option>)}</select></label>
      <button className="secondary-button" type="submit"><Search size={16}/> Tìm</button>
      {(search||status)&&<button className="text-button" type="button" onClick={()=>{setSearchInput('');updateQuery({page:1,q:'',status:''})}}>Xóa bộ lọc</button>}
    </form>
    {error&&<div className="login-error" role="alert">{error}{result&&' Dữ liệu đang hiển thị chưa được cập nhật.'} <button className="text-button" onClick={resource.retry}>Thử lại</button></div>}
    <div className={`table-shell ${personal?'asset-table-shell':''}`} aria-busy={loading}><div className="table-scroll"><table className="workspace-data-table"><colgroup><col style={{width:'25%'}}/><col style={{width:'15%'}}/><col style={{width:'15%'}}/><col style={{width:'15%'}}/><col style={{width:'15%'}}/><col style={{width:'15%'}}/></colgroup><thead><tr><th>Tài sản</th><th>{personal?'Loại':'Owner'}</th><th>{personal?'Thuật toán':'Phòng ban'}</th><th>Trạng thái</th><th>Hết hạn</th><th>Policy</th></tr></thead><tbody>{loading&&!result?<TableSkeletonRows rows={pageSize} columns={6} visible={pending}/>:result?.items.map(asset=><tr key={asset.id}><td><button className="table-link" disabled={loading||!!error} onClick={()=>onOpen?.(asset)}>{asset.code}</button><small className="cell-subtitle">{asset.name}</small></td><td>{personal?(asset.type==='KEY'?'Khóa mã hóa':'Chứng thư số'):asset.ownerName}</td><td>{personal?asset.algorithm:asset.departmentName}</td><td><StatusPill {...assetStatus[asset.status]}/></td><td>{asset.expiresAt}</td><td>{asset.policyCode}</td></tr>)}</tbody></table>{pending&&<div className="table-pending" role="status" aria-live="polite">{result?'Đang cập nhật…':'Đang tải tài sản…'}</div>}{!loading&&!error&&!result?.items.length&&<div className="empty-state"><Search size={22}/><strong>Không có tài sản phù hợp</strong><p>Thử từ khóa hoặc trạng thái khác.</p></div>}</div>{personal&&<div className="asset-mobile-list" aria-label="Danh sách tài sản">{pending&&<div className="table-pending" role="status" aria-live="polite">{result?'Đang cập nhật…':'Đang tải tài sản…'}</div>}{loading&&!result?<LoadingOutline visible={pending}>{Array.from({length:pageSize},(_,index)=><div className="asset-mobile-card" key={index}><span className="asset-type-icon"/><span className="asset-mobile-main"><strong> </strong><small> </small></span><span className="asset-mobile-meta"><span className="status-pill"> </span><small> </small></span></div>)}</LoadingOutline>:result?.items.length?result.items.map(asset=><button key={asset.id} className="asset-mobile-card" disabled={loading||!!error} onClick={()=>onOpen?.(asset)}><span className={`asset-type-icon ${asset.type==='CERTIFICATE'?'certificate':''}`}>{asset.type==='KEY'?<KeyRound size={19}/>:<FileKey2 size={19}/>}</span><span className="asset-mobile-main"><strong>{asset.name}</strong><small>{asset.code} · {asset.algorithm}</small></span><span className="asset-mobile-meta"><StatusPill {...assetStatus[asset.status]}/><small>{asset.daysLeft>0?`${asset.daysLeft} ngày`:'Đã kết thúc'}</small></span><ChevronRight size={18}/></button>):!error?<div className="empty-state"><strong>Không có tài sản phù hợp</strong></div>:null}</div>}</div>
    <div className="admin-asset-pagination"><span>Trang {page}/{loading||error?'—':totalPages} · {loading||error?'—':result?.total??'—'} tài sản</span><PageSizeSelect value={pageSize} onChange={value=>updateQuery({pageSize:value})}/><div><button className="secondary-button" disabled={loading||!!error||page<=1} onClick={()=>updateQuery({page:page-1})}>Trước</button><button className="secondary-button" disabled={loading||!!error||page>=totalPages} onClick={()=>updateQuery({page:page+1})}>Sau</button></div></div>
    {reports.panel}
  </section>;
}
