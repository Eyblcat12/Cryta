import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';

@ApiTags('System')
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @ApiOperation({ summary: 'Kiểm tra API và kết nối database' })
  async check() {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'connected', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE', message: 'Không thể kết nối database.' });
    }
  }
}
