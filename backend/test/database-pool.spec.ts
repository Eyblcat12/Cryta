import 'reflect-metadata';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_POOL, DatabaseModule } from '../src/database/database.module';
import { HealthController } from '../src/health/health.controller';
import { ReadinessService } from '../src/health/readiness.service';

const pools: Pool[] = [];
const readinessServices: ReadinessService[] = [];

function createHealthController() {
  const readiness = new ReadinessService();
  readinessServices.push(readiness);
  return new HealthController(readiness);
}

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
  await Promise.all(readinessServices.splice(0).map((service) => service.onModuleDestroy()));
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

});

describe('health probes', () => {
  it('reports liveness without connecting and fails readiness when DATABASE_URL is absent', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    const query = vi.spyOn(Pool.prototype, 'query');
    const health = createHealthController();

    expect(health.live()).toMatchObject({ status: 'ok' });
    await expect(health.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(query).not.toHaveBeenCalled();
  });

  it('shares a failing probe, hides driver details and retries the next check', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://fixture@127.0.0.1/test');
    const query = vi.spyOn(Pool.prototype, 'query');
    query.mockRejectedValueOnce(new Error('offline: synthetic-secret') as never);
    query.mockResolvedValueOnce({ rows: [{ value: 1 }] } as never);
    const health = createHealthController();

    const probes = [health.check(), health.check()];
    await Promise.all(probes.map((probe) => expect(probe).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Không thể kết nối database.',
      },
    })));
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith({ text: 'SELECT 1', query_timeout: 1000 });

    await expect(health.check()).resolves.toMatchObject({ status: 'ok', database: 'connected' });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
