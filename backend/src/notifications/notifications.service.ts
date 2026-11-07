import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import { listOrder } from '../common/list-order';
import { ASSET_ALERT_RECIPIENT } from './asset-alert-recipient';

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
    const select=`SELECT n.id,n.type,n.asset_id,n.request_id,n.created_at,n.read_at,a.asset_code,r.reason ${from}`;
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
  async stats() { const result=await this.pool.query(`SELECT delivery_status,COUNT(*)::int AS count FROM notifications WHERE channel='EMAIL' GROUP BY delivery_status`); return Object.fromEntries(result.rows.map(r=>[r.delivery_status,r.count])); }
}
