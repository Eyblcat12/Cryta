import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ExpiryScanService } from '../src/jobs/expiry-scan.service';
import type { NotificationsService } from '../src/notifications/notifications.service';

describe('expiry scan', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it('queues the due policy threshold and only audits the first state transition', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
      if (sql.includes("status='EXPIRED'")) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT DISTINCT pv.id,pv.configuration')) return { rows: [{ id: 'policy-1', configuration: { warning_days: [30, 'unsafe-policy-value', 7] } }] };
      if (sql.includes('SELECT a.id, thresholds.warning_day')) return { rows: [{ id: 'asset-1', warning_day: 7 }], rowCount: 1 };
      if (sql.includes("status='EXPIRING_SOON'")) return { rows: [{ id: 'asset-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const enqueueAsset = vi.fn(async () => {});
    const scan = new ExpiryScanService({ connect: vi.fn(async () => ({ query, release })) } as unknown as Pool, { enqueueAsset } as unknown as NotificationsService);
    await scan.run();
    expect(enqueueAsset).toHaveBeenCalledWith(expect.anything(), 'asset-1', 'ASSET_EXPIRING', '7-days');
    const due = query.mock.calls.find(([sql]) => sql.includes('jsonb_to_recordset'));
    expect(JSON.parse(due?.[1][0])).toEqual([{ policy_version_id: 'policy-1', warning_days: [7, 30] }]);
    expect(due?.[0]).toContain('FOR UPDATE OF a');
    expect(warn).toHaveBeenCalledWith({ event: 'expiry.invalid_warning_policy', invalidPolicies: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('unsafe-policy-value');
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('can run again after a database connection failure', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error('DB unavailable')).mockResolvedValueOnce({
      query: vi.fn(async (sql: string) => sql.includes('pg_try_advisory_xact_lock') ? { rows: [{ locked: false }] } : { rows: [] }),
      release: vi.fn(),
    });
    const scan = new ExpiryScanService({ connect } as unknown as Pool, { enqueueAsset: vi.fn() } as unknown as NotificationsService);
    await scan.run();
    await scan.run();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('resets its running guard and releases the connection even if rollback also fails', async () => {
    const failed = vi.fn().mockRejectedValue(new Error('connection lost')), release = vi.fn();
    const connect = vi.fn().mockResolvedValueOnce({ query: failed, release }).mockResolvedValueOnce({
      query: vi.fn(async (sql: string) => sql.includes('pg_try_advisory_xact_lock') ? { rows: [{ locked: false }] } : { rows: [] }), release: vi.fn(),
    });
    const scan = new ExpiryScanService({ connect } as unknown as Pool, {} as NotificationsService);
    await expect(scan.run()).resolves.toBeUndefined(); await expect(scan.run()).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2); expect(release).toHaveBeenCalledOnce();
    expect(failed.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('starts immediately, schedules the hourly scan and stops scheduling on shutdown', async () => {
    vi.useFakeTimers();
    const scan = new ExpiryScanService({} as Pool, {} as NotificationsService);
    const run = vi.spyOn(scan, 'run').mockResolvedValue();
    scan.onModuleInit(); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); expect(run).toHaveBeenCalledTimes(2);
    scan.onModuleDestroy(); await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('lets the active scan commit and release its client before shutdown completes', async () => {
    let committing!: () => void;
    let commit!: () => void;
    const entered = new Promise<void>(resolve => { committing = resolve; });
    const releaseCommit = new Promise<void>(resolve => { commit = resolve; });
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
      if (sql === 'COMMIT') { committing(); await releaseCommit; }
      return { rows: [], rowCount: 0 };
    });
    const connect = vi.fn(async () => ({ query, release }));
    const scan = new ExpiryScanService({ connect } as unknown as Pool, {} as NotificationsService);
    try {
      const active = scan.run();
      await entered;
      scan.onModuleDestroy();
      const drained = vi.fn();
      const shutdown = scan.beforeApplicationShutdown().then(drained);
      await scan.run();
      expect(drained).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      commit();
      await Promise.all([active, shutdown]);
      expect(connect).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      expect(drained).toHaveBeenCalledOnce();
    } finally { commit(); }
  });
});
