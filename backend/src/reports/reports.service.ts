import { BadRequestException, BeforeApplicationShutdown, ConflictException, ForbiddenException, GoneException,
  Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { auditMetadata } from '../audit/audit-context';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { encodeReportCsv } from './report-csv';
import { ReportDataService, reportLimits, reportScope, sameReportScope, type ReportDataset, type ReportFilters,
  type ReportFormat, type ReportScope } from './report-data.service';
import { encodeReportPdf } from './report-pdf';

type ReportState = 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
type Job = {
  id: string; requester_id: string; token_version: number; dataset: ReportDataset; format: ReportFormat;
  filters: ReportFilters; scope: ReportScope; state: ReportState; created_at: Date; finished_at: Date | null;
  expires_at: Date | null; row_count: number | null; failure_code: string | null; claim_token: string | null;
};
const jobColumns = `id,requester_id,token_version,dataset,format,filters,scope,
  CASE WHEN state='READY' AND expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE state END AS state,
  created_at,finished_at,expires_at,row_count,failure_code,claim_token`;

function scopeDenied() {
  return new ForbiddenException({ code: 'REPORT_SCOPE_CHANGED', message: 'Quyền xuất báo cáo đã thay đổi. Hãy tạo tác vụ mới.' });
}

function missingReport() {
  return new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Không tìm thấy báo cáo trong phiên hiện tại.' });
}

function assertReportSize(total: number, limit: number) {
  if (total === 0) throw new BadRequestException({ code: 'REPORT_EMPTY', message: 'Bộ lọc hiện tại không có dữ liệu.' });
  if (total > limit) throw new BadRequestException({ code: 'REPORT_TOO_LARGE', message: 'Hãy thu hẹp bộ lọc hoặc chọn định dạng có giới hạn cao hơn.' });
}

function present(job: Job) {
  return { id: job.id, dataset: job.dataset, format: job.format, scope: job.scope, state: job.state,
    createdAt: job.created_at, finishedAt: job.finished_at, expiresAt: job.expires_at,
    rowCount: job.row_count, failureCode: job.failure_code };
}

@Injectable()
export class ReportsService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(ReportsService.name);
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  private stopping = false;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly auth: AuthService,
    private readonly data: ReportDataService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.kick(), 3_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
  }

  async beforeApplicationShutdown() { await this.pending; }

  async preview(actor: AuthUser, dataset: ReportDataset, filters: ReportFilters) {
    return this.transaction(async client => {
      const user = await this.currentActor(client, actor.id, actor.tokenVersion);
      const scope = reportScope(user, dataset, filters);
      const { total, timeZone } = await this.data.read(client, user, dataset, filters, 1);
      return { total, timeZone, scope, limits: reportLimits };
    }, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  }

  async enqueue(actor: AuthUser, dataset: ReportDataset, format: ReportFormat, filters: ReportFilters, key: string) {
    const job = await this.transaction(async client => {
      const user = await this.currentActor(client, actor.id, actor.tokenVersion, 'FOR UPDATE OF u');
      const scope = reportScope(user, dataset, filters);
      const previous = (await client.query<Job>(`SELECT ${jobColumns} FROM report_exports WHERE requester_id=$1 AND request_key=$2`,
        [user.id, key])).rows[0];
      if (previous) {
        if (previous.token_version !== user.tokenVersion || previous.dataset !== dataset || previous.format !== format ||
          !sameReportScope(previous.scope, scope) || Object.keys(previous.filters).length !== Object.keys(filters).length ||
          Object.entries(filters).some(([name, value]) => previous.filters[name] !== value)) {
          throw new ConflictException({ code: 'REPORT_REQUEST_REUSED', message: 'Mã tạo báo cáo đã được dùng cho yêu cầu khác.' });
        }
        return previous;
      }
      const active = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM report_exports
        WHERE requester_id=$1 AND token_version=$2 AND state IN ('QUEUED','RUNNING')`, [user.id, user.tokenVersion])).rows[0].count;
      if (active >= 3) throw new ConflictException({ code: 'REPORT_QUEUE_FULL', message: 'Bạn có 3 tác vụ đang chờ hoặc đang chạy. Hãy đợi hoặc hủy một tác vụ.' });
      const { total } = await this.data.read(client, user, dataset, filters, 1);
      assertReportSize(total, reportLimits[format]);
      const inserted = (await client.query<Job>(`INSERT INTO report_exports (id,request_key,requester_id,token_version,dataset,format,filters,scope)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${jobColumns}`,
      [randomUUID(), key, user.id, user.tokenVersion, dataset, format, JSON.stringify(filters), JSON.stringify(scope)])).rows[0];
      await this.audit(client, inserted, 'REPORT_EXPORT_CREATED', { estimatedRows: total });
      return inserted;
    });
    this.kick();
    return present(job);
  }

  async list(actor: AuthUser, dataset: ReportDataset) {
    reportScope(actor, dataset, {});
    const { rows } = await this.pool.query<Job>(`SELECT ${jobColumns} FROM report_exports
      WHERE requester_id=$1 AND token_version=$2 AND dataset=$3 ORDER BY created_at DESC,id DESC LIMIT 20`,
    [actor.id, actor.tokenVersion, dataset]);
    return rows.map(present);
  }

  async cancel(actor: AuthUser, id: string) {
    return this.transaction(async client => {
      const user = await this.currentActor(client, actor.id, actor.tokenVersion, 'FOR SHARE OF u');
      const job = await this.find(client, user, id, 'FOR UPDATE');
      if (job.state === 'CANCELLED') return present(job);
      if (!['QUEUED', 'RUNNING'].includes(job.state)) {
        throw new ConflictException({ code: 'REPORT_ALREADY_FINISHED', message: 'Tác vụ đã kết thúc.' });
      }
      const stopped = (await client.query<Job>(`UPDATE report_exports SET state='CANCELLED',claim_token=NULL,lease_until=NULL,
        finished_at=clock_timestamp() WHERE id=$1 RETURNING ${jobColumns}`, [id])).rows[0];
      await this.audit(client, stopped, 'REPORT_EXPORT_CANCELLED');
      return present(stopped);
    });
  }

  async download(actor: AuthUser, id: string) {
    return this.transaction(async client => {
      const user = await this.currentActor(client, actor.id, actor.tokenVersion, 'FOR SHARE OF u');
      const job = await this.find(client, user, id, 'FOR SHARE');
      if (job.state === 'EXPIRED') throw new GoneException({ code: 'REPORT_EXPIRED', message: 'Tệp đã hết hạn. Hãy tạo lại báo cáo.' });
      if (job.state !== 'READY') throw new ConflictException({ code: 'REPORT_NOT_READY', message: 'Tệp báo cáo chưa sẵn sàng.' });
      const content = (await client.query<{ content: Buffer }>(`SELECT content FROM report_exports
        WHERE id=$1 AND state='READY' AND expires_at>clock_timestamp()`, [id])).rows[0]?.content;
      if (!content) throw new GoneException({ code: 'REPORT_EXPIRED', message: 'Tệp đã hết hạn. Hãy tạo lại báo cáo.' });
      await this.audit(client, job, 'REPORT_EXPORT_DOWNLOADED', { rows: job.row_count });
      return { content, format: job.format, dataset: job.dataset };
    });
  }

  private kick() {
    if (this.pending || this.stopping) return;
    this.pending = this.processOne().catch(() => this.logger.error({ event: 'report_export.worker_failed' }))
      .finally(() => { this.pending = undefined; });
  }

  private async processOne() {
    await this.pool.query(`UPDATE report_exports SET state='EXPIRED',content=NULL WHERE id IN (
      SELECT id FROM report_exports WHERE state='READY' AND expires_at<=clock_timestamp()
      ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED)`);
    await this.pool.query(`DELETE FROM report_exports WHERE id IN (
      SELECT id FROM report_exports WHERE state IN ('EXPIRED','FAILED','CANCELLED')
      AND finished_at<clock_timestamp()-interval '1 day' ORDER BY finished_at LIMIT 50 FOR UPDATE SKIP LOCKED)`);
    await this.pool.query(`UPDATE report_exports SET state='FAILED',lease_until=NULL,claim_token=NULL,
      finished_at=clock_timestamp(),failure_code='REPORT_INTERRUPTED' WHERE id IN (
      SELECT id FROM report_exports WHERE state='RUNNING' AND lease_until<=clock_timestamp() AND attempts>=3
      ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED)`);
    const claim = randomUUID();
    const job = (await this.pool.query<Job>(`UPDATE report_exports SET state='RUNNING',lease_until=clock_timestamp()+interval '2 minutes',
      claim_token=$1,attempts=attempts+1 WHERE id=(
        SELECT id FROM report_exports WHERE state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp() AND attempts<3)
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING ${jobColumns}`, [claim])).rows[0];
    if (!job) return;
    try {
      const report = await this.transaction(async client => {
        const user = await this.currentActor(client, job.requester_id, job.token_version);
        this.assertScope(user, job);
        const limit = reportLimits[job.format];
        const result = await this.data.read(client, user, job.dataset, job.filters, limit);
        assertReportSize(result.total, limit);
        if (result.rows.length !== result.total) throw new Error('REPORT_COUNT_MISMATCH');
        return result;
      }, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const content = job.format === 'CSV' ? encodeReportCsv(report) : await encodeReportPdf(report);
      if (content.length > 8 * 1024 * 1024) throw new Error('REPORT_FILE_TOO_LARGE');
      await this.transaction(async client => {
        const user = await this.currentActor(client, job.requester_id, job.token_version, 'FOR SHARE OF u');
        this.assertScope(user, job);
        const updated = await client.query(`UPDATE report_exports SET state='READY',content=$3,row_count=$4,
          finished_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 hour',claim_token=NULL,lease_until=NULL
          WHERE id=$1 AND claim_token=$2 AND lease_until>clock_timestamp() RETURNING id`, [job.id, claim, content, report.total]);
        if (updated.rowCount) await this.audit(client, job, 'REPORT_EXPORT_READY', { rows: report.total });
      });
    } catch (error) {
      const code = error instanceof ForbiddenException ? 'REPORT_SCOPE_CHANGED'
        : error instanceof BadRequestException ? (error.getResponse() as { code: string }).code : 'REPORT_BUILD_FAILED';
      await this.transaction(async client => {
        const failed = await client.query(`UPDATE report_exports SET state='FAILED',failure_code=$3,
          claim_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=$1 AND claim_token=$2 RETURNING id`,
        [job.id, claim, code]);
        if (failed.rowCount) await this.audit(client, job, 'REPORT_EXPORT_FAILED', { code }, 'FAILED');
      });
    }
  }

  private async currentActor(client: PoolClient, id: string, version: number, lock = '') {
    const active = await client.query(`SELECT u.id FROM users u JOIN departments d ON d.id=u.department_id
      WHERE u.id=$1 AND u.token_version=$2 AND u.status='ACTIVE' AND d.is_active AND NOT u.must_change_password ${lock}`,
    [id, version]);
    if (!active.rowCount) throw scopeDenied();
    const user = await this.auth.getUserById(id, client);
    if (user.tokenVersion !== version || user.mustChangePassword) throw scopeDenied();
    return user;
  }

  private assertScope(user: AuthUser, job: Job) {
    if (!sameReportScope(reportScope(user, job.dataset, job.filters), job.scope)) throw scopeDenied();
  }

  private async find(client: PoolClient, user: AuthUser, id: string, lock: 'FOR UPDATE' | 'FOR SHARE') {
    const job = (await client.query<Job>(`SELECT ${jobColumns} FROM report_exports WHERE id=$1
      AND requester_id=$2 AND token_version=$3 ${lock}`, [id, user.id, user.tokenVersion])).rows[0];
    if (!job) throw missingReport();
    this.assertScope(user, job);
    return job;
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>, begin = 'BEGIN') {
    const client = await this.pool.connect();
    try {
      await client.query(begin);
      await client.query("SET LOCAL statement_timeout='10s'");
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private audit(client: PoolClient, job: Job, action: string, details: object = {}, outcome = 'SUCCESS') {
    return client.query(`INSERT INTO audit_logs (actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)
      VALUES ($1,'USER',$2,'REPORT_EXPORT',$3,$4,$5::jsonb)`, [job.requester_id, action, job.id, outcome,
      JSON.stringify(auditMetadata({ dataset: job.dataset, format: job.format, scope: job.scope, ...details }))]);
  }
}
