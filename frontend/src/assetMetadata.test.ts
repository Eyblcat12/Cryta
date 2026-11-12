import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('asset metadata from the API', () => {
  it('keeps policy version separate from asset concurrency version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: {
      id: 'asset-1', code: 'KEY-001', type: 'KEY', status: 'ACTIVE', purpose: 'Bound policy fixture',
      expiresAt: '2027-01-01T00:00:00Z', policyCode: 'RSA_POLICY', policyVersion: 3, version: 9,
    } })));
    const { api } = await import('./api');
    expect(await api.assetDetail('asset-1')).toMatchObject({ policyCode: 'RSA_POLICY', policyVersion: 3, version: 9 });
  });
});
