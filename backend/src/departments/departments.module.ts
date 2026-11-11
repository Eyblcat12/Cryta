import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';

@Module({ imports: [AuthModule, UsersModule], controllers: [DepartmentsController], providers: [DepartmentsService] })
export class DepartmentsModule {}
