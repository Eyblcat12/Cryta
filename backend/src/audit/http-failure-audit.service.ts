import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AuthUser } from '../common/auth-user';
import type { RequestWithId } from '../common/request-context.middleware';
import { UUID_LIKE } from '../common/uuid-like.pipe';
import { auditMetadata } from './audit-context';

export const AUDIT_FAILURE_POOL = 'AUDIT_FAILURE_POOL';

// Only route templates registered by this API can enter the durable failure log.
const writeRoutes = new Set([
  '/auth/login', '/auth/refresh', '/auth/logout', '/auth/change-password',
  '/auth/mfa/verify', '/auth/mfa/recover', '/auth/mfa/enrollment/verify', '/auth/mfa/enrollment/finish', '/auth/mfa/step-up',
  '/auth/password-reset', '/auth/password-reset/complete', '/auth/invitation/accept',
  '/requests', '/requests/drafts/:id', '/requests/:id/submit', '/requests/:id/decision', '/requests/:id/cancel',
  '/users', '/users/invitations', '/users/:id/invitation', '/users/:id/status', '/users/:id/access', '/users/:id/department',
  '/departments/:id', '/departments/:id/status', '/policies', '/policies/:id/versions', '/policies/:id/deactivate',
  '/notifications/read-all', '/notifications/:id/read', '/notifications/test-email',
  '/operations/provider-issues/:id/actions',
]);
const readRoutes = new Set([
  '/auth/me', '/auth/account-actions', '/auth/mfa/status', '/assets', '/assets/:id', '/assets/:id/history', '/requests', '/requests/:id', '/users', '/users/reference-data',
  '/departments', '/departments/:id', '/policies', '/policies/admin', '/policies/:id/versions',
  '/audit-logs', '/notifications', '/notifications/status', '/notifications/delivery-issues',
  '/dashboard', '/dashboard/summary', '/operations/metrics', '/operations/signals', '/operations/provider-issues', '/operations/provider-issues/:id',
]);

@Injectable()
export class HttpFailureAuditService implements OnApplicationShutdown {
  private readonly logger = new Logger(HttpFailureAuditService.name);

  constructor(@Inject(AUDIT_FAILURE_POOL) private readonly pool: Pool) {}

  async record(request: RequestWithId & { user?: AuthUser }, status: number) {
    const fullRoute: unknown = request.route?.path;
    if (status < 400 || status > 599 || typeof fullRoute !== 'string' || !fullRoute.startsWith('/api/v1/')) return;
    const route = fullRoute.slice('/api/v1'.length);
    const method = request.method;
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!(mutation ? writeRoutes : readRoutes).has(route) || (!mutation && method !== 'GET')) return;
    const correlationId = request.requestId;
    if (!/^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(correlationId)) return;
    const actorId = request.user?.id && UUID_LIKE.test(request.user.id) ? request.user.id : null;
    const action = status >= 500 ? 'HTTP_REQUEST_FAILED' : 'HTTP_REQUEST_DENIED';
    const metadata = auditMetadata({ correlationId, method, route: fullRoute, httpStatus: status });
    try {
      // This pool is independent of the transaction that rejected or rolled back.
      await this.pool.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)
        VALUES($1,$2,$3,'HTTP_REQUEST',$4,$5,$6::jsonb)`,
      [actorId, actorId ? 'USER' : 'SYSTEM', action, fullRoute, status >= 500 ? 'FAILED' : 'DENIED', JSON.stringify(metadata)]);
    } catch {
      // The log collector must retain this fallback when the database is unavailable.
      this.logger.error({ event: 'audit.http_failure_not_persisted', correlationId, method, route: fullRoute, httpStatus: status });
    }
  }

  onApplicationShutdown() { return this.pool.end(); }
}
