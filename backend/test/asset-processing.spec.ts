import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { AssetProcessingService } from '../src/jobs/asset-processing.service';
import type { CryptoProviderService } from '../src/jobs/crypto-provider.service';
import type { NotificationsService } from '../src/notifications/notifications.service';

describe('asset worker recovery', () => {
  it('records an operation before changing a request to processing', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM requests WHERE status='APPROVED'")) return { rows: [{ id: 'request-1', request_type: 'CREATE', status: 'APPROVED', version: 1 }], rowCount: 1 };
      if (sql.includes("SET status='PROCESSING'")) return { rows: [{ id: 'request-1', request_type: 'CREATE', status: 'PROCESSING', version: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const worker = new AssetProcessingService(
      { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool,
      {} as CryptoProviderService,
      { enqueueExecutionResult: vi.fn(async () => {}) } as unknown as NotificationsService,
    );
    const job = await (worker as unknown as { claim(): Promise<unknown> }).claim();
    expect(job).toMatchObject({ status: 'PROCESSING', version: 2 });
    const calls = query.mock.calls.map(([sql]) => sql);
    expect(calls.findIndex((sql) => sql.includes('INSERT INTO provider_operations'))).toBeLessThan(calls.findIndex((sql) => sql.includes("SET status='PROCESSING'")));
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('moves stale work to reconciliation and never automatically approves it again', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('UPDATE requests')) return { rows: [{ id: 'request-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const worker = new AssetProcessingService(
      { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool,
      {} as CryptoProviderService,
      { enqueueExecutionResult: vi.fn(async () => {}) } as unknown as NotificationsService,
    );
    await (worker as unknown as { markStaleForReconciliation(): Promise<void> }).markStaleForReconciliation();
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => sql.includes("status='RECONCILIATION_REQUIRED'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("status='APPROVED'"))).toBe(false);
    expect(statements.some((sql) => sql.includes('REQUEST_RECONCILIATION_REQUIRED'))).toBe(true);
    expect(statements.some((sql) => sql.includes('provider_operations'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rechecks a young persisted request on later polls without contacting the provider', async () => {
    let stale = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("WHERE status='PROCESSING'")) return { rows: stale ? [{ id: 'request-1', request_type: 'CREATE' }] : [], rowCount: stale ? 1 : 0 };
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const provision = vi.fn(), revoke = vi.fn();
    const worker = new AssetProcessingService(
      { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool,
      { provision, revoke } as unknown as CryptoProviderService,
      { enqueueExecutionResult: vi.fn(async () => {}) } as unknown as NotificationsService,
    );
    const internal = worker as unknown as { run(): Promise<void>; markStaleForReconciliation(): Promise<void> };
    await internal.markStaleForReconciliation();
    await internal.run();
    expect(query.mock.calls.filter(([sql]) => sql.includes('REQUEST_RECONCILIATION_REQUIRED'))).toHaveLength(0);
    stale = true;
    await internal.run();
    expect(query.mock.calls.filter(([sql]) => sql.includes('REQUEST_RECONCILIATION_REQUIRED'))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO provider_operations'))).toHaveLength(1);
    expect(provision).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(5);
  });

  it('ignores an overlapping poll until the first sweep releases its connection', async () => {
    let resume!: () => void;
    const waiting = new Promise<void>((resolve) => { resume = resolve; });
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const release = vi.fn();
    const connect = vi.fn(async () => { await waiting; return { query, release }; });
    const worker = new AssetProcessingService({ connect } as unknown as Pool, {} as CryptoProviderService, { enqueueExecutionResult: vi.fn(async () => {}) } as unknown as NotificationsService);
    const internal = worker as unknown as { run(): Promise<void>; running: boolean };
    const first = internal.run();
    await internal.run();
    expect(connect).toHaveBeenCalledOnce();
    expect(internal.running).toBe(true);
    resume();
    await first;
    expect(connect).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(internal.running).toBe(false);
  });

  it('releases the run guard after a failed connection and recovers on the next poll', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const release = vi.fn();
    const connect = vi.fn().mockRejectedValueOnce(new Error('DB unavailable')).mockResolvedValue({ query, release });
    const worker = new AssetProcessingService({ connect } as unknown as Pool, {} as CryptoProviderService, { enqueueExecutionResult: vi.fn(async () => {}) } as unknown as NotificationsService);
    const internal = worker as unknown as { run(): Promise<void>; running: boolean };
    await internal.run();
    expect(internal.running).toBe(false);
    await internal.run();
    expect(connect).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledTimes(2);
    expect(internal.running).toBe(false);
  });

  it('rolls back a failed reconciliation audit and permits a later sweep', async () => {
    let failAudit = true;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("WHERE status='PROCESSING'")) return { rows: [{ id: 'request-1', request_type: 'CREATE' }], rowCount: 1 };
      if (sql.includes('REQUEST_RECONCILIATION_REQUIRED') && failAudit) throw new Error('Audit unavailable');
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const provision = vi.fn();
    const worker = new AssetProcessingService(
      { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool,
      { provision } as unknown as CryptoProviderService,
      { enqueueExecutionResult: vi.fn(async () => {}) } as unknown as NotificationsService,
    );
    const internal = worker as unknown as { run(): Promise<void>; running: boolean };
    await internal.run();
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
    expect(internal.running).toBe(false);
    failAudit = false;
    await internal.run();
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledTimes(3);
    expect(internal.running).toBe(false);
    expect(provision).not.toHaveBeenCalled();
  });
});

describe('asset worker execution guards', () => {
  const claimed = (type: 'CREATE' | 'RENEW' | 'REVOKE' = 'RENEW') => ({
    id: 'request-1', request_type: type, creator_id: 'owner-1', department_id: 'department-1',
    policy_version_id: 'policy-1', target_asset_id: type === 'CREATE' ? null : 'asset-1',
    reason: 'Approved business operation', requested_parameters: {}, status: 'PROCESSING', version: 2, result_asset_id: null,
  });
  const originalTarget = () => ({ id: 'asset-1', asset_type: 'KEY', owner_id: 'owner-1', department_id: 'department-1',
    policy_version_id: 'policy-1', status: 'ACTIVE', version: 1, provider_reference: 'provider-old', provider_scope: 'MOCK',
    algorithm: 'RSA', key_size: 2048, usage: 'SIGNING' });
  function harness(job = claimed()) {
    const state = { request: structuredClone(job), target: originalTarget(),
      configuration: { algorithm: 'RSA', maximum_validity_days: 90 } as Record<string, unknown>, policyAvailable: true,
      afterProvider: undefined as (() => void) | undefined,
      operation: { claim_version: job.version, status: 'CLAIMED', attempt_count: 0, retry_count: 0, provider_reference: null } };
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM requests WHERE id=') || sql.includes('AS lease_expired')) {
        return { rows: [structuredClone(state.request)], rowCount: 1 };
      }
      if (sql.startsWith('SELECT status,claim_version')) return { rows: [state.operation], rowCount: 1 };
      if (sql.includes("SET status='SENT',attempt_count=attempt_count+1")) {
        state.operation.status = 'SENT'; state.operation.attempt_count = 1;
      }
      if (sql.includes('SELECT pv.configuration')) return { rows: state.policyAvailable ? [{ configuration: structuredClone(state.configuration) }] : [], rowCount: state.policyAvailable ? 1 : 0 };
      if (sql.includes('FROM crypto_assets WHERE id=$1 FOR UPDATE')) return { rows: [structuredClone(state.target)], rowCount: 1 };
      if (sql.startsWith('SELECT algorithm,key_size,usage')) return { rows: [structuredClone(state.target)], rowCount: 1 };
      if (sql.includes("SET status='RECONCILIATION_REQUIRED'") && sql.includes('UPDATE requests')) {
        state.request.status = 'RECONCILIATION_REQUIRED'; state.request.version += 1;
        return { rows: [{ id: job.id }], rowCount: 1 };
      }
      if (sql.includes("SET status='COMPLETED'") && sql.includes('UPDATE requests')) state.request.status = 'COMPLETED';
      return { rows: [{ id: job.id }], rowCount: 1 };
    });
    const release = vi.fn();
    const provision = vi.fn(async () => {
      state.afterProvider?.();
      return { providerReference: 'provider-new', algorithm: 'RSA', keySize: 2048, usage: 'SIGNING', publicKeyFingerprint: 'fingerprint' };
    });
    const revoke = vi.fn(async () => { state.afterProvider?.(); return { revoked: true }; });
    const enqueueAsset = vi.fn(async () => {});
    const worker = new AssetProcessingService({ query, connect: vi.fn(async () => ({ query, release })) } as unknown as Pool,
      { provision, revoke } as unknown as CryptoProviderService, { enqueueAsset, enqueueExecutionResult: vi.fn(async () => {}) } as unknown as NotificationsService);
    const internal = worker as unknown as { process(value: ReturnType<typeof claimed>): Promise<void> };
    return { job, state, query, release, provision, revoke, enqueueAsset, run: () => internal.process(job) };
  }

  for (const type of ['RENEW', 'REVOKE'] as const) {
    it.each([
      ['owner', { owner_id: 'foreign-owner' }], ['state', { status: 'EXPIRED' }], ['expiry before scan', { expired: true }],
      ['policy', { policy_version_id: 'different-policy' }], ['provider reference', { provider_reference: null }],
    ])(`rejects ${type} with changed target %s before provider or attempt`, async (_name, mutation) => {
      const test = harness(claimed(type)); Object.assign(test.state.target, mutation);
      await test.run();
      expect(test.provision).not.toHaveBeenCalled(); expect(test.revoke).not.toHaveBeenCalled();
      expect(test.query.mock.calls.some(([sql]) => sql.includes('attempt_count=attempt_count+1'))).toBe(false);
      expect(test.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO crypto_assets'))).toBe(false);
      expect(test.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
      expect(test.state.request.status).toBe('RECONCILIATION_REQUIRED');
    });

    it(`completes valid ${type} with the approved policy and releases preflight locks before provider`, async () => {
      const test = harness(claimed(type));
      test.state.afterProvider = () => { expect(test.query.mock.calls.at(-1)?.[0]).toBe('COMMIT'); expect(test.release).toHaveBeenCalledOnce(); };
      await test.run();
      expect(test.state.request.status).toBe('COMPLETED');
      expect(type === 'RENEW' ? test.provision : test.revoke).toHaveBeenCalledOnce();
      if (type === 'RENEW') expect(test.provision).toHaveBeenCalledWith(expect.objectContaining({ replacesProviderReference: 'provider-old', operationId: 'request-1', keySize: 2048 }));
      else expect(test.revoke).toHaveBeenCalledWith('provider-old', 'request-1');
      expect(test.release).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['owner', { owner_id: 'foreign-owner' }], ['state', { status: 'EXPIRED' }],
      ['reference', { provider_reference: 'replaced-reference' }], ['key inputs', { key_size: 3072 }],
    ])(`preserves the receipt and refuses final ${type} target %s drift`, async (_name, mutation) => {
      const test = harness(claimed(type));
      test.state.afterProvider = () => { Object.assign(test.state.target, mutation); };
      await test.run();
      expect(type === 'RENEW' ? test.provision : test.revoke).toHaveBeenCalledOnce();
      expect(test.query.mock.calls.filter(([sql]) => sql.includes('SET status=CASE WHEN'))).toHaveLength(1);
      expect(test.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO crypto_assets') || sql.includes("SET status='REVOKED'"))).toBe(false);
      expect(test.state.request.status).toBe('RECONCILIATION_REQUIRED');
      expect(test.enqueueAsset).not.toHaveBeenCalled();
    });
  }

  it.each(['version', 'reason'] as const)('rejects a stale claimed request %s before provider', async (field) => {
    const test = harness();
    if (field === 'version') test.state.request.version += 1; else test.state.request.reason = 'Changed approved inputs';
    await test.run();
    expect(test.provision).not.toHaveBeenCalled(); expect(test.revoke).not.toHaveBeenCalled();
    expect(test.query.mock.calls.some(([sql]) => sql.includes('attempt_count=attempt_count+1'))).toBe(false);
  });

  it('rejects an unavailable policy before provider even for revoke', async () => {
    const test = harness(claimed('REVOKE')); test.state.policyAvailable = false;
    await test.run();
    expect(test.revoke).not.toHaveBeenCalled();
    expect(test.query.mock.calls.some(([sql]) => sql.includes('attempt_count=attempt_count+1'))).toBe(false);
  });

  it('keeps a provider receipt and rolls back completion if the policy snapshot is unavailable', async () => {
    const test = harness(); test.state.afterProvider = () => { test.state.policyAvailable = false; };
    await test.run();
    expect(test.provision).toHaveBeenCalledOnce();
    expect(test.state.request.status).toBe('RECONCILIATION_REQUIRED');
    expect(test.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO crypto_assets'))).toBe(false);
  });

  it('rejects changed request input after provider without committing an asset', async () => {
    const test = harness(); test.state.afterProvider = () => { test.state.request.reason = 'Changed after provider'; };
    await test.run(); expect(test.provision).toHaveBeenCalledOnce();
    expect(test.state.request.status).toBe('RECONCILIATION_REQUIRED');
    expect(test.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO crypto_assets'))).toBe(false);
  });

  it.each(['AES', 'ED25519', 'ECDSA'])('uses shared %s defaults instead of hard-coded RSA size and signing defaults', async (algorithm) => {
    const test = harness(claimed('CREATE')); test.state.configuration = { algorithm, maximum_validity_days: 90 };
    await test.run();
    expect(test.provision).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'KEY', algorithm, keySize: 256,
      usage: algorithm === 'AES' ? 'ENCRYPTION' : 'SIGNING', validityDays: 90 }));
    expect(test.state.request.status).toBe('COMPLETED');
  });
});
