import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationShutdown, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Pool } from 'pg';
import { DrainablePoll } from '../common/drainable-poll';
import { DATABASE_POOL } from '../database/database.constants';
import { OperationsMetricsService } from '../operations/operations-metrics.service';
import { accountEmail, emailConfiguration, mfaSecurityChangedEmail, notificationEmail, passwordResetCompletedEmail } from './email-template';
import { deriveAccountActionToken, matchesAccountActionHash, readAccountActionKey, type AccountActionPurpose } from '../auth/account-action-token';
import { ASSET_ALERT_RECIPIENT } from './asset-alert-recipient';

type Job = { id:string; type:string; recipient_email:string; recipient_name:string; request_id:string|null; asset_id:string|null; created_at?:Date; asset_expires_at?:Date|null };
type AccountDelivery = { id: string; user_id: string; purpose: AccountActionPurpose; token_hash: string; created_at: Date; expires_at: Date };

@Injectable()
export class EmailWorkerService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(EmailWorkerService.name);
  private readonly poll = new DrainablePoll();
  private timer?: NodeJS.Timeout;
  private transporter?: Transporter;
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly metrics?: OperationsMetricsService,
  ) {}
  async onModuleInit(){
    if (process.env.SMTP_ENABLED !== undefined && !['true', 'false'].includes(process.env.SMTP_ENABLED)) {
      throw new Error('SMTP_ENABLED_INVALID');
    }
    if(process.env.SMTP_ENABLED!=='true'){this.logger.warn('SMTP đang tắt; đặt SMTP_ENABLED=true để gửi email thật.');return;}
    this.required('SMTP_FROM');
    emailConfiguration(process.env);
    const host = this.required('SMTP_HOST').trim();
    if (!host || /[\s/]/.test(host)) throw new Error('SMTP_HOST_INVALID');
    const secureFlag = process.env.SMTP_SECURE;
    if (secureFlag !== undefined && !['true', 'false'].includes(secureFlag)) throw new Error('SMTP_SECURE_INVALID');
    const port = Number(process.env.SMTP_PORT ?? (secureFlag === 'true' ? 465 : 587));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT_INVALID');
    const secure = secureFlag === 'true' || (secureFlag === undefined && port === 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    if (Boolean(user) !== Boolean(pass)) throw new Error('SMTP_AUTH_INCOMPLETE');
    const loopback = host === '127.0.0.1' || host === '::1';
    const transporter = nodemailer.createTransport({
      host, port, secure, requireTLS: !secure && (!loopback || Boolean(user)),
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: 10_000, socketTimeout: 20_000,
    });
    try {
      await transporter.verify();
    } catch {
      transporter.close();
      this.logger.error({ event: 'email.smtp_verify_failed' });
      throw new Error('SMTP_VERIFY_FAILED');
    }
    this.transporter = transporter;
    this.logger.log('Kết nối SMTP đã được xác minh.');
    await this.reconcileStuck();
    this.timer=setInterval(()=>void this.processBatch(),10_000); void this.processBatch();
  }
  onModuleDestroy() {
    this.poll.stop();
    if (this.timer) clearInterval(this.timer);
  }

  beforeApplicationShutdown() { return this.poll.drain(); }

  onApplicationShutdown() { this.transporter?.close(); }
  assertTestReady(){if(!this.transporter)throw new ServiceUnavailableException({code:'SMTP_DISABLED',message:'SMTP chưa được bật hoặc chưa kết nối. Hãy kiểm tra cấu hình SMTP_* rồi khởi động lại hệ thống.'});this.from()}
  async sendTest(to:string,operationId:string){
    this.assertTestReady();
    const domain=this.from().match(/@([a-z0-9.-]+)/i)?.[1]??'crypta.invalid';
    const result=await this.transporter!.sendMail({from:this.from(),to,messageId:`<email-test-${operationId}@${domain}>`,subject:'Crypta - Kiểm tra cấu hình email',text:'Cấu hình SMTP của Crypta đang hoạt động.',html:'<p>Cấu hình SMTP của <strong>Crypta</strong> đang hoạt động.</p>'});
    const accepted:unknown=result.accepted;
    if(!Array.isArray(accepted))throw new Error('SMTP_TEST_RESULT_UNCONFIRMED');
    const matches=(item:unknown)=>{
      const address=typeof item==='string'?item:item&&typeof item==='object'?(item as {address?:unknown}).address:undefined;
      return typeof address==='string'&&address.toLowerCase()===to.toLowerCase();
    };
    if(accepted.some(matches))return{accepted:true};
    if(Array.isArray(result.rejected)&&result.rejected.some(matches))return{accepted:false};
    throw new Error('SMTP_TEST_RESULT_UNCONFIRMED');
  }
  private processBatch(): Promise<void> {
    if (!this.transporter) return Promise.resolve();
    return this.poll.run(() => this.deliverBatch());
  }

  private async deliverBatch() {
    const startedAt = performance.now();
    try {
      await this.reconcileStuck();
      for (let i = 0; i < 10 && !this.poll.stopping; i++) {
        const job = await this.claim();
        if (!job) break;
        await this.deliver(job);
      }
      this.metrics?.recordJob('emailDelivery', 'completed', startedAt);
    } catch {
      this.metrics?.recordJob('emailDelivery', 'failed', startedAt);
      this.logger.error({ event: 'email.poll_failed' });
    }
  }
  private async reconcileStuck(){const result=await this.pool.query(`UPDATE notifications SET delivery_status='RECONCILIATION_REQUIRED',error_message='SMTP outcome unknown after worker interruption; verify provider before retry' WHERE channel='EMAIL' AND delivery_status='SENDING' AND COALESCE(claimed_at,scheduled_for)<NOW()-INTERVAL '10 minutes' RETURNING id`);if(result.rowCount)this.logger.warn(`${result.rowCount} email cần kiểm tra kết quả gửi trước khi thử lại.`)}
  private async claim():Promise<Job|undefined>{const client=await this.pool.connect();try{await client.query('BEGIN');const found=await client.query<Job>(`SELECT n.id,n.type,n.request_id,n.asset_id,n.created_at,a.expires_at AS asset_expires_at,u.email AS recipient_email,u.display_name AS recipient_name FROM notifications n JOIN users u ON u.id=n.recipient_id LEFT JOIN crypto_assets a ON a.id=n.asset_id WHERE n.channel='EMAIL' AND n.delivery_status='PENDING' AND n.scheduled_for<=NOW() ORDER BY n.scheduled_for,n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1`);const job=found.rows[0];if(job)await client.query(`UPDATE notifications SET delivery_status='SENDING',attempt_count=attempt_count+1,claimed_at=NOW() WHERE id=$1`,[job.id]);await client.query('COMMIT');return job}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  private async deliver(job: Job) {
    let message;
    try { message = await this.message(job); }
    catch {
      // No SMTP call was made; a preparation failure is a known unsent result.
      await this.pool.query(`UPDATE notifications SET delivery_status='FAILED',failed_at=NOW(),error_message=$2
        WHERE id=$1 AND delivery_status='SENDING'`, [job.id, 'Email content could not be prepared']);
      this.logger.error({ event: 'email.content_failed', notificationId: job.id });
      return;
    }
    try {
      await this.transporter!.sendMail({
        from: this.from(), to: job.recipient_email, messageId: this.messageId(job.id),
        subject: message.subject, text: message.text, html: message.html,
      });
    } catch (error) {
      const code = (error as { responseCode?: unknown })?.responseCode;
      if (typeof code === 'number' && Number.isInteger(code) && code >= 400 && code < 600) {
        await this.pool.query(`UPDATE notifications
          SET delivery_status=CASE WHEN $3::int>=500 OR attempt_count>=5 THEN 'FAILED' ELSE 'PENDING' END,
            failed_at=CASE WHEN $3::int>=500 OR attempt_count>=5 THEN NOW() ELSE NULL END,
            scheduled_for=NOW()+(LEAST(attempt_count,5)*INTERVAL '2 minutes'),error_message=$2
          WHERE id=$1 AND delivery_status='SENDING'`, [job.id, `SMTP rejected delivery (${code})`, code]);
        this.logger.warn({ event: 'email.delivery_rejected', notificationId: job.id, smtpStatus: code });
      } else {
        await this.pool.query(`UPDATE notifications
          SET delivery_status='RECONCILIATION_REQUIRED',error_message=$2 WHERE id=$1 AND delivery_status='SENDING'`,
          [job.id, 'SMTP outcome unknown; verify provider before retry']);
        this.logger.warn({ event: 'email.delivery_uncertain', notificationId: job.id });
      }
      return;
    }

    try {
      await this.pool.query(`UPDATE notifications SET delivery_status='SENT',sent_at=NOW(),error_message=NULL
        WHERE id=$1 AND delivery_status='SENDING'`, [job.id]);
    } catch {
      this.logger.error({ event: 'email.acknowledgement_failed', notificationId: job.id });
    }
  }
  private async message(job: Job) {
    const config = emailConfiguration(process.env);
    if(job.type==='ASSET_EXPIRING'||job.type==='ASSET_EXPIRED'){
      const eligible=await this.pool.query(`SELECT 1 FROM notifications n JOIN crypto_assets a ON a.id=n.asset_id
        JOIN users u ON u.id=n.recipient_id AND u.status='ACTIVE' JOIN departments d ON d.id=u.department_id AND d.is_active
        WHERE n.id=$1 AND n.channel='EMAIL' AND n.delivery_status='SENDING' AND ${ASSET_ALERT_RECIPIENT}`,[job.id]);
      if(!eligible.rowCount)throw new Error('ASSET_ALERT_RECIPIENT_NO_LONGER_ELIGIBLE');
    }
    if (job.type === 'PASSWORD_RESET_COMPLETED') return passwordResetCompletedEmail(job.recipient_name, config);
    if (job.type === 'MFA_SECURITY_CHANGED') return mfaSecurityChangedEmail(job.recipient_name, job.created_at ?? null, config);
    if (job.type === 'INVITATION' || job.type === 'PASSWORD_RESET') {
      if (process.env.ACCOUNT_ACTIONS_ENABLED !== 'true') throw new Error('ACCOUNT_ACTIONS_DISABLED');
      const result = await this.pool.query<AccountDelivery>(`SELECT a.id,a.user_id,a.purpose,a.token_hash,a.created_at,a.expires_at
        FROM notifications n JOIN account_actions a ON a.id=n.account_action_id
        JOIN users u ON u.id=a.user_id JOIN departments d ON d.id=u.department_id
        WHERE n.id=$1 AND n.delivery_status='SENDING' AND d.is_active AND u.token_version=a.token_version
          AND a.expires_at>clock_timestamp() AND a.used_at IS NULL AND a.revoked_at IS NULL
          AND ((a.purpose='INVITATION' AND u.invitation_pending AND u.status='INACTIVE')
            OR (a.purpose='PASSWORD_RESET' AND NOT u.invitation_pending AND u.status='ACTIVE'))`, [job.id]);
      const action = result.rows[0];
      if (!action) throw new Error('ACCOUNT_ACTION_NOT_DELIVERABLE');
      const key = readAccountActionKey(process.env.ACCOUNT_ACTION_KEY);
      const actionToken = deriveAccountActionToken(key, { id: action.id, userId: action.user_id, purpose: action.purpose });
      if (!matchesAccountActionHash(actionToken, action.token_hash)) throw new Error('ACCOUNT_ACTION_KEY_CHANGED');
      return accountEmail({ purpose: action.purpose, recipientName: job.recipient_name,
        actionToken, issuedAt: action.created_at, expiresAt: action.expires_at }, config);
    }
    return notificationEmail({ type: job.type, recipientName: job.recipient_name, requestId: job.request_id,
      assetId: job.asset_id, occurredAt: job.created_at, expiresAt: job.asset_expires_at }, config);
  }
  private required(key:string){const value=process.env[key];if(!value)throw new Error(`${key} is required when SMTP_ENABLED=true`);return value}
  private from(){return this.required('SMTP_FROM')}
  private messageId(id:string){const domain=this.from().match(/@([a-z0-9.-]+)/i)?.[1]??'crypta.invalid';return `<notification-${id}@${domain}>`}

}
