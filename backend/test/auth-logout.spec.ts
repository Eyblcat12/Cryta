import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';

const id='12345678-1234-1234-1234-123456789abc';
const owner='11111111-1111-1111-1111-111111111111';
function setup(){const query=vi.fn().mockResolvedValue({rows:[],rowCount:0}),release=vi.fn(),connect=vi.fn(async()=>({query,release}));return {query,release,connect,service:new AuthService({connect} as unknown as Pool,{} as JwtService)}}
describe('logout session boundaries',()=>{
  it.each(['not-a-uuid.secret',id,`${id}.`,`${id}.secret.extra`])('ignores malformed cookies without a UUID database write: %s',async cookie=>{
    const {service,query}=setup();await expect(service.logout(cookie,owner)).resolves.toEqual({loggedOut:true});
    expect(query.mock.calls.every(([sql])=>!sql.startsWith('UPDATE auth_sessions'))).toBe(true);
    expect(query).toHaveBeenCalledTimes(4);expect(query.mock.calls[2][1]).toEqual([owner,'LOGOUT','SUCCESS','{}']);
    expect(query.mock.calls[0][0]).toBe('BEGIN');expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('requires the authenticated owner and hashed secret when revoking a valid session',async()=>{
    const {service,query}=setup();await service.logout(`${id}.fixture-secret`,owner);
    const [sql,values]=query.mock.calls[2];
    expect(sql).toContain('WHERE id = $1 AND user_id = $2 AND token_hash = $3');
    expect(values).toEqual([id,owner,createHash('sha256').update('fixture-secret').digest('hex')]);
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[1][0]).toBe('SELECT id FROM users WHERE id=$1 FOR UPDATE');
  });
  it('does not revoke without an authenticated actor',async()=>{
    const {service,query,connect}=setup();await expect(service.logout(`${id}.fixture-secret`)).resolves.toEqual({loggedOut:true});expect(query).not.toHaveBeenCalled();expect(connect).not.toHaveBeenCalled();
  });
  it('rolls back session revocation when the audit insert fails',async()=>{
    const {service,query,release}=setup();
    query.mockImplementation(async(sql:string)=>{if(sql.includes('INSERT INTO audit_logs'))throw new Error('audit unavailable');return {rows:[],rowCount:0}});
    await expect(service.logout(`${id}.fixture-secret`,owner)).rejects.toThrow('audit unavailable');
    expect(query.mock.calls.map(([sql])=>sql.split(' ')[0])).toEqual(['BEGIN','SELECT','UPDATE','INSERT','ROLLBACK']);
    expect(release).toHaveBeenCalledOnce();
  });
});
