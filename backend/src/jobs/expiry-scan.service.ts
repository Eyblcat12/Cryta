import { auditMetadata } from '../audit/audit-context';
import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DrainablePoll } from '../common/drainable-poll';
import { DATABASE_POOL } from '../database/database.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsMetricsService } from '../operations/operations-metrics.service';
import { expiryWarningPolicy } from './expiry-warning-policy';

type DueWarning = { id: string; warning_day: number };

@Injectable()
export class ExpiryScanService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly poll = new DrainablePoll();
  private get running() { return this.poll.running; }
  private readonly logger = new Logger(ExpiryScanService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly notifications: NotificationsService,
    private readonly metrics?: OperationsMetricsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), 60 * 60 * 1000);
    void this.run();
  }

  onModuleDestroy() {
    this.poll.stop();
    if (this.timer) clearInterval(this.timer);
  }

  beforeApplicationShutdown() { return this.poll.drain(); }

  run(): Promise<void> {
    return this.running ? Promise.resolve() : this.poll.run(() => this.scan());
  }

  private async scan() {
    const startedAt = performance.now();
    let client: PoolClient | undefined;
    let attemptAt: string | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      const lock = await client.query<{ locked: boolean; attempt_at: string }>(
        'SELECT pg_try_advisory_xact_lock(20260904) AS locked, clock_timestamp()::text AS attempt_at');
      if (!lock.rows[0].locked) {
        await client.query('ROLLBACK');
        return;
      }
      attemptAt = lock.rows[0].attempt_at;

      const expired = await client.query<{ id: string }>(`UPDATE crypto_assets SET status='EXPIRED',version=version+1
        WHERE status IN ('ACTIVE','EXPIRING_SOON') AND expires_at<=NOW() RETURNING id`);
      for (const asset of expired.rows) {
        await this.notifications.enqueueAsset(client, asset.id, 'ASSET_EXPIRED', 'expired');
        await this.audit(client, asset.id, 'ASSET_MARKED_EXPIRED');
      }

      // Never cast legacy JSON values in SQL. Validate each attached policy once;
      // malformed entries cannot roll back expiry transitions for healthy assets.
      const policies = await client.query<{ id: string; configuration: unknown }>(`SELECT DISTINCT pv.id,pv.configuration
        FROM policy_versions pv JOIN crypto_assets a ON a.policy_version_id=pv.id
        WHERE a.status IN ('ACTIVE','EXPIRING_SOON') AND a.expires_at>NOW()`);
      let invalidPolicies = 0;
      const warningPolicies = policies.rows.map(policy => {
        const normalized = expiryWarningPolicy(policy.configuration);
        if (normalized.invalid) invalidPolicies++;
        return { policy_version_id: policy.id, warning_days: normalized.days };
      });
      // Choose the nearest due threshold. After downtime this sends one useful
      // catch-up reminder, while the notification key prevents hourly duplicates.
      // Policy days are elapsed 24-hour periods, independent of the database time zone.
      const due = await client.query<DueWarning>(`WITH warning_policies AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS input(policy_version_id uuid,warning_days jsonb)
        ) SELECT a.id, thresholds.warning_day
        FROM crypto_assets a JOIN warning_policies wp ON wp.policy_version_id=a.policy_version_id
        CROSS JOIN LATERAL (
          SELECT MIN(value::int) AS warning_day
          FROM jsonb_array_elements_text(wp.warning_days) AS days(value)
          WHERE value::int > 0 AND a.expires_at <= NOW() + make_interval(hours => value::int * 24)
        ) thresholds
        WHERE a.status IN ('ACTIVE','EXPIRING_SOON') AND a.expires_at > NOW()
          AND thresholds.warning_day IS NOT NULL ORDER BY a.id FOR UPDATE OF a`, [JSON.stringify(warningPolicies)]);
      const firstWarnings = await client.query<{ id: string }>(`UPDATE crypto_assets SET status='EXPIRING_SOON',version=version+1
        WHERE id=ANY($1::uuid[]) AND status='ACTIVE' RETURNING id`, [due.rows.map((row) => row.id)]);
      for (const asset of firstWarnings.rows) await this.audit(client, asset.id, 'ASSET_MARKED_EXPIRING_SOON');
      for (const asset of due.rows) await this.notifications.enqueueAsset(client, asset.id, 'ASSET_EXPIRING', `${asset.warning_day}-days`);

      await client.query(`UPDATE public.expiry_scan_status SET last_attempt_at=$1,last_success_at=clock_timestamp(),last_failed=false
        WHERE singleton`, [attemptAt]);
      await client.query('COMMIT');
      if (invalidPolicies) this.logger.warn({ event: 'expiry.invalid_warning_policy', invalidPolicies });
      this.metrics?.recordJob('expiryScan', 'completed', startedAt);
      this.logger.log({
        event: 'expiry.scan_completed',
        warningsDue: due.rowCount ?? 0,
        expired: expired.rowCount ?? 0,
        invalidPolicies,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch {
      this.metrics?.recordJob('expiryScan', 'failed', startedAt);
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (attemptAt) {
          // An overlapping, newer scan may have finished after this transaction rolled back.
          await client.query(`UPDATE public.expiry_scan_status SET last_attempt_at=$1,last_failed=true
            WHERE singleton AND (last_attempt_at IS NULL OR last_attempt_at<$1)`, [attemptAt]).catch(() => undefined);
        }
      }
      this.logger.error({ event: 'expiry.scan_failed', durationMs: Math.round(performance.now() - startedAt) });
    } finally {
      client?.release();
    }
  }

  private audit(client: PoolClient, id: string, action: string) {
    return client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,outcome,metadata)
      VALUES('SYSTEM',$1,'CRYPTO_ASSET',$2,'SUCCESS',$3::jsonb)`, [action, id, JSON.stringify(auditMetadata())]);
  }
}
