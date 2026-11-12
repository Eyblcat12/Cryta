import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { AssetsService } from '../src/assets/assets.service';

const owner: AuthUser = { id: 'owner-1', email: 'owner@example.test', displayName: 'Owner', departmentId: 'dept-1', tokenVersion: 1, roles: ['USER'], approverDepartmentIds: [], mustChangePassword: false };

describe('asset history', () => {
  it('returns the bound policy version independently of the asset concurrency version', async () => {
    const query=vi.fn(async(_sql:string)=>({rows:[{id:'asset-1',owner_id:owner.id,policy_version:3,version:9}]}));
    const service=new AssetsService({query} as unknown as Pool);
    await expect(service.detail(owner,'asset-1')).resolves.toMatchObject({policyVersion:3,version:9});
    expect(query.mock.calls[0][0]).toContain('pv.version AS policy_version');
  });
  it('pages asset and related request events after checking asset scope', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM crypto_assets a JOIN departments')) return { rows: [{ id: 'asset-1', owner_id: 'owner-1', department_id: 'dept-1' }] };
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 121 }] };
      if (sql.includes('FROM audit_logs')) return { rows: [{ id: 5, action: 'REQUEST_APPROVED', occurred_at: '2026-01-01', outcome: 'SUCCESS', actor_name: 'Approver', request_id: 'request-1' }] };
      return { rows: [{ id: 'previous', asset_code: 'KEY-OLD', replaces_asset_id: null, owner_id: 'owner-1', department_id: 'dept-1' }, { id: 'next', asset_code: 'KEY-OTHER', replaces_asset_id: 'asset-1', owner_id: 'other', department_id: 'dept-2' }] };
    });
    const service = new AssetsService({ query } as unknown as Pool);
    const result = await service.history(owner, 'asset-1', { page: '2', pageSize: '10' });
    expect(result).toMatchObject({ total: 121, page: 2, pageSize: 10, lineage: { replaces: 'KEY-OLD', replacedBy: [] } });
    expect(result.lineage.assets).toEqual([{id:'previous',code:'KEY-OLD',relation:'predecessor'}]);
    expect(query.mock.calls[1][0]).toContain('target_asset_id=$1::uuid OR result_asset_id=$1::uuid');
    expect(query.mock.calls[2][0]).toContain('ORDER BY a.occurred_at DESC,a.event_order DESC,a.id DESC LIMIT $5 OFFSET $6');
    expect(query.mock.calls[2][0]).toContain('r.creator_id=$2 OR (r.submitted_at IS NOT NULL');
    expect(query.mock.calls[2][1]).toEqual(['asset-1', owner.id, false, [], 10, 10]);
    expect(query.mock.calls[2][0]).toContain('FROM provider_operations op JOIN visible_requests r ON r.id=op.request_id');
    expect(query.mock.calls[2][0]).toContain('FROM request_decisions d JOIN visible_requests r ON r.id=d.request_id');
    expect(query.mock.calls[2][0]).toContain('WHERE milestone.occurred_at IS NOT NULL');
    expect(query.mock.calls[2][0]).toContain('a.entity_id=$1::text');
    expect(query.mock.calls[2][0]).not.toContain('op.receipt,');
    expect(query.mock.calls[2][0]).not.toContain('d.comment');
  });

  it('denies cross-owner history before reading audit data', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'asset-2', owner_id: 'other', department_id: 'dept-2' }] }));
    const service = new AssetsService({ query } as unknown as Pool);
    await expect(service.history(owner, 'asset-2', { page: '1' })).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
