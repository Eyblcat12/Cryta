import type { UserRole } from './types';

export type WorkspaceView =
  | 'dashboard'
  | 'assets'
  | 'requests'
  | 'request-new'
  | 'approvals'
  | 'approval-history'
  | 'users'
  | 'access'
  | 'policies'
  | 'audit'
  | 'notifications'
  | 'account-security'
  | 'email'
  | 'provider-recovery'
  | 'forbidden'
  | 'not-found';

export const pageTitles: Record<WorkspaceView, string> = {
  dashboard: 'Tổng quan',
  assets: 'Tài sản',
  requests: 'Yêu cầu',
  'request-new': 'Tạo yêu cầu',
  approvals: 'Hàng chờ phê duyệt',
  'approval-history': 'Lịch sử quyết định',
  users: 'Người dùng & vai trò',
  access: 'Phân quyền',
  policies: 'Chính sách',
  audit: 'Audit Log',
  notifications: 'Thông báo',
  'account-security': 'Bảo mật tài khoản',
  email: 'Vận hành email',
  'provider-recovery': 'Đối soát provider',
  forbidden: 'Không có quyền',
  'not-found': 'Không tìm thấy trang',
};

export const routeManifest: ReadonlyArray<{
  path: string;
  view: WorkspaceView;
  roles: readonly UserRole[];
}> = [
  { path: '/dashboard', view: 'dashboard', roles: ['USER', 'APPROVER', 'ADMIN'] },
  { path: '/assets', view: 'assets', roles: ['USER', 'APPROVER', 'ADMIN'] },
  { path: '/assets/:assetId', view: 'assets', roles: ['USER', 'APPROVER', 'ADMIN'] },
  { path: '/requests', view: 'requests', roles: ['USER', 'APPROVER'] },
  { path: '/requests/new', view: 'request-new', roles: ['USER'] },
  { path: '/requests/:requestId', view: 'requests', roles: ['USER', 'APPROVER'] },
  { path: '/approvals', view: 'approvals', roles: ['APPROVER'] },
  { path: '/approvals/history', view: 'approval-history', roles: ['APPROVER'] },
  { path: '/users', view: 'users', roles: ['ADMIN'] },
  { path: '/users/access', view: 'access', roles: ['ADMIN'] },
  { path: '/policies', view: 'policies', roles: ['ADMIN'] },
  { path: '/audit', view: 'audit', roles: ['ADMIN'] },
  { path: '/operations/email', view: 'email', roles: ['ADMIN'] },
  { path: '/operations/provider', view: 'provider-recovery', roles: ['ADMIN'] },
  { path: '/notifications', view: 'notifications', roles: ['USER', 'APPROVER', 'ADMIN'] },
  { path: '/account/security', view: 'account-security', roles: ['USER', 'APPROVER', 'ADMIN'] },
];

function normalizedPath(pathname: string) {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '');
}

export function workspaceView(pathname: string): WorkspaceView {
  const path = normalizedPath(pathname);
  if (path === '/' || path === '/login' || path === '/dashboard') return 'dashboard';
  if (path === '/assets' || /^\/assets\/[^/]+$/.test(path)) return 'assets';
  if (path === '/requests/new') return 'request-new';
  if (path === '/requests' || /^\/requests\/[^/]+$/.test(path)) return 'requests';
  if (path === '/approvals') return 'approvals';
  if (path === '/approvals/history') return 'approval-history';
  if (path === '/users') return 'users';
  if (path === '/users/access') return 'access';
  if (path === '/policies') return 'policies';
  if (path === '/audit') return 'audit';
  if (path === '/notifications') return 'notifications';
  if (path === '/account/security') return 'account-security';
  if (path === '/operations/email') return 'email';
  if (path === '/operations/provider') return 'provider-recovery';
  if (path === '/forbidden') return 'forbidden';
  return 'not-found';
}

export function canOpenView(role: UserRole, view: WorkspaceView,grantedRoles:readonly UserRole[]=[role]) {
  if(!grantedRoles.includes(role))return false;
  if (view === 'forbidden' || view === 'not-found') return true;
  if(grantedRoles.includes('ADMIN')&&['request-new','approvals'].includes(view))return false;
  const manifestEntry = routeManifest.find((entry) => entry.view === view);
  return manifestEntry?.roles.includes(role) ?? false;
}
