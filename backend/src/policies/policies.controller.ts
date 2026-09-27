import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { UuidLikePipe } from '../common/uuid-like.pipe';
import { DATABASE_POOL } from '../database/database.constants';

@ApiTags('Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('policies')
export class PoliciesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách chính sách đang áp dụng' })
  async list() {
    const result = await this.pool.query(
      `SELECT pv.id, p.id AS policy_id, p.code, p.name, pv.version, pv.configuration, pv.effective_from 
       FROM policy_versions pv 
       JOIN policies p ON p.id = pv.policy_id 
       WHERE p.is_active = TRUE 
       ORDER BY p.name, pv.version DESC`
    );
    return result.rows.map((r) => ({
      id: r.id,
      policyId: r.policy_id,
      code: r.code,
      name: r.name,
      version: r.version,
      configuration: r.configuration,
      effectiveFrom: r.effective_from,
    }));
  }

  @Post()
  @ApiOperation({ summary: 'Tạo chính sách mới (Security Admin)' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: { code: string; name: string; configuration: Record<string, unknown> },
  ) {
    if (!user.roles.includes('ADMIN')) {
      throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ Quản trị bảo mật mới có quyền tạo chính sách.' });
    }
    if (!body.code?.trim() || !body.name?.trim()) {
      throw new BadRequestException({ code: 'INVALID_INPUT', message: 'Mã và tên chính sách không được để trống.' });
    }
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const policyId = randomUUID();
      const versionId = randomUUID();
      const code = body.code.trim().toUpperCase();
      const name = body.name.trim();

      const existing = await client.query('SELECT 1 FROM policies WHERE code = $1', [code]);
      if (existing.rowCount) {
        throw new ConflictException({ code: 'POLICY_EXISTS', message: 'Mã chính sách đã tồn tại.' });
      }

      await client.query(
        `INSERT INTO policies (id, code, name, is_active) VALUES ($1, $2, $3, TRUE)`,
        [policyId, code, name]
      );
      await client.query(
        `INSERT INTO policy_versions (id, policy_id, version, configuration, changed_by, effective_from)
         VALUES ($1, $2, 1, $3::jsonb, $4, NOW())`,
        [versionId, policyId, JSON.stringify(body.configuration ?? {}), user.id]
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_type, action, entity_type, entity_id, outcome, metadata)
         VALUES ($1, 'USER', 'POLICY_CREATED', 'POLICY', $2, 'SUCCESS', $3::jsonb)`,
        [user.id, policyId, JSON.stringify({ code, version: 1 })]
      );
      await client.query('COMMIT');
      return { id: versionId, policyId, code, name, version: 1, configuration: body.configuration };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  @Post(':policyId/versions')
  @ApiOperation({ summary: 'Ban hành phiên bản chính sách mới (Security Admin)' })
  async createVersion(
    @CurrentUser() user: AuthUser,
    @Param('policyId', UuidLikePipe) policyId: string,
    @Body('configuration') configuration: Record<string, unknown>,
  ) {
    if (!user.roles.includes('ADMIN')) {
      throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ Quản trị bảo mật mới có quyền cập nhật chính sách.' });
    }
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const policyRes = await client.query<{ code: string; name: string }>(
        'SELECT code, name FROM policies WHERE id = $1 FOR UPDATE',
        [policyId]
      );
      const policy = policyRes.rows[0];
      if (!policy) {
        throw new NotFoundException({ code: 'POLICY_NOT_FOUND', message: 'Không tìm thấy chính sách.' });
      }

      const latestVerRes = await client.query<{ max_version: number }>(
        'SELECT COALESCE(MAX(version), 0) AS max_version FROM policy_versions WHERE policy_id = $1',
        [policyId]
      );
      const nextVersion = (latestVerRes.rows[0]?.max_version ?? 0) + 1;
      const versionId = randomUUID();

      await client.query(
        `INSERT INTO policy_versions (id, policy_id, version, configuration, changed_by, effective_from)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
        [versionId, policyId, nextVersion, JSON.stringify(configuration ?? {}), user.id]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_type, action, entity_type, entity_id, outcome, metadata)
         VALUES ($1, 'USER', 'POLICY_VERSION_PUBLISHED', 'POLICY', $2, 'SUCCESS', $3::jsonb)`,
        [user.id, policyId, JSON.stringify({ code: policy.code, version: nextVersion })]
      );

      await client.query('COMMIT');
      return { id: versionId, policyId, code: policy.code, name: policy.name, version: nextVersion, configuration };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
