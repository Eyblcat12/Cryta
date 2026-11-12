import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AuthUser,RoleCode } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';
import { cryptoProviderMode } from '../jobs/crypto-provider-config';

const trendSources = {
  requests: { table: 'requests', timestamp: 'submitted_at', scope: 'AND creator_id = $2', daily: false },
  decisions: { table: 'request_decisions', timestamp: 'decided_at', scope: 'AND approver_id = $2', daily: true },
  assets: { table: 'crypto_assets', timestamp: 'created_at', scope: '', daily: false },
} as const;

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
    if (role === 'ADMIN') {
      const { metrics } = await this.adminMetrics();
      return { role, metrics, services: this.services() };
    }
    return {role,metrics:role==='APPROVER'?await this.approverMetrics(user):await this.ownerMetrics(user)};
  }

  async get(user:AuthUser,requested?:unknown) {
    const role=this.role(user,requested);
    const timeZone = process.env.APP_TIME_ZONE ?? 'Asia/Ho_Chi_Minh';
    if(role==='ADMIN')return { ...await this.admin(timeZone), trendTimeZone: timeZone };
    if(role==='APPROVER')return { ...await this.approver(user, timeZone), trendTimeZone: timeZone };
    return { ...await this.owner(user, timeZone), trendTimeZone: timeZone };
  }

  private trend(source: keyof typeof trendSources, timeZone: string, actorId?: string) {
    const { table, timestamp, scope, daily } = trendSources[source];
    const unit = daily ? 'day' : 'month';
    const lookback = daily ? '6 days' : '5 months';
    const format = daily ? 'YYYY-MM-DD' : 'YYYY-MM';
    // Resolve the bounds once, leaving the timestamp usable by range indexes.
    // The extra UTC day at each end covers timezone offsets and repeated local midnights.
    return this.pool.query<{ period: string; value: number }>(`
      WITH calendar AS (
        SELECT date_trunc('${unit}', NOW() AT TIME ZONE $1::text) AS last_bucket
      ), buckets AS (
        SELECT generate_series(last_bucket - INTERVAL '${lookback}', last_bucket, INTERVAL '1 ${unit}') AS period
        FROM calendar
      ), totals AS (
        SELECT date_trunc('${unit}', ${timestamp} AT TIME ZONE $1::text) AS period, COUNT(*)::int AS value
        FROM ${table}
        WHERE ${timestamp} >= (SELECT ((last_bucket - INTERVAL '${lookback}') AT TIME ZONE 'UTC') - INTERVAL '24 hours' FROM calendar)
          AND ${timestamp} < (SELECT ((last_bucket + INTERVAL '1 ${unit}') AT TIME ZONE 'UTC') + INTERVAL '24 hours' FROM calendar)
          ${scope}
        GROUP BY 1
      )
      SELECT TO_CHAR(buckets.period, '${format}') AS period, COALESCE(totals.value, 0) AS value
      FROM buckets LEFT JOIN totals USING (period)
      ORDER BY buckets.period`, actorId === undefined ? [timeZone] : [timeZone, actorId]);
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

  private async owner(user:AuthUser, timeZone: string) {
    const [metrics,trend,composition,priority]=await Promise.all([
      this.ownerMetrics(user),
      this.trend('requests', timeZone, user.id),
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

  private async approver(user:AuthUser, timeZone: string) {
    const [metrics,trend]=await Promise.all([
      this.approverMetrics(user),
      this.trend('decisions', timeZone, user.id),
    ]);
    return {role:'APPROVER',metrics,trend:trend.rows,composition:[{label:'APPROVED',value:metrics.approved},{label:'REJECTED',value:metrics.rejected},{label:'PENDING',value:metrics.pending}]};
  }

  private async adminMetrics() {
    const result=await this.pool.query(`WITH asset_counts AS (
      SELECT status AS label, COUNT(*)::int AS value FROM crypto_assets GROUP BY status
    ) SELECT
      (SELECT COALESCE(SUM(value),0)::int FROM asset_counts) total_assets,
      (SELECT COALESCE(MAX(value) FILTER (WHERE label='EXPIRING_SOON'),0)::int FROM asset_counts) expiring,
      (SELECT COALESCE(json_agg(asset_counts ORDER BY value DESC),'[]'::json) FROM asset_counts) composition,
      (SELECT COUNT(*)::int FROM users WHERE status='ACTIVE') active_users,
      (SELECT COUNT(DISTINCT ur.user_id)::int FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.code='ADMIN') admin_users,
      (SELECT COUNT(DISTINCT ur.user_id)::int FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.code='APPROVER') approver_users,
      (SELECT COUNT(*)::int FROM users u
        WHERE EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='ADMIN')
          AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='APPROVER')) sod_conflicts,
      (SELECT COUNT(*)::int FROM notifications WHERE channel='EMAIL' AND delivery_status='FAILED') failed_jobs,
      (SELECT COUNT(*)::int FROM notifications WHERE channel='EMAIL' AND delivery_status='RECONCILIATION_REQUIRED') email_reconciliation,
      (SELECT COUNT(*)::int FROM departments WHERE is_active) departments`);
    const { composition, ...metrics } = result.rows[0];
    return { metrics, composition };
  }

  private services() {return {cryptoProvider:cryptoProviderMode(),email:process.env.SMTP_ENABLED==='true'?'ENABLED':'DISABLED',expiryScan:'ACTIVE'}}

  private async admin(timeZone: string) {
    const [{ metrics, composition }, trend] = await Promise.all([
      this.adminMetrics(),
      this.trend('assets', timeZone),
    ]);
    return { role: 'ADMIN', metrics, trend: trend.rows, composition, services: this.services() };
  }
}
