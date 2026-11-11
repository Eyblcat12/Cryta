import { useLocation, useNavigate } from 'react-router';
import type { UserRole } from './types';

type DetailReturn = { returnTo: string; userId: string; role: UserRole };

export function detailReturn(state: unknown, userId: string, role: UserRole): string | null {
  if (!state || typeof state !== 'object') return null;
  const candidate = state as Partial<DetailReturn>;
  if (candidate.userId !== userId || candidate.role !== role || typeof candidate.returnTo !== 'string') return null;
  const path = candidate.returnTo.split('?')[0];
  const allowed = role === 'ADMIN' ? ['/assets','/notifications','/dashboard']
    : role === 'APPROVER' ? ['/assets','/approvals','/approvals/history','/requests','/notifications','/dashboard']
    : ['/assets','/requests','/notifications','/dashboard'];
  return allowed.includes(path) ? candidate.returnTo : null;
}

export function useOpenDetail(userId: string, role: UserRole) {
  const location = useLocation();
  const navigate = useNavigate();
  return (path: string) => navigate(path, { state: { returnTo: location.pathname + location.search, userId, role } satisfies DetailReturn });
}
