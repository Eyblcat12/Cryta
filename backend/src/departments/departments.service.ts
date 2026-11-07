import { auditMetadata } from '../audit/audit-context';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { AuthUser } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { UsersService } from '../users/users.service';
import type { DepartmentStatusDto, SaveDepartmentDto } from './departments.dto';

type Department = { id: string; code: string; name: string; is_active: boolean; version: number; user_count?:number; scope_count?:number };
const present = (row: Department) => ({ id: row.id, code: row.code, name: row.name, active: row.is_active, version: row.version, userCount:row.user_count, scopeCount:row.scope_count });
const missing = () => new NotFoundException({ code: 'DEPARTMENT_NOT_FOUND', message: 'Không tìm thấy đơn vị.' });
const conflict = () => new ConflictException({ code: 'VERSION_CONFLICT', message: 'Đơn vị đã thay đổi. Hãy tải lại trước khi lưu.' });

@Injectable()
export class DepartmentsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly users: UsersService) {}

  async list(admin: AuthUser, query: Record<string, string> = {}) {
    this.assertAdmin(admin);
    const number = (value: string | undefined, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
        throw new BadRequestException({ code: 'INVALID_PAGINATION', message: 'Tham số phân trang không hợp lệ.' });
      return Number(value);
    };
    const page = number(query.page, 1, 1000000), pageSize = number(query.pageSize, 25, 100);
    const values: unknown[] = [], filters: string[] = [];
    if (query.active !== undefined) {
      if (!['true', 'false'].includes(query.active)) throw new BadRequestException({ code: 'INVALID_DEPARTMENT_FILTER', message: 'Bộ lọc đơn vị không hợp lệ.' });
      values.push(query.active === 'true'); filters.push(`is_active=$${values.length}`);
    }
    if (query.search !== undefined) {
      if (typeof query.search !== 'string' || query.search.length > 100) throw new BadRequestException({ code: 'INVALID_SEARCH', message: 'Từ khóa tối đa 100 ký tự.' });
      if (query.search.trim()) { values.push(`%${query.search.trim()}%`); filters.push(`(code ILIKE $${values.length} OR name ILIKE $${values.length})`); }
    }
    const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
    const count = await this.pool.query(`SELECT count(*)::int AS total FROM departments ${where}`, values);
    const result = await this.pool.query<Department>(`SELECT id,code,name,is_active,version,(SELECT count(*)::int FROM users WHERE department_id=departments.id) AS user_count,(SELECT count(*)::int FROM approver_scopes WHERE department_id=departments.id) AS scope_count FROM departments ${where} ORDER BY name,id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
    return { items: result.rows.map(present), total: count.rows[0].total, page, pageSize };
  }

  async detail(admin: AuthUser, id: string) {
    this.assertAdmin(admin);
    const result = await this.pool.query<Department>('SELECT id,code,name,is_active,version FROM departments WHERE id=$1', [id]);
    if (!result.rows[0]) throw missing();
    return { ...present(result.rows[0]), usage: await this.usage(this.pool, id) };
  }

  async save(admin: AuthUser, id: string, dto: SaveDepartmentDto) {
    this.assertAdmin(admin);
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException({ code: 'INVALID_DEPARTMENT_NAME', message: 'Tên đơn vị phải có ít nhất hai ký tự.' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await this.users.lockAdministration(client, admin);
      const current = (await client.query<Department>('SELECT * FROM departments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!current && dto.version !== undefined) throw missing();
      if (current && dto.version === undefined) {
        if (current.version !== 1 || current.code !== dto.code || current.name !== name || !current.is_active) throw conflict();
        await client.query('COMMIT'); return present(current);
      }
      if (current && current.version !== dto.version) throw conflict();
      const result = current
        ? await client.query<Department>('UPDATE departments SET code=$2,name=$3,version=version+1 WHERE id=$1 RETURNING *', [id, dto.code, name])
        : await client.query<Department>('INSERT INTO departments(id,code,name) VALUES($1,$2,$3) RETURNING *', [id, dto.code, name]);
      await this.audit(client, admin.id, current ? 'DEPARTMENT_UPDATED' : 'DEPARTMENT_CREATED', id,
        { previous: current ? { code: current.code, name: current.name } : null, code: dto.code, name });
      await client.query('COMMIT'); return present(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') throw new ConflictException({ code: 'DEPARTMENT_CODE_EXISTS', message: 'Mã đơn vị đã được sử dụng.' });
      throw error;
    } finally { client.release(); }
  }

  async status(admin: AuthUser, id: string, dto: DepartmentStatusDto) {
    this.assertAdmin(admin);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await this.users.lockAdministration(client, admin);
      const current = (await client.query<Department>('SELECT * FROM departments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!current) throw missing(); if (current.version !== dto.version) throw conflict();
      if (current.is_active === dto.active) { await client.query('COMMIT'); return present(current); }
      if (!dto.active) {
        const usage = await this.usage(client, id);
        if (Object.values(usage).some(value => value > 0)) throw new ConflictException({ code: 'DEPARTMENT_IN_USE',
          message: 'Đơn vị còn tài khoản, phạm vi phê duyệt, yêu cầu đang mở hoặc tài sản đang hoạt động. Hãy xử lý các liên kết trước.', details: usage });
      }
      const result = await client.query<Department>('UPDATE departments SET is_active=$2,version=version+1 WHERE id=$1 RETURNING *', [id, dto.active]);
      await this.audit(client, admin.id, dto.active ? 'DEPARTMENT_ACTIVATED' : 'DEPARTMENT_DEACTIVATED', id, { active: dto.active });
      await client.query('COMMIT'); return present(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  private async usage(queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, id: string) {
    return (await queryable.query<{ users: number; approverScopes: number; openRequests: number; activeAssets: number }>(`SELECT
      (SELECT count(*)::int FROM users WHERE department_id=$1) AS users,
      (SELECT count(*)::int FROM approver_scopes WHERE department_id=$1) AS "approverScopes",
      (SELECT count(*)::int FROM requests WHERE department_id=$1 AND status IN ('PENDING','APPROVED','PROCESSING','RECONCILIATION_REQUIRED')) AS "openRequests",
      (SELECT count(*)::int FROM crypto_assets WHERE department_id=$1 AND status IN ('REGISTERED','ACTIVE','EXPIRING_SOON')) AS "activeAssets"`, [id])).rows[0];
  }
  private audit(client: PoolClient, actor: string, action: string, id: string, metadata: unknown) {
    return client.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)
      VALUES($1,'USER',$2,'DEPARTMENT',$3,'SUCCESS',$4::jsonb)`, [actor, action, id, JSON.stringify(auditMetadata(metadata))]);
  }
  private assertAdmin(user: AuthUser) {
    if (!user.roles.includes('ADMIN')) throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ Security Admin được quản lý đơn vị.' });
  }
}
