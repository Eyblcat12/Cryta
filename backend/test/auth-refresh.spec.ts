import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';

const id = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222';
const secret = 'fixture-refresh-secret';
function setup(sessionOverrides: Record<string, unknown> = {}, failAudit = false) {
  const session = { user_id: owner, token_hash: createHash('sha256').update(secret).digest('hex'), expires_at: new Date(Date.now() + 60_000), revoked_at: null, ...sessionOverrides };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT user_id FROM auth_sessions')) return { rows: [{ user_id: owner }] };
    if (sql.includes('SELECT user_id, token_hash')) return { rows: [session] };
    if (sql.includes('FROM users u')) return { rows: [{ id: owner, status: 'ACTIVE', token_version: 1, roles: ['USER'], scopes: [] }] };
    if (sql.includes('INSERT INTO audit_logs') && failAudit) throw new Error('audit unavailable');
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn(), signAsync = vi.fn().mockResolvedValue('access-token');
  return { query, release, signAsync, service: new AuthService({ connect: async () => ({ query, release }) } as unknown as Pool, { signAsync } as unknown as JwtService) };
}
describe('refresh rotation audit and replay boundaries', () => {
  it('rejects a wrong secret without revoking any sessions or attributing a replay to the owner', async () => {
    const { service, query, release } = setup();
    await expect(service.refresh(`${id}.wrong-secret`)).rejects.toMatchObject({ status: 401 });
    expect(query.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(release).toHaveBeenCalledOnce();
  });
  it.each([{ revoked_at: new Date() }, { expires_at: new Date(0) }])('records and commits a verified replay rejection with revocation', async overrides => {
    const { service, query } = setup(overrides);
    await expect(service.refresh(`${id}.${secret}`)).rejects.toMatchObject({ status: 401 });
    const audit = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'));
    expect(audit?.[1]).toEqual([owner, 'SESSION_REPLAY_REJECTED', 'DENIED', '{}']);
    expect(query.mock.calls.find(([sql]) => sql.startsWith('UPDATE auth_sessions'))?.[1]).toEqual([owner]);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
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
  it.each([{}, { revoked_at: new Date() }])('rolls back rotation or replay revocation if audit persistence fails', async overrides => {
    const { service, query, release, signAsync } = setup(overrides, true);
    await expect(service.refresh(`${id}.${secret}`)).rejects.toThrow('audit unavailable');
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(release).toHaveBeenCalledOnce(); expect(signAsync).not.toHaveBeenCalled();
  });
});
