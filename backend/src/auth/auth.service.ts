import { BadRequestException, ForbiddenException, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AuthUser, RoleCode } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { auditMetadata } from '../audit/audit-context';
import { MfaService, mfaChallengeExpired, mfaInvalidCode, requiresMfa, type MfaPurpose } from './mfa.service';
import { OidcService, oidcDenied } from './oidc.service';
import type { OidcIdentity } from './oidc-provider';

type UserRow = { id: string; email: string; display_name: string; department_id: string; department_name: string; token_version: number; password_hash: string; status: string; failed_login_attempts:number;locked_until:Date|null;must_change_password:boolean;roles: RoleCode[] | null; scopes: string[] | null; mfa_enrolled: boolean };
type SessionContext = { ipAddress?: string; userAgent?: string };
const LOGIN_DUMMY_HASH = '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.';
const invalidCredentials = () => new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' });

@Injectable()
export class AuthService {
  private readonly mfa = new MfaService();
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly jwt: JwtService,
    @Optional() private readonly oidc?: OidcService) {}

  async login(email: string, password: string, context: SessionContext = {}) {
    const row = await this.findUserByEmail(email);
    const linked = row && await this.oidc?.hasLink(this.pool, row.id);
    const valid = await compare(password, row && !linked ? row.password_hash : LOGIN_DUMMY_HASH);
    if (!row || linked || row.status !== 'ACTIVE' || (row.locked_until && row.locked_until > new Date())) {
      throw invalidCredentials();
    }
    if (!valid) {
      // Only attempts against the same active credential can advance the counter.
      // PostgreSQL rechecks the lock predicate after a concurrent UPDATE commits.
      await this.pool.query(`UPDATE users SET
        failed_login_attempts=CASE WHEN locked_until IS NULL THEN LEAST(failed_login_attempts,4)+1 ELSE 1 END,
        locked_until=CASE WHEN locked_until IS NULL AND failed_login_attempts>=4 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END
        WHERE id=$1 AND password_hash=$2 AND token_version=$3 AND status='ACTIVE'
          AND (locked_until IS NULL OR locked_until<=NOW())`, [row.id, row.password_hash, row.token_version]);
      throw invalidCredentials();
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Session creation and account/password/access revocation share the user row lock.
      // A credential verified before a concurrent password change must not open a new session.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.id]);
      const current = (await client.query<UserRow>(this.userQuery('u.id = $1'), [row.id])).rows[0];
      if (!current || current.status !== 'ACTIVE' || current.password_hash !== row.password_hash ||
          (current.locked_until && current.locked_until > new Date()) || await this.oidc?.hasLink(client, row.id)) {
        throw invalidCredentials();
      }
      const user = this.toAuthUser(current);
      if (user.mfaRequired) {
        const challenge = await this.mfa.start(client, user, user.mfaEnrolled ? 'VERIFY' : 'ENROLL');
        await client.query('UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=$1', [user.id]);
        await client.query('COMMIT');
        return challenge;
      }
      const result = await this.loginSession(client, user, context, false);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async loginOidc(identity: OidcIdentity, context: SessionContext) {
    const oidc = this.oidc;
    const id = await oidc?.linkedUser(identity);
    if (!oidc || !id) throw oidcDenied();
    return this.mfaTransaction(async client => {
      const row = await this.lockUser(client, id);
      const user = this.toAuthUser(row);
      const sessionId = await oidc.startSession(client, id, identity);
      if (user.mfaRequired) return this.mfa.start(client, user, user.mfaEnrolled ? 'VERIFY' : 'ENROLL', sessionId);
      return this.loginSession(client, user, context, false, sessionId);
    });
  }

  async assertOidcSession(id: string, userId: string) {
    if (!await this.oidc?.checkSession(id, userId)) throw this.invalidSession();
  }

  async refresh(rawToken: string | undefined, context: SessionContext = {}) {
    if (!rawToken) throw this.invalidSession();
    const parts = rawToken.split('.');
    const [sessionId, secret] = parts;
    if (parts.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) || !secret) throw this.invalidSession();
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const owner = (await client.query<{ user_id: string }>('SELECT user_id FROM auth_sessions WHERE id=$1', [sessionId])).rows[0];
      if (!owner) throw this.invalidSession();
      // Lock user before session, matching password/access/status changes. Recheck the
      // session after waiting, so rotation cannot escape another transaction's revocation.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner.user_id]);
      const found = await client.query<{ user_id: string; token_hash: string; expires_at: Date; revoked_at: Date | null;
        replaced_by: string | null; mfa_token_version: number | null; oidc_session_id: string | null }>(`SELECT
        user_id, token_hash, expires_at, revoked_at, replaced_by, mfa_token_version, oidc_session_id
        FROM auth_sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
      const session = found.rows[0];
      // A guessed session UUID with a wrong secret must not revoke another user's sessions.
      if (!session || session.token_hash !== this.hash(secret)) throw this.invalidSession();
      const user = await this.getUserById(session.user_id, client);
      const oidcSessionId = session.oidc_session_id ?? undefined;
      const verified = session.mfa_token_version === user.tokenVersion;
      // Credentials retired by MFA enrollment or replacement must not revoke the new sessions.
      if (user.mfaRequired && !verified) throw this.invalidSession();
      if (session.revoked_at || session.expires_at <= new Date()) {
        if (!session.revoked_at || !session.replaced_by ||
            !await this.hasActiveRefreshSuccessor(client, session.replaced_by, session.user_id)) throw this.invalidSession();
        await client.query('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1', [session.user_id]);
        if (oidcSessionId) await this.oidc?.endSession(client, oidcSessionId, user.id);
        await this.appendAuthAudit(client, session.user_id, 'SESSION_REPLAY_REJECTED', 'DENIED');
        await client.query('COMMIT');
        committed = true;
        throw this.invalidSession();
      }
      if (oidcSessionId && !await this.oidc?.renewSession(client, oidcSessionId, user.id)) {
        await this.oidc?.endSession(client, oidcSessionId, user.id);
        await this.appendAuthAudit(client, user.id, 'OIDC_SESSION_REVOKED', 'DENIED');
        await client.query('COMMIT');
        committed = true;
        throw this.invalidSession();
      }
      const nextToken = await this.createSession(client, user, context, verified, oidcSessionId);
      await client.query('UPDATE auth_sessions SET revoked_at = NOW(), last_used_at = NOW(), replaced_by = $2 WHERE id = $1', [sessionId, nextToken.split('.')[0]]);
      await this.appendAuthAudit(client, user.id, 'SESSION_REFRESHED', 'SUCCESS');
      await client.query('COMMIT');
      committed = true;
      return { ...await this.issueAccessToken(user, verified, oidcSessionId), refreshToken: nextToken };
    } catch (error) { if (!committed) await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  private async hasActiveRefreshSuccessor(client: PoolClient, successorId: string, userId: string) {
    // Refresh, logout and credential revocation hold the same user lock while changing this chain.
    const active = await client.query(`WITH RECURSIVE successors AS (
      SELECT id,replaced_by,revoked_at,expires_at FROM auth_sessions WHERE id=$1 AND user_id=$2
      UNION
      SELECT next.id,next.replaced_by,next.revoked_at,next.expires_at FROM auth_sessions next
      JOIN successors previous ON next.id=previous.replaced_by WHERE next.user_id=$2
    ) SELECT id FROM successors WHERE revoked_at IS NULL AND expires_at>NOW() LIMIT 1`, [successorId, userId]);
    return Boolean(active.rowCount);
  }

  async verifyMfaLogin(challenge: string, code: string, context: SessionContext) {
    return this.withMfaChallenge(challenge, ['VERIFY'], async (client, user, row) => {
      if (!await this.mfa.verifyCurrent(client, user.id, code, await this.mfa.factor(client, user.id))) return null;
      await this.mfa.consume(client, user.id);
      return this.loginSession(client, user, context, true, row.oidc_session_id ?? undefined);
    });
  }

  async recoverMfa(challenge: string, code: string) {
    return this.withMfaChallenge(challenge, ['VERIFY'], async (client, user, row) => {
      if (!await this.mfa.useRecoveryCode(client, user.id, code, await this.mfa.factor(client, user.id))) return null;
      const tokenVersion = await this.revokeMfaSessions(client, user.id);
      await this.appendAuthAudit(client, user.id, 'MFA_RECOVERY_STARTED', 'SUCCESS');
      await this.queueMfaAlert(client, user.id);
      return this.mfa.start(client, { ...user, tokenVersion }, 'RECOVER', row.oidc_session_id ?? undefined);
    });
  }

  async verifyMfaEnrollment(challenge: string, code: string) {
    return this.withMfaChallenge(challenge, ['ENROLL', 'RECOVER', 'REPLACE'], async (client, user, row) => {
      await this.mfa.factor(client, user.id);
      const recoveryCodes = await this.mfa.verifyEnrollment(client, row, code);
      return recoveryCodes ? { recoveryCodes } : null;
    });
  }

  async finishMfaEnrollment(challenge: string, context: SessionContext) {
    return this.withMfaChallenge(challenge, ['ENROLL', 'RECOVER', 'REPLACE'], async (client, user, row) => {
      await this.mfa.factor(client, user.id);
      await this.mfa.activate(client, row);
      const tokenVersion = await this.revokeMfaSessions(client, user.id);
      await this.appendAuthAudit(client, user.id, row.purpose === 'ENROLL' ? 'MFA_ENROLLED' : 'MFA_FACTOR_CHANGED', 'SUCCESS');
      await this.queueMfaAlert(client, user.id);
      return this.loginSession(client, { ...user, tokenVersion, mfaEnrolled: true, mfaRequired: true }, context, true, row.oidc_session_id ?? undefined);
    });
  }

  async mfaStatus(actor: AuthUser) {
    const client = await this.pool.connect();
    try { return await this.mfa.remainingCodes(client, actor.id); }
    finally { client.release(); }
  }

  async stepUpMfa(actor: AuthUser, password: string | undefined, code: string, purpose: 'CODES' | 'REPLACE', oidcSessionId?: string) {
    return this.mfaTransaction(async client => {
      const row = await this.lockUser(client, actor.id);
      if (row.token_version !== actor.tokenVersion || !row.mfa_enrolled || row.must_change_password) throw this.invalidSession();
      if (oidcSessionId && (!await this.oidc?.recentlyAuthenticated(client, oidcSessionId, actor.id) ||
          !await this.oidc?.renewSession(client, oidcSessionId, actor.id))) {
        throw new ForbiddenException({ code: 'OIDC_REAUTH_REQUIRED', message: 'Hãy đăng xuất và đăng nhập lại qua SSO để xác nhận thao tác.' });
      }
      const factor = await this.mfa.factor(client, actor.id);
      if ((!oidcSessionId && (!password || !await compare(password, row.password_hash))) ||
          !await this.mfa.verifyCurrent(client, actor.id, code, factor)) {
        return this.failedMfa(client, actor.id);
      }
      if (purpose === 'REPLACE') return this.mfa.start(client, actor, 'REPLACE', oidcSessionId);
      const recoveryCodes = await this.mfa.rotateRecoveryCodes(client, actor.id, factor);
      await this.appendAuthAudit(client, actor.id, 'MFA_RECOVERY_CODES_ROTATED', 'SUCCESS');
      await this.queueMfaAlert(client, actor.id);
      return { recoveryCodes };
    });
  }

  private async withMfaChallenge<T>(challenge: string, purposes: MfaPurpose[], operation: (client: PoolClient, user: AuthUser, row: Awaited<ReturnType<MfaService['challenge']>>) => Promise<T | null>) {
    return this.mfaTransaction(async client => {
      const id = await this.mfa.owner(client, challenge);
      if (!id) throw mfaChallengeExpired();
      const user = this.toAuthUser(await this.lockUser(client, id));
      if (!user.mfaRequired) throw mfaChallengeExpired();
      const row = await this.mfa.challenge(client, user, challenge, purposes);
      if (row.oidc_session_id && !await this.oidc?.renewSession(client, row.oidc_session_id, user.id)) throw mfaChallengeExpired();
      const result = await operation(client, user, row);
      return result === null ? this.failedMfa(client, id) : result;
    });
  }

  private async lockUser(client: PoolClient, id: string) {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
    const row = (await client.query<UserRow>(this.userQuery('u.id = $1'), [id])).rows[0];
    if (!row || row.status !== 'ACTIVE') throw mfaChallengeExpired();
    return row;
  }

  private async mfaTransaction<T>(operation: (client: PoolClient) => Promise<T | UnauthorizedException>): Promise<T> {
    const client = await this.pool.connect();
    let result: T | UnauthorizedException;
    try {
      await client.query('BEGIN');
      result = await operation(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    // Preserve failure counters and audit even when the HTTP response is a denial.
    if (result instanceof UnauthorizedException) throw result;
    return result;
  }

  private async failedMfa(client: PoolClient, id: string) {
    await this.mfa.recordFailure(client, id);
    await this.appendAuthAudit(client, id, 'MFA_VERIFICATION_DENIED', 'DENIED');
    return mfaInvalidCode();
  }

  private async revokeMfaSessions(client: PoolClient, id: string) {
    const result = await client.query<{ token_version: number }>('UPDATE users SET token_version=token_version+1 WHERE id=$1 RETURNING token_version', [id]);
    await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1', [id]);
    return result.rows[0].token_version;
  }

  private async queueMfaAlert(client: PoolClient, id: string) {
    if (process.env.SMTP_ENABLED !== 'true') return;
    await client.query(`INSERT INTO notifications (recipient_id,type,channel,deduplication_key)
      VALUES ($1,'MFA_SECURITY_CHANGED','EMAIL',$2)`, [id, `mfa-security:${randomUUID()}`]);
  }

  async logout(rawToken: string | undefined, actorId?: string, oidcSessionId?: string) {
    if (!actorId) return { loggedOut: true };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Match refresh/password changes: user row before the session row.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actorId]);
      if (oidcSessionId) await this.oidc?.endSession(client, oidcSessionId, actorId);
      const parts = rawToken?.split('.');
      if (parts?.length === 2) {
        const [sessionId, secret] = parts;
        // Logout remains idempotent and scoped to the authenticated owner.
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) && secret) {
          await client.query('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1 AND user_id = $2 AND token_hash = $3', [sessionId, actorId, this.hash(secret)]);
        }
      }
      await this.appendAuthAudit(client, actorId, 'LOGOUT', 'SUCCESS');
      await client.query('COMMIT');
      return { loggedOut: true, ...(oidcSessionId && { redirect: await this.oidc?.logoutUrl() }) };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async changePassword(userId:string,currentPassword:string,newPassword:string){const client=await this.pool.connect();try{await client.query('BEGIN');const found=await client.query<{password_hash:string}>('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',[userId]);const row=found.rows[0];if(!row||!await compare(currentPassword,row.password_hash))throw new UnauthorizedException({code:'CURRENT_PASSWORD_INVALID',message:'Mật khẩu hiện tại không đúng.'});if(await compare(newPassword,row.password_hash))throw new BadRequestException({code:'PASSWORD_UNCHANGED',message:'Mật khẩu mới phải khác mật khẩu hiện tại.'});await client.query('UPDATE users SET password_hash=$2,must_change_password=FALSE,token_version=token_version+1,failed_login_attempts=0,locked_until=NULL WHERE id=$1',[userId,await hash(newPassword,12)]);await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1',[userId]);await this.appendAuthAudit(client,userId,'PASSWORD_CHANGED','SUCCESS');await client.query('COMMIT');return{changed:true,loginRequired:true}}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}

  async getUserById(id: string, queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.pool): Promise<AuthUser> {
    const result = await queryable.query<UserRow>(this.userQuery('u.id = $1'), [id]);
    const row = result.rows[0];
    if (!row || row.status !== 'ACTIVE') throw this.invalidSession();
    return this.toAuthUser(row);
  }

  private async findUserByEmail(email: string) { return (await this.pool.query<UserRow>(this.userQuery('LOWER(u.email) = LOWER($1)'), [email.trim()])).rows[0]; }
  private userQuery(where: string) { return `SELECT u.id,u.email,u.display_name,u.department_id,d.name AS department_name,u.token_version,u.password_hash,u.status,u.failed_login_attempts,u.locked_until,u.must_change_password,COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL),'{}') AS roles,COALESCE(array_agg(DISTINCT s.department_id::text) FILTER (WHERE s.department_id IS NOT NULL),'{}') AS scopes,EXISTS(SELECT 1 FROM auth_mfa m WHERE m.user_id=u.id AND m.credential_id IS NOT NULL) AS mfa_enrolled FROM users u JOIN departments d ON d.id=u.department_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN approver_scopes s ON s.user_id=u.id WHERE ${where} GROUP BY u.id,d.id`; }
  private async issueAccessToken(user: AuthUser, mfaVerified: boolean, oidcSessionId?: string) {
    const payload = { sub: user.id, email: user.email, tokenVersion: user.tokenVersion, ...(mfaVerified && { mfaVerified: true }),
      ...(oidcSessionId && { oidcSessionId }) };
    return {
      accessToken: await this.jwt.signAsync(payload, oidcSessionId ? { expiresIn: 60 } : undefined), tokenType: 'Bearer',
      expiresIn: oidcSessionId ? '60s' : process.env.JWT_ACCESS_TTL ?? '15m',
      user: oidcSessionId ? { ...user, signInMethod: 'SSO' as const } : user,
    };
  }
  private async loginSession(client: PoolClient, user: AuthUser, context: SessionContext, mfaVerified: boolean, oidcSessionId?: string) {
    const refreshToken = await this.createSession(client, user, context, mfaVerified, oidcSessionId);
    await client.query('UPDATE users SET last_login_at=NOW(),failed_login_attempts=0,locked_until=NULL WHERE id=$1', [user.id]);
    await this.appendAuthAudit(client, user.id, oidcSessionId ? 'OIDC_LOGIN_SUCCESS' : 'LOGIN_SUCCESS', 'SUCCESS');
    return { ...await this.issueAccessToken(user, mfaVerified, oidcSessionId), refreshToken };
  }
  private async createSession(client: PoolClient, user: AuthUser, context: SessionContext, mfaVerified: boolean, oidcSessionId?: string) {
    const id = randomUUID(), secret = randomBytes(48).toString('base64url'), days = Math.max(1, Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30));
    await client.query(`INSERT INTO auth_sessions (id,user_id,token_hash,user_agent,ip_address,expires_at,mfa_token_version,oidc_session_id)
      VALUES ($1,$2,$3,$4,$5,NOW()+($6 || ' days')::interval,$7,$8)`,
    [id,user.id,this.hash(secret),context.userAgent?.slice(0,500)??null,context.ipAddress??null,days,mfaVerified?user.tokenVersion:null,oidcSessionId??null]);
    return `${id}.${secret}`;
  }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private invalidSession() { return new UnauthorizedException({ code: 'SESSION_INVALID', message: 'Phiên đăng nhập không còn hợp lệ.' }); }
  private toAuthUser(row: UserRow): AuthUser {
    const roles = row.roles ?? [], enrolled = row.mfa_enrolled === true;
    return { id: row.id,email: row.email,displayName: row.display_name,departmentId: row.department_id,departmentName: row.department_name,tokenVersion: row.token_version,roles,approverDepartmentIds: row.scopes??[],mustChangePassword:row.must_change_password,
      ...(requiresMfa(roles, enrolled, row.must_change_password) && { mfaRequired: true }),
      ...(enrolled && { mfaEnrolled: true }),
      ...(process.env.ACCOUNT_ACTIONS_ENABLED==='true'&&{accountActionsEnabled:true}) };
  }
  private appendAuthAudit(queryable: Pick<Pool,'query'>|Pick<PoolClient,'query'>, actorId: string, action: string, outcome: string) { return queryable.query(`INSERT INTO audit_logs (actor_id,actor_type,action,entity_type,entity_id,outcome,metadata) VALUES ($1::uuid,'USER',$2,'SESSION',$1::text,$3,$4::jsonb)`,[actorId,action,outcome,JSON.stringify(auditMetadata())]); }
}
