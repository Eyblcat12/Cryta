import { auditMetadata } from '../audit/audit-context';
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import { emailConfiguration } from '../notifications/email-template';
import { accountActionTokenHash, deriveAccountActionToken, matchesAccountActionHash, readAccountActionKey, type AccountActionPurpose } from './account-action-token';

type Account = { id: string; status: string; token_version: number; invitation_pending: boolean; password_hash: string };
type UsableAction = { id: string; user_id: string; token_version: number; token_hash: string };
const accepted = { accepted: true } as const;
const invalid = () => new BadRequestException({ code: 'ACCOUNT_LINK_INVALID', message: 'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng.' });

@Injectable()
export class AccountActionsService implements OnModuleInit {
  private readonly logger = new Logger(AccountActionsService.name);
  private key?: Buffer;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  onModuleInit() {
    if (process.env.ACCOUNT_ACTIONS_ENABLED !== 'true') return;
    if (process.env.SMTP_ENABLED !== 'true') throw new Error('ACCOUNT_ACTIONS_REQUIRE_SMTP');
    emailConfiguration(process.env);
    this.key = readAccountActionKey(process.env.ACCOUNT_ACTION_KEY);
  }

  get enabled(): boolean { return this.key !== undefined; }

  requireEnabled(): Buffer {
    if (!this.key) throw new ServiceUnavailableException({ code: 'ACCOUNT_ACTIONS_DISABLED', message: 'Tính năng email tài khoản chưa được bật.' });
    return this.key;
  }

  async requestReset(input: string) {
    const key = this.requireEnabled();
    const email = input.trim().toLowerCase();
    const startedAt = performance.now();
    try {
      if (!await this.takeAttempt('reset-global', 120, 60)) return accepted;
      const fingerprint = createHmac('sha256', key).update('crypta:reset-rate:v1:' + email).digest('hex');
      if (!await this.takeAttempt('reset:' + fingerprint, 3, 900)) return accepted;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const account = (await client.query<Account>(`SELECT id,status,token_version,invitation_pending FROM users
          WHERE LOWER(email)=$1 FOR UPDATE`, [email])).rows[0];
        if (account?.status === 'ACTIVE' && !account.invitation_pending && !await this.recentlyIssued(client, account.id, account.token_version)) {
          await this.issue(client, account.id, account.token_version, 'PASSWORD_RESET');
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
      return accepted;
    } catch {
      this.logger.error({ event: 'account.reset_request_failed', ...auditMetadata() });
      return accepted;
    } finally {
      // Both known and unknown accounts share the same status, body, and latency floor.
      const remaining = 250 - (performance.now() - startedAt);
      if (remaining > 0) await setTimeout(remaining);
    }
  }

  private async recentlyIssued(client: PoolClient, userId: string, version: number): Promise<boolean> {
    const result = await client.query(`SELECT 1 FROM account_actions WHERE user_id=$1 AND token_version=$2
      AND purpose='PASSWORD_RESET' AND used_at IS NULL AND revoked_at IS NULL
      AND created_at>clock_timestamp()-INTERVAL '2 minutes' AND expires_at>clock_timestamp()`, [userId, version]);
    return (result.rowCount ?? 0) > 0;
  }

  async issue(client: PoolClient, userId: string, version: number, purpose: AccountActionPurpose) {
    const key = this.requireEnabled();
    const id = randomUUID();
    const token = deriveAccountActionToken(key, { id, userId, purpose });
    const lifetime = purpose === 'INVITATION' ? 24 * 60 : 30;
    await client.query(`UPDATE account_actions SET revoked_at=clock_timestamp()
      WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL AND revoked_at IS NULL`, [userId, purpose]);
    await client.query(`INSERT INTO account_actions(id,user_id,purpose,token_hash,token_version,expires_at)
      VALUES ($1,$2,$3,$4,$5,clock_timestamp()+make_interval(mins=>$6))`, [id, userId, purpose, accountActionTokenHash(token), version, lifetime]);
    await client.query(`INSERT INTO notifications(recipient_id,type,channel,account_action_id,deduplication_key)
      VALUES ($1,$2,'EMAIL',$3,$4)`, [userId, purpose, id, 'account-action:' + id]);
    if (purpose === 'PASSWORD_RESET') await client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,outcome,metadata)
      VALUES('SYSTEM','PASSWORD_RESET_REQUESTED','USER',$1::text,'SUCCESS',$2::jsonb)`, [userId, JSON.stringify(auditMetadata())]);
  }

  async complete(purpose: AccountActionPurpose, token: string, newPassword: string) {
    const key = this.requireEnabled();
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw new BadRequestException({ code: 'PASSWORD_TOO_LONG', message: 'Mật khẩu mới vượt giới hạn 72 byte.' });
    }
    if (!await this.takeAttempt('complete-global', 120, 60)) {
      throw new HttpException({ code: 'ACCOUNT_ACTION_RATE_LIMIT', message: 'Có quá nhiều yêu cầu. Vui lòng thử lại sau.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const candidate = (await this.pool.query<UsableAction>(`SELECT id,user_id,token_version,token_hash FROM account_actions
      WHERE token_hash=$1 AND purpose=$2 AND expires_at>clock_timestamp() AND used_at IS NULL AND revoked_at IS NULL`,
      [accountActionTokenHash(token), purpose])).rows[0];
    if (!candidate) throw invalid();
    const issuedToken = deriveAccountActionToken(key, { id: candidate.id, userId: candidate.user_id, purpose });
    if (!matchesAccountActionHash(issuedToken, candidate.token_hash)) throw invalid();
    const passwordHash = await hash(newPassword, 12);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = (await client.query<Account>(`SELECT u.id,u.status,u.token_version,u.invitation_pending,u.password_hash
        FROM users u JOIN departments d ON d.id=u.department_id
        WHERE u.id=$1 AND d.is_active FOR UPDATE OF u FOR SHARE OF d`, [candidate.user_id])).rows[0];
      const invitation = purpose === 'INVITATION';
      if (!account || account.token_version !== candidate.token_version ||
          account.invitation_pending !== invitation || account.status !== (invitation ? 'INACTIVE' : 'ACTIVE')) throw invalid();
      const consume = await client.query(`UPDATE account_actions SET used_at=clock_timestamp()
        WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [candidate.id]);
      if (consume.rowCount !== 1) throw invalid();
      if (await compare(newPassword, account.password_hash)) {
        throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
      }
      await client.query(`UPDATE users SET password_hash=$2,status='ACTIVE',must_change_password=FALSE,
        invitation_pending=FALSE,token_version=token_version+1,failed_login_attempts=0,locked_until=NULL WHERE id=$1`, [account.id, passwordHash]);
      await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=$1', [account.id]);
      await client.query('UPDATE account_actions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL', [account.id]);
      if (!invitation) {
        await client.query(`INSERT INTO notifications(recipient_id,type,channel,deduplication_key)
          VALUES ($1,'PASSWORD_RESET_COMPLETED','EMAIL',$2)`, [account.id, 'account-reset-completed:' + candidate.id]);
      }
      await client.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)
        VALUES($1::uuid,'USER',$2,'USER',$1::text,'SUCCESS',$3::jsonb)`, [account.id, invitation ? 'USER_INVITATION_ACCEPTED' : 'USER_PASSWORD_RESET', JSON.stringify(auditMetadata())]);
      await client.query('COMMIT');
      return { changed: true, loginRequired: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async takeAttempt(bucket: string, limit: number, seconds: number): Promise<boolean> {
    const result = await this.pool.query<{ attempt_count: number }>(`INSERT INTO account_action_limits(bucket_key,attempt_count,expires_at)
      VALUES($1,1,clock_timestamp()+make_interval(secs=>$3))
      ON CONFLICT (bucket_key) DO UPDATE SET
        attempt_count=CASE WHEN account_action_limits.expires_at<=clock_timestamp() THEN 1 ELSE account_action_limits.attempt_count+1 END,
        expires_at=CASE WHEN account_action_limits.expires_at<=clock_timestamp() THEN excluded.expires_at ELSE account_action_limits.expires_at END
      WHERE account_action_limits.expires_at<=clock_timestamp() OR account_action_limits.attempt_count<$2 RETURNING attempt_count`, [bucket, limit, seconds]);
    if (bucket === 'reset-global' && result.rows[0]?.attempt_count === 1) {
      await this.pool.query(`DELETE FROM account_action_limits WHERE bucket_key IN (
        SELECT bucket_key FROM account_action_limits WHERE expires_at<clock_timestamp()-INTERVAL '1 hour'
        ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED)`);
    }
    return result.rowCount === 1;
  }
}
