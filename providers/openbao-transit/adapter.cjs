const { createHash, createPublicKey } = require('node:crypto');

const dayMs = 86_400_000;
const keys = new Map([
  ['RSA:2048', 'rsa-2048'], ['RSA:3072', 'rsa-3072'], ['RSA:4096', 'rsa-4096'],
  ['ECDSA:256', 'ecdsa-p256'], ['ECDSA:384', 'ecdsa-p384'], ['ECDSA:521', 'ecdsa-p521'],
]);
const operationPattern = /^[a-zA-Z0-9_.-]{1,128}$/;
const referencePattern = /^crypta-[a-f0-9]{64}$/;
const pemPattern = /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/;
const curves = { prime256v1: 256, secp384r1: 384, secp521r1: 521 };
const hash = value => createHash('sha256').update(value).digest('hex');

class AdapterError extends Error {
  constructor(code, status, upstreamStatus) {
    super(code);
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

function requireOperation(value) {
  if (typeof value !== 'string' || !operationPattern.test(value)) throw new AdapterError('OPERATION_ID_INVALID', 400);
}

function requireReference(value) {
  if (typeof value !== 'string' || !referencePattern.test(value)) throw new AdapterError('PROVIDER_REFERENCE_INVALID', 400);
}

function provisionInput(input) {
  const { operationId, assetType, algorithm, keySize, usage, purpose, validityDays, replacesProviderReference } = input;
  requireOperation(operationId);
  if (assetType !== 'KEY' || usage !== 'SIGNING' || !Number.isInteger(keySize) || !keys.has(`${algorithm}:${keySize}`)) {
    throw new AdapterError('OPENBAO_CAPABILITY_UNSUPPORTED', 422);
  }
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650 ||
      typeof purpose !== 'string' || !purpose.trim() || purpose.length > 500) throw new AdapterError('KEY_POLICY_INVALID', 400);
  if (replacesProviderReference != null) requireReference(replacesProviderReference);
  return { operationId, algorithm, keySize, usage, validityDays, replacesProviderReference,
    requestDigest: hash(JSON.stringify([assetType, algorithm, keySize, usage, purpose, validityDays, replacesProviderReference ?? null])) };
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AdapterError('OPENBAO_RESPONSE_INVALID', 502);
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 65536) {
        void reader.cancel().catch(() => undefined);
        throw new AdapterError('OPENBAO_RESPONSE_INVALID', 502);
      }
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError('OPENBAO_RESPONSE_INVALID', 502);
  } finally { reader.releaseLock(); }
}

class OpenBaoTransitAdapter {
  constructor({ origin, token, transitMount, journalMount, namespace, timeoutMs = 5000 }) {
    const base = new URL(origin);
    if (base.pathname !== '/' || base.username || base.password || base.search || base.hash ||
        (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1'))) {
      throw new Error('OPENBAO_ORIGIN_INVALID');
    }
    if (typeof token !== 'string' || !/^[!-~]{20,1024}$/.test(token) ||
        ![transitMount, journalMount, namespace].every(value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) ||
        transitMount === journalMount || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new Error('OPENBAO_CONFIG_INVALID');
    }
    this.origin = base.origin;
    this.token = token;
    this.transit = '/v1/' + transitMount + '/keys/';
    this.journal = '/v1/' + journalMount + '/data/' + namespace + '/';
    this.namespace = namespace;
    this.timeoutMs = timeoutMs;
  }

  async provision(input) {
    const { operationId, algorithm, keySize, usage, validityDays, replacesProviderReference, requestDigest } = provisionInput(input);
    const providerReference = 'crypta-' + this.operationKey(operationId);
    if (providerReference === replacesProviderReference) throw new AdapterError('RENEWAL_REFERENCE_REUSED', 409);
    if (replacesProviderReference) {
      const predecessor = await this.readJournal(this.operationPathForReference(replacesProviderReference));
      if (predecessor?.action !== 'PROVISION') throw new AdapterError('PREDECESSOR_UNKNOWN', 404);
    }
    const now = Date.now();
    const data = await this.reserve(this.operationPath(operationId), {
      action: 'PROVISION', operationId, providerReference, algorithm, keySize, usage, requestDigest,
      validFrom: new Date(now).toISOString(), expiresAt: new Date(now + validityDays * dayMs).toISOString(),
    });
    if (Date.parse(data.expiresAt) <= Date.now()) throw new AdapterError('OPENBAO_KEY_EXPIRED', 409);
    const type = keys.get(`${algorithm}:${keySize}`);
    await this.call('POST', this.transit + providerReference, { type, exportable: false, allow_plaintext_backup: false }, [200, 204]);
    const receipt = await this.receipt(data);
    if (receipt.status !== 'ACTIVE') throw new AdapterError('OPENBAO_KEY_INACTIVE', 409);
    return receipt;
  }

  async revoke({ operationId, providerReference }) {
    requireOperation(operationId);
    requireReference(providerReference);
    const key = await this.readJournal(this.operationPathForReference(providerReference));
    if (key?.action !== 'PROVISION') throw new AdapterError('PROVIDER_REFERENCE_UNKNOWN', 404);
    await this.reserve(this.operationPath(operationId), {
      action: 'REVOKE', operationId, requestDigest: hash(providerReference), providerReference,
    });
    await this.call('DELETE', this.transit + providerReference + '/soft-delete', undefined, [200, 204]);
    return this.revocationReceipt(operationId, providerReference);
  }

  async lookup(operationId) {
    requireOperation(operationId);
    const record = await this.readJournal(this.operationPath(operationId));
    if (!record) throw new AdapterError('OPERATION_NOT_FOUND', 404);
    if (record.action === 'REVOKE') return this.revocationReceipt(operationId, record.providerReference);
    return this.receipt(record);
  }

  async revocationReceipt(operationId, providerReference) {
    requireReference(providerReference);
    const upstream = await this.keyState(providerReference);
    if (upstream.soft_deleted !== true) throw new AdapterError('OPENBAO_REVOCATION_UNCONFIRMED', 502);
    return { operationId, providerReference, revoked: true };
  }

  async receipt(record) {
    const { operationId, providerReference, algorithm, keySize, usage, validFrom, expiresAt } = record;
    requireOperation(operationId);
    requireReference(providerReference);
    const started = Date.parse(validFrom), expires = Date.parse(expiresAt);
    if (!Number.isFinite(started) || !Number.isFinite(expires) || started >= expires || usage !== 'SIGNING') {
      throw new AdapterError('OPENBAO_JOURNAL_INVALID', 502);
    }
    const upstream = await this.keyState(providerReference);
    if (upstream.type !== keys.get(`${algorithm}:${keySize}`) || upstream.latest_version !== 1 ||
        upstream.exportable !== false || upstream.allow_plaintext_backup !== false || upstream.supports_signing !== true ||
        typeof upstream.soft_deleted !== 'boolean') throw new AdapterError('OPENBAO_KEY_METADATA_INVALID', 502);
    const pem = upstream.keys?.['1']?.public_key;
    if (typeof pem !== 'string' || pem.length > 8192 || !pemPattern.test(pem)) throw new AdapterError('OPENBAO_PUBLIC_KEY_INVALID', 502);
    let key;
    try { key = createPublicKey(pem); }
    catch { throw new AdapterError('OPENBAO_PUBLIC_KEY_INVALID', 502); }
    const actualSize = algorithm === 'RSA' && key.asymmetricKeyType === 'rsa' ? key.asymmetricKeyDetails?.modulusLength
      : algorithm === 'ECDSA' && key.asymmetricKeyType === 'ec' ? curves[key.asymmetricKeyDetails?.namedCurve] : undefined;
    if (actualSize !== keySize) throw new AdapterError('OPENBAO_PUBLIC_KEY_INVALID', 502);
    const status = upstream.soft_deleted ? 'REVOKED' : expires <= Date.now() ? 'EXPIRED' : 'ACTIVE';
    return { operationId, providerReference, assetType: 'KEY', status, algorithm, keySize, usage, validFrom, expiresAt,
      publicKeyFingerprint: 'SHA256:' + hash(key.export({ type: 'spki', format: 'der' })) };
  }

  operationKey(operationId) { return hash(JSON.stringify([this.namespace, operationId])); }
  operationPath(operationId) { return 'operations/' + this.operationKey(operationId); }
  operationPathForReference(reference) { return 'operations/' + reference.slice('crypta-'.length); }

  async keyState(reference) {
    const { data } = await this.call('GET', this.transit + reference, undefined, [200]);
    if (!data || data.name !== reference) throw new AdapterError('OPENBAO_KEY_METADATA_INVALID', 502);
    return data;
  }

  async reserve(path, data) {
    let record = await this.readJournal(path);
    if (!record) {
      try {
        await this.call('POST', this.journal + path, { options: { cas: 0 }, data }, [200, 204]);
        record = data;
      } catch (error) {
        if (!(error instanceof AdapterError) || ![400, 403].includes(error.upstreamStatus)) throw error;
        record = await this.readJournal(path);
        if (!record) throw error;
      }
    }
    if (record.action !== data.action || record.requestDigest !== data.requestDigest) throw new AdapterError('OPERATION_ID_REUSED', 409);
    return record;
  }

  async readJournal(path) {
    const response = await this.call('GET', this.journal + path, undefined, [200, 404]);
    if (response === null) return undefined;
    const record = response.data?.data;
    if (!record || !['PROVISION', 'REVOKE'].includes(record.action) || !/^[a-f0-9]{64}$/.test(record.requestDigest)) {
      throw new AdapterError('OPENBAO_JOURNAL_INVALID', 502);
    }
    return record;
  }

  async call(method, pathname, body, expected) {
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const response = await fetch(this.origin + pathname, { method, redirect: 'error', signal,
        headers: { 'X-Vault-Token': this.token, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      if (!expected.includes(response.status)) {
        void response.body?.cancel().catch(() => undefined);
        const status = response.status === 400 ? 400 : 502;
        throw new AdapterError('OPENBAO_UPSTREAM_REJECTED', status, response.status);
      }
      if (response.status === 204 || response.status === 404) {
        void response.body?.cancel().catch(() => undefined);
        return null;
      }
      return await readJson(response);
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError(signal.aborted ? 'OPENBAO_TIMEOUT' : 'OPENBAO_TRANSPORT_FAILED', 503);
    }
  }
}

module.exports = { AdapterError, OpenBaoTransitAdapter };
