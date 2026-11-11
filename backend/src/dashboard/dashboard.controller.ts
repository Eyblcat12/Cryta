import { Controller,Get,Query,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { DashboardService } from './dashboard.service';
@ApiTags('Dashboard')@ApiBearerAuth()@UseGuards(JwtAuthGuard)@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard:DashboardService) {}
  @Get('summary')summary(@CurrentUser()user:AuthUser,@Query('role')role?:string){return this.dashboard.summary(user,role)}
  @Get()get(@CurrentUser()user:AuthUser,@Query('role')role?:string){return this.dashboard.get(user,role)}
}
