import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthUser } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { auditMetadata } from '../audit/audit-context';
import { EmailWorkerService } from './email-worker.service';

@Injectable()
export class EmailTestService {
  private readonly logger = new Logger(EmailTestService.name);
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly email: EmailWorkerService) {}

  async send(user: AuthUser, recipient: string) {
    if (!user.roles.includes('ADMIN')) throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ Security Admin được gửi email kiểm tra.' });
    if (typeof recipient !== 'string' || recipient.length > 254 || !isEmail(recipient))
      throw new BadRequestException({ code: 'INVALID_EMAIL', message: 'Địa chỉ nhận email không hợp lệ.' });
    this.email.assertTestReady();
    const operationId = randomUUID();
    const metadata = { operationId, recipientDomain: recipient.slice(recipient.lastIndexOf('@') + 1).toLowerCase() };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'");
      // Reserve the shared budget before network I/O; never hold this lock while sending.
      await client.query('SELECT pg_advisory_xact_lock(17232,28)');
      const actor = (await client.query(`SELECT u.status,u.token_version,d.is_active,EXISTS(
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='ADMIN'
        ) AS is_admin FROM users u JOIN departments d ON d.id=u.department_id WHERE u.id=$1 FOR SHARE OF u,d`, [user.id])).rows[0];
      if (!actor || actor.status !== 'ACTIVE' || !actor.is_active || !actor.is_admin || actor.token_version !== user.tokenVersion)
        throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi.' });
      const counts = (await client.query<{ actor_count: number; global_count: number }>(`SELECT
        count(*) FILTER (WHERE actor_id=$1)::int AS actor_count,count(*)::int AS global_count FROM audit_logs
        WHERE action='EMAIL_TEST_REQUESTED' AND occurred_at>clock_timestamp()-INTERVAL '1 minute'`, [user.id])).rows[0];
      if (!counts) throw new Error('EMAIL_TEST_BUDGET_UNAVAILABLE');
      if (counts.actor_count >= 1 || counts.global_count >= 5)
        throw new HttpException({ code: 'EMAIL_TEST_RATE_LIMITED', message: 'Đã đạt giới hạn gửi thử. Hãy chờ một phút trước khi thử lại.', details: [{ retryAfterSeconds: 60 }] }, 429);
      await client.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)
        VALUES($1,'USER','EMAIL_TEST_REQUESTED','EMAIL_TEST',$2,'SUCCESS',$3::jsonb)`, [user.id, operationId, JSON.stringify(auditMetadata(metadata))]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string })?.code === '55P03') throw new ConflictException({ code: 'EMAIL_TEST_BUSY', message: 'Có thao tác gửi thử đang được ghi nhận. Hãy thử lại sau.' });
      throw error;
    } finally { client.release(); }

    let action = 'EMAIL_TEST_ACCEPTED', outcome = 'SUCCESS', smtpStatus: number | undefined;
    try {
      const result = await this.email.sendTest(recipient, operationId);
      if (!result.accepted) action = 'EMAIL_TEST_REJECTED';
    } catch (error) {
      const code = (error as { responseCode?: unknown })?.responseCode;
      if (typeof code === 'number' && Number.isInteger(code) && code >= 400 && code < 600) {
        action = 'EMAIL_TEST_REJECTED'; smtpStatus = code;
      } else action = 'EMAIL_TEST_OUTCOME_UNKNOWN';
    }
    if (action !== 'EMAIL_TEST_ACCEPTED') outcome = 'FAILED';
    try {
      await this.pool.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)
        VALUES($1,'USER',$2,'EMAIL_TEST',$3,$4,$5::jsonb)`,
      [user.id, action, operationId, outcome, JSON.stringify(auditMetadata({ ...metadata, ...(smtpStatus !== undefined && { smtpStatus }) }))]);
    } catch {
      this.logger.error({ event: 'email.test_acknowledgement_failed', operationId, action, ...auditMetadata() });
      throw new ServiceUnavailableException({ code: 'SMTP_TEST_ACKNOWLEDGEMENT_FAILED', message: 'Chưa lưu được kết quả gửi thử. Kiểm tra hộp thư và nhật ký trước khi gửi lại.' });
    }
    if (action === 'EMAIL_TEST_REJECTED') throw new ServiceUnavailableException({ code: 'SMTP_TEST_REJECTED', message: 'SMTP đã từ chối thư thử. Kiểm tra địa chỉ nhận và cấu hình gửi trước khi thử lại.' });
    if (action === 'EMAIL_TEST_OUTCOME_UNKNOWN') throw new ServiceUnavailableException({ code: 'SMTP_TEST_OUTCOME_UNKNOWN', message: 'Chưa xác định được kết quả gửi thử. Kiểm tra hộp thư và nhật ký trước khi gửi lại.' });
    return { sent: true, to: recipient, operationId };
  }
}
