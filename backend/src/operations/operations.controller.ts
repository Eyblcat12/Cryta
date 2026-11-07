import { Controller, ForbiddenException, Get, Header, Headers, NotFoundException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { OperationsMetricsService } from './operations-metrics.service';

@ApiTags('Operations')
@Controller('operations')
export class OperationsController {
  constructor(private readonly metrics: OperationsMetricsService) {}

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đọc chỉ số vận hành của hệ thống' })
  snapshot(@CurrentUser() user: AuthUser) {
    if (!user.roles.includes('ADMIN')) {
      throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ Security Admin được xem chỉ số vận hành.' });
    }
    return this.metrics.snapshot();
  }

  @Get('signals')
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth('monitorToken')
  @ApiOperation({ summary: 'Đọc mã cảnh báo bằng token monitor riêng' })
  async monitorSignals(@Headers('authorization') authorization?: string) {
    const hash = process.env.OPERATIONS_MONITOR_TOKEN_SHA256;
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new NotFoundException();
    const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '')?.[1];
    if (!token || !timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(hash, 'hex'))) {
      throw new UnauthorizedException({ code: 'MONITOR_AUTH_REQUIRED', message: 'Token giám sát không hợp lệ.' });
    }
    return this.metrics.monitorSnapshot();
  }
}
