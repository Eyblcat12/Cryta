import { canOpenView } from './routes';
import type { WorkspaceView } from './routes';
import type { UserRole } from './types';
import { cleanQuery } from './tableQuery';

export function workspaceSearch(view:WorkspaceView,role:UserRole,roles:readonly UserRole[]) {
  const destinations={assets:{path:'/assets',label:'Tìm tài sản'},requests:{path:'/requests',label:'Tìm yêu cầu'},users:{path:'/users',label:'Tìm người dùng'},audit:{path:'/audit',label:'Tìm Audit Log'},approvals:{path:'/approvals',label:'Tìm hàng chờ'},'approval-history':{path:'/approvals/history',label:'Tìm lịch sử xử lý'}};
  if(view in destinations&&canOpenView(role,view,roles))return destinations[view as keyof typeof destinations];
  if(view==='access'&&role==='ADMIN')return destinations.users;
  if(role==='USER')return destinations.assets;
  if(role==='APPROVER')return canOpenView(role,'approvals',roles)?destinations.approvals:destinations['approval-history'];
  return destinations.audit;
}

export function workspaceSearchUrl(target:string,location:{pathname:string;search:string},query:string) {
  const params=new URLSearchParams(location.pathname===target?location.search:'');
  params.delete('page');params.set('q',cleanQuery(query));
  return `${target}?${params}`;
}
