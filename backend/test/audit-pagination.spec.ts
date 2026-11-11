import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { AuditController } from '../src/audit/audit.controller';

const admin: AuthUser = { id: 'admin-1', email: 'admin@example.test', displayName: 'Admin', departmentId: 'dept-1', tokenVersion: 1, roles: ['ADMIN'], approverDepartmentIds: [], mustChangePassword: false };

describe('audit pagination', () => {
  it('filters before count and uses a stable tie-breaker', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 302 }] } : { rows: [] });
    const controller = new AuditController({ query } as unknown as Pool);
    const result = await controller.list(admin, { page: '3', pageSize: '25', search: 'REVOKE', outcome: 'DENIED' });
    expect(result).toEqual({ items: [], total: 302, page: 3, pageSize: 25 });
    expect(query.mock.calls[0][0]).toContain('a.outcome = $2');
    expect(query.mock.calls[0][1]).toEqual(['%REVOKE%', 'DENIED']);
    expect(query.mock.calls[1][0]).toContain('ORDER BY a.occurred_at DESC,a.id DESC LIMIT $3 OFFSET $4');
    expect(query.mock.calls[1][1]).toEqual(['%REVOKE%', 'DENIED', 25, 50]);
  });

  it('rejects non-admin access and invalid filters without querying', async () => {
    const query = vi.fn();
    const controller = new AuditController({ query } as unknown as Pool);
    await expect(controller.list({ ...admin, roles: ['USER'] }, { page: '1' })).rejects.toThrow();
    await expect(controller.list(admin, { page: '1', outcome: 'WRONG' })).rejects.toThrow();
    await expect(controller.list(admin, { page: '1', requestId: 'not-a-uuid' })).rejects.toThrow();
    await expect(controller.list(admin, { from: '2026-11-07T12:00:00Z', to: '2026-11-07T11:00:00Z' })).rejects.toMatchObject({ response: { code: 'INVALID_DATE' } });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects repeated numeric query values before paged or legacy reads', async () => {
    const query = vi.fn();
    const controller = new AuditController({ query } as unknown as Pool);
    for (const malformed of [{page:['2']},{pageSize:['25']},{limit:['100']}]) {
      await expect(controller.list(admin, malformed as unknown as Record<string,string>)).rejects.toThrow();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('filters both count and page by an exact server correlation and projects it without raw metadata', async () => {
    const correlationId = 'req_11111111-1111-4111-8111-111111111111';
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 1 }] } : { rows: [{ id: '501', correlation_id: correlationId }] });
    const result = await new AuditController({ query } as unknown as Pool).list(admin, { correlationId });
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 25, items: [{ id: '501', correlationId }] });
    expect(query.mock.calls[0][0]).toContain("a.metadata->>'correlationId' = $1");
    expect(query.mock.calls[1][0]).toContain("a.metadata->>'correlationId' = $1");
    expect(query.mock.calls[0][1]).toEqual([correlationId]);
    expect(query.mock.calls[1][1]).toEqual([correlationId, 25, 0]);
  });

  it.each(['', 'caller-value', "req_11111111-1111-4111-8111-111111111111' OR true", ['req_11111111-1111-4111-8111-111111111111']])('rejects invalid or repeated correlation values before querying', async correlationId => {
    const query = vi.fn();
    await expect(new AuditController({ query } as unknown as Pool).list(admin, { correlationId } as Record<string,string>)).rejects.toMatchObject({ response: { code: Array.isArray(correlationId) ? 'INVALID_FILTER' : 'INVALID_CORRELATION_ID' } });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('audit event detail', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  it('returns only display fields, preserves a bigint identifier and checks the related object', async () => {
    const id = '9007199254740993';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id, action: 'USER_STATUS_CHANGED', entity_type: 'USER', entity_id: userId,
        metadata: { previousStatus: 'ACTIVE', status: 'INACTIVE', fixture: 'must never leave the detail endpoint' } }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const controller = new AuditController({ query } as unknown as Pool);
    const event = await controller.detail(admin, id);
    expect(query.mock.calls[0][1]).toEqual([id]);
    expect(query.mock.calls[1][1]).toEqual([userId]);
    expect(event).toMatchObject({ id, changes: [{ field: 'status', before: 'ACTIVE', after: 'INACTIVE' }], related: { kind: 'USER', id: userId } });
    expect(event).not.toHaveProperty('metadata');
  });

  it('rejects other roles and an out-of-range bigint before reading the database', async () => {
    const query = vi.fn();
    const controller = new AuditController({ query } as unknown as Pool);
    await expect(controller.detail({ ...admin, roles: ['APPROVER'] }, '1')).rejects.toMatchObject({ response: { code: 'ADMIN_REQUIRED' } });
    await expect(controller.detail(admin, '9223372036854775808')).rejects.toMatchObject({ response: { code: 'INVALID_AUDIT_ID' } });
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves partial legacy changes without a link to a removed object', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: '1', action: 'USER_STATUS_CHANGED', entity_type: 'USER', entity_id: userId, metadata: { status: 'LOCKED' } }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    await expect(new AuditController({ query } as unknown as Pool).detail(admin, '1')).resolves.toMatchObject({
      changes: [{ field: 'status', after: 'LOCKED' }], related: null,
    });
  });
});
