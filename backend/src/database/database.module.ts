import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { MigrationService } from './migration.service';
import { DATABASE_POOL } from './database.constants';
export { DATABASE_POOL } from './database.constants';

@Global()
@Module({
  providers: [{
    provide: DATABASE_POOL,
    useFactory: () => {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
        ...(process.env.CRYPTA_DEPLOYMENT_MODE === 'production' ? { connectionTimeoutMillis: 5000 } : {}),
        idleTimeoutMillis: 30_000,
        statement_timeout: 10_000,
        application_name: 'crypta-api',
      });
      const logger = new Logger('DatabasePool');
      // Idle clients can emit outside a query's try/catch. Never log raw DB errors.
      pool.on('error', () => {
        logger.error('Idle PostgreSQL client error; check database connectivity.');
      });
      return pool;
    },
  }, MigrationService],
  exports: [DATABASE_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // HTTP and claimed jobs must finish before their shared connections close.
  onApplicationShutdown() { return this.pool.end(); }
}
