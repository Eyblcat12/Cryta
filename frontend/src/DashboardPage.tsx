import { Plus,Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api } from './api';
import { ResourceRegion } from './ResourceRegion';
import { UserOverview } from './UserOverview';
import { AdminDashboard,ApproverDashboard } from './WorkspacePages';
import { PageHeader,roleMeta } from './WorkspaceUi';
import { useResource } from './useResource';
import type { WorkspacePageContext } from './WorkspacePage';
import { canCreateRequests,canChangeAsset } from './workspacePermissions';
import type { DashboardData } from './dashboardTypes';

function DashboardContent({context,dashboard,updating}:{context:WorkspacePageContext;dashboard:DashboardData;updating:boolean}) {
  const navigate=useNavigate();
  return context.role==='USER'
    ?<UserOverview dashboard={dashboard} canRequest={!!dashboard.lifecycle?.priority&&canChangeAsset(context.user,dashboard.lifecycle.priority)} updating={updating} openRequest={context.openRequest}/>
    :context.role==='APPROVER'
      ?<><ApproverDashboard view="dashboard" canReviewQueue={!context.user.roles.includes('ADMIN')} dashboard={dashboard} refreshKey={context.revisions.requests} onOpenRequest={()=>{}} onReload={()=>context.onReload(['requests','summary','dashboard'])}/>{context.user.roles.includes('ADMIN')&&<p className="inline-alert" role="status">Tài khoản có quyền Quản trị bảo mật chỉ xem số liệu; không được tạo hoặc phê duyệt yêu cầu nghiệp vụ.</p>}</>
      :<AdminDashboard view="dashboard" dashboard={dashboard} navigate={navigate} refreshKey={context.revisions.dashboard} currentUserId={context.user.id} onCreateUser={context.onCreateUser} onNotify={context.onNotify}/>;
}

export function DashboardPage({context}:{context:WorkspacePageContext}) {
  const navigate=useNavigate();
  const resource=useResource(`${context.scope}:dashboard`,signal=>api.dashboard(signal,context.role),context.revisions.dashboard);
  const title=context.role==='USER'?'Tổng quan tài sản mã hóa':context.role==='APPROVER'?'Tổng quan phê duyệt':'Sức khỏe tài sản mật mã';
  const outline:DashboardData={role:context.role,metrics:{total:0,active:0,expiring:0,pending:0,total_assets:0},trend:[],composition:[]};
  return <>
    <PageHeader eyebrow={roleMeta[context.role].eyebrow} title={title} description="Theo dõi trạng thái và công việc trong phạm vi của vai trò hiện tại." actions={context.role==='USER'&&canCreateRequests(context.user)?<button className="primary-button" onClick={()=>context.openRequest()}><Plus size={18}/> Tạo yêu cầu mới</button>:context.role==='ADMIN'?<button className="primary-button" onClick={()=>navigate('/audit')}><Search size={18}/> Tra cứu Audit Log</button>:undefined}/>
    <ResourceRegion resource={resource} label="Tổng quan" placeholder={<DashboardContent context={context} dashboard={outline} updating/>}>{dashboard=><DashboardContent context={context} dashboard={dashboard} updating={resource.loading||!!resource.error}/>}</ResourceRegion>
  </>;
}
