import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OperationsController } from './operations.controller';
import { OperationsMetricsService } from './operations-metrics.service';

@Module({
  imports: [AuthModule],
  controllers: [OperationsController],
  providers: [OperationsMetricsService],
  exports: [OperationsMetricsService],
})
export class OperationsModule {}
