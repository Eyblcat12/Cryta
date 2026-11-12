import { lazy, Suspense } from 'react';
import { Plus } from 'lucide-react';
import { useLocation,useNavigate,useOutletContext } from 'react-router';
import { useOpenDetail } from './detailNavigation';
import { DashboardPage } from './DashboardPage';
import type { DashboardSummary } from './dashboardTypes';
import { ProviderRecoveryPage } from './ProviderRecoveryPage';
import { RequestPage } from './RequestPage';
import type { WorkspaceView } from './routes';
import type { AuthUser,UserRole } from './types';
import type { Resource } from './useResource';
import type { ResourceRevisions,WorkspaceResource } from './workspaceRefresh';
import { WorkspaceDetailRoute } from './WorkspaceDetailRoute';
import { AdminAssetsTable,AdminDashboard,ApproverDashboard,NotificationPanel,UserRequestHistory } from './WorkspacePages';
import type { RequestType } from './WorkspaceUi';
import { PageHeader,RouteState } from './WorkspaceUi';
import { canCreateRequests } from './workspacePermissions';

const MfaSecurityPage = lazy(() => import('./MfaScreen').then(module => ({ default: module.MfaSecurityPage })));
const PoliciesPage = lazy(() => import('./PoliciesPage').then(module => ({ default: module.PoliciesPage })));

export interface WorkspacePageContext {
  view:WorkspaceView;
  role:UserRole;
  user:AuthUser;
  routeAllowed:boolean;
  scope:string;
  revisions:ResourceRevisions;
  summary?:Resource<DashboardSummary>;
  unreadNotificationCount?:number|null;
  onCloseDetail:()=>void;
  openRequest:(type?:RequestType,assetId?:string)=>void;
  onReload:(resources:readonly WorkspaceResource[])=>Promise<void>;
  onNotify:(message:string)=>void;
  onCreateUser:()=>void;
  onSessionAccepted:(user:AuthUser)=>void;
  onDecision:(action:'APPROVE'|'REJECT',requestId:string,version:number,level?:1|2)=>void;
}

export function WorkspacePage() {
  const context=useOutletContext<WorkspacePageContext>();
  const navigate=useNavigate();const location=useLocation();const openDetail=useOpenDetail(context.user.id,context.role);
  const {view,role,revisions}=context;
  if(view==='not-found')return <RouteState title="Không tìm thấy trang" description="Đường dẫn không tồn tại hoặc đã được thay đổi." actionLabel="Về tổng quan" onAction={()=>navigate('/dashboard')}/>;
  if(!context.routeAllowed)return <RouteState title="Bạn không có quyền mở trang này" description="Vai trò hiện tại không được phép truy cập nội dung đã yêu cầu." actionLabel="Về tổng quan" onAction={()=>navigate('/dashboard')}/>;
  if(view!=='request-new'&&/^\/(assets|requests)\/[^/]+\/?$/.test(location.pathname))return <WorkspaceDetailRoute context={context}/>;
  if(view==='dashboard')return <DashboardPage context={context}/>;
  if(view==='account-security')return <Suspense fallback={<p role="status">Đang tải bảo mật tài khoản…</p>}>
    <MfaSecurityPage user={context.user} onAuthenticated={context.onSessionAccepted}/>
  </Suspense>;
  if(view==='policies')return <Suspense fallback={<p role="status">Đang tải chính sách…</p>}>
    <PoliciesPage context={context}/>
  </Suspense>;
  if(view==='provider-recovery')return <ProviderRecoveryPage scope={context.scope} revision={revisions.providerRecovery}/>;
  if(view==='request-new')return <RequestPage context={context}/>;
  if(view==='notifications')return <><PageHeader eyebrow="Theo dõi" title="Thông báo" description="Cập nhật liên quan đến công việc trong phạm vi của bạn."/><NotificationPanel refreshKey={revisions.notifications} unreadCount={context.unreadNotificationCount??null} onNotify={context.onNotify} onOpenAsset={asset=>openDetail(`/assets/${encodeURIComponent(asset.id)}`)} onOpenRequest={request=>openDetail(`/requests/${encodeURIComponent(request.id)}`)}/></>;
  if(role==='USER')return view==='assets'
    ?<><PageHeader eyebrow="Không gian cá nhân" title="Tài sản của tôi" description="Tra cứu toàn bộ khóa và chứng thư bạn đang sở hữu." actions={canCreateRequests(context.user)&&<button className="primary-button" onClick={()=>context.openRequest()}><Plus size={17}/> Tạo yêu cầu</button>}/><AdminAssetsTable refreshKey={revisions.assets} personal onOpen={asset=>openDetail(`/assets/${encodeURIComponent(asset.id)}`)}/></>
    :<><PageHeader eyebrow="Theo dõi công việc" title="Yêu cầu của tôi" description="Theo dõi tiến độ cấp mới, gia hạn và thu hồi tài sản." actions={canCreateRequests(context.user)&&<button className="primary-button" onClick={()=>context.openRequest()}><Plus size={17}/> Tạo yêu cầu</button>}/><UserRequestHistory refreshKey={revisions.requests} initialExpanded createdByMe onOpen={request=>openDetail(`/requests/${encodeURIComponent(request.id)}`)} onReload={()=>context.onReload(['requests','summary'])}/></>;
  if(role==='APPROVER'&&view==='assets')return <><PageHeader eyebrow="Trung tâm phê duyệt" title="Tài sản trong phạm vi phê duyệt" description="Tra cứu tài sản thuộc các đơn vị được giao và mở từng bản ghi để xem vòng đời."/><AdminAssetsTable refreshKey={revisions.assets} approvalScope onOpen={asset=>openDetail(`/assets/${encodeURIComponent(asset.id)}`)}/></>;
  if(role==='APPROVER')return view==='requests'
    ?<><PageHeader eyebrow="Trung tâm phê duyệt" title="Chi tiết yêu cầu" description="Mở yêu cầu được phép xem trong phạm vi hiện tại."/><UserRequestHistory refreshKey={revisions.requests} initialExpanded approvalScope onOpen={request=>openDetail(`/requests/${encodeURIComponent(request.id)}`)} onReload={()=>context.onReload(['requests','summary'])}/></>
    :<ApproverDashboard view={view==='approval-history'?'history':'queue'} refreshKey={revisions.requests} dashboard={context.summary?.data} onOpenRequest={request=>openDetail(`/requests/${encodeURIComponent(request.id)}`)} onReload={()=>context.onReload(['requests','summary'])}/>;
  return <AdminDashboard view={view} navigate={navigate} dashboard={context.summary?.data} refreshKey={revisions[view==='users'?'users':view==='access'?'access':view==='email'?'email':view==='audit'?'audit':'assets']} currentUserId={context.user.id} accountActionsEnabled={context.user.accountActionsEnabled===true} onCreateUser={context.onCreateUser} onNotify={context.onNotify}/>;
}
