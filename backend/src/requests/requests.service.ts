import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isISO8601 } from 'class-validator';
import type { Pool, PoolClient } from 'pg';
import type { AuthUser } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { auditMetadata } from '../audit/audit-context';
import { NotificationsService } from '../notifications/notifications.service';
import { cryptoProviderConfig } from '../jobs/crypto-provider-config';
import { listOrder } from '../common/list-order';
import { UUID_LIKE } from '../common/uuid-like.pipe';
import type { CancelRequestDto, CreateRequestDto, DecideRequestDto, SaveDraftDto } from './request.dto';
import { assertAssetCanChange, assertCanCreateRequest, assertCanDecide, assertParametersMatchPolicy, normalizeRequestParameters } from './request-policy';
import { presentRequest, type RequestRow } from './request.presenter';

const creatorAndTarget = `JOIN users u ON u.id=r.creator_id
  LEFT JOIN crypto_assets a ON a.id=r.target_asset_id AND (r.submitted_at IS NOT NULL OR a.owner_id=r.creator_id)`;
const twoStage = `pv.configuration->'approval_levels'='2'::jsonb`;
const deadline = `r.submitted_at+make_interval(hours=>(pv.configuration->>'approval_deadline_hours')::int)`;
const approvalColumns = `CASE WHEN ${twoStage} THEN 2 ELSE 1 END AS approval_levels,
  CASE WHEN ${twoStage} THEN ${deadline} END AS approval_deadline_at`;
const selectRequests = (source = 'requests r') => `SELECT r.*,u.display_name creator_name,d.name department_name,a.asset_code target_asset_code,
  ${approvalColumns},
  CASE WHEN ${twoStage} THEN (SELECT count(*)::int FROM request_decisions WHERE request_id=r.id AND decision='APPROVED') END AS approved_levels,
  CASE WHEN ${twoStage} THEN (SELECT approver_id FROM request_decisions WHERE request_id=r.id AND approval_level=1 AND decision='APPROVED') END AS first_approver_id
  FROM ${source} ${creatorAndTarget} JOIN departments d ON d.id=r.department_id
  LEFT JOIN policy_versions pv ON pv.id=r.policy_version_id`;
const requestSelect = selectRequests();
const missingRequest = () => new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Không tìm thấy yêu cầu.' });
const versionConflict = () => new ConflictException({ code: 'VERSION_CONFLICT', message: 'Yêu cầu đã thay đổi. Hãy tải lại để tiếp tục.' });
const approvalExpired = () => new ConflictException({ code: 'APPROVAL_DEADLINE_EXPIRED', message: 'Yêu cầu đã quá thời hạn phê duyệt.' });

@Injectable()
export class RequestsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly notifications: NotificationsService) {}

  async list(user: AuthUser, query: Record<string, string> = {}, reader: Pick<Pool, 'query'> = this.pool, maxPageSize = 100) {
    if(query.createdByMe!==undefined&&(typeof query.createdByMe!=='string'||!['true','false'].includes(query.createdByMe)))
      throw new BadRequestException({code:'INVALID_REQUEST_FILTER',message:'Bộ lọc yêu cầu cá nhân không hợp lệ.'});
    if (query.approvalScope !== undefined && !['true', 'false'].includes(query.approvalScope)) {
      throw new BadRequestException({ code: 'INVALID_REQUEST_FILTER', message: 'Bộ lọc phạm vi phê duyệt không hợp lệ.' });
    }
    if (query.approvalScope === 'true' && !user.roles.includes('APPROVER')) {
      throw new ForbiddenException({ code: 'APPROVER_REQUIRED', message: 'Bạn cần quyền phê duyệt để dùng bộ lọc này.' });
    }
    const approver = query.createdByMe !== 'true' && user.roles.includes('APPROVER') &&
      (!user.roles.includes('ADMIN') || query.approvalScope === 'true');
    const submittedOnly = query.createdByMe !== 'true' && (approver || user.roles.includes('ADMIN'));
    const scope = query.createdByMe==='true' ? {sql:'WHERE r.creator_id = $1',values:[user.id]}
      : approver ? { sql: 'WHERE r.department_id = ANY($1::uuid[])', values: [user.approverDepartmentIds] }
      : user.roles.includes('ADMIN') ? { sql: '', values: [] as unknown[] }
      : { sql: 'WHERE r.creator_id = $1', values: [user.id] };
    const defaultOrder = approver ? 'r.emergency DESC, r.submitted_at ASC, r.id ASC'
      : query.status && query.status !== 'DRAFT' && query.status !== 'CANCELLED'
        ? 'r.submitted_at DESC, r.id DESC' : 'COALESCE(r.submitted_at, r.updated_at) DESC, r.id DESC';
    const order = listOrder(query, {
      submittedAt: 'r.submitted_at', updatedAt: 'r.updated_at', status: 'r.status', type: 'r.request_type', emergency: 'r.emergency',
    }, 'r.id', defaultOrder);
    const conditions = scope.sql ? [scope.sql.replace(/^WHERE /, '')] : [];
    if (!Object.keys(query).length) {
      if (submittedOnly) conditions.push('r.submitted_at IS NOT NULL');
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return (await reader.query<RequestRow>(`${requestSelect} ${where} ORDER BY ${order} LIMIT 100`, scope.values)).rows.map(presentRequest);
    }
    const parseNumber = (value: string | undefined, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
        throw new BadRequestException({ code: 'INVALID_PAGINATION', message: 'Tham số phân trang không hợp lệ.' });
      return Number(value);
    };
    const page = parseNumber(query.page, 1, 1_000_000);
    const pageSize = parseNumber(query.pageSize, 25, maxPageSize);
    for (const field of ['status', 'type', 'emergency', 'search', 'excludePending', 'departmentId', 'from', 'to'])
      if (query[field] !== undefined && typeof query[field] !== 'string')
        throw new BadRequestException({ code: 'INVALID_FILTER', message: 'Bộ lọc yêu cầu không hợp lệ.' });
    if (query.excludePending !== undefined) {
      if (!['true', 'false'].includes(query.excludePending))
        throw new BadRequestException({ code: 'INVALID_HISTORY_FILTER', message: 'Bộ lọc lịch sử không hợp lệ.' });
      if (query.excludePending === 'true') conditions.push("r.status <> 'PENDING'");
    }
    const values = [...scope.values];
    if (query.status) {
      if (!['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED'].includes(query.status))
        throw new BadRequestException({ code: 'INVALID_STATUS', message: 'Trạng thái yêu cầu không hợp lệ.' });
      values.push(query.status); conditions.push(`r.status = $${values.length}`);
    }
    if (query.type) {
      if (!['CREATE', 'RENEW', 'REVOKE'].includes(query.type)) throw new BadRequestException({ code: 'INVALID_TYPE', message: 'Loại yêu cầu không hợp lệ.' });
      values.push(query.type); conditions.push(`r.request_type = $${values.length}`);
    }
    if (query.emergency) {
      if (!['true', 'false'].includes(query.emergency)) throw new BadRequestException({ code: 'INVALID_EMERGENCY', message: 'Bộ lọc khẩn cấp không hợp lệ.' });
      values.push(query.emergency === 'true'); conditions.push(`r.emergency = $${values.length}`);
    }
    if (query.departmentId !== undefined) {
      if (!UUID_LIKE.test(query.departmentId)) throw new BadRequestException({ code: 'INVALID_DEPARTMENT_ID', message: 'Mã đơn vị không hợp lệ.' });
      values.push(query.departmentId); conditions.push(`r.department_id = $${values.length}::uuid`);
    }
    let lowerBound: number | undefined;
    for (const [key, operator] of [['from', '>='], ['to', '<=']] as const) {
      const input = query[key];
      if (input === undefined) continue;
      const date = new Date(input);
      const timestamp = date.getTime();
      if (!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input) ||
          !isISO8601(input, { strict: true }) || !Number.isFinite(timestamp) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ||
          (lowerBound !== undefined && timestamp < lowerBound))
        throw new BadRequestException({ code: 'INVALID_DATE', message: 'Khoảng thời gian gửi không hợp lệ.' });
      if (key === 'from') lowerBound = timestamp;
      values.push(date.toISOString());
      conditions.push(`r.submitted_at ${operator} $${values.length}::timestamptz`);
    }
    const search = query.search?.trim();
    if (search) {
      if (search.length > 100) throw new BadRequestException({ code: 'INVALID_SEARCH', message: 'Từ khóa tối đa 100 ký tự.' });
      values.push(`%${search}%`); conditions.push(`(r.id::text ILIKE $${values.length} OR r.reason ILIKE $${values.length} OR u.display_name ILIKE $${values.length} OR a.asset_code ILIKE $${values.length})`);
    }
    if (submittedOnly) conditions.push('r.submitted_at IS NOT NULL');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const filterFrom = `FROM requests r${search ? ` ${creatorAndTarget}` : ''}`;
    const count = await reader.query(`SELECT COUNT(*)::int AS total ${filterFrom} ${where}`, values);
    const args = [...values, pageSize, (page - 1) * pageSize];
    const pageIds = `SELECT r.id ${filterFrom} ${where} ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`;
    const rows = await reader.query<RequestRow>(`${selectRequests(`(${pageIds}) page_ids JOIN requests r ON r.id=page_ids.id`)} ORDER BY ${order}`, args);
    return { items: rows.rows.map(presentRequest), total: Number(count.rows[0]?.total ?? 0), page, pageSize };
  }

  async create(user: AuthUser, dto: CreateRequestDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      user = await this.lockCurrentUser(client, user);
      const parameters = await this.validateSubmission(client, user, dto);
      const id = randomUUID();
      const result = await client.query(`INSERT INTO requests (id, request_type, creator_id, department_id, policy_version_id, target_asset_id, status, reason, emergency, requested_parameters) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9::jsonb) RETURNING *`, [id, dto.type, user.id, user.departmentId, dto.policyVersionId, dto.targetAssetId ?? null, dto.reason.trim(), dto.emergency ?? false, JSON.stringify(parameters)]);
      await this.recordSubmission(client, user, id, dto);
      await client.query('COMMIT');
      return presentRequest(result.rows[0] as RequestRow);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async saveDraft(user: AuthUser, requestId: string, dto: SaveDraftDto) {
    assertCanCreateRequest(user, dto.type, dto.targetAssetId, { allowMissingTarget: true });
    const parameters = normalizeRequestParameters(dto.parameters ?? {});
    this.assertRevokeParameters(dto.type, parameters);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      user = await this.lockCurrentUser(client, user);
      const found = await client.query<RequestRow>('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [requestId]);
      const current = found.rows[0];
      if (current && current.creator_id !== user.id) throw missingRequest();
      if (!current && dto.version !== undefined) throw missingRequest();
      if (current && current.status !== 'DRAFT') {
        throw new ConflictException({ code: 'INVALID_REQUEST_STATE', message: 'Chỉ có thể sửa yêu cầu nháp.' });
      }
      if (current && dto.version !== undefined && current.version !== dto.version) throw versionConflict();

      const values = [requestId, dto.type, dto.policyVersionId ?? null, dto.targetAssetId ?? null,
        dto.reason?.trim() ?? '', dto.emergency ?? false, JSON.stringify(parameters)];
      if (current && dto.version === undefined) {
        // The first PUT can be retried after a lost response, without changing the row.
        this.assertSameDraft(current, dto, parameters);
        await client.query('COMMIT');
        return presentRequest(current);
      }
      if (dto.policyVersionId && !(await client.query('SELECT 1 FROM policy_versions WHERE id=$1', [dto.policyVersionId])).rowCount) {
        throw new NotFoundException({ code: 'POLICY_NOT_FOUND', message: 'Không tìm thấy phiên bản chính sách.' });
      }
      if (dto.targetAssetId && !(await client.query('SELECT 1 FROM crypto_assets WHERE id=$1 AND owner_id=$2', [dto.targetAssetId, user.id])).rowCount) {
        throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Không tìm thấy tài sản của bạn.' });
      }
      const saved = current
        ? await client.query<RequestRow>(`UPDATE requests SET request_type=$2,policy_version_id=$3,target_asset_id=$4,
            reason=$5,emergency=$6,requested_parameters=$7::jsonb,version=version+1 WHERE id=$1 RETURNING *`, values)
        : await client.query<RequestRow>(`INSERT INTO requests(id,request_type,policy_version_id,target_asset_id,reason,emergency,
            requested_parameters,creator_id,department_id,status,submitted_at)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'DRAFT',NULL) ON CONFLICT(id) DO NOTHING RETURNING *`,
          [...values, user.id, user.departmentId]);
      // A competing first PUT can win between the lookup and insert.
      const row = saved.rows[0] ?? await this.lockOwned(client, user.id, requestId);
      if (row.status !== 'DRAFT') throw versionConflict();
      if (!saved.rows[0]) this.assertSameDraft(row, dto, parameters);
      if (saved.rows[0]) await this.appendAudit(client, user.id, current ? 'REQUEST_DRAFT_UPDATED' : 'REQUEST_DRAFT_CREATED', requestId, 'SUCCESS', {
        requestType: dto.type, version: row.version,
      });
      await client.query('COMMIT');
      return presentRequest(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async submitDraft(user: AuthUser, requestId: string, version: number) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      user = await this.lockCurrentUser(client, user);
      const request = await this.lockOwned(client, user.id, requestId);
      if (request.status === 'PENDING' && request.version === version + 1) {
        await client.query('COMMIT');
        return presentRequest(request);
      }
      if (request.status !== 'DRAFT') {
        throw new ConflictException({ code: 'INVALID_REQUEST_STATE', message: 'Chỉ có thể gửi yêu cầu nháp.' });
      }
      if (request.version !== version) throw versionConflict();
      if (!request.policy_version_id) {
        throw new BadRequestException({ code: 'POLICY_REQUIRED', message: 'Hãy chọn chính sách trước khi gửi yêu cầu.' });
      }
      const dto: CreateRequestDto = {
        type: request.request_type, policyVersionId: request.policy_version_id, targetAssetId: request.target_asset_id ?? undefined,
        reason: request.reason, emergency: request.emergency, parameters: request.requested_parameters,
      };
      const parameters = await this.validateSubmission(client, user, dto);
      const updated = await client.query<RequestRow>(`UPDATE requests SET status='PENDING',version=version+1,
        submitted_at=NOW(),department_id=$2,requested_parameters=$3::jsonb WHERE id=$1 RETURNING *`,
      [requestId, user.departmentId, JSON.stringify(parameters)]);
      await this.recordSubmission(client, user, requestId, dto);
      await client.query('COMMIT');
      return presentRequest(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async decide(user: AuthUser, requestId: string, dto: DecideRequestDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      user = await this.lockCurrentUser(client, user);
      const found = await client.query<RequestRow>(`SELECT r.*,${approvalColumns}
        FROM requests r LEFT JOIN policy_versions pv ON pv.id=r.policy_version_id WHERE r.id=$1 FOR UPDATE OF r`, [requestId]);
      const request = found.rows[0];
      if (!request || request.submitted_at === null) throw missingRequest();
      assertCanDecide(user, { creatorId: request.creator_id, departmentId: request.department_id, status: request.status });
      const needsTwo = request.approval_levels === 2;
      if ((needsTwo || dto.version) && Number(dto.version) !== request.version) throw versionConflict();
      let level = 1, firstApprover: string | null = null;
      if (needsTwo) {
        const first = (await client.query<{ approver_id: string }>(`SELECT approver_id FROM request_decisions
          WHERE request_id=$1 AND approval_level=1 AND decision='APPROVED'`, [requestId])).rows[0];
        if (first?.approver_id === user.id) throw new ForbiddenException({ code: 'SECOND_APPROVER_REQUIRED', message: 'Cấp hai cần một người duyệt khác trong cùng phạm vi.' });
        if (first) { level = 2; firstApprover = first.approver_id; }
      }
      await client.query(`INSERT INTO request_decisions (request_id,approver_id,decision,comment,approval_level)
        VALUES ($1,$2,$3,$4,$5)`, [requestId, user.id, dto.decision, dto.comment?.trim() ?? null, level]);
      const partial = needsTwo && level === 1 && dto.decision === 'APPROVED';
      const updated = await client.query<RequestRow>('UPDATE requests SET status = $2, version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING *', [requestId, partial ? 'PENDING' : dto.decision]);
      const audit = partial ? 'REQUEST_FIRST_APPROVED' : dto.decision === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED';
      await this.appendAudit(client, user.id, audit, requestId, 'SUCCESS', needsTwo ? { approvalLevel: level, approvalLevels: 2 } : {});
      if (partial) await this.notifications.enqueueSecondApproval(client, requestId, request.department_id, user.id);
      else await this.notifications.enqueueDecision(client, requestId, dto.decision === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED');
      await client.query('COMMIT');
      return presentRequest({ ...updated.rows[0], approval_levels: request.approval_levels, approval_deadline_at: request.approval_deadline_at,
        approved_levels: level - 1 + Number(dto.decision === 'APPROVED'), first_approver_id: partial ? user.id : firstApprover });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && error.message === 'APPROVAL_DEADLINE_EXPIRED') throw approvalExpired();
      throw error;
    } finally { client.release(); }
  }

  async detail(user: AuthUser, requestId: string) {
    const found = await this.pool.query<RequestRow & {
      decisions: Array<{ level: number; decision: 'APPROVED' | 'REJECTED'; comment: string | null;
        approverId: string; approverName: string; decidedAt: string }> | null;
    }>(`SELECT r.*, (SELECT jsonb_agg(jsonb_build_object('level',d.approval_level,'decision',d.decision,
        'comment',d.comment,'approverId',d.approver_id,'approverName',u.display_name,'decidedAt',d.decided_at) ORDER BY d.approval_level)
      FROM request_decisions d JOIN users u ON u.id=d.approver_id WHERE d.request_id=r.id AND r.submitted_at IS NOT NULL) AS decisions
      FROM (${requestSelect} WHERE r.id = $1) r`, [requestId]);
    const request = found.rows[0];
    if (!request) throw missingRequest();
    const allowed = request.creator_id === user.id || (request.submitted_at !== null &&
      (user.roles.includes('ADMIN') || (user.roles.includes('APPROVER') && user.approverDepartmentIds.includes(request.department_id))));
    if (!allowed) throw missingRequest();
    const decisions = request.decisions ?? [];
    const latest = decisions.at(-1);
    const final = latest && (request.approval_levels !== 2 || latest.level === 2 || latest.decision === 'REJECTED');
    return { ...presentRequest(request), decision: final ? {
      decision: latest.decision, comment: latest.comment, approverId: latest.approverId,
      approverName: latest.approverName, decidedAt: latest.decidedAt,
    } : null, ...(request.approval_levels === 2 && { approvalHistory: decisions }) };
  }

  async cancel(user: AuthUser, requestId: string, dto: CancelRequestDto = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      user = await this.lockCurrentUser(client, user);
      const request = await this.lockOwned(client, user.id, requestId);
      if (request.status !== 'PENDING' && request.status !== 'DRAFT') {
        throw new ConflictException({ code: 'INVALID_REQUEST_STATE', message: 'Chỉ có thể hủy nháp hoặc yêu cầu đang chờ duyệt.' });
      }
      if (dto.version !== undefined && request.version !== dto.version) throw versionConflict();
      const reason = dto.reason?.trim() || null;
      const updated = await client.query<RequestRow>(`UPDATE requests SET status='CANCELLED',version=version+1,
        cancellation_reason=$2 WHERE id=$1 RETURNING *`, [requestId, reason]);
      await this.appendAudit(client, user.id, 'REQUEST_CANCELLED', requestId, 'SUCCESS', {
        previousStatus: request.status, reasonProvided: reason !== null,
      });
      await client.query('COMMIT');
      return presentRequest(updated.rows[0]);
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async lockOwned(client: PoolClient, userId: string, requestId: string) {
    const found = await client.query<RequestRow>('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [requestId]);
    const row = found.rows[0];
    if (!row || row.creator_id !== userId) throw missingRequest();
    return row;
  }

  private async lockCurrentUser(client: PoolClient, user: AuthUser): Promise<AuthUser> {
    // Serialize the mutation with account revocation/transfer after the HTTP guard.
    const current = (await client.query<{ status: string; token_version: number; department_id: string; is_active: boolean }>(
      `SELECT u.status,u.token_version,u.department_id,d.is_active FROM users u JOIN departments d ON d.id=u.department_id
       WHERE u.id=$1 FOR SHARE OF u,d`, [user.id])).rows[0];
    if (!current || current.status !== 'ACTIVE' || current.token_version !== user.tokenVersion || !current.is_active) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi.' });
    }
    return { ...user, departmentId: current.department_id };
  }

  private assertSameDraft(row: RequestRow, dto: SaveDraftDto, parameters: Record<string, unknown>) {
    if (row.version !== 1 || row.request_type !== dto.type ||
        row.policy_version_id !== (dto.policyVersionId?.toLowerCase() ?? null) ||
        row.target_asset_id !== (dto.targetAssetId?.toLowerCase() ?? null) ||
        row.reason !== (dto.reason?.trim() ?? '') || row.emergency !== (dto.emergency ?? false) ||
        !isDeepStrictEqual(row.requested_parameters, parameters)) throw versionConflict();
  }

  private assertRevokeParameters(type: CreateRequestDto['type'], parameters: Record<string, unknown>) {
    if (type === 'REVOKE' && Object.keys(parameters).length) {
      throw new ConflictException({ code: 'REVOKE_PARAMETERS_NOT_ALLOWED', message: 'Thu hồi không sử dụng tham số cấp phát.' });
    }
  }

  private async validateSubmission(client: PoolClient, user: AuthUser, dto: CreateRequestDto) {
    assertCanCreateRequest(user, dto.type, dto.targetAssetId);
    if (dto.reason.trim().length < 10) {
      throw new BadRequestException({ code: 'REQUEST_REASON_TOO_SHORT', message: 'Lý do nghiệp vụ phải có ít nhất 10 ký tự.' });
    }
    const parameters = normalizeRequestParameters(dto.parameters ?? {});
    this.assertRevokeParameters(dto.type, parameters);
    // Lock the parent before selecting the latest version so a concurrent publication
    // or deactivation is visible to this transaction's next statement.
    if (dto.type !== 'REVOKE') {
      await client.query(`SELECT p.id FROM policies p JOIN policy_versions pv ON pv.policy_id=p.id
        WHERE pv.id=$1 FOR SHARE OF p`, [dto.policyVersionId]);
    }
    const policy = await client.query<{ configuration: Record<string, unknown> }>(`SELECT pv.configuration
      FROM policy_versions pv JOIN policies p ON p.id=pv.policy_id
      WHERE pv.id=$1 AND ($2='REVOKE' OR p.is_active) AND pv.effective_from<=statement_timestamp()
        AND ($2<>'CREATE' OR NOT EXISTS(SELECT 1 FROM policy_versions newer WHERE newer.policy_id=pv.policy_id
          AND newer.version>pv.version AND newer.effective_from<=statement_timestamp()))`, [dto.policyVersionId, dto.type]);
    if (!policy.rows[0]) throw new NotFoundException({ code: 'POLICY_NOT_FOUND', message: 'Chính sách không tồn tại hoặc đã ngừng áp dụng.' });
    if (dto.type === 'CREATE') assertParametersMatchPolicy(parameters, policy.rows[0].configuration);
    if (!dto.targetAssetId) return parameters;

    const result = await client.query<{ owner_id: string; status: string; policy_version_id: string; asset_type: 'KEY'|'CERTIFICATE'; provider_scope: string | null }>(
      'SELECT owner_id, status, policy_version_id, asset_type, provider_scope FROM crypto_assets WHERE id = $1 FOR UPDATE', [dto.targetAssetId]);
    const asset = result.rows[0];
    if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Không tìm thấy tài sản.' });
    assertAssetCanChange({ ownerId: asset.owner_id, status: asset.status }, user.id);
    if (asset.provider_scope !== cryptoProviderConfig().scope) {
      throw new ConflictException({ code: 'CRYPTO_PROVIDER_SCOPE_MISMATCH', message: 'Tài sản chưa được xác minh với nhà cung cấp đang cấu hình.' });
    }
    if (asset.policy_version_id !== dto.policyVersionId) {
      throw new ConflictException({ code: 'ASSET_POLICY_MISMATCH', message: 'Yêu cầu phải dùng chính sách gắn với tài sản.' });
    }
    if (dto.type === 'RENEW') {
      if (parameters.assetType && parameters.assetType !== asset.asset_type) {
        throw new ConflictException({ code: 'ASSET_TYPE_MISMATCH', message: 'Loại tài sản gia hạn phải giống tài sản hiện tại.' });
      }
      assertParametersMatchPolicy({ ...parameters, assetType: asset.asset_type }, policy.rows[0].configuration);
    }
    const duplicate = await client.query(`SELECT 1 FROM requests WHERE target_asset_id=$1
      AND status IN ('PENDING','APPROVED','PROCESSING','RECONCILIATION_REQUIRED')`, [dto.targetAssetId]);
    if (duplicate.rowCount) {
      throw new ConflictException({ code: 'DUPLICATE_OPEN_REQUEST', message: 'Tài sản đã có yêu cầu cùng loại đang xử lý.' });
    }
    return parameters;
  }

  private async recordSubmission(client: PoolClient, user: AuthUser, id: string, dto: CreateRequestDto) {
    await this.appendAudit(client, user.id, 'REQUEST_SUBMITTED', id, 'SUCCESS', { requestType: dto.type, emergency: dto.emergency ?? false });
    await this.notifications.enqueueRequestSubmitted(client, id, user.departmentId);
  }

  private appendAudit(client: PoolClient, actorId: string, action: string, entityId: string, outcome: string, metadata: Record<string, unknown>) {
    return client.query(`INSERT INTO audit_logs (actor_id, actor_type, action, entity_type, entity_id, outcome, request_id, metadata) VALUES ($1,'USER',$2,'REQUEST',$3::text,$4,$3::uuid,$5::jsonb)`, [actorId, action, entityId, outcome, JSON.stringify(auditMetadata(metadata))]);
  }
}
