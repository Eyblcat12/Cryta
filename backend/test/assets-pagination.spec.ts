import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { AssetsService } from '../src/assets/assets.service';

const owner: AuthUser = {
  id: 'owner-1', email: 'owner@example.test', displayName: 'Owner', departmentId: 'dept-1',
  tokenVersion: 1, roles: ['USER'], approverDepartmentIds: [], mustChangePassword: false,
};

describe('asset pagination', () => {
  it('rejects repeated/non-string pagination before querying',async()=>{
    const query=vi.fn();const service=new AssetsService({query} as unknown as Pool);
    for(const field of ['page','pageSize'])await expect(service.list(owner,{[field]:['1'] as unknown as string})).rejects.toMatchObject({status:400});
    expect(query).not.toHaveBeenCalled();
  });
  it('pages eligible renewal/revocation assets within the owner scope', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 52 }] } : { rows: [] });
    const service = new AssetsService({query} as unknown as Pool);
    expect(await service.list(owner, {page: '3', pageSize: '20', eligible: 'true'})).toEqual({items: [], total: 52, page: 3, pageSize: 20});
    for (const [sql] of query.mock.calls) expect(sql).toContain("a.owner_id = $1 AND a.status IN ('ACTIVE','EXPIRING_SOON')");
    expect(query.mock.calls[1][1]).toEqual(['owner-1', 'MOCK', 20, 40]);
    await expect(service.list(owner, {eligible:'yes'})).rejects.toThrow();
    await expect(service.list(owner, {eligible:['true'] as unknown as string})).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('applies owner scope and filters before count and page, with stable ordering', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 251 }] } : { rows: [] });
    const service = new AssetsService({ query } as unknown as Pool);
    const result = await service.list(owner, { page: '2', pageSize: '25', status: 'ACTIVE', search: 'laptop' });
    expect(result).toEqual({ items: [], total: 251, page: 2, pageSize: 25 });
    expect(query).toHaveBeenCalledTimes(2);
    const [countSql, countValues] = query.mock.calls[0] as [string, unknown[]];
    const [listSql, listValues] = query.mock.calls[1] as [string, unknown[]];
    expect(countSql).toContain('a.owner_id = $1 AND a.status = $2');
    expect(countSql).toContain('a.asset_code ILIKE $3');
    expect(countValues).toEqual(['owner-1', 'ACTIVE', '%laptop%']);
    expect(listSql).toContain('ORDER BY a.expires_at ASC, a.id ASC LIMIT $4 OFFSET $5');
    expect(listValues).toEqual(['owner-1', 'ACTIVE', '%laptop%', 25, 25]);
  });

  it('keeps approver scope and caps page size', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 0 }] } : { rows: [] });
    const service = new AssetsService({ query } as unknown as Pool);
    const approver = { ...owner, roles: ['APPROVER'] as AuthUser['roles'], approverDepartmentIds: ['dept-1'] };
    await service.list(approver, { page: '1', pageSize: '100' });
    expect(query.mock.calls[0][0]).toContain('a.department_id = ANY($1::uuid[])');
    expect(query.mock.calls[0][1]).toEqual([['dept-1']]);
    await expect(service.list(approver, { page: '1', pageSize: '101' })).rejects.toThrow();
    await expect(service.list(approver, { page: '0' })).rejects.toThrow();
    await expect(service.list(approver, { status: 'UNKNOWN' })).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
