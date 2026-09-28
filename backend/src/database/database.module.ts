import { Global, Module } from '@nestjs/common';
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
        idleTimeoutMillis: 30_000,
        statement_timeout: 10_000,
        application_name: 'crypta-api',
      });
      pool.on('error', (err) => {
        console.warn('[DatabasePool] Idle client error caught:', err.message);
      });
      return pool;
    },
  }, MigrationService],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
