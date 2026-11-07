import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { RequestsService } from '../src/requests/requests.service';
import type { NotificationsService } from '../src/notifications/notifications.service';

const approver: AuthUser = { id: 'approver-1', email: 'approver@example.test', displayName: 'Approver', departmentId: 'dept-1', tokenVersion: 1, roles: ['APPROVER'], approverDepartmentIds: ['dept-1'], mustChangePassword: false };

describe('request pagination', () => {
  it('counts only in-scope pending emergency requests before paging', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 125 }] } : { rows: [] });
    const service = new RequestsService({ query } as unknown as Pool, {} as NotificationsService);
    const result = await service.list(approver, { page: '3', pageSize: '25', status: 'PENDING', emergency: 'true' });
    expect(result).toEqual({ items: [], total: 125, page: 3, pageSize: 25 });
    expect(query.mock.calls[0][0]).toContain('r.department_id = ANY($1::uuid[]) AND r.status = $2 AND r.emergency = $3');
    expect(query.mock.calls[0][1]).toEqual([['dept-1'], 'PENDING', true]);
    expect(query.mock.calls[1][0]).toContain('ORDER BY r.emergency DESC, r.submitted_at ASC, r.id ASC LIMIT $4 OFFSET $5');
    expect(query.mock.calls[1][1]).toEqual([['dept-1'], 'PENDING', true, 25, 50]);
  });

  it('rejects invalid filters before database access', async () => {
    const query = vi.fn();
    const service = new RequestsService({ query } as unknown as Pool, {} as NotificationsService);
    await expect(service.list(approver, { pageSize: '101' })).rejects.toThrow();
    await expect(service.list(approver, { status: 'INVALID' })).rejects.toThrow();
    await expect(service.list(approver, { emergency: 'yes' })).rejects.toThrow();
    await expect(service.list(approver, { excludePending: 'yes' })).rejects.toThrow();
    await expect(service.list(approver, { excludePending: ['true'] as unknown as string })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('filters history before count and pagination without widening the approver scope', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 35 }] } : { rows: [] });
    const service = new RequestsService({ query } as unknown as Pool, {} as NotificationsService);
    expect(await service.list(approver, { page: '2', pageSize: '10', excludePending: 'true' })).toEqual({items: [], total: 35, page: 2, pageSize: 10});
    for (const [sql] of query.mock.calls) expect(sql).toContain("r.department_id = ANY($1::uuid[]) AND r.status <> 'PENDING'");
    expect(query.mock.calls[1][1]).toEqual([['dept-1'], 10, 10]);
  });
});
