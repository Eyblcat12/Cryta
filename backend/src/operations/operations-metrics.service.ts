import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import { cryptoProviderMode } from '../jobs/crypto-provider-config';
import { EMAIL_QUEUE_WAIT_LIMIT_SECONDS, EMAIL_WORKER_SAMPLE, emailWorkerStatus, type EmailWorkerSample } from '../notifications/email-worker-status';

type Job = 'assetProcessing' | 'emailDelivery' | 'expiryScan';
type JobRun = { outcome: 'completed' | 'failed'; finishedAt: string; durationMs: number };
type StatusGroup = '2xx' | '3xx' | '4xx' | '5xx' | 'other';
type QueueSnapshot = {
  collected_at: Date;
  expiry_failed: boolean;
  expiry_stale: boolean;
  email_worker: EmailWorkerSample;
  assets: { ready: number; processing: number; oldestReadySeconds: number | null };
  provider: { reconciliationRequired: number; lastRecordedFailureAt: string | null };
  email: {
    due: number; scheduled: number; sending: number; failed: number;
    reconciliationRequired: number; oldestDueSeconds: number | null; lastFailedAt: string | null;
  };
};

const QUEUE_SNAPSHOT = {
  query_timeout: 2_000,
  text: `
    WITH asset_queue AS (
      SELECT json_build_object(
        'ready', COUNT(*) FILTER (WHERE status = 'APPROVED'),
        'processing', COUNT(*) FILTER (WHERE status = 'PROCESSING'),
        'oldestReadySeconds', EXTRACT(EPOCH FROM statement_timestamp() -
          MIN(updated_at) FILTER (WHERE status = 'APPROVED'))
      ) AS assets
      FROM requests WHERE status IN ('APPROVED', 'PROCESSING')
    ), provider_queue AS (
      SELECT json_build_object(
        'reconciliationRequired', COUNT(*),
        'lastRecordedFailureAt', MAX(updated_at) FILTER (WHERE last_error_code IS NOT NULL)
      ) AS provider
      FROM provider_operations WHERE status = 'RECONCILIATION_REQUIRED'
    ), email_queue AS (
      SELECT json_build_object(
        'due', COUNT(*) FILTER (WHERE delivery_status = 'PENDING' AND scheduled_for <= statement_timestamp()),
        'scheduled', COUNT(*) FILTER (WHERE delivery_status = 'PENDING' AND scheduled_for > statement_timestamp()),
        'sending', COUNT(*) FILTER (WHERE delivery_status = 'SENDING'),
        'failed', COUNT(*) FILTER (WHERE delivery_status = 'FAILED'),
        'lastFailedAt', MAX(failed_at) FILTER (WHERE delivery_status = 'FAILED'),
        'reconciliationRequired', COUNT(*) FILTER (WHERE delivery_status = 'RECONCILIATION_REQUIRED'),
        'oldestDueSeconds', EXTRACT(EPOCH FROM statement_timestamp() -
          MIN(scheduled_for) FILTER (WHERE delivery_status = 'PENDING' AND scheduled_for <= statement_timestamp()))
      ) AS email
      FROM notifications
      WHERE channel = 'EMAIL' AND delivery_status IN ('PENDING', 'SENDING', 'FAILED', 'RECONCILIATION_REQUIRED')
    )
    SELECT statement_timestamp() AS collected_at, assets, provider, email,
      expiry.last_failed AS expiry_failed,
      COALESCE(expiry.last_success_at,expiry.initialized_at) <= statement_timestamp()-INTERVAL '2 hours' AS expiry_stale,
      ${EMAIL_WORKER_SAMPLE} AS email_worker
    FROM asset_queue CROSS JOIN provider_queue CROSS JOIN email_queue
    CROSS JOIN public.expiry_scan_status expiry
    CROSS JOIN public.email_worker_status worker WHERE expiry.singleton AND worker.singleton
  `,
};

const ASSET_WAIT_LIMIT_SECONDS = 120;

@Injectable()
export class OperationsMetricsService {
  private readonly since = new Date().toISOString();
  private readonly statuses: Record<StatusGroup, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
  private readonly latencyLimitsMs = [100, 500, 1_000, 3_000];
  private readonly latencyCounts = [0, 0, 0, 0, 0];
  private readonly jobs: Record<Job, JobRun | null> = { assetProcessing: null, emailDelivery: null, expiryScan: null };
  private totalDurationMs = 0;
  private inFlight?: Promise<QueueSnapshot>;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  observeHttp(status: number, startedAt: number) {
    const durationMs = performance.now() - startedAt;
    const group = Math.floor(status / 100);
    const key = group >= 2 && group <= 5 ? `${group}xx` as StatusGroup : 'other';
    this.statuses[key] += 1;
    const bucket = this.latencyLimitsMs.findIndex(limit => durationMs <= limit);
    this.latencyCounts[bucket === -1 ? this.latencyLimitsMs.length : bucket] += 1;
    this.totalDurationMs += durationMs;
  }

  recordJob(job: Job, outcome: JobRun['outcome'], startedAt: number) {
    this.jobs[job] = {
      outcome, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - startedAt),
    };
  }

  async snapshot() {
    const queues = await this.readQueues();
    const { collected_at, assets, provider, email } = queues;
    const smtpEnabled = process.env.SMTP_ENABLED === 'true';
    return {
      collectedAt: collected_at,
      database: {
        status: 'connected',
        pool: { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount },
      },
      assets: { ...assets, oldestReadySeconds: assets.oldestReadySeconds === null ? null : Math.max(0, assets.oldestReadySeconds) },
      provider: { ...provider, mode: cryptoProviderMode() },
      email: { ...email, enabled: smtpEnabled, worker: emailWorkerStatus(smtpEnabled, queues.email_worker) },
      signals: this.signals(queues, smtpEnabled),
      process: {
        since: this.since,
        jobs: { ...this.jobs },
        http: {
          statuses: { ...this.statuses },
          latencyLimitsMs: [...this.latencyLimitsMs],
          latencyCounts: [...this.latencyCounts],
          totalDurationMs: Math.round(this.totalDurationMs),
        },
      },
    };
  }

  async monitorSnapshot() {
    const queues = await this.readQueues();
    return { collectedAt: queues.collected_at, signals: this.signals(queues, process.env.SMTP_ENABLED === 'true') };
  }

  private readQueues() {
    this.inFlight ??= this.queryQueues().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private signals(
    { assets, provider, email, expiry_failed, expiry_stale, email_worker }: QueueSnapshot,
    smtpEnabled: boolean,
  ): string[] {
    const signals: string[] = [];
    if ((assets.oldestReadySeconds ?? 0) >= ASSET_WAIT_LIMIT_SECONDS) signals.push('ASSET_QUEUE_DELAYED');
    if (provider.reconciliationRequired > 0) signals.push('PROVIDER_RECONCILIATION_REQUIRED');
    if (smtpEnabled && (email.oldestDueSeconds ?? 0) >= EMAIL_QUEUE_WAIT_LIMIT_SECONDS) signals.push('EMAIL_QUEUE_DELAYED');
    if (email.reconciliationRequired > 0) signals.push('EMAIL_RECONCILIATION_REQUIRED');
    const worker = emailWorkerStatus(smtpEnabled, email_worker);
    if (worker.state === 'FAILED') signals.push('EMAIL_WORKER_FAILED');
    if (worker.state === 'STALE') signals.push('EMAIL_WORKER_STALE');
    if (expiry_failed) signals.push('EXPIRY_SCAN_FAILED');
    if (expiry_stale) signals.push('EXPIRY_SCAN_STALE');
    return signals;
  }

  private async queryQueues() {
    try {
      const { rows: [snapshot] } = await this.pool.query<QueueSnapshot>(QUEUE_SNAPSHOT);
      if (!snapshot) throw new Error('EXPIRY_SCAN_STATUS_MISSING');
      return snapshot;
    } catch {
      throw new ServiceUnavailableException({ code: 'METRICS_UNAVAILABLE', message: 'Không thể đọc chỉ số vận hành.' });
    }
  }
}
