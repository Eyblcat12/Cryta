import { auditMetadata } from '../audit/audit-context';
import { BeforeApplicationShutdown, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import { DrainablePoll } from '../common/drainable-poll';
import { DATABASE_POOL } from '../database/database.constants';
import type { AuthUser } from '../common/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsMetricsService } from '../operations/operations-metrics.service';
import { assertAssetCanChange, normalizeRequestParameters, resolveProvisionParameters } from '../requests/request-policy';
import { CryptoProviderService, type ProvisionResult } from './crypto-provider.service';
import { cryptoProviderConfig, cryptoProviderMode } from './crypto-provider-config';
import { automaticRetryDelays, failureCode, maximumRecoveryRetries, type FailureClass } from './provider-recovery';

const CLAIM_LEASE = "INTERVAL '15 minutes'";
const HEARTBEAT_MS = 30_000;

type Job = {
  id: string;
  request_type: 'CREATE' | 'RENEW' | 'REVOKE';
  creator_id: string;
  department_id: string;
  policy_version_id: string;
  target_asset_id: string | null;
  reason: string;
  requested_parameters: Record<string, unknown>;
  status: string;
  version: number;
  result_asset_id: string | null;
};

type Target = {
  id: string;
  asset_type: 'KEY' | 'CERTIFICATE';
  owner_id: string;
  department_id: string;
  policy_version_id: string;
  status: string;
  version: number;
  provider_reference: string | null;
  provider_scope: string | null;
  algorithm: string | null;
  key_size: number | null;
  usage: string | null;
};

type PreparedOperation = {
  target?: Target;
  configuration: Record<string, unknown>;
  providerScope: string;
  parameters?: ReturnType<typeof resolveProvisionParameters>;
};

type Operation = {
  status: string;
  claim_version: number | null;
  attempt_count: number;
  retry_count: number;
  provider_reference: string | null;
  failure_class: FailureClass | null;
  last_error_code: string | null;
  receipt: ProvisionResult | null;
  input_digest: string | null;
};

@Injectable()
export class AssetProcessingService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly poll = new DrainablePoll();
  private get running() { return this.poll.running; }
  private readonly logger = new Logger(AssetProcessingService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly provider: CryptoProviderService,
    private readonly notifications: NotificationsService,
    private readonly metrics?: OperationsMetricsService,
  ) {}

  async onModuleInit() {
    await this.markStaleForReconciliation();
    this.timer = setInterval(() => void this.run(), 5000);
    void this.run();
  }

  onModuleDestroy() {
    this.poll.stop();
    if (this.timer) clearInterval(this.timer);
  }

  beforeApplicationShutdown() { return this.poll.drain(); }

  private async markStaleForReconciliation() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stale = await client.query<{ id: string; request_type: Job['request_type'] }>(`WITH expired AS (
        SELECT id FROM requests WHERE status='PROCESSING' AND updated_at<NOW()-${CLAIM_LEASE} AND result_asset_id IS NULL
        ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 25
      ) UPDATE requests r SET status='RECONCILIATION_REQUIRED',version=r.version+1,updated_at=NOW()
        FROM expired WHERE r.id=expired.id RETURNING r.id,r.request_type`);
      for (const row of stale.rows) {
        await client.query(`INSERT INTO provider_operations(request_id,operation_type,status,failure_class,last_error_code)
          VALUES($1,$2,'RECONCILIATION_REQUIRED','OUTCOME_UNKNOWN','STALE_PROCESSING')
          ON CONFLICT(request_id) DO UPDATE SET status='RECONCILIATION_REQUIRED',retry_after=NULL,
            last_error_code='STALE_PROCESSING',updated_at=NOW(),failure_class=CASE
              WHEN provider_operations.receipt IS NOT NULL THEN 'RESULT_RECORDED'
              WHEN provider_operations.claim_version IS NOT NULL AND provider_operations.status='CLAIMED'
                AND provider_operations.attempt_count=0 AND provider_operations.provider_reference IS NULL THEN 'UNSENT_TRANSIENT'
              ELSE 'OUTCOME_UNKNOWN' END`, [row.id, row.request_type]);
        await client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,outcome,request_id,metadata)
          VALUES('SYSTEM','REQUEST_RECONCILIATION_REQUIRED','REQUEST',$1::text,'FAILED',$1::uuid,$2::jsonb)`, [row.id, JSON.stringify(auditMetadata({ reason: 'stale_processing' }))]);
        await this.notifications.enqueueExecutionResult(client,row.id,'REQUEST_RECONCILIATION_REQUIRED');
      }
      await client.query('COMMIT');
      if (stale.rowCount) this.logger.warn({ event: 'asset.stale_processing', count: stale.rowCount });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private run(): Promise<void> {
    return this.running ? Promise.resolve() : this.poll.run(() => this.processBatch());
  }

  private async processBatch() {
    const startedAt = performance.now();
    try {
      // A request that was young at startup can become stale while this instance stays alive.
      await this.markStaleForReconciliation();
      for (let i = 0; i < 5 && !this.poll.stopping; i++) {
        const job = await this.claim();
        if (!job) break;
        await this.process(job);
      }
      this.metrics?.recordJob('assetProcessing', 'completed', startedAt);
    } catch {
      this.metrics?.recordJob('assetProcessing', 'failed', startedAt);
      this.logger.error({ event: 'asset.poll_failed' });
    }
  }

  private async claim(): Promise<Job | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<Job>(`SELECT * FROM requests WHERE status='APPROVED'
        AND NOT EXISTS(SELECT 1 FROM provider_operations op WHERE op.request_id=requests.id
          AND (op.status<>'CLAIMED' OR op.retry_after IS NULL OR op.retry_after>NOW()))
        ORDER BY emergency DESC,updated_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      let job = result.rows[0];
      if (job) {
        const operation = await client.query(`INSERT INTO provider_operations(request_id,operation_type,status,claim_version)
          VALUES($1,$2,'CLAIMED',$3) ON CONFLICT(request_id) DO UPDATE SET claim_version=EXCLUDED.claim_version,
            retry_after=NULL,updated_at=NOW()
          WHERE provider_operations.status='CLAIMED' AND provider_operations.retry_after<=NOW()
          RETURNING request_id`, [job.id, job.request_type, job.version + 1]);
        if (!operation.rowCount) throw new Error('PROVIDER_OPERATION_ALREADY_EXISTS');
        const processing = await client.query<Job>(`UPDATE requests SET status='PROCESSING',version=version+1 WHERE id=$1 RETURNING *`, [job.id]);
        job = processing.rows[0];
        if (!job) throw new Error('REQUEST_PROCESSING_LEASE_LOST');
      }
      await client.query('COMMIT');
      return job;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async process(job: Job) {
    const heartbeat = new DrainablePoll();
    const timer = setInterval(() => void heartbeat.run(async () => {
      try { await this.renewClaim(job); }
      catch { this.logger.warn({ event: 'asset.claim_heartbeat_failed', requestId: job.id }); }
    }), HEARTBEAT_MS);
    try { await this.processClaim(job); }
    finally {
      clearInterval(timer);
      heartbeat.stop();
      await heartbeat.drain();
    }
  }

  private async renewClaim(job: Job) {
    // Skip an in-flight transaction and let its row lock protect the claim until it finishes.
    await this.pool.query(`WITH active_claim AS (
      SELECT id FROM requests WHERE id=$1 AND version=$2 AND status='PROCESSING'
        AND result_asset_id IS NULL AND updated_at>=NOW()-${CLAIM_LEASE}
      FOR UPDATE SKIP LOCKED
    ) UPDATE requests r SET updated_at=NOW() FROM active_claim WHERE r.id=active_claim.id`, [job.id, job.version]);
  }

  private async processClaim(job: Job) {
    try {
      const prepared = await this.prepareProviderCall(job);
      const result = await this.callProvider(job, prepared);
      await this.markProviderSucceeded(job, result);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await this.assertFinalState(client, job, prepared);
        await this.complete(client, job, prepared, result);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    } catch (error) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const current = (await client.query<Job>('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [job.id])).rows[0];
        const operation = await this.lockOperation(client, job.id);
        if (current?.status === 'PROCESSING' && operation && (operation.claim_version === null || operation.claim_version === job.version)) {
          const unsent = operation.claim_version === job.version && operation.status === 'CLAIMED' &&
            operation.attempt_count === 0 && operation.provider_reference === null;
          const expired = error instanceof Error && error.message === 'REQUEST_PROCESSING_LEASE_EXPIRED';
          const code = expired ? 'STALE_PROCESSING' : failureCode(error);
          const transient = unsent && current.version === job.version && code === 'PREFLIGHT_DB_BUSY';
          const delay = transient ? automaticRetryDelays[operation.retry_count] : undefined;
          if (delay !== undefined) {
            await this.scheduleRetry(client, job.id, delay, operation.retry_count, code);
          } else {
            const classification: FailureClass = operation.receipt ? 'RESULT_RECORDED'
              : unsent && (transient || expired) ? 'UNSENT_TRANSIENT' : unsent ? 'UNSENT_PERMANENT' : 'OUTCOME_UNKNOWN';
            await this.requireReconciliation(client, job.id, classification, code === 'PREFLIGHT_DB_BUSY' && !unsent ? 'PROCESSING_ERROR' : code);
          }
        }
        await client.query('COMMIT');
      } catch (reconciliationError) {
        await client.query('ROLLBACK');
        throw reconciliationError;
      } finally { client.release(); }
    }
  }

  private async lockOperation(client: PoolClient, requestId: string) {
    return (await client.query<Operation>(`SELECT status,claim_version,attempt_count,retry_count,provider_reference,
      failure_class,last_error_code,receipt,input_digest FROM provider_operations WHERE request_id=$1 FOR UPDATE`, [requestId])).rows[0];
  }

  private async scheduleRetry(client: PoolClient, requestId: string, delay: number, retryCount: number, code: string, actor?: { id: string; reason: string }) {
    await client.query(`UPDATE provider_operations SET status='CLAIMED',retry_count=retry_count+1,
      retry_after=NOW()+make_interval(secs=>$2),failure_class='UNSENT_TRANSIENT',last_error_code=$3,updated_at=NOW()
      WHERE request_id=$1`, [requestId, delay, code]);
    await client.query(`UPDATE requests SET status='APPROVED',version=version+1 WHERE id=$1`, [requestId]);
    await this.recoveryAudit(client, requestId, 'PROVIDER_RETRY_SCHEDULED', { code, delaySeconds: delay, retryCount: retryCount + 1 }, actor);
  }

  private async requireReconciliation(client: PoolClient, requestId: string, classification: FailureClass, code: string) {
    await client.query(`UPDATE requests SET status='RECONCILIATION_REQUIRED',version=version+1 WHERE id=$1`, [requestId]);
    await client.query(`UPDATE provider_operations SET status='RECONCILIATION_REQUIRED',failure_class=$2,last_error_code=$3,
      retry_after=NULL,updated_at=NOW() WHERE request_id=$1`, [requestId, classification, code]);
    await client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,outcome,request_id,metadata)
      VALUES('SYSTEM','REQUEST_RECONCILIATION_REQUIRED','REQUEST',$1::text,'FAILED',$1::uuid,$2::jsonb)`,
    [requestId, JSON.stringify(auditMetadata({ code, classification }))]);
    await this.notifications.enqueueExecutionResult(client, requestId, 'REQUEST_RECONCILIATION_REQUIRED');
    this.logger.warn({ event: 'asset.reconciliation_required', requestId, code });
  }

  private recoveryAudit(client: PoolClient, requestId: string, action: string, metadata: Record<string, unknown>, actor?: { id: string; reason: string }) {
    return client.query(`INSERT INTO audit_logs(actor_id,actor_type,action,entity_type,entity_id,outcome,request_id,metadata)
      VALUES($1,$2,$3,'REQUEST',$4::text,'SUCCESS',$4::uuid,$5::jsonb)`,
    [actor?.id ?? null, actor ? 'USER' : 'SYSTEM', action, requestId, JSON.stringify(auditMetadata({ ...metadata, reason: actor?.reason }))]);
  }

  private async markProviderSent(job: Job, client: PoolClient, inputDigest: string) {
    const updated = await client.query(`UPDATE provider_operations SET status='SENT',attempt_count=attempt_count+1,
      sent_at=NOW(),failure_class=NULL,last_error_code=NULL,input_digest=$3,updated_at=NOW()
      WHERE request_id=$1 AND claim_version=$2 AND status='CLAIMED' AND retry_after IS NULL RETURNING request_id`,
    [job.id, job.version, inputDigest]);
    if (!updated.rowCount) throw new Error('PROVIDER_OPERATION_NOT_CLAIMED');
  }

  private async markProviderSucceeded(job: Job, receipt: ProvisionResult) {
    const { providerReference, algorithm, keySize, usage, publicKeyFingerprint, serialNumber, subjectDn, issuerDn, fingerprint,
      validFrom, expiresAt, providerScope } = receipt;
    const recorded = { providerReference, algorithm, keySize, usage, publicKeyFingerprint, serialNumber, subjectDn, issuerDn, fingerprint,
      validFrom, expiresAt, providerScope };
    const values = [job.id, job.version, providerReference, JSON.stringify(recorded)];
    const persist = () => this.pool.query(`UPDATE provider_operations
      SET status=CASE WHEN status='RECONCILIATION_REQUIRED' THEN status ELSE 'PROVIDER_SUCCEEDED' END,
          provider_reference=$3,receipt=$4::jsonb,receipt_at=NOW(),failure_class='RESULT_RECORDED',updated_at=NOW()
      WHERE request_id=$1 AND claim_version=$2 AND receipt IS NULL
        AND status IN ('SENT','RECONCILIATION_REQUIRED') RETURNING request_id`, values);
    try {
      if ((await persist()).rowCount) return;
    } catch {
      // A lost database acknowledgment can mean the receipt already committed.
      if ((await persist()).rowCount) return;
    }
    const existing = await this.pool.query(`SELECT request_id FROM provider_operations
      WHERE request_id=$1 AND claim_version=$2 AND provider_reference=$3 AND receipt=$4::jsonb
        AND status IN ('PROVIDER_SUCCEEDED','RECONCILIATION_REQUIRED')`, values);
    if (!existing.rowCount) throw new Error('PROVIDER_OPERATION_NOT_SENT');
  }

  private async readTarget(job: Job, client: PoolClient, providerScope: string): Promise<Target | undefined> {
    if (job.request_type === 'CREATE') {
      if (job.target_asset_id) throw new Error('TARGET_ASSET_NOT_ALLOWED');
      return undefined;
    }
    if (!job.target_asset_id) throw new Error('TARGET_ASSET_REQUIRED');
    const target = (await client.query<Target>('SELECT * FROM crypto_assets WHERE id=$1 FOR UPDATE', [job.target_asset_id])).rows[0];
    if (!target) throw new Error('ASSET_NOT_FOUND');
    assertAssetCanChange({ ownerId: target.owner_id, status: target.status }, job.creator_id);
    if (target.policy_version_id !== job.policy_version_id) throw new Error('ASSET_POLICY_MISMATCH');
    if (!target.provider_reference) throw new Error('PROVIDER_REFERENCE_REQUIRED');
    if (target.provider_scope !== providerScope) throw new Error('CRYPTO_PROVIDER_SCOPE_MISMATCH');
    if (target.asset_type === 'KEY') {
      const key = (await client.query<Pick<Target, 'algorithm' | 'key_size' | 'usage'>>(
        'SELECT algorithm,key_size,usage FROM cryptographic_keys WHERE asset_id=$1 FOR SHARE', [target.id])).rows[0];
      target.algorithm = key?.algorithm ?? null;
      target.key_size = key?.key_size ?? null;
      target.usage = key?.usage ?? null;
    }
    return target;
  }

  private targetSnapshot(target: Target, includeScope = true) {
    return { id: target.id, ownerId: target.owner_id, departmentId: target.department_id,
      status: target.status, version: target.version, policyVersionId: target.policy_version_id,
      assetType: target.asset_type, providerReference: target.provider_reference,
      algorithm: target.algorithm, keySize: target.key_size, usage: target.usage,
      ...(includeScope && { providerScope: target.provider_scope }) };
  }

  private async assertRequestState(client: PoolClient, job: Job) {
    const current = (await client.query<Job & { lease_expired: boolean }>(`SELECT *,updated_at<NOW()-${CLAIM_LEASE} AS lease_expired
      FROM requests WHERE id=$1 FOR UPDATE`, [job.id])).rows[0];
    if (!current || current.status !== 'PROCESSING' || current.version !== job.version || current.result_asset_id !== null) {
      throw new Error('REQUEST_PROCESSING_LEASE_LOST');
    }
    if (current.lease_expired) throw new Error('REQUEST_PROCESSING_LEASE_EXPIRED');
    for (const field of ['request_type', 'creator_id', 'department_id', 'policy_version_id', 'target_asset_id', 'reason', 'requested_parameters'] as const) {
      if (!isDeepStrictEqual(current[field], job[field])) throw new Error('REQUEST_PROCESSING_INPUT_CHANGED');
    }
  }

  private async readPolicy(client: PoolClient, job: Job) {
    // Submitted requests keep their immutable version through publication and deactivation.
    const policy = (await client.query<{ configuration: Record<string, unknown> }>(`SELECT pv.configuration
      FROM policy_versions pv WHERE pv.id=$1 AND pv.effective_from<=NOW()`, [job.policy_version_id])).rows[0];
    if (!policy) throw new Error('POLICY_NOT_FOUND');
    return policy.configuration;
  }

  private async readInputs(client: PoolClient, job: Job): Promise<PreparedOperation> {
    const { scope: providerScope } = cryptoProviderConfig();
    const configuration = await this.readPolicy(client, job);
    const target = await this.readTarget(job, client, providerScope);
    if (job.request_type === 'REVOKE') {
      if (Object.keys(normalizeRequestParameters(job.requested_parameters ?? {})).length) throw new Error('REVOKE_PARAMETERS_NOT_ALLOWED');
      return { target, configuration, providerScope };
    }
    const parameters = resolveProvisionParameters(job.requested_parameters ?? {}, configuration,
      target && { assetType: target.asset_type, algorithm: target.algorithm, keySize: target.key_size, usage: target.usage });
    return { target, configuration, providerScope, parameters };
  }

  private inputDigest(job: Job, prepared: PreparedOperation, legacy = false) {
    return createHash('sha256').update(JSON.stringify({
      request: job.id, type: job.request_type, owner: job.creator_id, department: job.department_id,
      policy: job.policy_version_id, reason: job.reason, inputs: job.requested_parameters,
      configuration: prepared.configuration, target: prepared.target && this.targetSnapshot(prepared.target, !legacy),
      mode: cryptoProviderMode(), endpoint: process.env.CRYPTO_PROVIDER_URL ?? null,
      ...(!legacy && { providerScope: prepared.providerScope }),
    })).digest('hex');
  }

  private async prepareProviderCall(job: Job) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertRequestState(client, job);
      const prepared = await this.readInputs(client, job);
      await this.markProviderSent(job, client, this.inputDigest(job, prepared));
      await client.query('COMMIT');
      return prepared;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async assertFinalState(client: PoolClient, job: Job, { configuration, target, providerScope }: PreparedOperation) {
    // Request -> policy -> asset -> operation; no row locks are held across the external call.
    await this.assertRequestState(client, job);
    if (!isDeepStrictEqual(await this.readPolicy(client, job), configuration)) throw new Error('POLICY_CONFIGURATION_CHANGED');
    const lockedTarget = await this.readTarget(job, client, providerScope);
    if (target && (!lockedTarget || !isDeepStrictEqual(this.targetSnapshot(lockedTarget), this.targetSnapshot(target)))) {
      throw new Error('TARGET_ASSET_CHANGED');
    }
  }

  private async callProvider(job: Job, { target, parameters, providerScope }: PreparedOperation): Promise<ProvisionResult> {
    if (job.request_type === 'REVOKE') {
      const reference = target?.provider_reference;
      if (!reference) throw new Error('PROVIDER_REFERENCE_REQUIRED');
      await this.provider.revoke(reference, job.id);
      return { providerReference: reference, providerScope };
    }
    if (!parameters) throw new Error('PROVISION_PARAMETERS_REQUIRED');
    const result = await this.provider.provision({
      ...parameters,
      purpose: job.reason,
      replacesProviderReference: target?.provider_reference ?? null,
      operationId: job.id,
    });
    return { ...result, providerScope };
  }

  private async complete(client: PoolClient, job: Job, { target, parameters, providerScope }: PreparedOperation, result: ProvisionResult) {
    let assetId: string;
    let action: string;
    if (job.request_type === 'REVOKE') {
      if (!target || target.provider_reference !== result.providerReference) throw new Error('PROVIDER_REFERENCE_MISMATCH');
      assetId = target.id;
      action = 'ASSET_REVOKED';
      await client.query(`UPDATE crypto_assets SET status='REVOKED',version=version+1 WHERE id=$1`, [assetId]);
      await this.notifications.enqueueAsset(client, assetId, 'ASSET_REVOKED', job.id);
    } else {
      if (!parameters) throw new Error('PROVISION_PARAMETERS_REQUIRED');
      const { assetType, validityDays } = parameters;
      if (providerScope !== 'MOCK' && (!result.validFrom || !result.expiresAt)) throw new Error('CRYPTO_PROVIDER_RESPONSE_INVALID');
      assetId = randomUUID();
      action = job.request_type === 'RENEW' ? 'ASSET_RENEWED' : 'ASSET_CREATED';
      const code = `${assetType === 'KEY' ? 'KEY' : 'CRT'}-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
      await client.query(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at,replaces_asset_id,provider_reference,provider_scope)
        SELECT $1,$2,$3,$4,$5,$6,$7,
          CASE WHEN COALESCE($13::timestamptz,sent_at+make_interval(days=>$8::int))<=NOW() THEN 'EXPIRED' ELSE 'ACTIVE' END,
          COALESCE($12::timestamptz,sent_at),COALESCE($13::timestamptz,sent_at+make_interval(days=>$8::int)),$9,$10,$14
        FROM provider_operations WHERE request_id=$11`,
        [assetId, code, assetType, job.creator_id, job.department_id, job.policy_version_id, job.reason, validityDays,
          job.target_asset_id, result.providerReference, job.id, result.validFrom ?? null, result.expiresAt ?? null, providerScope]);
      if (assetType === 'KEY') {
        await client.query(`INSERT INTO cryptographic_keys(asset_id,algorithm,key_size,usage,public_key_fingerprint)
          VALUES($1,$2,$3,$4,$5)`, [assetId, result.algorithm, result.keySize, result.usage, result.publicKeyFingerprint]);
      } else {
        await client.query(`INSERT INTO certificates(asset_id,serial_number,subject_dn,issuer_dn,fingerprint)
          VALUES($1,$2,$3,$4,$5)`, [assetId, result.serialNumber, result.subjectDn, result.issuerDn, result.fingerprint]);
      }
      if (job.request_type === 'RENEW' && job.target_asset_id) {
        await client.query(`UPDATE crypto_assets SET status='SUPERSEDED',version=version+1 WHERE id=$1`, [job.target_asset_id]);
      }
    }
    const completed = await client.query(`UPDATE requests SET status='COMPLETED',result_asset_id=$2,completed_at=NOW(),version=version+1
      WHERE id=$1 AND status=$3 AND version=$4 RETURNING id`, [job.id, assetId, job.status, job.version]);
    if (!completed.rowCount) throw new Error('REQUEST_PROCESSING_LEASE_LOST');
    await client.query(`UPDATE provider_operations SET status='COMPLETED',failure_class=NULL,updated_at=NOW() WHERE request_id=$1`, [job.id]);
    await this.audit(client, job.id, assetId, action, { provider: cryptoProviderMode() });
    await this.notifications.enqueueExecutionResult(client, job.id, 'REQUEST_COMPLETED');
  }

  async recover(user: AuthUser, requestId: string, expectedVersion: number, action: 'RETRY' | 'ABANDON' | 'CONFIRM', reason: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = (await client.query(`SELECT u.status,u.token_version,d.is_active,EXISTS(
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='ADMIN'
      ) AS is_admin FROM users u JOIN departments d ON d.id=u.department_id WHERE u.id=$1 FOR SHARE OF u,d`, [user.id])).rows[0];
      if (!actor?.is_admin || !actor.is_active || actor.status !== 'ACTIVE' || actor.token_version !== user.tokenVersion) {
        throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi.' });
      }
      const job = (await client.query<Job>('SELECT * FROM requests WHERE id=$1 FOR UPDATE', [requestId])).rows[0];
      if (!job) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Không tìm thấy yêu cầu.' });
      if (job.status !== 'RECONCILIATION_REQUIRED' || job.version !== expectedVersion || job.result_asset_id !== null) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Yêu cầu đã thay đổi. Hãy tải lại trước khi thao tác.' });
      }
      const operation = await this.lockOperation(client, requestId);
      const auditActor = { id: user.id, reason };
      const blocked = () => new ConflictException({ code: 'RECOVERY_UNVERIFIED', message: 'Chưa có bằng chứng phù hợp để thực hiện thao tác này.' });
      if (!operation || operation.status !== 'RECONCILIATION_REQUIRED') throw blocked();
      const unsent = operation.claim_version !== null && operation.attempt_count === 0 && operation.provider_reference === null &&
        (operation.failure_class === 'UNSENT_TRANSIENT' || operation.failure_class === 'UNSENT_PERMANENT');
      let status: string;
      if (action === 'RETRY') {
        if (!unsent || operation.failure_class !== 'UNSENT_TRANSIENT' || operation.retry_count >= maximumRecoveryRetries) throw blocked();
        await this.scheduleRetry(client, requestId, 60, operation.retry_count, operation.last_error_code ?? 'STALE_PROCESSING', auditActor);
        status = 'APPROVED';
      } else if (action === 'ABANDON') {
        if (!unsent) throw blocked();
        await client.query(`UPDATE requests SET status='FAILED',version=version+1 WHERE id=$1`, [requestId]);
        await client.query(`UPDATE provider_operations SET status='FAILED',updated_at=NOW() WHERE request_id=$1`, [requestId]);
        await this.recoveryAudit(client, requestId, 'PROVIDER_REQUEST_ABANDONED', { classification: operation.failure_class }, auditActor);
        await this.notifications.enqueueExecutionResult(client, requestId, 'REQUEST_FAILED');
        status = 'FAILED';
      } else {
        if (!operation.receipt || !operation.input_digest || operation.failure_class !== 'RESULT_RECORDED') throw blocked();
        let prepared: PreparedOperation;
        try { prepared = await this.readInputs(client, job); }
        catch (error) {
          // Provider inputs can drift after an externally successful operation.
          if (error instanceof Error && !('code' in error)) throw blocked();
          throw error;
        }
        const legacy = operation.receipt.providerScope === undefined;
        if ((operation.receipt.providerScope ?? 'MOCK') !== prepared.providerScope ||
            operation.input_digest !== this.inputDigest(job, prepared, legacy)) throw blocked();
        await this.complete(client, job, prepared, operation.receipt);
        await this.recoveryAudit(client, requestId, 'PROVIDER_RESULT_CONFIRMED', {}, auditActor);
        status = 'COMPLETED';
      }
      await client.query('COMMIT');
      return { id: requestId, status, version: expectedVersion + 1 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private audit(client: PoolClient, requestId: string, assetId: string, action: string, metadata: Record<string, unknown>) {
    return client.query(`INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,outcome,request_id,metadata)
      VALUES('SYSTEM',$1,'CRYPTO_ASSET',$2,'SUCCESS',$3,$4::jsonb)`, [action, assetId, requestId, JSON.stringify(auditMetadata(metadata))]);
  }
}
