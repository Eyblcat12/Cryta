import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AuthUser } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { cryptoProviderConfig } from '../jobs/crypto-provider-config';
import { listOrder } from '../common/list-order';

@Injectable()
export class AssetsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  async list(user: AuthUser, query: Record<string, string> = {}) {
    if(query.ownedOnly!==undefined&&(typeof query.ownedOnly!=='string'||!['true','false'].includes(query.ownedOnly)))
      throw new BadRequestException({code:'INVALID_ASSET_FILTER',message:'Bộ lọc tài sản cá nhân không hợp lệ.'});
    // Owner access already exists in detail(); this projection never accepts a caller-supplied owner ID.
    const scope = query.ownedOnly==='true' ? {sql:'WHERE a.owner_id = $1',values:[user.id]}
      : user.roles.includes('ADMIN') ? { sql: '', values: [] as unknown[] }
      : user.roles.includes('APPROVER') ? { sql: 'WHERE a.department_id = ANY($1::uuid[])', values: [user.approverDepartmentIds] }
      : { sql: 'WHERE a.owner_id = $1', values: [user.id] };
    if (!Object.keys(query).length) {
      const rows = await this.pool.query(this.selectSql(scope.sql) + ' ORDER BY a.expires_at ASC, a.id ASC LIMIT 250', scope.values);
      return rows.rows.map(this.present);
    }
    const integer = (value: string | undefined, fallback: number, maximum: number, name: string) => {
      if (value === undefined) return fallback;
      if (typeof value!=='string'||!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum)
        throw new BadRequestException({ code: 'INVALID_PAGINATION', message: `${name} phải là số nguyên từ 1 đến ${maximum}.` });
      return Number(value);
    };
    const page = integer(query.page, 1, 1_000_000, 'page');
    const pageSize = integer(query.pageSize, 25, 100, 'pageSize');
    const order = listOrder(query, {
      expiresAt: 'a.expires_at', createdAt: 'a.created_at', code: 'a.asset_code', status: 'a.status', type: 'a.asset_type',
    }, 'a.id', 'a.expires_at ASC, a.id ASC');
    if (query.status !== undefined && typeof query.status !== 'string')
      throw new BadRequestException({ code: 'INVALID_ASSET_STATUS', message: 'Trạng thái tài sản không hợp lệ.' });
    if (query.search !== undefined && typeof query.search !== 'string')
      throw new BadRequestException({ code: 'INVALID_SEARCH', message: 'Từ khóa tìm kiếm không hợp lệ.' });
    const status = query.status?.trim();
    if (status && !['REGISTERED', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'REVOKED', 'SUPERSEDED'].includes(status))
      throw new BadRequestException({ code: 'INVALID_ASSET_STATUS', message: 'Trạng thái tài sản không hợp lệ.' });
    const search = query.search?.trim();
    if (search && search.length > 100)
      throw new BadRequestException({ code: 'INVALID_SEARCH', message: 'Từ khóa tìm kiếm tối đa 100 ký tự.' });
    const conditions: string[] = [];
    const values = [...scope.values];
    if (scope.sql) conditions.push(scope.sql.replace(/^WHERE /, ''));
    if (query.eligible !== undefined) {
      if (typeof query.eligible !== 'string' || !['true', 'false'].includes(query.eligible))
        throw new BadRequestException({ code: 'INVALID_ASSET_FILTER', message: 'Bộ lọc tài sản không hợp lệ.' });
      if (query.eligible === 'true') {
        conditions.push("a.status IN ('ACTIVE','EXPIRING_SOON')");
        values.push(cryptoProviderConfig().scope);
        conditions.push(`a.provider_scope=$${values.length} AND a.provider_reference IS NOT NULL`);
      }
    }
    if (status) { values.push(status); conditions.push(`a.status = $${values.length}`); }
    if (search) { values.push(`%${search}%`); conditions.push(`(a.asset_code ILIKE $${values.length} OR a.purpose ILIKE $${values.length} OR u.display_name ILIKE $${values.length} OR d.name ILIKE $${values.length})`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const filterFrom = `FROM crypto_assets a${search ? ' JOIN departments d ON d.id=a.department_id JOIN users u ON u.id=a.owner_id' : ''}`;
    const count = await this.pool.query(`SELECT COUNT(*)::int AS total ${filterFrom} ${where}`, values);
    const listValues = [...values, pageSize, (page - 1) * pageSize];
    const pageIds = `SELECT a.id ${filterFrom} ${where} ORDER BY ${order} LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`;
    const source = `(${pageIds}) page_ids JOIN crypto_assets a ON a.id=page_ids.id`;
    const rows = await this.pool.query(this.selectSql('', source) + ` ORDER BY ${order}`, listValues);
    return { items: rows.rows.map(this.present), total: Number(count.rows[0]?.total ?? 0), page, pageSize };
  }
  async detail(user: AuthUser, id: string) {
    const result = await this.pool.query(this.selectSql('WHERE a.id = $1'), [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Không tìm thấy tài sản.' });
    const allowed = user.roles.includes('ADMIN') || row.owner_id === user.id || (user.roles.includes('APPROVER') && user.approverDepartmentIds.includes(row.department_id));
    if (!allowed) throw new ForbiddenException({ code: 'ASSET_SCOPE_DENIED', message: 'Bạn không có quyền xem tài sản này.' });
    return this.present(row);
  }
  async history(user:AuthUser,id:string,query:Record<string,string>={}) {
    await this.detail(user,id);
    const match=`((a.entity_type='CRYPTO_ASSET' AND a.entity_id=$1::text) OR (a.request_id IN (SELECT id FROM requests WHERE submitted_at IS NOT NULL AND (target_asset_id=$1::uuid OR result_asset_id=$1::uuid))) OR (a.action='ASSET_RENEWED' AND a.entity_type='CRYPTO_ASSET' AND a.entity_id IN (SELECT result_asset_id::text FROM requests WHERE target_asset_id=$1::uuid AND status='COMPLETED')))`;
    const values:unknown[]=[id,user.id,user.roles.includes('ADMIN'),user.roles.includes('APPROVER')?user.approverDepartmentIds:[]];
    const visibleRequest=`(a.request_id IS NULL OR a.request_id IN (SELECT r.id FROM requests r WHERE
      r.creator_id=$2 OR (r.submitted_at IS NOT NULL AND ($3::boolean OR r.department_id=ANY($4::uuid[])))))`;
    const from=`FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE ${match} AND ${visibleRequest}`;
    if(!Object.keys(query).length){const result=await this.pool.query(`SELECT a.id,a.action,a.occurred_at,a.outcome,u.display_name actor_name ${from} ORDER BY a.occurred_at DESC,a.id DESC LIMIT 100`,values);return result.rows.map(row=>({id:row.id,action:row.action,occurredAt:row.occurred_at,outcome:row.outcome,actorName:row.actor_name??'Hệ thống'}))}
    const number=(value:string|undefined,fallback:number,max:number)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new BadRequestException({code:'INVALID_PAGINATION',message:'Tham số phân trang không hợp lệ.'});return Number(value)};
    const page=number(query.page,1,1_000_000),pageSize=number(query.pageSize,10,50);
    const history = `WITH visible_requests AS (
      SELECT r.id FROM requests r WHERE r.submitted_at IS NOT NULL
        AND (r.target_asset_id=$1::uuid OR r.result_asset_id=$1::uuid)
        AND (r.creator_id=$2 OR $3::boolean OR r.department_id=ANY($4::uuid[]))
    ), events AS (
      SELECT a.id::text AS id,a.id AS event_order,a.action,a.occurred_at,a.outcome,a.request_id,u.display_name AS actor_name ${from}
      UNION ALL
      SELECT 'decision:'||d.id::text,0::bigint,
        CASE WHEN d.decision='APPROVED' THEN 'REQUEST_APPROVED' ELSE 'REQUEST_REJECTED' END,
        d.decided_at,'SUCCESS',d.request_id,u.display_name
      FROM request_decisions d JOIN visible_requests r ON r.id=d.request_id
        JOIN users u ON u.id=d.approver_id
      WHERE NOT EXISTS (
        SELECT 1 FROM audit_logs existing WHERE existing.request_id=d.request_id AND existing.actor_id=d.approver_id
          AND existing.outcome='SUCCESS'
          AND existing.action=CASE WHEN d.decision='APPROVED' THEN 'REQUEST_APPROVED' ELSE 'REQUEST_REJECTED' END
      )
      UNION ALL
      SELECT 'provider:'||op.request_id::text||':'||milestone.action,0::bigint,
        milestone.action,milestone.occurred_at,'SUCCESS',op.request_id,NULL::varchar
      FROM provider_operations op JOIN visible_requests r ON r.id=op.request_id
        CROSS JOIN LATERAL (VALUES ('PROVIDER_DISPATCH_STARTED',op.sent_at),('PROVIDER_RESULT_RECORDED',op.receipt_at))
          milestone(action,occurred_at)
      WHERE milestone.occurred_at IS NOT NULL
    )`;
    const count=await this.pool.query(`${history} SELECT COUNT(*)::int AS total FROM events`,values);
    const result=await this.pool.query(`${history} SELECT a.id,a.action,a.occurred_at,a.outcome,a.request_id,a.actor_name
      FROM events a ORDER BY a.occurred_at DESC,a.event_order DESC,a.id DESC LIMIT $5 OFFSET $6`,[...values,pageSize,(page-1)*pageSize]);
    const relatives=await this.pool.query(`SELECT id,asset_code,replaces_asset_id,owner_id,department_id FROM crypto_assets WHERE replaces_asset_id=$1 OR id=(SELECT replaces_asset_id FROM crypto_assets WHERE id=$1) ORDER BY asset_code,id`,[id]);
    const visible=relatives.rows.filter(row=>user.roles.includes('ADMIN')||row.owner_id===user.id||(user.roles.includes('APPROVER')&&user.approverDepartmentIds.includes(row.department_id)));
    return{items:result.rows.map(row=>({id:row.id,action:row.action,occurredAt:row.occurred_at,outcome:row.outcome,actorName:row.actor_name??'Hệ thống',requestId:row.request_id})),total:Number(count.rows[0]?.total??0),page,pageSize,lineage:{replaces:visible.find(row=>row.id!==id&&row.replaces_asset_id!==id)?.asset_code??null,replacedBy:visible.filter(row=>row.replaces_asset_id===id).map(row=>row.asset_code),assets:visible.map(row=>({id:row.id,code:row.asset_code,relation:row.replaces_asset_id===id?'successor':'predecessor'}))}};
  }
  private selectSql(where: string, source = 'crypto_assets a') { return `SELECT a.*,d.name AS department_name,u.display_name AS owner_name,p.code AS policy_code,pv.version AS policy_version,k.algorithm,k.key_size,k.usage,k.public_key_fingerprint,c.serial_number,c.subject_dn,c.issuer_dn,c.fingerprint FROM ${source} JOIN departments d ON d.id=a.department_id JOIN users u ON u.id=a.owner_id JOIN policy_versions pv ON pv.id=a.policy_version_id JOIN policies p ON p.id=pv.policy_id LEFT JOIN cryptographic_keys k ON k.asset_id=a.id LEFT JOIN certificates c ON c.asset_id=a.id ${where}`; }
  private present(row: Record<string, unknown>) { return { id:row.id,code:row.asset_code,type:row.asset_type,status:row.status,ownerId:row.owner_id,ownerName:row.owner_name,departmentId:row.department_id,departmentName:row.department_name,policyVersionId:row.policy_version_id,policyVersion:row.policy_version,policyCode:row.policy_code,purpose:row.purpose,validFrom:row.valid_from,expiresAt:row.expires_at,providerReference:row.provider_reference,providerMode:row.provider_scope==='MOCK'?'MOCK':row.provider_scope?'HTTP':null,version:row.version,algorithm:row.algorithm,keySize:row.key_size,usage:row.usage,publicKeyFingerprint:row.public_key_fingerprint,serialNumber:row.serial_number,subjectDn:row.subject_dn,issuerDn:row.issuer_dn,fingerprint:row.fingerprint }; }
}
