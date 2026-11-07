import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import { cryptoProviderMode } from '../jobs/crypto-provider-config';

type Job = 'assetProcessing' | 'emailDelivery' | 'expiryScan';
type JobRun = { outcome: 'completed' | 'failed'; finishedAt: string; durationMs: number };
type StatusGroup = '2xx' | '3xx' | '4xx' | '5xx' | 'other';
type QueueSnapshot = {
  collected_at: Date;
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
    SELECT statement_timestamp() AS collected_at, assets, provider, email
    FROM asset_queue CROSS JOIN provider_queue CROSS JOIN email_queue
  `,
};

const ASSET_WAIT_LIMIT_SECONDS = 120;
const EMAIL_WAIT_LIMIT_SECONDS = 300;
const EXPIRY_STALE_LIMIT_MS = 2 * 60 * 60 * 1_000;

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
    const { collected_at, assets, provider, email } = await this.readQueues();
    const smtpEnabled = process.env.SMTP_ENABLED === 'true';
    return {
      collectedAt: collected_at,
      database: {
        status: 'connected',
        pool: { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount },
      },
      assets: { ...assets, oldestReadySeconds: assets.oldestReadySeconds === null ? null : Math.max(0, assets.oldestReadySeconds) },
      provider: { ...provider, mode: cryptoProviderMode() },
      email: { ...email, enabled: smtpEnabled },
      signals: this.signals(assets, provider, email, smtpEnabled),
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
    const { collected_at, assets, provider, email } = await this.readQueues();
    return { collectedAt: collected_at, signals: this.signals(assets, provider, email, process.env.SMTP_ENABLED === 'true') };
  }

  private readQueues() {
    this.inFlight ??= this.queryQueues().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private signals(
    assets: QueueSnapshot['assets'],
    provider: QueueSnapshot['provider'],
    email: QueueSnapshot['email'],
    smtpEnabled: boolean,
  ): string[] {
    const signals: string[] = [];
    if ((assets.oldestReadySeconds ?? 0) >= ASSET_WAIT_LIMIT_SECONDS) signals.push('ASSET_QUEUE_DELAYED');
    if (provider.reconciliationRequired > 0) signals.push('PROVIDER_RECONCILIATION_REQUIRED');
    if (smtpEnabled && (email.oldestDueSeconds ?? 0) >= EMAIL_WAIT_LIMIT_SECONDS) signals.push('EMAIL_QUEUE_DELAYED');
    if (email.reconciliationRequired > 0) signals.push('EMAIL_RECONCILIATION_REQUIRED');
    const expiry = this.jobs.expiryScan;
    if (expiry?.outcome === 'failed') signals.push('EXPIRY_SCAN_FAILED');
    if (Date.now() - Date.parse(expiry?.finishedAt ?? this.since) >= EXPIRY_STALE_LIMIT_MS) {
      signals.push('EXPIRY_SCAN_STALE');
    }
    return signals;
  }

  private async queryQueues() {
    try {
      const { rows: [snapshot] } = await this.pool.query<QueueSnapshot>(QUEUE_SNAPSHOT);
      return snapshot;
    } catch {
      throw new ServiceUnavailableException({ code: 'METRICS_UNAVAILABLE', message: 'Không thể đọc chỉ số vận hành.' });
    }
  }
}
