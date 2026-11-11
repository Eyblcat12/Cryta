import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { AssetsService } from '../src/assets/assets.service';
import { AuditController } from '../src/audit/audit.controller';
import type { AccountActionsService } from '../src/auth/account-actions.service';
import type { AuthUser } from '../src/common/auth-user';
import { NotificationsService } from '../src/notifications/notifications.service';
import { RequestsService } from '../src/requests/requests.service';
import { UsersService } from '../src/users/users.service';

const user: AuthUser = { id: 'owner', roles: ['USER'], email: 'owner@example.test', displayName: 'Owner',
  departmentId: 'own-department', tokenVersion: 1, approverDepartmentIds: [], mustChangePassword: false };
const admin: AuthUser = { ...user, roles: ['ADMIN'] };

function setup() {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: sql.includes('COUNT(*)') ? [{ total: 620 }] : [] }));
  const pool = { query } as unknown as Pool;
  return { query, assets: new AssetsService(pool), audit: new AuditController(pool), notifications: new NotificationsService(pool),
    requests: new RequestsService(pool, {} as NotificationsService), users: new UsersService(pool, {} as AccountActionsService) };
}

describe('server list ordering and filter boundaries', () => {
  const targets = ['assets', 'requests', 'users', 'audit', 'notifications'] as const;
  function list(services: ReturnType<typeof setup>, target: typeof targets[number], params: Record<string, string>) {
    if (target === 'users') return services.users.listPage(admin, params);
    if (target === 'audit') return services.audit.list(admin, params);
    if (target === 'notifications') return services.notifications.list(user.id, params);
    return services[target].list(user, params);
  }

  it.each(targets)('rejects untrusted ordering for %s before opening a database query', async target => {
    const services = setup();
    for (const params of [
      { sortBy: 'id; DROP TABLE users' }, { sortBy: 'constructor' }, { sortBy: '__proto__' },
      { sortOrder: 'desc' }, { sortBy: ['createdAt', 'createdAt'] }, { sortBy: 'createdAt', sortOrder: ['asc'] },
    ]) {
      await expect(list(services, target, params as unknown as Record<string, string>)).rejects.toMatchObject({ response: { code: 'INVALID_SORT' } });
    }
    expect(services.query).not.toHaveBeenCalled();
  });

  it('orders asset ties without widening the authenticated owner scope', async () => {
    const services = setup();
    const result = await services.assets.list(user, { page: '2', pageSize: '10', sortBy: 'code', sortOrder: 'desc', status: 'ACTIVE' });
    expect(result).toEqual({ items: [], total: 620, page: 2, pageSize: 10 });
    expect(services.query.mock.calls[0][1]).toEqual(['owner', 'ACTIVE']);
    expect(services.query.mock.calls[1][0]).toContain('WHERE a.owner_id = $1 AND a.status = $2 ORDER BY a.asset_code DESC NULLS LAST, a.id DESC');
    expect(services.query.mock.calls[1][1]).toEqual(['owner', 'ACTIVE', 10, 10]);
  });

  it('keeps drafts private when an approver sorts submitted requests', async () => {
    const services = setup();
    await services.requests.list({ ...user, roles: ['APPROVER'], approverDepartmentIds: ['scope'] }, {
      sortBy: 'submittedAt', sortOrder: 'asc', pageSize: '10',
    });
    expect(services.query.mock.calls[1][0]).toContain('r.department_id = ANY($1::uuid[]) AND r.submitted_at IS NOT NULL');
    expect(services.query.mock.calls[1][0]).toContain('ORDER BY r.submitted_at ASC NULLS LAST, r.id ASC');
    expect(services.query.mock.calls[1][1]).toEqual([['scope'], 10, 0]);
  });

  it('pages users in the same order before and after expanding role metadata', async () => {
    const services = setup();
    await services.users.listPage(admin, { sortBy: 'lastLoginAt', sortOrder: 'desc', pageSize: '5' });
    expect(services.query.mock.calls[1][0].split('ORDER BY u.last_login_at DESC NULLS LAST, u.id DESC')).toHaveLength(3);
    expect(services.query.mock.calls[1][1]).toEqual([5, 0]);
  });

  it('applies an audit filter even when the caller omits page parameters', async () => {
    const services = setup();
    const result = await services.audit.list(admin, { action: 'REVOKED', sortBy: 'actor', sortOrder: 'asc' });
    expect(result).toEqual({ items: [], total: 620, page: 1, pageSize: 25 });
    expect(services.query.mock.calls[0][1]).toEqual(['%REVOKED%']);
    expect(services.query.mock.calls[1][0]).toContain('WHERE a.action ILIKE $1 ORDER BY u.display_name ASC NULLS LAST, a.id ASC');
    expect(services.query.mock.calls[1][1]).toEqual(['%REVOKED%', 25, 0]);
  });

  it('rejects repeated audit filters even without page parameters', async () => {
    const services = setup();
    await expect(services.audit.list(admin, { action: ['LOGIN'] } as unknown as Record<string, string>)).rejects.toMatchObject({ status: 400 });
    expect(services.query).not.toHaveBeenCalled();
  });

  it('binds notification search and type before count and paging and always limits the recipient', async () => {
    const services = setup();
    await services.notifications.list(user.id, { search: "' OR TRUE --", type: 'ASSET_REVOKED', sortBy: 'readAt', sortOrder: 'desc', page: '3', pageSize: '10' });
    for (const [sql] of services.query.mock.calls) {
      expect(sql).toContain("n.recipient_id=$1 AND n.channel='IN_APP' AND n.type=$2");
      expect(sql).not.toContain('OR TRUE');
    }
    expect(services.query.mock.calls[0][1]).toEqual(['owner', 'ASSET_REVOKED', "%' OR TRUE --%"]);
    expect(services.query.mock.calls[1][0]).toContain('ORDER BY n.read_at DESC NULLS LAST, n.id DESC LIMIT $4 OFFSET $5');
    expect(services.query.mock.calls[1][1]).toEqual(['owner', 'ASSET_REVOKED', "%' OR TRUE --%", 10, 20]);
  });

  it('preserves the legacy array contracts for callers without filters', async () => {
    const services = setup();
    await expect(services.assets.list(user)).resolves.toEqual([]);
    await expect(services.requests.list(user)).resolves.toEqual([]);
    await expect(services.audit.list(admin, { limit: '50' })).resolves.toEqual([]);
    await expect(services.notifications.list(user.id)).resolves.toEqual([]);
  });
});
