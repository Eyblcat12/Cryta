import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AuthUser } from '../common/auth-user';
import { DATABASE_POOL } from '../database/database.constants';

@Injectable()
export class AssetsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  async list(user: AuthUser) {
    const scope = user.roles.includes('ADMIN') ? { sql: '', values: [] as unknown[] }
      : user.roles.includes('APPROVER') ? { sql: 'WHERE a.department_id = ANY($1::uuid[])', values: [user.approverDepartmentIds] }
      : { sql: 'WHERE a.owner_id = $1', values: [user.id] };
    const rows = await this.pool.query(this.selectSql(scope.sql) + ' ORDER BY a.expires_at ASC LIMIT 250', scope.values);
    return rows.rows.map(this.present);
  }
  async detail(user: AuthUser, id: string) {
    const result = await this.pool.query(this.selectSql('WHERE a.id = $1'), [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Không tìm thấy tài sản.' });
    const allowed = user.roles.includes('ADMIN') || row.owner_id === user.id || (user.roles.includes('APPROVER') && user.approverDepartmentIds.includes(row.department_id));
    if (!allowed) throw new ForbiddenException({ code: 'ASSET_SCOPE_DENIED', message: 'Bạn không có quyền xem tài sản này.' });
    return this.present(row);
  }
  private selectSql(where: string) { return `SELECT a.*,d.name AS department_name,u.display_name AS owner_name,p.code AS policy_code,k.algorithm,k.key_size,k.usage,k.public_key_fingerprint,c.serial_number,c.subject_dn,c.issuer_dn,c.fingerprint FROM crypto_assets a JOIN departments d ON d.id=a.department_id JOIN users u ON u.id=a.owner_id JOIN policy_versions pv ON pv.id=a.policy_version_id JOIN policies p ON p.id=pv.policy_id LEFT JOIN cryptographic_keys k ON k.asset_id=a.id LEFT JOIN certificates c ON c.asset_id=a.id ${where}`; }
  private present(row: Record<string, unknown>) { return { id:row.id,code:row.asset_code,type:row.asset_type,status:row.status,ownerId:row.owner_id,ownerName:row.owner_name,departmentId:row.department_id,departmentName:row.department_name,policyVersionId:row.policy_version_id,policyCode:row.policy_code,purpose:row.purpose,validFrom:row.valid_from,expiresAt:row.expires_at,providerReference:row.provider_reference,version:row.version,algorithm:row.algorithm,keySize:row.key_size,usage:row.usage,publicKeyFingerprint:row.public_key_fingerprint,serialNumber:row.serial_number,subjectDn:row.subject_dn,issuerDn:row.issuer_dn,fingerprint:row.fingerprint }; }
}
