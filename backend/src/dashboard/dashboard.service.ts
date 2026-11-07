import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AuthUser,RoleCode } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { cryptoProviderMode } from '../jobs/crypto-provider-config';

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE_POOL) private readonly pool:Pool) {}

  private role(user:AuthUser,requested:unknown):RoleCode {
    if(requested===undefined)return user.roles.includes('ADMIN')?'ADMIN':user.roles.includes('APPROVER')?'APPROVER':'USER';
    if(typeof requested!=='string'||!['ADMIN','APPROVER','USER'].includes(requested))throw new BadRequestException({code:'INVALID_DASHBOARD_ROLE',message:'Vai trò tổng quan không hợp lệ.'});
    if(!user.roles.includes(requested as RoleCode))throw new ForbiddenException({code:'DASHBOARD_ROLE_FORBIDDEN',message:'Bạn không được cấp vai trò tổng quan này.'});
    return requested as RoleCode;
  }

  async summary(user:AuthUser,requested?:unknown) {
    const role=this.role(user,requested);
    if(role==='ADMIN')return {role,metrics:await this.adminMetrics(),services:this.services()};
    return {role,metrics:role==='APPROVER'?await this.approverMetrics(user):await this.ownerMetrics(user)};
  }

  async get(user:AuthUser,requested?:unknown) {
    const role=this.role(user,requested);
    if(role==='ADMIN')return this.admin();
    if(role==='APPROVER')return this.approver(user);
    return this.owner(user);
  }

  private async ownerMetrics(user:AuthUser) {
    const [assets,requests]=await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int total,COUNT(*)FILTER(WHERE status='ACTIVE')::int active,
        COUNT(*)FILTER(WHERE status='EXPIRING_SOON')::int expiring,COUNT(*)FILTER(WHERE status IN('EXPIRED','REVOKED','SUPERSEDED'))::int ended,
        COUNT(*)FILTER(WHERE status IN('ACTIVE','EXPIRING_SOON'))::int live,
        COUNT(*)FILTER(WHERE status IN('ACTIVE','EXPIRING_SOON') AND expires_at<=NOW()+INTERVAL '30 days')::int within30,
        COUNT(*)FILTER(WHERE status IN('ACTIVE','EXPIRING_SOON') AND expires_at>NOW()+INTERVAL '30 days' AND expires_at<=NOW()+INTERVAL '180 days')::int within180,
        COUNT(*)FILTER(WHERE status IN('ACTIVE','EXPIRING_SOON') AND expires_at>NOW()+INTERVAL '180 days')::int after180
        FROM crypto_assets WHERE owner_id=$1`,[user.id]),
      this.pool.query(`SELECT COUNT(*)FILTER(WHERE status='PENDING')::int pending,COUNT(*)FILTER(WHERE status='PROCESSING')::int processing,COUNT(*)FILTER(WHERE status='FAILED')::int failed FROM requests WHERE creator_id=$1`,[user.id]),
    ]);
    return {...assets.rows[0],...requests.rows[0]};
  }

  private async owner(user:AuthUser) {
    const [metrics,trend,composition,priority]=await Promise.all([
      this.ownerMetrics(user),
      this.pool.query(`SELECT TO_CHAR(month,'YYYY-MM') period,COUNT(r.id)::int value FROM generate_series(date_trunc('month',NOW())-INTERVAL '5 months',date_trunc('month',NOW()),INTERVAL '1 month') month LEFT JOIN requests r ON r.creator_id=$1 AND date_trunc('month',r.submitted_at)=month GROUP BY month ORDER BY month`,[user.id]),
      this.pool.query(`SELECT asset_type label,COUNT(*)::int value FROM crypto_assets WHERE owner_id=$1 GROUP BY asset_type`,[user.id]),
      this.pool.query(`SELECT id,owner_id AS "ownerId",department_id AS "departmentId",asset_code AS code,purpose,asset_type AS type,status,expires_at AS "expiresAt",policy_version_id AS "policyVersionId",version
        FROM crypto_assets WHERE owner_id=$1 AND status='EXPIRING_SOON' ORDER BY expires_at ASC,id ASC LIMIT 1`,[user.id]),
    ]);
    return {role:'USER',metrics,trend:trend.rows,composition:composition.rows,lifecycle:{live:metrics.live,within30:metrics.within30,within180:metrics.within180,after180:metrics.after180,priority:priority.rows[0]??null}};
  }

  private async approverMetrics(user:AuthUser) {
    const [queue,decisions]=await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int pending,COUNT(*)FILTER(WHERE emergency)::int emergency,COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM(NOW()-submitted_at))/3600)::numeric,1),0) avg_wait_hours FROM requests WHERE department_id=ANY($1::uuid[]) AND status='PENDING'`,[user.approverDepartmentIds]),
      this.pool.query(`SELECT COUNT(*)FILTER(WHERE decision='APPROVED')::int approved,COUNT(*)FILTER(WHERE decision='REJECTED')::int rejected FROM request_decisions WHERE approver_id=$1 AND decided_at>=NOW()-INTERVAL '30 days'`,[user.id]),
    ]);
    return {...queue.rows[0],...decisions.rows[0]};
  }

  private async approver(user:AuthUser) {
    const [metrics,trend]=await Promise.all([
      this.approverMetrics(user),
      this.pool.query(`SELECT TO_CHAR(day,'YYYY-MM-DD') period,COUNT(d.id)::int value FROM generate_series(current_date-6,current_date,INTERVAL '1 day') day LEFT JOIN request_decisions d ON d.approver_id=$1 AND d.decided_at>=day AND d.decided_at<day+INTERVAL '1 day' GROUP BY day ORDER BY day`,[user.id]),
    ]);
    return {role:'APPROVER',metrics,trend:trend.rows,composition:[{label:'APPROVED',value:metrics.approved},{label:'REJECTED',value:metrics.rejected},{label:'PENDING',value:metrics.pending}]};
  }

  private async adminMetrics() {
    const result=await this.pool.query(`SELECT (SELECT COUNT(*)::int FROM crypto_assets)total_assets,(SELECT COUNT(*)::int FROM crypto_assets WHERE status='EXPIRING_SOON')expiring,(SELECT COUNT(*)::int FROM users WHERE status='ACTIVE')active_users,(SELECT COUNT(DISTINCT ur.user_id)::int FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.code='ADMIN')admin_users,(SELECT COUNT(DISTINCT ur.user_id)::int FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.code='APPROVER')approver_users,(SELECT COUNT(*)::int FROM users u WHERE EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='ADMIN') AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='APPROVER'))sod_conflicts,(SELECT COUNT(*)::int FROM notifications WHERE delivery_status='FAILED')failed_jobs,(SELECT COUNT(*)::int FROM notifications WHERE delivery_status='RECONCILIATION_REQUIRED')email_reconciliation,(SELECT COUNT(*)::int FROM departments WHERE is_active)departments`);
    return result.rows[0];
  }

  private services() {return {cryptoProvider:cryptoProviderMode(),email:process.env.SMTP_ENABLED==='true'?'ENABLED':'DISABLED',expiryScan:'ACTIVE'}}

  private async admin() {
    const [metrics,trend,composition]=await Promise.all([
      this.adminMetrics(),
      this.pool.query(`SELECT TO_CHAR(month,'YYYY-MM') period,COUNT(a.id)::int value FROM generate_series(date_trunc('month',NOW())-INTERVAL '5 months',date_trunc('month',NOW()),INTERVAL '1 month')month LEFT JOIN crypto_assets a ON date_trunc('month',a.created_at)=month GROUP BY month ORDER BY month`),
      this.pool.query(`SELECT status label,COUNT(*)::int value FROM crypto_assets GROUP BY status ORDER BY value DESC`),
    ]);
    return {role:'ADMIN',metrics,trend:trend.rows,composition:composition.rows,services:this.services()};
  }
}
