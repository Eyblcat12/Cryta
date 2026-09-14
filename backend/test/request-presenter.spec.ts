import { describe, expect, it } from 'vitest';
import { presentRequest, type RequestRow } from '../src/requests/request.presenter';

describe('request presenter', () => {
  it('exposes the API contract in camelCase', () => {
    const row: RequestRow = {
      id: 'request-1', request_type: 'RENEW', creator_id: 'user-1', department_id: 'it', policy_version_id: 'policy-1',
      target_asset_id: 'asset-old', result_asset_id: null, status: 'PENDING', reason: 'Gia hạn phục vụ hệ thống', emergency: false,
      requested_parameters: { validity_days: 365 }, version: 2, submitted_at: '2026-09-04T00:00:00Z', completed_at: null, updated_at: '2026-09-04T00:00:00Z',
    };

    expect(presentRequest(row)).toEqual(expect.objectContaining({
      type: 'RENEW', creatorId: 'user-1', targetAssetId: 'asset-old', policyVersionId: 'policy-1', submittedAt: '2026-09-04T00:00:00Z',
    }));
    expect(presentRequest(row)).not.toHaveProperty('request_type');
  });
});
