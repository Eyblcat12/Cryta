import { Body, Controller, ForbiddenException, Get, Header, Inject, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { Pool } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { UuidLikePipe } from '../common/uuid-like.pipe';
import { DATABASE_POOL } from '../database/database.constants';
import { AssetProcessingService } from './asset-processing.service';
import { maximumRecoveryRetries, publicFailureCode, type FailureClass } from './provider-recovery';

const statuses = ['RECONCILIATION_REQUIRED', 'FAILED', 'RETRY_SCHEDULED'] as const;
type RecoveryStatus = typeof statuses[number];
const actions = ['RETRY', 'ABANDON', 'CONFIRM'] as const;
type RecoveryAction = typeof actions[number];

class RecoveryQuery {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 1_000_000 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @ApiPropertyOptional({ enum: statuses })
  @IsOptional() @IsIn(statuses) status?: RecoveryStatus;
}

class RecoveryDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt() @Min(1) @Max(2_147_483_647) version: number;
  @ApiProperty({ enum: actions })
  @IsIn(actions) action: RecoveryAction;
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(10, 500) reason: string;
}

type RecoveryRow = {
  id: string; type: string; status: string; version: number; targetAssetId: string | null;
  attemptCount: number; retryCount: number; retryAfter: Date | null; sentAt: Date | null;
  receiptAt: Date | null; updatedAt: Date; failureClass: FailureClass | null;
  errorCode: string | null; hasReceipt: boolean; verifiedUnsent: boolean;
};

const from = 'FROM requests r JOIN provider_operations op ON op.request_id=r.id';
const select = `SELECT r.id,r.request_type AS type,r.status,r.version,r.target_asset_id AS "targetAssetId",
  op.attempt_count AS "attemptCount",op.retry_count AS "retryCount",op.retry_after AS "retryAfter",
  op.sent_at AS "sentAt",op.receipt_at AS "receiptAt",op.updated_at AS "updatedAt",
  op.failure_class AS "failureClass",op.last_error_code AS "errorCode",
  (op.receipt IS NOT NULL AND op.input_digest IS NOT NULL) AS "hasReceipt",
  (op.claim_version IS NOT NULL AND op.attempt_count=0 AND op.provider_reference IS NULL) AS "verifiedUnsent"`;

function present({ verifiedUnsent, ...row }: RecoveryRow) {
  const availableActions: RecoveryAction[] = [];
  const failureClass = row.failureClass ?? (row.status === 'RECONCILIATION_REQUIRED' ? 'OUTCOME_UNKNOWN' : null);
  if (row.status === 'RECONCILIATION_REQUIRED') {
    if (failureClass === 'RESULT_RECORDED' && row.hasReceipt) availableActions.push('CONFIRM');
    if (verifiedUnsent && (failureClass === 'UNSENT_TRANSIENT' || failureClass === 'UNSENT_PERMANENT')) {
      if (failureClass === 'UNSENT_TRANSIENT' && row.retryCount < maximumRecoveryRetries) availableActions.push('RETRY');
      availableActions.push('ABANDON');
    }
  }
  return { ...row, status: row.retryAfter && row.status === 'APPROVED' ? 'RETRY_SCHEDULED' : row.status,
    errorCode: publicFailureCode(row.errorCode), failureClass, availableActions };
}

@ApiTags('Operations') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('operations/provider-issues')
export class ProviderRecoveryController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly worker: AssetProcessingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: AuthUser, @Query() { page = 1, pageSize = 20, status }: RecoveryQuery) {
    this.assertAdmin(user);
    const where = `WHERE ($1::text IS NULL OR $1=CASE WHEN r.status='APPROVED' THEN 'RETRY_SCHEDULED' ELSE r.status END)
      AND (r.status IN ('RECONCILIATION_REQUIRED','FAILED') OR (r.status='APPROVED' AND op.retry_after IS NOT NULL))`;
    const [count, result] = await Promise.all([
      this.pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${from} ${where}`, [status ?? null]),
      this.pool.query<RecoveryRow>(`${select} ${from} ${where} ORDER BY op.updated_at DESC,r.id LIMIT $2 OFFSET $3`,
        [status ?? null, pageSize, (page - 1) * pageSize]),
    ]);
    return { items: result.rows.map(present), total: count.rows[0].total, page, pageSize };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async detail(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string) {
    this.assertAdmin(user);
    const result = await this.pool.query<RecoveryRow & { history: unknown[] }>(`${select},
      COALESCE((SELECT jsonb_agg(events ORDER BY events.id DESC) FROM (
        SELECT id,action,actor_type AS "actorType",occurred_at AS "occurredAt",
          metadata->'retryCount' AS "retryCount",metadata->'delaySeconds' AS "delaySeconds",
          CASE WHEN actor_type='USER' THEN metadata->>'reason' END AS reason
        FROM audit_logs WHERE request_id=r.id AND action IN (
          'REQUEST_RECONCILIATION_REQUIRED','PROVIDER_RETRY_SCHEDULED','PROVIDER_REQUEST_ABANDONED','PROVIDER_RESULT_CONFIRMED')
        ORDER BY id DESC LIMIT 20
      ) events),'[]'::jsonb) AS history ${from} WHERE r.id=$1`, [id]);
    if (!result.rows[0]) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Không tìm thấy yêu cầu.' });
    return present(result.rows[0]);
  }

  @Post(':id/actions')
  @Header('Cache-Control', 'no-store')
  recover(@CurrentUser() user: AuthUser, @Param('id', UuidLikePipe) id: string, @Body() dto: RecoveryDto) {
    this.assertAdmin(user);
    return this.worker.recover(user, id, dto.version, dto.action, dto.reason);
  }

  private assertAdmin(user: AuthUser) {
    if (!user.roles.includes('ADMIN')) throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ quản trị bảo mật được đối soát yêu cầu.' });
  }
}
