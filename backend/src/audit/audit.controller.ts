import { BadRequestException, Controller, ForbiddenException, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { DATABASE_POOL } from '../database/database.constants';
import { redactAuditMetadata } from './audit-redaction';
import { listOrder } from '../common/list-order';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  @ApiQuery({ name: 'sortBy', required: false, enum: ['occurredAt','action','outcome','actor','entity'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc','desc'], description: 'Cần sortBy. Mặc định asc khi đã chọn cột.' })
  @ApiQuery({ name: 'correlationId', required: false, description: 'Mã req_UUID do máy chủ cấp trong x-request-id.' })
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string> = {}) {
    if (!user.roles.includes('ADMIN')) throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ Security Admin được tra cứu Audit Log.' });
    const parseNumber = (value: string | undefined, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
        throw new BadRequestException({ code: 'INVALID_PAGINATION', message: 'Tham số phân trang không hợp lệ.' });
      return Number(value);
    };
    const paged = Object.keys(query).some(key => key !== 'limit');
    if (!paged) {
      const limit = parseNumber(query.limit, 100, 200);
      const result = await this.pool.query(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.outcome,a.metadata,a.occurred_at,u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.occurred_at DESC,a.id DESC LIMIT $1`, [limit]);
      return result.rows.map(this.present);
    }
    const page = parseNumber(query.page, 1, 1_000_000);
    const pageSize = parseNumber(query.pageSize, 25, 100);
    const order = listOrder(query, {
      occurredAt: 'a.occurred_at', action: 'a.action', outcome: 'a.outcome', actor: 'u.display_name', entity: 'a.entity_id',
    }, 'a.id', 'a.occurred_at DESC,a.id DESC');
    for (const field of ['search', 'actor', 'action', 'entity', 'outcome', 'requestId', 'correlationId', 'from', 'to'])
      if (query[field] !== undefined && typeof query[field] !== 'string')
        throw new BadRequestException({ code: 'INVALID_FILTER', message: 'Bộ lọc không hợp lệ.' });
    const values: unknown[] = [];
    const filters: string[] = [];
    // An uncorrelated UUID array lets PostgreSQL combine the actor and text indexes with BitmapOr.
    const actorMatches = (parameter: string) => `a.actor_id = ANY(ARRAY(SELECT id FROM users WHERE display_name ILIKE ${parameter}))`;
    const textFilter = (value: string | undefined, match: (parameter: string) => string) => {
      const term = value?.trim();
      if (!term) return;
      if (term.length > 100) throw new BadRequestException({ code: 'INVALID_FILTER', message: 'Bộ lọc tối đa 100 ký tự.' });
      values.push(`%${term}%`);
      filters.push(match(`$${values.length}`));
    };
    if (query.search?.trim()) {
      const term = query.search.trim();
      if (term.length > 100) throw new BadRequestException({ code: 'INVALID_FILTER', message: 'Bộ lọc tối đa 100 ký tự.' });
      values.push(`%${term}%`);
      const parameter = `$${values.length}`;
      filters.push(`(a.action ILIKE ${parameter} OR a.entity_id ILIKE ${parameter} OR ${actorMatches(parameter)})`);
    }
    textFilter(query.actor, actorMatches);
    textFilter(query.action, parameter => `a.action ILIKE ${parameter}`);
    textFilter(query.entity, parameter => `a.entity_id ILIKE ${parameter}`);
    if (query.outcome) {
      if (!['SUCCESS', 'FAILED', 'DENIED'].includes(query.outcome)) throw new BadRequestException({ code: 'INVALID_OUTCOME', message: 'Kết quả audit không hợp lệ.' });
      values.push(query.outcome); filters.push(`a.outcome = $${values.length}`);
    }
    if (query.requestId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.requestId)) throw new BadRequestException({ code: 'INVALID_REQUEST_ID', message: 'Mã yêu cầu không hợp lệ.' });
      values.push(query.requestId); filters.push(`a.request_id = $${values.length}::uuid`);
    }
    if (query.correlationId !== undefined) {
      if (!/^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(query.correlationId))
        throw new BadRequestException({ code: 'INVALID_CORRELATION_ID', message: 'Mã truy vết không hợp lệ.' });
      values.push(query.correlationId); filters.push(`a.metadata->>'correlationId' = $${values.length}`);
    }
    for (const [key, op] of [['from', '>='], ['to', '<=']] as const) {
      if (!query[key]) continue;
      const date = new Date(query[key]);
      if (!Number.isFinite(date.getTime())) throw new BadRequestException({ code: 'INVALID_DATE', message: 'Khoảng thời gian không hợp lệ.' });
      values.push(date.toISOString()); filters.push(`a.occurred_at ${op} $${values.length}::timestamptz`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = await this.pool.query(`SELECT COUNT(*)::int AS total FROM audit_logs a ${where}`, values);
    const args = [...values, pageSize, (page - 1) * pageSize];
    const actorJoin = 'LEFT JOIN users u ON u.id=a.actor_id';
    const pageQuery = `SELECT a.* FROM audit_logs a ${query.sortBy === 'actor' ? actorJoin : ''} ${where} ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`;
    const result = await this.pool.query(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.outcome,a.occurred_at,a.request_id,
      a.metadata->>'correlationId' AS correlation_id,u.display_name AS actor_name
      FROM (${pageQuery}) a ${actorJoin} ORDER BY ${order}`, args);
    return { items: result.rows.map(this.present), total: Number(count.rows[0]?.total ?? 0), page, pageSize };
  }

  private present(row: Record<string, unknown>) {
    const correlation = row.correlation_id ?? (row.metadata as Record<string, unknown> | undefined)?.correlationId;
    const correlationId = typeof correlation === 'string' && /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(correlation) ? correlation : undefined;
    return { id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, outcome: row.outcome, metadata: redactAuditMetadata(row.metadata), occurredAt: row.occurred_at, actorName: row.actor_name ?? 'Hệ thống', requestId: row.request_id, correlationId };
  }
}
