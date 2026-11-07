import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReadinessService } from './readiness.service';

@ApiTags('System')
@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('live')
  @ApiOperation({ summary: 'Kiểm tra tiến trình API' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Kiểm tra khả năng truy cập database từ API' })
  ready() {
    return this.check();
  }

  @Get()
  @ApiOperation({ summary: 'Kiểm tra API và kết nối database' })
  async check() {
    await this.readiness.check();
    return { status: 'ok', database: 'connected', timestamp: new Date().toISOString() };
  }
}
