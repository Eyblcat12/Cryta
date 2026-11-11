import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OperationsModule } from '../operations/operations.module';
import { EmailWorkerService } from './email-worker.service';
import { EmailTestService } from './email-test.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuthModule, OperationsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailWorkerService, EmailTestService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
