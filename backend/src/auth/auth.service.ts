import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AuthUser, RoleCode } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';

type UserRow = { id: string; email: string; display_name: string; department_id: string; token_version: number; password_hash: string; status: string; failed_login_attempts:number;locked_until:Date|null;must_change_password:boolean;roles: RoleCode[] | null; scopes: string[] | null };
type SessionContext = { ipAddress?: string; userAgent?: string };

@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly jwt: JwtService) {}

  async login(email: string, password: string, context: SessionContext = {}) {
    const row = await this.findUserByEmail(email);
    if (row?.locked_until && row.locked_until > new Date()) throw new UnauthorizedException({ code: 'ACCOUNT_TEMPORARILY_LOCKED', message: 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Hãy thử lại sau.' });
    const isLockExpired = row?.locked_until && row.locked_until <= new Date();
    const currentFailedAttempts = isLockExpired ? 0 : (row?.failed_login_attempts ?? 0);
    const valid = await compare(password, row?.password_hash ?? '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.');
    if (!row || row.status !== 'ACTIVE' || !valid) {
      if (row && row.status === 'ACTIVE') {
        const nextAttempts = currentFailedAttempts + 1;
        await this.pool.query(
          `UPDATE users SET failed_login_attempts=$1, locked_until=CASE WHEN $1 >= 10 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END WHERE id=$2`,
          [nextAttempts, row.id]
        );
      }
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' });
    }
    const user = this.toAuthUser(row);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const refreshToken = await this.createSession(client, user.id, context);
      await client.query('UPDATE users SET last_login_at=NOW(),failed_login_attempts=0,locked_until=NULL WHERE id=$1', [user.id]);
      await this.appendAuthAudit(client, user.id, 'LOGIN_SUCCESS', 'SUCCESS');
      await client.query('COMMIT');
      return { ...await this.issueAccessToken(user), refreshToken };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async refresh(rawToken: string | undefined, context: SessionContext = {}) {
    if (!rawToken) throw this.invalidSession();
    const [sessionId, secret] = rawToken.split('.');
    if (!sessionId || !secret) throw this.invalidSession();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<{ user_id: string; token_hash: string; expires_at: Date; revoked_at: Date | null }>('SELECT user_id, token_hash, expires_at, revoked_at FROM auth_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const session = found.rows[0];
      if (!session || session.revoked_at || session.expires_at <= new Date() || session.token_hash !== this.hash(secret)) {
        if (session?.user_id) await client.query('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1', [session.user_id]);
        await client.query('COMMIT');
        throw this.invalidSession();
      }
      const user = await this.getUserById(session.user_id, client);
      const nextToken = await this.createSession(client, user.id, context);
      await client.query('UPDATE auth_sessions SET revoked_at = NOW(), last_used_at = NOW(), replaced_by = $2 WHERE id = $1', [sessionId, nextToken.split('.')[0]]);
      await client.query('COMMIT');
      return { ...await this.issueAccessToken(user), refreshToken: nextToken };
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async logout(rawToken: string | undefined, actorId?: string) {
    if (rawToken) { const [sessionId] = rawToken.split('.'); if (sessionId) await this.pool.query('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1', [sessionId]); }
    if (actorId) await this.appendAuthAudit(this.pool, actorId, 'LOGOUT', 'SUCCESS');
    return { loggedOut: true };
  }

  async changePassword(userId:string,currentPassword:string,newPassword:string){const client=await this.pool.connect();try{await client.query('BEGIN');const found=await client.query<{password_hash:string}>('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',[userId]);const row=found.rows[0];if(!row||!await compare(currentPassword,row.password_hash))throw new UnauthorizedException({code:'CURRENT_PASSWORD_INVALID',message:'Mật khẩu hiện tại không đúng.'});if(await compare(newPassword,row.password_hash))throw new BadRequestException({code:'PASSWORD_UNCHANGED',message:'Mật khẩu mới phải khác mật khẩu hiện tại.'});await client.query('UPDATE users SET password_hash=$2,must_change_password=FALSE,token_version=token_version+1,failed_login_attempts=0,locked_until=NULL WHERE id=$1',[userId,await hash(newPassword,12)]);await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1',[userId]);await this.appendAuthAudit(client,userId,'PASSWORD_CHANGED','SUCCESS');await client.query('COMMIT');return{changed:true,loginRequired:true}}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}

  async getUserById(id: string, queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.pool): Promise<AuthUser> {
    const result = await queryable.query<UserRow>(this.userQuery('u.id = $1'), [id]);
    const row = result.rows[0];
    if (!row || row.status !== 'ACTIVE') throw this.invalidSession();
    return this.toAuthUser(row);
  }

  private async findUserByEmail(email: string) { return (await this.pool.query<UserRow>(this.userQuery('LOWER(u.email) = LOWER($1)'), [email.trim()])).rows[0]; }
  private userQuery(where: string) { return `SELECT u.id,u.email,u.display_name,u.department_id,u.token_version,u.password_hash,u.status,u.failed_login_attempts,u.locked_until,u.must_change_password,COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL),'{}') AS roles,COALESCE(array_agg(DISTINCT s.department_id::text) FILTER (WHERE s.department_id IS NOT NULL),'{}') AS scopes FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN approver_scopes s ON s.user_id=u.id WHERE ${where} GROUP BY u.id`; }
  private async issueAccessToken(user: AuthUser) { return { accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email, tokenVersion: user.tokenVersion }), tokenType: 'Bearer', expiresIn: process.env.JWT_ACCESS_TTL ?? '15m', user }; }
  private async createSession(client: PoolClient, userId: string, context: SessionContext) {
    const id = randomUUID(), secret = randomBytes(48).toString('base64url'), days = Math.max(1, Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30));
    await client.query(`INSERT INTO auth_sessions (id,user_id,token_hash,user_agent,ip_address,expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+($6 || ' days')::interval)`, [id,userId,this.hash(secret),context.userAgent?.slice(0,500)??null,context.ipAddress??null,days]);
    return `${id}.${secret}`;
  }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private invalidSession() { return new UnauthorizedException({ code: 'SESSION_INVALID', message: 'Phiên đăng nhập không còn hợp lệ.' }); }
  private toAuthUser(row: UserRow): AuthUser { return { id: row.id,email: row.email,displayName: row.display_name,departmentId: row.department_id,tokenVersion: row.token_version,roles: row.roles??[],approverDepartmentIds: row.scopes??[],mustChangePassword:row.must_change_password }; }
  private appendAuthAudit(queryable: Pick<Pool,'query'>|Pick<PoolClient,'query'>, actorId: string, action: string, outcome: string) { return queryable.query(`INSERT INTO audit_logs (actor_id,actor_type,action,entity_type,entity_id,outcome,metadata) VALUES ($1::uuid,'USER',$2,'SESSION',$1::text,$3,'{}'::jsonb)`,[actorId,action,outcome]); }
}
