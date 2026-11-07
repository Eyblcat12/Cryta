import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RequestsModule } from './requests/requests.module';
import { AssetsModule } from './assets/assets.module';
import { AuditModule } from './audit/audit.module';
import { PoliciesModule } from './policies/policies.module';
import { NotificationsModule } from './notifications/notifications.module';
import { JobsModule } from './jobs/jobs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UsersModule } from './users/users.module';
import { OperationsModule } from './operations/operations.module';
import { DepartmentsModule } from './departments/departments.module';
import { ReportsModule } from './reports/reports.module';

@Module({ imports: [DatabaseModule, AuthModule, HealthModule, AssetsModule, PoliciesModule, RequestsModule, AuditModule, NotificationsModule, JobsModule, DashboardModule, UsersModule, OperationsModule, DepartmentsModule, ReportsModule] })
export class AppModule {}
