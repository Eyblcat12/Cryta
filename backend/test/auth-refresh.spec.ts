import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';

const id = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222';
const replacedBy = '33333333-3333-4333-8333-333333333333';
const secret = 'fixture-refresh-secret';
function setup(sessionOverrides: Record<string, unknown> = {}, failAudit = false, enrolled = false, activeSuccessor = true) {
  const session = { user_id: owner, token_hash: createHash('sha256').update(secret).digest('hex'), expires_at: new Date(Date.now() + 60_000),
    revoked_at: null, replaced_by: null, ...sessionOverrides };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT user_id FROM auth_sessions')) return { rows: [{ user_id: owner }] };
    if (sql.includes('user_id, token_hash, expires_at')) return { rows: [session] };
    if (sql.includes('FROM users u')) return { rows: [{ id: owner, status: 'ACTIVE', token_version: 1, roles: ['USER'], scopes: [], mfa_enrolled: enrolled }] };
    if (sql.startsWith('WITH RECURSIVE refresh_chain')) return { rowCount: Number(activeSuccessor) };
    if (sql.includes('INSERT INTO audit_logs') && failAudit) throw new Error('audit unavailable');
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn(), signAsync = vi.fn().mockResolvedValue('access-token');
  return { query, release, signAsync, service: new AuthService({ connect: async () => ({ query, release }) } as unknown as Pool, { signAsync } as unknown as JwtService) };
}
describe('refresh rotation audit and replay boundaries', () => {
  it('refuses a retired MFA refresh cookie without revoking current verified sessions', async () => {
    const { service, query, signAsync } = setup({ revoked_at: new Date(), mfa_token_version: null }, false, true);
    await expect(service.refresh(`${id}.${secret}`)).rejects.toMatchObject({ response: { code: 'SESSION_INVALID' } });
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret without revoking any sessions or attributing a replay to the owner', async () => {
    const { service, query, release } = setup();
    await expect(service.refresh(`${id}.wrong-secret`)).rejects.toMatchObject({ status: 401 });
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(release).toHaveBeenCalledOnce();
  });
  it.each([new Date(0), new Date(Date.now() + 60_000)])('records and commits a verified replay rejection when a rotation successor is active', async expiresAt => {
    const { service, query } = setup({ revoked_at: new Date(), expires_at: expiresAt, replaced_by: replacedBy });
    await expect(service.refresh(`${id}.${secret}`)).rejects.toMatchObject({ status: 401 });
    const audit = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'));
    expect(audit?.[1]).toEqual([owner, 'SESSION_REPLAY_REJECTED', 'DENIED', '{}']);
    expect(query.mock.calls.find(([sql]) => sql.startsWith('UPDATE auth_sessions'))?.[1]).toEqual([owner]);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it.each([
    { expires_at: new Date(0) }, { revoked_at: new Date() }, { revoked_at: new Date(), replaced_by: replacedBy },
  ])('rejects a retired cookie when there is no active successor', async overrides => {
    const { service, query, signAsync } = setup(overrides, false, false, false);
    await expect(service.refresh(`${id}.${secret}`)).rejects.toMatchObject({ response: { code: 'SESSION_INVALID' } });
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(signAsync).not.toHaveBeenCalled();
  });
  it('writes a successful rotation audit before commit and excludes the refresh secret', async () => {
    const { service, query, signAsync } = setup();
    const result = await service.refresh(`${id}.${secret}`);
    expect(result.refreshToken).not.toBe(`${id}.${secret}`); expect(signAsync).toHaveBeenCalledOnce();
    const auditIndex = query.mock.calls.findIndex(([sql]) => sql.includes('INSERT INTO audit_logs'));
    expect(query.mock.calls[auditIndex][1]).toEqual([owner, 'SESSION_REFRESHED', 'SUCCESS', '{}']);
    expect(query.mock.calls[auditIndex + 1][0]).toBe('COMMIT');
    expect(JSON.stringify(query.mock.calls)).not.toContain(secret);
  });
  it.each([{}, { revoked_at: new Date(), replaced_by: replacedBy }])('rolls back rotation or replay revocation if audit persistence fails', async overrides => {
    const { service, query, release, signAsync } = setup(overrides, true);
    await expect(service.refresh(`${id}.${secret}`)).rejects.toThrow('audit unavailable');
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(release).toHaveBeenCalledOnce(); expect(signAsync).not.toHaveBeenCalled();
  });
});
