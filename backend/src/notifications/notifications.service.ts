import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { auditMetadata } from '../audit/audit-context';
import type { AuthUser } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { listOrder } from '../common/list-order';
import { ASSET_ALERT_RECIPIENT } from './asset-alert-recipient';
import type { EmailReconciliationDto } from './email-reconciliation.dto';

const missingEmail = () => new NotFoundException({ code: 'EMAIL_DELIVERY_NOT_FOUND', message: 'Không tìm thấy lần gửi email.' });

@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  async enqueueExecutionResult(client: PoolClient, requestId: string, type: 'REQUEST_COMPLETED' | 'REQUEST_RECONCILIATION_REQUIRED' | 'REQUEST_FAILED') {
    await client.query(`INSERT INTO notifications (recipient_id,request_id,type,channel,deduplication_key,delivery_status,sent_at)
      SELECT creator_id,id,$2::varchar,channel,LOWER($2::text)||':'||id::text||':'||LOWER(channel),
        CASE WHEN channel='IN_APP' THEN 'SENT' ELSE 'PENDING' END,CASE WHEN channel='IN_APP' THEN NOW() ELSE NULL END
      FROM requests CROSS JOIN (VALUES ('EMAIL'),('IN_APP')) AS channels(channel)
      WHERE id=$1::uuid AND status=SUBSTRING($2::text FROM 9)
      ON CONFLICT (deduplication_key) DO NOTHING`, [requestId, type]);
  }
  async enqueueRequestSubmitted(client: PoolClient, requestId: string, departmentId: string) {
    await client.query(`INSERT INTO notifications (recipient_id,request_id,type,channel,deduplication_key,delivery_status,sent_at)
      SELECT DISTINCT s.user_id,$1::uuid,'REQUEST_SUBMITTED',channel,'request-submitted:'||$1::text||':'||s.user_id::text||':'||LOWER(channel),CASE WHEN channel='IN_APP' THEN 'SENT' ELSE 'PENDING' END,CASE WHEN channel='IN_APP' THEN NOW() ELSE NULL END
      FROM approver_scopes s JOIN users u ON u.id=s.user_id AND u.status='ACTIVE'
      CROSS JOIN (VALUES ('EMAIL'),('IN_APP')) AS channels(channel)
      WHERE s.department_id=$2 ON CONFLICT (deduplication_key) DO NOTHING`, [requestId, departmentId]);
  }
  async enqueueDecision(client: PoolClient, requestId: string, type: 'REQUEST_APPROVED'|'REQUEST_REJECTED') {
    await client.query(`INSERT INTO notifications (recipient_id,request_id,type,channel,deduplication_key,delivery_status,sent_at)
      SELECT creator_id,id,$2::varchar,channel,LOWER($2::text)||':'||id::text||':'||LOWER(channel),CASE WHEN channel='IN_APP' THEN 'SENT' ELSE 'PENDING' END,CASE WHEN channel='IN_APP' THEN NOW() ELSE NULL END FROM requests CROSS JOIN (VALUES ('EMAIL'),('IN_APP')) AS channels(channel) WHERE id=$1::uuid
      ON CONFLICT (deduplication_key) DO NOTHING`, [requestId, type]);
  }
  async enqueueSecondApproval(client: PoolClient, requestId: string, departmentId: string, firstApprover: string) {
    await client.query(`INSERT INTO notifications (recipient_id,request_id,type,channel,deduplication_key,delivery_status,sent_at)
      SELECT DISTINCT u.id,r.id,'REQUEST_SECOND_APPROVAL',channels.channel,
        'request-second-approval:'||r.id::text||':'||u.id::text||':'||lower(channels.channel),
        CASE WHEN channels.channel='IN_APP' THEN 'SENT' ELSE 'PENDING' END,
        CASE WHEN channels.channel='IN_APP' THEN NOW() END
      FROM requests r JOIN approver_scopes s ON s.department_id=r.department_id
      JOIN users u ON u.id=s.user_id AND u.status='ACTIVE'
      JOIN departments d ON d.id=u.department_id AND d.is_active
      JOIN user_roles ur ON ur.user_id=u.id JOIN roles role ON role.id=ur.role_id AND role.code='APPROVER'
      CROSS JOIN (VALUES ('EMAIL'),('IN_APP')) AS channels(channel)
      WHERE r.id=$1 AND r.department_id=$2 AND u.id<>$3 AND u.id<>r.creator_id
      ON CONFLICT (deduplication_key) DO NOTHING`, [requestId, departmentId, firstApprover]);
  }
  async enqueueAsset(client:PoolClient,assetId:string,type:'ASSET_EXPIRING'|'ASSET_EXPIRED'|'ASSET_REVOKED',suffix:string){
    if(type==='ASSET_REVOKED'){
      await client.query(`INSERT INTO notifications(recipient_id,asset_id,type,channel,deduplication_key,delivery_status,sent_at) SELECT owner_id,id,$2::varchar,channel,LOWER($2::text)||':'||id::text||':'||$3||':'||LOWER(channel),CASE WHEN channel='IN_APP' THEN 'SENT' ELSE 'PENDING' END,CASE WHEN channel='IN_APP' THEN NOW() ELSE NULL END FROM crypto_assets CROSS JOIN (VALUES ('EMAIL'),('IN_APP')) AS channels(channel) WHERE id=$1::uuid ON CONFLICT(deduplication_key) DO NOTHING`,[assetId,type,suffix]);return;
    }
    await client.query(`INSERT INTO notifications(recipient_id,asset_id,type,channel,deduplication_key,delivery_status,sent_at)
      SELECT u.id,a.id,$2::varchar,channels.channel,LOWER($2::text)||':'||a.id::text||':'||$3||':'||u.id::text||':'||LOWER(channels.channel),
        CASE WHEN channels.channel='IN_APP' THEN 'SENT' ELSE 'PENDING' END,CASE WHEN channels.channel='IN_APP' THEN NOW() ELSE NULL END
      FROM crypto_assets a JOIN users u ON u.status='ACTIVE' JOIN departments d ON d.id=u.department_id AND d.is_active
      CROSS JOIN (VALUES ('EMAIL'),('IN_APP')) AS channels(channel)
      WHERE a.id=$1::uuid AND ${ASSET_ALERT_RECIPIENT} AND NOT EXISTS(
        SELECT 1 FROM notifications legacy WHERE legacy.recipient_id=u.id AND legacy.asset_id=a.id AND legacy.type=$2::varchar
          AND legacy.channel=channels.channel AND legacy.deduplication_key=LOWER($2::text)||':'||a.id::text||':'||$3||':'||LOWER(channels.channel)
      ) ON CONFLICT(deduplication_key) DO NOTHING`,[assetId,type,suffix]);
  }
  async list(userId:string,query:Record<string,string>={}){
    const from=`FROM notifications n LEFT JOIN crypto_assets a ON a.id=n.asset_id AND EXISTS(
      SELECT 1 FROM users u JOIN departments d ON d.id=u.department_id AND d.is_active
      WHERE u.id=n.recipient_id AND u.status='ACTIVE' AND ${ASSET_ALERT_RECIPIENT}
    ) LEFT JOIN requests r ON r.id=n.request_id AND (r.creator_id=n.recipient_id OR (r.submitted_at IS NOT NULL AND EXISTS(
      SELECT 1 FROM user_roles ur JOIN roles role ON role.id=ur.role_id WHERE ur.user_id=n.recipient_id
        AND (role.code='ADMIN' OR (role.code='APPROVER' AND EXISTS(
          SELECT 1 FROM approver_scopes scope WHERE scope.user_id=ur.user_id AND scope.department_id=r.department_id
        )))
    )))`;
    const select=`SELECT n.id,n.type,a.id AS asset_id,r.id AS request_id,n.created_at,n.read_at,a.asset_code,r.reason ${from}`;
    const present=(r:Record<string,unknown>)=>({id:r.id,type:r.type,assetId:r.asset_id,requestId:r.request_id,assetCode:r.asset_code,description:r.reason,createdAt:r.created_at,readAt:r.read_at});
    if(!Object.keys(query).length){const result=await this.pool.query(`${select} WHERE n.recipient_id=$1 AND n.channel='IN_APP' ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,[userId]);return result.rows.map(present)}
    const number=(value:string|undefined,fallback:number,max:number)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new BadRequestException({code:'INVALID_PAGINATION',message:'Tham số phân trang không hợp lệ.'});return Number(value)};
    const page=number(query.page,1,1_000_000),pageSize=number(query.pageSize,25,100);
    const order = listOrder(query, { createdAt: 'n.created_at', type: 'n.type', readAt: 'n.read_at' }, 'n.id', 'n.created_at DESC,n.id DESC');
    const values:unknown[]=[userId];const filters=[`n.recipient_id=$1`,`n.channel='IN_APP'`];
    if(query.read!==undefined){if(typeof query.read!=='string'||!['true','false'].includes(query.read))throw new BadRequestException({code:'INVALID_READ_FILTER',message:'Bộ lọc đã đọc không hợp lệ.'});filters.push(query.read==='true'?'n.read_at IS NOT NULL':'n.read_at IS NULL')}
    if (query.type !== undefined) {
      if (typeof query.type !== 'string' || !['REQUEST_SUBMITTED','REQUEST_SECOND_APPROVAL','REQUEST_APPROVED','REQUEST_REJECTED','REQUEST_COMPLETED',
        'REQUEST_RECONCILIATION_REQUIRED','REQUEST_FAILED','ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED'].includes(query.type)) {
        throw new BadRequestException({ code: 'INVALID_NOTIFICATION_TYPE', message: 'Loại thông báo không hợp lệ.' });
      }
      values.push(query.type); filters.push(`n.type=$${values.length}`);
    }
    if (query.search !== undefined) {
      if (typeof query.search !== 'string' || query.search.trim().length > 100) {
        throw new BadRequestException({ code: 'INVALID_SEARCH', message: 'Từ khóa tìm kiếm tối đa 100 ký tự.' });
      }
      const search = query.search.trim();
      if (search) {
        values.push(`%${search}%`);
        filters.push(`(n.type ILIKE $${values.length} OR a.asset_code ILIKE $${values.length} OR r.reason ILIKE $${values.length})`);
      }
    }
    const where=`WHERE ${filters.join(' AND ')}`;
    const count=await this.pool.query(`SELECT COUNT(*)::int AS total ${from} ${where}`,values);
    const args=[...values,pageSize,(page-1)*pageSize];
    const rows=await this.pool.query(`${select} ${where} ORDER BY ${order} LIMIT $${args.length-1} OFFSET $${args.length}`,args);
    return{items:rows.rows.map(present),total:Number(count.rows[0]?.total??0),page,pageSize};
  }
  async markRead(userId:string,id?:string){const result=await this.pool.query(id?`UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND recipient_id=$2 AND channel='IN_APP' RETURNING id`:`UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE recipient_id=$1 AND channel='IN_APP' AND read_at IS NULL RETURNING id`,id?[id,userId]:[userId]);return{updated:result.rowCount??0}}
  async deliveryIssues(query:Record<string,string>={}){
    const number=(value:string|undefined,fallback:number,max:number)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw new BadRequestException({code:'INVALID_PAGINATION',message:'Tham số phân trang không hợp lệ.'});return Number(value)};
    const page=number(query.page,1,1_000_000),pageSize=number(query.pageSize,20,100);
    if(query.status!==undefined&&typeof query.status!=='string')throw new BadRequestException({code:'INVALID_STATUS',message:'Trạng thái email không hợp lệ.'});
    if(query.status&&!['FAILED','RECONCILIATION_REQUIRED'].includes(query.status))throw new BadRequestException({code:'INVALID_STATUS',message:'Chỉ lọc email lỗi hoặc cần đối soát.'});
    const values:unknown[]=[];let where=`WHERE n.channel='EMAIL' AND n.delivery_status IN ('FAILED','RECONCILIATION_REQUIRED')`;
    if(query.status){values.push(query.status);where+=` AND n.delivery_status=$1`}
    const from=`FROM notifications n JOIN users u ON u.id=n.recipient_id`;
    const count=await this.pool.query(`SELECT COUNT(*)::int AS total ${from} ${where}`,values);
    const args=[...values,pageSize,(page-1)*pageSize];
    const result=await this.pool.query(`SELECT n.id,n.type,n.delivery_status,n.attempt_count,n.created_at,n.claimed_at,n.failed_at,u.email recipient_email,u.display_name recipient_name ${from} ${where} ORDER BY n.created_at DESC,n.id DESC LIMIT $${args.length-1} OFFSET $${args.length}`,args);
    return{items:result.rows.map(row=>({id:row.id,type:row.type,status:row.delivery_status,attemptCount:row.attempt_count,createdAt:row.created_at,claimedAt:row.claimed_at,failedAt:row.failed_at,recipientEmail:row.recipient_email,recipientName:row.recipient_name})),total:Number(count.rows[0]?.total??0),page,pageSize};
  }
  async deliveryDetail(id: string) {
    const { rows: [email] } = await this.pool.query(`SELECT n.id,n.type,n.delivery_status AS status,n.attempt_count AS "attemptCount",
      n.created_at AS "createdAt",n.claimed_at AS "claimedAt",n.failed_at AS "failedAt",n.sent_at AS "sentAt",
      n.error_message,u.email AS "recipientEmail",u.display_name AS "recipientName"
      FROM notifications n JOIN users u ON u.id=n.recipient_id WHERE n.id=$1 AND n.channel='EMAIL'`, [id]);
    if (!email) throw missingEmail();
    const { error_message: diagnostic, ...detail } = email;
    const rejection = typeof diagnostic === 'string' ? /^SMTP rejected delivery \(([45]\d{2})\)$/.exec(diagnostic) : null;
    const smtpStatus = rejection ? Number(rejection[1]) : null;
    const failure = detail.status === 'RECONCILIATION_REQUIRED' ? 'OUTCOME_UNKNOWN'
      : smtpStatus !== null ? (smtpStatus >= 500 ? 'SMTP_PERMANENT_REJECTION' : 'SMTP_TEMPORARY_REJECTION')
      : diagnostic === 'Email content could not be prepared' ? 'PREPARATION_FAILED'
      : diagnostic === 'SMTP did not accept delivery (operator verified)' ? 'VERIFIED_UNSENT' : null;
    return { ...detail, smtpStatus, failure, messageIdPrefix: `notification-${detail.id}` };
  }

  async reconcileDelivery(user: AuthUser, id: string, dto: EmailReconciliationDto) {
    const accepted = dto.outcome === 'ACCEPTED';
    const acceptedAt = accepted && dto.acceptedAt ? new Date(dto.acceptedAt) : null;
    if (accepted ? !acceptedAt || !Number.isFinite(acceptedAt.getTime()) : dto.acceptedAt !== undefined) {
      throw new BadRequestException({ code: 'EMAIL_ACCEPTANCE_TIME_INVALID', message: 'Chỉ cung cấp thời điểm khi xác nhận SMTP đã chấp nhận.' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'");
      const { rows: [actor] } = await client.query(`SELECT u.status,u.token_version,d.is_active,EXISTS(
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='ADMIN'
        ) AS is_admin FROM users u JOIN departments d ON d.id=u.department_id WHERE u.id=$1 FOR SHARE OF u,d`, [user.id]);
      if (!actor || actor.status !== 'ACTIVE' || !actor.is_active || !actor.is_admin || actor.token_version !== user.tokenVersion) {
        throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi.' });
      }

      const { rows: [email] } = await client.query(`SELECT delivery_status,attempt_count,
        ($2::timestamptz BETWEEN created_at AND clock_timestamp()) AS acceptance_in_range
        FROM notifications WHERE id=$1 AND channel='EMAIL' FOR UPDATE`, [id, acceptedAt]);
      if (!email) throw missingEmail();
      if (email.delivery_status !== 'RECONCILIATION_REQUIRED' || email.attempt_count !== dto.attemptCount) {
        throw new ConflictException({ code: 'EMAIL_DELIVERY_CHANGED', message: 'Trạng thái lần gửi đã thay đổi. Hãy tải lại chi tiết.' });
      }
      if (accepted && !email.acceptance_in_range) {
        throw new BadRequestException({ code: 'EMAIL_ACCEPTANCE_TIME_INVALID', message: 'Thời điểm SMTP chấp nhận phải nằm từ lúc tạo thư đến hiện tại.' });
      }

      const status = accepted ? 'SENT' : 'FAILED';
      await client.query(`UPDATE notifications SET delivery_status=$2,sent_at=$3::timestamptz,
        failed_at=CASE WHEN $3::timestamptz IS NULL THEN clock_timestamp() END,error_message=$4 WHERE id=$1`,
      [id, status, acceptedAt, accepted ? null : 'SMTP did not accept delivery (operator verified)']);
      await client.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,metadata)
        VALUES($1,'USER',$2,'EMAIL_DELIVERY',$3,'SUCCESS',$4::jsonb)`, [user.id,
        accepted ? 'EMAIL_DELIVERY_ACCEPTED_CONFIRMED' : 'EMAIL_DELIVERY_UNSENT_CONFIRMED', id,
        JSON.stringify(auditMetadata({ evidenceReference: dto.evidenceReference, attemptCount: dto.attemptCount,
          ...(acceptedAt && { acceptedAt: acceptedAt.toISOString() }) }))]);
      await client.query('COMMIT');
      return { id, status };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((error as { code?: string })?.code === '55P03') {
        throw new ConflictException({ code: 'EMAIL_DELIVERY_BUSY', message: 'Lần gửi đang được xử lý. Hãy tải lại chi tiết.' });
      }
      throw error;
    } finally { client.release(); }
  }
  async stats() { const result=await this.pool.query(`SELECT delivery_status,COUNT(*)::int AS count FROM notifications WHERE channel='EMAIL' GROUP BY delivery_status`); return Object.fromEntries(result.rows.map(r=>[r.delivery_status,r.count])); }
}
