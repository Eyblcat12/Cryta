import 'reflect-metadata';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_POOL, DatabaseModule } from '../src/database/database.module';
import { HealthController } from '../src/health/health.controller';

const pools: Pool[] = [];
function createPool() {
  const providers = Reflect.getMetadata('providers', DatabaseModule) as Array<{
    provide?: unknown; useFactory?: () => Pool;
  }>;
  const factory = providers.find((provider) => provider.provide === DATABASE_POOL)?.useFactory;
  if (!factory) throw new Error('DATABASE_POOL factory missing');
  const pool = factory();
  pools.push(pool);
  return pool;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('database pool idle error handling', () => {
  it('preserves configured pool limits and timeouts without opening a connection', () => {
    vi.stubEnv('DATABASE_POOL_SIZE', '7');
    const pool = createPool();
    expect(pool.options).toMatchObject({
      max: 7, idleTimeoutMillis: 30_000, statement_timeout: 10_000,
      application_name: 'crypta-api',
    });
    expect(pool.totalCount).toBe(0);
    expect(pool.listenerCount('error')).toBe(1);
  });

  it('handles repeated idle error events without throwing or logging raw error details', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pool = createPool();
    const error = new Error('ECONNRESET postgres://user:synthetic-secret@example.invalid/db');
    expect(() => { pool.emit('error', error); pool.emit('error', error); }).not.toThrow();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('Idle PostgreSQL client error; check database connectivity.');
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-secret');
  });

  it('does not hide query failures or report healthy while the database is unavailable', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pool = createPool();
    pool.emit('error', new Error('ECONNRESET'));
    const query = vi.spyOn(pool, 'query').mockRejectedValue(new Error('offline') as never);
    const health = new HealthController(pool);
    await expect(health.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('can report healthy on a subsequent successful probe without creating another pool', async () => {
    const pool = createPool();
    const query = vi.spyOn(pool, 'query');
    query.mockRejectedValueOnce(new Error('offline') as never);
    query.mockResolvedValueOnce({ rows: [{ value: 1 }] } as never);
    const health = new HealthController(pool);
    await expect(health.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(health.check()).resolves.toMatchObject({ status: 'ok', database: 'connected' });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
