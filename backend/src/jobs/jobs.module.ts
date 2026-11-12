import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationsModule } from '../operations/operations.module';
import { AssetProcessingService } from './asset-processing.service';
import { CryptoProviderService } from './crypto-provider.service';
import { ExpiryScanService } from './expiry-scan.service';
import { AuthModule } from '../auth/auth.module';
import { ProviderRecoveryController } from './provider-recovery.controller';

@Module({
  imports: [AuthModule, NotificationsModule, OperationsModule],
  controllers: [ProviderRecoveryController],
  providers: [CryptoProviderService, AssetProcessingService, ExpiryScanService],
})
export class JobsModule {}
