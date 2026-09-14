import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';

@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
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
  async enqueueAsset(client:PoolClient,assetId:string,type:'ASSET_EXPIRING'|'ASSET_EXPIRED'|'ASSET_REVOKED',suffix:string){await client.query(`INSERT INTO notifications(recipient_id,asset_id,type,channel,deduplication_key,delivery_status,sent_at) SELECT owner_id,id,$2::varchar,channel,LOWER($2::text)||':'||id::text||':'||$3||':'||LOWER(channel),CASE WHEN channel='IN_APP' THEN 'SENT' ELSE 'PENDING' END,CASE WHEN channel='IN_APP' THEN NOW() ELSE NULL END FROM crypto_assets CROSS JOIN (VALUES ('EMAIL'),('IN_APP')) AS channels(channel) WHERE id=$1::uuid ON CONFLICT(deduplication_key) DO NOTHING`,[assetId,type,suffix])}
  async list(userId:string){const result=await this.pool.query(`SELECT n.id,n.type,n.asset_id,n.request_id,n.created_at,n.read_at,a.asset_code,r.reason FROM notifications n LEFT JOIN crypto_assets a ON a.id=n.asset_id LEFT JOIN requests r ON r.id=n.request_id WHERE n.recipient_id=$1 AND n.channel='IN_APP' ORDER BY n.created_at DESC LIMIT 100`,[userId]);return result.rows.map(r=>({id:r.id,type:r.type,assetId:r.asset_id,requestId:r.request_id,assetCode:r.asset_code,description:r.reason,createdAt:r.created_at,readAt:r.read_at}))}
  async markRead(userId:string,id?:string){const result=await this.pool.query(id?`UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND recipient_id=$2 AND channel='IN_APP' RETURNING id`:`UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE recipient_id=$1 AND channel='IN_APP' AND read_at IS NULL RETURNING id`,id?[id,userId]:[userId]);return{updated:result.rowCount??0}}
  async stats() { const result=await this.pool.query(`SELECT delivery_status,COUNT(*)::int AS count FROM notifications GROUP BY delivery_status`); return Object.fromEntries(result.rows.map(r=>[r.delivery_status,r.count])); }
}
