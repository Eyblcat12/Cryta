import { BadRequestException, Controller, ForbiddenException, Get, Header, Inject, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/current-user.decorator';
import { UUID_LIKE } from '../common/uuid-like.pipe';
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
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string> = {}) {
    return listAudit(this.pool, user, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', type: String, description: 'Mã sự kiện audit dạng số nguyên dương.' })
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    requireAuditAdmin(user);
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9_223_372_036_854_775_807n)
      throw new BadRequestException({ code: 'INVALID_AUDIT_ID', message: 'Mã sự kiện không hợp lệ.' });
    const result = await this.pool.query<Record<string, unknown>>(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.outcome,a.occurred_at,
      a.request_id,a.metadata,u.display_name AS actor_name
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.id=$1::bigint`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'AUDIT_EVENT_NOT_FOUND', message: 'Không tìm thấy sự kiện.' });
    const { metadata, ...audit } = presentAudit(row);
    let related: { kind: 'USER' | 'ASSET'; id: string } | null = null;
    if (typeof audit.entityId === 'string' && UUID_LIKE.test(audit.entityId)) {
      if (audit.entityType === 'USER' && (await this.pool.query('SELECT 1 FROM users WHERE id=$1', [audit.entityId])).rowCount) {
        related = { kind: 'USER', id: audit.entityId };
      }
      if (audit.entityType === 'CRYPTO_ASSET' && (await this.pool.query('SELECT 1 FROM crypto_assets WHERE id=$1', [audit.entityId])).rowCount) {
        related = { kind: 'ASSET', id: audit.entityId };
      }
    }
    return { ...audit, changes: auditChanges(audit.action, metadata), related };
  }
}

function requireAuditAdmin(user: AuthUser) {
  if (!user.roles.includes('ADMIN')) throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ Security Admin được tra cứu Audit Log.' });
}

function auditChanges(action: unknown, value: unknown) {
  const metadata = value as Record<string, unknown> | undefined;
  const changes: Array<{ field: string; before?: string; after: string }> = [];
  const record = (field: string, before: unknown, after: unknown, valid: (value: string) => boolean) => {
    if (typeof after === 'string' && valid(after)) {
      changes.push({ field, ...(typeof before === 'string' && valid(before) && { before }), after });
    }
  };
  if (action === 'USER_STATUS_CHANGED') {
    record('status', metadata?.previousStatus, metadata?.status, value => ['ACTIVE', 'INACTIVE', 'LOCKED'].includes(value));
  } else if (action === 'USER_DEPARTMENT_CHANGED') {
    record('departmentId', metadata?.previousDepartmentId, metadata?.departmentId, value => UUID_LIKE.test(value));
  } else if (action === 'DEPARTMENT_UPDATED') {
    const previous = metadata?.previous as Record<string, unknown> | undefined;
    record('departmentCode', previous?.code, metadata?.code, value => /^[A-Z][A-Z0-9_-]{0,49}$/.test(value));
    record('departmentName', previous?.name, metadata?.name, value => value.length > 0 && value.length <= 255);
  } else if (action === 'POLICY_VERSION_CREATED') {
    const previous = metadata?.previousVersion;
    const next = metadata?.newVersion;
    if (typeof next === 'number') {
      record('policyVersion', typeof previous === 'number' ? String(previous) : undefined,
        String(next), value => /^[1-9]\d{0,9}$/.test(value));
    }
  }
  return changes;
}

export async function listAudit(reader: Pick<Pool, 'query'>, user: AuthUser, query: Record<string, string>, maxPageSize = 100) {
    requireAuditAdmin(user);
    const parseNumber = (value: string | undefined, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
        throw new BadRequestException({ code: 'INVALID_PAGINATION', message: 'Tham số phân trang không hợp lệ.' });
      return Number(value);
    };
    const paged = Object.keys(query).some(key => key !== 'limit');
    if (!paged) {
      const limit = parseNumber(query.limit, 100, 200);
      const result = await reader.query(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.outcome,a.metadata,a.occurred_at,u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.occurred_at DESC,a.id DESC LIMIT $1`, [limit]);
      return result.rows.map(presentAudit);
    }
    const page = parseNumber(query.page, 1, 1_000_000);
    const pageSize = parseNumber(query.pageSize, 25, maxPageSize);
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
    let lowerBound: number | undefined;
    for (const [key, op] of [['from', '>='], ['to', '<=']] as const) {
      if (!query[key]) continue;
      const date = new Date(query[key]);
      const timestamp = date.getTime();
      if (!Number.isFinite(timestamp) || (key === 'to' && lowerBound !== undefined && timestamp < lowerBound))
        throw new BadRequestException({ code: 'INVALID_DATE', message: 'Khoảng thời gian không hợp lệ.' });
      if (key === 'from') lowerBound = timestamp;
      values.push(date.toISOString()); filters.push(`a.occurred_at ${op} $${values.length}::timestamptz`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = await reader.query(`SELECT COUNT(*)::int AS total FROM audit_logs a ${where}`, values);
    const args = [...values, pageSize, (page - 1) * pageSize];
    const actorJoin = 'LEFT JOIN users u ON u.id=a.actor_id';
    const pageQuery = `SELECT a.* FROM audit_logs a ${query.sortBy === 'actor' ? actorJoin : ''} ${where} ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`;
    const result = await reader.query(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.outcome,a.occurred_at,a.request_id,
      a.metadata->>'correlationId' AS correlation_id,u.display_name AS actor_name
      FROM (${pageQuery}) a ${actorJoin} ORDER BY ${order}`, args);
    return { items: result.rows.map(presentAudit), total: Number(count.rows[0]?.total ?? 0), page, pageSize };
}

function presentAudit(row: Record<string, unknown>) {
    const correlation = row.correlation_id ?? (row.metadata as Record<string, unknown> | undefined)?.correlationId;
    const correlationId = typeof correlation === 'string' && /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(correlation) ? correlation : undefined;
    return { id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, outcome: row.outcome, metadata: redactAuditMetadata(row.metadata), occurredAt: row.occurred_at, actorName: row.actor_name ?? 'Hệ thống', requestId: row.request_id, correlationId };
}
