import {
  Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { Pool, PoolClient } from 'pg';
import { auditMetadata } from '../audit/audit-context';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { UuidLikePipe } from '../common/uuid-like.pipe';
import { DATABASE_POOL } from '../database/database.constants';
import { resolveProvisionParameters } from '../requests/request-policy';

class PolicyConfigurationDto {
  @ApiPropertyOptional({ enum: ['RSA', 'ECDSA', 'ED25519', 'AES'] })
  @IsOptional() @IsIn(['RSA', 'ECDSA', 'ED25519', 'AES']) algorithm?: string;
  @ApiPropertyOptional({ type: 'integer', minimum: 128, maximum: 16384 })
  @IsOptional() @IsInt() @Min(128) @Max(16384) minimumKeySize?: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 3650 })
  @IsInt() @Min(1) @Max(3650) maximumValidityDays: number;
  @ApiPropertyOptional({ enum: ['TLS_SERVER'] })
  @IsOptional() @IsIn(['TLS_SERVER']) certificateProfile?: string;
  @ApiProperty({ type: 'array', uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 3650 } })
  @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(3650, { each: true }) warningDays: number[];
}

export class PolicyVersionDto extends PolicyConfigurationDto {
  @ApiProperty({ type: 'integer', minimum: 0 })
  @IsInt() @Min(0) expectedVersion: number;
}

export class CreatePolicyDto extends PolicyConfigurationDto {
  @ApiProperty({ minLength: 1, maxLength: 50, description: 'Mã chữ, số, gạch dưới hoặc gạch ngang. Server chuyển thành chữ hoa.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Length(1, 50) @Matches(/^[A-Z0-9_-]+$/) code: string;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 255) name: string;
}

export class StopPolicyDto {
  @ApiProperty({ type: 'integer', minimum: 0 })
  @IsInt() @Min(0) expectedVersion: number;
}

interface VersionRow {
  id: string;
  version: number;
  configuration: Record<string, unknown>;
  effective_from: Date;
}

function presentVersion(row: VersionRow) {
  return { id: row.id, version: row.version, configuration: row.configuration, effectiveFrom: row.effective_from };
}

@ApiTags('Policies') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('policies')
export class PoliciesController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  async list() {
    const result = await this.pool.query(`SELECT pv.id,p.id policy_id,p.code,p.name,pv.version,pv.configuration,pv.effective_from
      FROM policy_versions pv JOIN policies p ON p.id=pv.policy_id
      WHERE p.is_active=TRUE AND pv.effective_from<=statement_timestamp() ORDER BY p.name,pv.version DESC`);
    return result.rows.map(row => ({ ...presentVersion(row), policyId: row.policy_id, code: row.code, name: row.name }));
  }

  @Get('admin')
  async listAdmin(@CurrentUser() user: AuthUser) {
    this.assertAdmin(user);
    const result = await this.pool.query(`SELECT p.id,p.code,p.name,p.is_active AS active,
      to_jsonb(latest) AS latest,effective.version AS "effectiveVersion",effective.effective_from AS "effectiveFrom"
      FROM policies p
      LEFT JOIN LATERAL (SELECT id,version,configuration,effective_from FROM policy_versions
        WHERE policy_id=p.id ORDER BY version DESC LIMIT 1) latest ON TRUE
      LEFT JOIN LATERAL (SELECT version,effective_from FROM policy_versions
        WHERE policy_id=p.id AND p.is_active AND effective_from<=statement_timestamp()
        ORDER BY version DESC LIMIT 1) effective ON TRUE
      ORDER BY p.name,p.id`);
    return result.rows.map(({ latest, ...policy }) => ({ ...policy, latest: latest ? presentVersion(latest) : null }));
  }

  @Get(':id/versions')
  async history(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string) {
    this.assertAdmin(user);
    const result = await this.pool.query<VersionRow>(`SELECT pv.id,pv.version,pv.configuration,pv.effective_from
      FROM policies p LEFT JOIN policy_versions pv ON pv.policy_id=p.id WHERE p.id=$1 ORDER BY pv.version DESC`, [id]);
    if (!result.rowCount) throw this.notFound();
    return result.rows.filter(row => row.id).map(presentVersion);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreatePolicyDto) {
    this.assertAdmin(user);
    const configuration = this.configuration(dto);
    return this.transaction(async client => {
      const result = await client.query<{ id: string }>(`INSERT INTO policies(code,name) VALUES($1,$2)
        ON CONFLICT(code) DO NOTHING RETURNING id`, [dto.code, dto.name]);
      const policyId = result.rows[0]?.id;
      if (!policyId) throw new ConflictException({ code: 'POLICY_CODE_EXISTS', message: 'Mã chính sách đã được sử dụng.' });
      const first = await this.insertVersion(client, policyId, 1, configuration, user.id);
      await this.audit(client, user.id, policyId, 'POLICY_CREATED', { code: dto.code, newVersion: 1, configuration });
      return { id: policyId, code: dto.code, name: dto.name, active: true, latest: first, effectiveVersion: 1, effectiveFrom: first.effectiveFrom };
    });
  }

  @Post(':id/versions')
  async version(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() dto: PolicyVersionDto) {
    this.assertAdmin(user);
    const configuration = this.configuration(dto);
    return this.transaction(async client => {
      await this.lockActiveVersion(client, id, dto.expectedVersion);
      const version = dto.expectedVersion + 1;
      const result = await this.insertVersion(client, id, version, configuration, user.id);
      await this.audit(client, user.id, id, 'POLICY_VERSION_CREATED', { previousVersion: dto.expectedVersion, newVersion: version, configuration });
      return { ...result, policyId: id };
    });
  }

  @Patch(':id/deactivate')
  async deactivate(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() dto: StopPolicyDto) {
    this.assertAdmin(user);
    return this.transaction(async client => {
      await this.lockActiveVersion(client, id, dto.expectedVersion);
      await client.query('UPDATE policies SET is_active=FALSE WHERE id=$1', [id]);
      await this.audit(client, user.id, id, 'POLICY_DEACTIVATED', { latestVersion: dto.expectedVersion });
      return { id, active: false, latestVersion: dto.expectedVersion };
    });
  }

  private assertAdmin(user: AuthUser) {
    if (!user.roles.includes('ADMIN')) throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ quản trị bảo mật được quản lý chính sách.' });
  }

  private notFound() {
    return new NotFoundException({ code: 'POLICY_NOT_FOUND', message: 'Không tìm thấy chính sách.' });
  }

  private configuration(dto: PolicyConfigurationDto) {
    const invalid = (message: string) => new ConflictException({ code: 'POLICY_CONFIGURATION_INVALID', message });
    if (!dto.algorithm && !dto.certificateProfile) throw invalid('Chọn thuật toán hoặc hồ sơ chứng thư.');
    if (dto.algorithm === 'RSA' && (!dto.minimumKeySize || dto.minimumKeySize < 2048)) throw invalid('Khóa RSA phải có độ dài tối thiểu 2048 bit.');
    if (dto.warningDays.some(day => day > dto.maximumValidityDays)) throw invalid('Mốc cảnh báo không được vượt thời hạn tài sản.');
    const configuration = {
      algorithm: dto.algorithm ?? undefined, minimum_key_size: dto.minimumKeySize ?? undefined,
      maximum_validity_days: dto.maximumValidityDays, certificate_profile: dto.certificateProfile ?? undefined, warning_days: dto.warningDays,
    };
    resolveProvisionParameters({ assetType: dto.certificateProfile ? 'CERTIFICATE' : 'KEY' }, configuration);
    return configuration;
  }

  private async lockActiveVersion(client: PoolClient, id: string, expectedVersion: number) {
    const policy = (await client.query<{ is_active: boolean }>('SELECT id,is_active FROM policies WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!policy) throw this.notFound();
    const latest = (await client.query<{ version: number }>('SELECT version FROM policy_versions WHERE policy_id=$1 ORDER BY version DESC LIMIT 1', [id])).rows[0];
    if (!policy.is_active || (latest?.version ?? 0) !== expectedVersion) {
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Chính sách đã thay đổi. Hãy tải lại trước khi lưu.' });
    }
  }

  private async insertVersion(client: PoolClient, policyId: string, version: number, configuration: Record<string, unknown>, actorId: string) {
    const result = await client.query<VersionRow>(`INSERT INTO policy_versions(policy_id,version,configuration,changed_by,effective_from)
      VALUES($1,$2,$3::jsonb,$4,statement_timestamp()) RETURNING id,version,configuration,effective_from`,
    [policyId, version, JSON.stringify(configuration), actorId]);
    return presentVersion(result.rows[0]);
  }

  private audit(client: PoolClient, actorId: string, id: string, action: string, metadata: Record<string, unknown>) {
    return client.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)
      VALUES($1,'USER',$2,'POLICY',$3,'SUCCESS',$4::jsonb)`, [actorId, action, id, JSON.stringify(auditMetadata(metadata))]);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
