import { Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AUDIT_FAILURE_POOL, HttpFailureAuditService } from './http-failure-audit.service';

@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [HttpFailureAuditService, {
    provide: AUDIT_FAILURE_POOL,
    useFactory: () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 1000,
        idleTimeoutMillis: 10_000, statement_timeout: 2000, query_timeout: 2500, application_name: 'crypta-failure-audit' });
      const logger = new Logger('FailureAuditPool');
      pool.on('error', () => logger.error({ event: 'audit.idle_connection_lost' }));
      return pool;
    },
  }],
  exports: [HttpFailureAuditService],
})
export class AuditModule {}
