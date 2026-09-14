import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AuthUser } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateRequestDto, DecideRequestDto } from './request.dto';
import { assertAssetCanChange, assertCanCreateRequest, assertCanDecide, assertParametersMatchPolicy } from './request-policy';
import { presentRequest, type RequestRow } from './request.presenter';

@Injectable()
export class RequestsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly notifications: NotificationsService) {}

  async list(user: AuthUser) {
    const select=`SELECT r.*,u.display_name creator_name,d.name department_name,a.asset_code target_asset_code FROM requests r JOIN users u ON u.id=r.creator_id JOIN departments d ON d.id=r.department_id LEFT JOIN crypto_assets a ON a.id=r.target_asset_id`;
    if (user.roles.includes('ADMIN')) return (await this.pool.query<RequestRow>(`${select} ORDER BY r.submitted_at DESC LIMIT 100`)).rows.map(presentRequest);
    if (user.roles.includes('APPROVER')) return (await this.pool.query<RequestRow>(`${select} WHERE r.department_id = ANY($1::uuid[]) ORDER BY r.emergency DESC, r.submitted_at ASC LIMIT 100`, [user.approverDepartmentIds])).rows.map(presentRequest);
    return (await this.pool.query<RequestRow>(`${select} WHERE r.creator_id = $1 ORDER BY r.submitted_at DESC LIMIT 100`, [user.id])).rows.map(presentRequest);
  }

  async create(user: AuthUser, dto: CreateRequestDto) {
    assertCanCreateRequest(user, dto.type, dto.targetAssetId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const policy=await client.query<{configuration:Record<string,unknown>}>(`SELECT pv.configuration FROM policy_versions pv JOIN policies p ON p.id=pv.policy_id WHERE pv.id=$1 AND p.is_active=TRUE FOR SHARE`,[dto.policyVersionId]);
      if(!policy.rows[0])throw new NotFoundException({code:'POLICY_NOT_FOUND',message:'Chính sách không tồn tại hoặc đã ngừng áp dụng.'});
      if(dto.type==='CREATE')assertParametersMatchPolicy(dto.parameters??{},policy.rows[0].configuration);
      if (dto.targetAssetId) {
        const asset = await client.query<{ owner_id: string; status: string }>('SELECT owner_id, status FROM crypto_assets WHERE id = $1 FOR SHARE', [dto.targetAssetId]);
        if (!asset.rows[0]) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Không tìm thấy tài sản.' });
        assertAssetCanChange({ ownerId: asset.rows[0].owner_id, status: asset.rows[0].status }, user.id);
        const duplicate = await client.query('SELECT 1 FROM requests WHERE target_asset_id = $1 AND request_type = $2 AND status IN (\'PENDING\', \'APPROVED\', \'PROCESSING\')', [dto.targetAssetId, dto.type]);
        if (duplicate.rowCount) throw new ConflictException({ code: 'DUPLICATE_OPEN_REQUEST', message: 'Tài sản đã có yêu cầu cùng loại đang xử lý.' });
      }
      const id = randomUUID();
      const result = await client.query(`INSERT INTO requests (id, request_type, creator_id, department_id, policy_version_id, target_asset_id, status, reason, emergency, requested_parameters) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9::jsonb) RETURNING *`, [id, dto.type, user.id, user.departmentId, dto.policyVersionId, dto.targetAssetId ?? null, dto.reason.trim(), dto.emergency ?? false, JSON.stringify(dto.parameters ?? {})]);
      await this.appendAudit(client, user.id, 'REQUEST_SUBMITTED', id, 'SUCCESS', { requestType: dto.type, emergency: dto.emergency ?? false });
      await this.notifications.enqueueRequestSubmitted(client, id, user.departmentId);
      await client.query('COMMIT');
      return presentRequest(result.rows[0] as RequestRow);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async decide(user: AuthUser, requestId: string, dto: DecideRequestDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<{ creator_id: string; department_id: string; status: string; version: number }>('SELECT creator_id, department_id, status, version FROM requests WHERE id = $1 FOR UPDATE', [requestId]);
      const request = found.rows[0];
      if (!request) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Không tìm thấy yêu cầu.' });
      assertCanDecide(user, { creatorId: request.creator_id, departmentId: request.department_id, status: request.status });
      if (dto.version && Number(dto.version) !== request.version) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Yêu cầu đã thay đổi. Hãy tải lại trước khi quyết định.' });
      await client.query('INSERT INTO request_decisions (request_id, approver_id, decision, comment) VALUES ($1,$2,$3,$4)', [requestId, user.id, dto.decision, dto.comment?.trim() ?? null]);
      const updated = await client.query('UPDATE requests SET status = $2, version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING *', [requestId, dto.decision]);
      await this.appendAudit(client, user.id, dto.decision === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED', requestId, 'SUCCESS', {});
      await this.notifications.enqueueDecision(client, requestId, dto.decision === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED');
      await client.query('COMMIT');
      return presentRequest(updated.rows[0] as RequestRow);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async detail(user: AuthUser, requestId: string) {
    const found = await this.pool.query<RequestRow>('SELECT r.*,u.display_name creator_name,d.name department_name,a.asset_code target_asset_code FROM requests r JOIN users u ON u.id=r.creator_id JOIN departments d ON d.id=r.department_id LEFT JOIN crypto_assets a ON a.id=r.target_asset_id WHERE r.id = $1', [requestId]);
    const request = found.rows[0];
    if (!request) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Không tìm thấy yêu cầu.' });
    const allowed = user.roles.includes('ADMIN') || request.creator_id === user.id || (user.roles.includes('APPROVER') && user.approverDepartmentIds.includes(request.department_id));
    if (!allowed) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Không tìm thấy yêu cầu.' });
    const decision = await this.pool.query('SELECT decision,comment,approver_id,decided_at FROM request_decisions WHERE request_id=$1', [requestId]);
    return { ...presentRequest(request), decision: decision.rows[0] ? { decision:decision.rows[0].decision,comment:decision.rows[0].comment,approverId:decision.rows[0].approver_id,decidedAt:decision.rows[0].decided_at } : null };
  }

  async cancel(user: AuthUser, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<RequestRow>('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [requestId]);
      const request = found.rows[0];
      if (!request || request.creator_id !== user.id) throw new NotFoundException({ code:'REQUEST_NOT_FOUND',message:'Không tìm thấy yêu cầu của bạn.' });
      if (request.status !== 'PENDING') throw new ConflictException({ code:'INVALID_REQUEST_STATE',message:'Chỉ có thể hủy yêu cầu đang chờ duyệt.' });
      const updated = await client.query<RequestRow>(`UPDATE requests SET status='CANCELLED',version=version+1 WHERE id=$1 RETURNING *`,[requestId]);
      await this.appendAudit(client,user.id,'REQUEST_CANCELLED',requestId,'SUCCESS',{});
      await client.query('COMMIT');
      return presentRequest(updated.rows[0]);
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private appendAudit(client: PoolClient, actorId: string, action: string, entityId: string, outcome: string, metadata: Record<string, unknown>) {
    return client.query(`INSERT INTO audit_logs (actor_id, actor_type, action, entity_type, entity_id, outcome, request_id, metadata) VALUES ($1,'USER',$2,'REQUEST',$3::text,$4,$3::uuid,$5::jsonb)`, [actorId, action, entityId, outcome, JSON.stringify(metadata)]);
  }
}
