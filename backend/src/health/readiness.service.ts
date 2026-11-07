import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

const PROBE_TIMEOUT_MS = 1_000;
const PROBE_QUERY = { text: 'SELECT 1', query_timeout: PROBE_TIMEOUT_MS };

export function shutdownUnavailable() {
  return new ServiceUnavailableException({
    code: 'APP_SHUTTING_DOWN',
    message: 'Dịch vụ đang dừng. Vui lòng thử lại sau.',
  });
}

@Injectable()
export class ReadinessService implements OnModuleDestroy {
  private readonly pool?: Pool;
  private inFlight?: Promise<void>;
  private stopped = false;

  get stopping() { return this.stopped; }

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return;

    this.pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: PROBE_TIMEOUT_MS,
      statement_timeout: PROBE_TIMEOUT_MS,
      application_name: 'crypta-readiness',
    });
    const logger = new Logger(ReadinessService.name);
    this.pool.on('error', () => {
      logger.warn('Idle PostgreSQL readiness connection lost.');
    });
  }

  check(): Promise<void> {
    if (this.stopping) return Promise.reject(shutdownUnavailable());
    // Concurrent requests share one check and cannot build up a pool queue.
    this.inFlight ??= this.probe().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.pool?.end();
  }

  private async probe(): Promise<void> {
    try {
      if (this.pool) {
        await this.pool.query(PROBE_QUERY);
        return;
      }
    } catch {
      // pg discards the failed connection. Keep driver details out of the response.
    }
    throw new ServiceUnavailableException({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Không thể kết nối database.',
    });
  }
}
