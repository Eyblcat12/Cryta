import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import type { NotificationsService } from '../src/notifications/notifications.service';
import { RequestsService } from '../src/requests/requests.service';
import { AccountActionsService } from '../src/auth/account-actions.service';
import { auditContext } from '../src/audit/audit-context';

const user = { id: '11111111-1111-4111-8111-111111111111', departmentId: 'department', tokenVersion: 1, roles: ['USER'], approverDepartmentIds: [] } as unknown as AuthUser;
const correlationId = 'req_22222222-2222-4222-8222-222222222222';
function drafts(existing: boolean, failAudit = false) {
  const row = { id: '33333333-3333-4333-8333-333333333333', creator_id: user.id, request_type: 'CREATE',
    status: 'DRAFT', policy_version_id: null, target_asset_id: null, reason: '', emergency: false, requested_parameters: {}, version: 1 };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT u.status,u.token_version')) return { rows: [{ status: 'ACTIVE', token_version: 1, department_id: user.departmentId, is_active: true }] };
    if (sql.startsWith('SELECT * FROM requests')) return { rows: existing ? [row] : [] };
    if (/^(INSERT INTO requests|UPDATE requests)/.test(sql)) return { rows: [{ ...row, version: existing ? 2 : 1 }], rowCount: 1 };
    if (sql.includes('INSERT INTO audit_logs') && failAudit) throw new Error('audit unavailable');
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  const service = new RequestsService({ connect: async () => ({ query, release }) } as unknown as Pool, {} as NotificationsService);
  return { row, query, release, service };
}
describe('audit coverage of drafts and reset requests', () => {
  it.each([false, true])('audits a changed draft atomically and excludes its free text: existing=%s', async existing => {
    const { row, service, query } = drafts(existing);
    await auditContext.run({ correlationId }, () => service.saveDraft(user, row.id, { type: 'CREATE', reason: 'private-draft-reason', ...(existing && { version: 1 }) }));
    const index = query.mock.calls.findIndex(([sql]) => sql.includes('INSERT INTO audit_logs'));
    const values = query.mock.calls[index][1];
    expect(values[1]).toBe(existing ? 'REQUEST_DRAFT_UPDATED' : 'REQUEST_DRAFT_CREATED');
    expect(JSON.parse(values[4])).toEqual({ requestType: 'CREATE', version: existing ? 2 : 1, correlationId });
    expect(JSON.stringify(values)).not.toContain('private-draft-reason');
    expect(query.mock.calls[index + 1][0]).toBe('COMMIT');
  });
  it('does not duplicate the creation audit for an idempotent first-save retry', async () => {
    const { row, service, query } = drafts(true);
    await service.saveDraft(user, row.id, { type: 'CREATE' });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('rolls back the draft when audit persistence fails', async () => {
    const { row, service, query, release } = drafts(false, true);
    await expect(service.saveDraft(user, row.id, { type: 'CREATE' })).rejects.toThrow('audit unavailable');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(release).toHaveBeenCalledOnce();
  });
  it('records a reset request as SYSTEM without storing its credential or inventing a verified actor', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const service = new AccountActionsService({} as Pool);
    vi.spyOn(service, 'requireEnabled').mockReturnValue(Buffer.from('a1'.repeat(32), 'hex'));
    await auditContext.run({ correlationId }, () => service.issue({ query } as never, user.id, 1, 'PASSWORD_RESET'));
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'));
    expect(insert?.[0]).toContain("VALUES('SYSTEM','PASSWORD_RESET_REQUESTED'");
    expect(insert?.[1]).toEqual([user.id, JSON.stringify({ correlationId })]);
  });
});
