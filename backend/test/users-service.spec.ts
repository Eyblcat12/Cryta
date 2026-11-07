import { AccountActionsService } from '../src/auth/account-actions.service';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { UsersService } from '../src/users/users.service';

const admin: AuthUser = {
  id: 'admin-1', email: 'admin@example.test', displayName: 'Admin', departmentId: 'dept-1',
  tokenVersion: 1, roles: ['ADMIN'], approverDepartmentIds: [], mustChangePassword: false,
};

function setup(answer: (sql: string) => unknown, actor: unknown = { status: 'ACTIVE', token_version: 1, is_admin: true }) {
  const query = vi.fn(async (sql: string) => sql.includes('SELECT u.status,u.token_version')
    ? { rows: actor ? [actor] : [], rowCount: actor ? 1 : 0 } : answer(sql));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const service = new UsersService({ connect } as unknown as Pool, {} as AccountActionsService);
  return { service, query, release };
}

describe('user access changes', () => {
  for (const operation of ['create', 'status', 'access'] as const) {
    it.each([
      ['missing', null],
      ['inactive', { status: 'INACTIVE', token_version: 1, is_admin: true }],
      ['locked', { status: 'LOCKED', token_version: 1, is_admin: true }],
      ['role removed', { status: 'ACTIVE', token_version: 1, is_admin: false }],
      ['version changed', { status: 'ACTIVE', token_version: 2, is_admin: true }],
    ])(`rejects a %s administrator before ${operation} writes`, async (_name, actor) => {
      const { service, query, release } = setup(() => ({ rowCount: 1, rows: [] }), actor);
      const result = operation === 'create' ? service.create(admin, {
        email: 'new@example.test', displayName: 'New user', departmentId: 'dept-1', temporaryPassword: 'Temporary@Test12345',
        roles: ['USER'], approverDepartmentIds: [],
      }) : operation === 'status' ? service.status(admin, 'user-1', { status: 'LOCKED' })
        : service.access(admin, 'user-1', { roles: ['USER'], approverDepartmentIds: [] });
      await expect(result).rejects.toMatchObject({ response: { code: 'SESSION_REVOKED' }, status: 401 });
      const calls = query.mock.calls.map(([sql]) => sql);
      expect(calls.some(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
      expect(calls.at(-1)).toBe('ROLLBACK');
      expect(release).toHaveBeenCalledOnce();
    });
  }

  it('rolls back status and session revocation when audit fails', async () => {
    const { service, query, release } = setup((sql) => {
      if (sql.includes('SELECT id,invitation_pending,status FROM users')) return { rowCount: 1, rows: [{ invitation_pending: false, status: 'LOCKED' }] };
      if (sql.includes('UPDATE users')) return { rows: [{ id: 'user-1', email: 'u@example.test', display_name: 'User', status: 'ACTIVE' }] };
      if (sql.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
      return { rowCount: 1 };
    });
    await expect(service.status(admin, 'user-1', { status: 'ACTIVE' })).rejects.toThrow('audit unavailable');
    const calls = query.mock.calls.map(([sql]) => sql);
    expect(calls).toContain('BEGIN');
    expect(calls.some((sql) => sql.includes('UPDATE auth_sessions'))).toBe(true);
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('blocks disabling the last active Admin before writing', async () => {
    const { service, query } = setup((sql) => {
      if (sql.includes('SELECT id,invitation_pending,status FROM users')) return { rowCount: 1, rows: [{ invitation_pending: false, status: 'ACTIVE' }] };
      if (sql.includes('WHERE u.id=$1')) return { rowCount: 1 };
      if (sql.includes('WHERE u.id<>$1')) return { rowCount: 0 };
      return { rowCount: 1 };
    });
    await expect(service.status(admin, 'admin-2', { status: 'INACTIVE' })).rejects.toThrow(/ít nhất một quản trị viên/);
    const calls = query.mock.calls.map(([sql]) => sql);
    expect(calls.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(calls.findIndex(sql => sql.includes('pg_advisory_xact_lock'))).toBeLessThan(calls.findIndex(sql => sql.includes('FOR UPDATE')));
    expect(calls.some((sql) => sql.includes('UPDATE users'))).toBe(false);
    expect(calls.at(-1)).toBe('ROLLBACK');
  });

  it('blocks removing the last active Admin role before deleting roles', async () => {
    const { service, query } = setup((sql) => {
      if (sql.includes('SELECT 1 FROM users WHERE id=$1')) return { rowCount: 1 };
      if (sql.includes('WHERE u.id=$1')) return { rowCount: 1 };
      if (sql.includes('WHERE u.id<>$1')) return { rowCount: 0 };
      return { rowCount: 1 };
    });
    await expect(service.access(admin, 'admin-2', { roles: ['USER'], approverDepartmentIds: [] })).rejects.toThrow(/ít nhất một quản trị viên/);
    const calls = query.mock.calls.map(([sql]) => sql);
    expect(calls.findIndex(sql => sql.includes('pg_advisory_xact_lock'))).toBeLessThan(calls.findIndex(sql => sql.includes('FOR UPDATE')));
    expect(calls.some((sql) => sql.includes('DELETE FROM user_roles'))).toBe(false);
    expect(calls.at(-1)).toBe('ROLLBACK');
  });
});
