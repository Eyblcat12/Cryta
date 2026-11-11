import { Injectable } from '@nestjs/common';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { cryptoProviderConfig, type HttpProviderConfig } from './crypto-provider-config';

export type ProvisionInput = {
  assetType: 'KEY' | 'CERTIFICATE'; algorithm?: string; keySize?: number; usage?: string;
  purpose: string; validityDays: number; replacesProviderReference?: string | null;
  operationId?: string;
};
export type ProvisionResult = {
  providerReference: string; algorithm?: string; keySize?: number; usage?: string;
  publicKeyFingerprint?: string; serialNumber?: string; subjectDn?: string;
  issuerDn?: string; fingerprint?: string; validFrom?: string; expiresAt?: string; providerScope?: string;
};

const maxResponseBytes = 64 * 1024;
const dayMs = 86_400_000;
const ecBits: Readonly<Record<string, number>> = { prime256v1: 256, secp384r1: 384, secp521r1: 521 };

class ProviderResponseError extends Error {}
function invalidResponse(): never { throw new ProviderResponseError('CRYPTO_PROVIDER_RESPONSE_INVALID'); }

function responseObject(raw: unknown, operationId: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidResponse();
  const data = raw as Record<string, unknown>;
  if (data.operationId !== operationId) invalidResponse();
  return data;
}

function requiredText(value: unknown, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || value.includes('\0')) invalidResponse();
  return value.trim();
}

function parseUtc(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) invalidResponse();
  const date = new Date(value);
  const normalized = value.length === 20 ? value.replace(/Z$/, '.000Z') : value;
  if (!Number.isFinite(+date) || date.toISOString() !== normalized) invalidResponse();
  return date;
}

function validateValidity(validFrom: Date, expiresAt: Date, validityDays: number) {
  const now = Date.now();
  const duration = +expiresAt - +validFrom;
  if (!Number.isInteger(validityDays) || validityDays < 1 || !Number.isFinite(duration) ||
      +validFrom > now || +expiresAt <= now || duration <= 0 || duration > validityDays * dayMs) invalidResponse();
  return { validFrom: validFrom.toISOString(), expiresAt: expiresAt.toISOString() };
}

function validateKey(algorithm: string, keySize: unknown, input: ProvisionInput): asserts keySize is number {
  if (typeof keySize !== 'number' || !Number.isInteger(keySize) || (input.algorithm && algorithm !== input.algorithm) ||
      (input.keySize !== undefined && keySize !== input.keySize)) invalidResponse();
  const allowed = algorithm === 'RSA' ? keySize >= 2048 && keySize <= 16384
    : algorithm === 'ECDSA' ? [256, 384, 521].includes(keySize)
      : algorithm === 'ED25519' ? keySize === 256 : algorithm === 'AES' && [128, 192, 256].includes(keySize);
  if (!allowed) invalidResponse();
}

@Injectable()
export class CryptoProviderService {
  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    const config = cryptoProviderConfig();
    if (config.mode === 'HTTP') {
      const operationId = this.operationId(input.operationId);
      const raw = await this.call(config, '/assets', input, operationId);
      return this.validateProvisionResult(raw, input, operationId);
    }
    // A repeated mock request returns the same external reference.
    const id = input.operationId ?? randomUUID();
    const fingerprint = createHash('sha256').update(id).digest('hex');
    return input.assetType === 'KEY'
      ? { providerReference: `mock-key-${id}`, algorithm: input.algorithm ?? 'RSA', keySize: input.keySize ?? 2048, usage: input.usage ?? 'SIGNING', publicKeyFingerprint: `SHA256:${fingerprint}` }
      : { providerReference: `mock-cert-${id}`, serialNumber: id.replace(/-/g, '').slice(0, 20).toUpperCase(), subjectDn: `CN=${id}.crypta.local`, issuerDn: 'CN=Crypta Mock CA', fingerprint: `SHA256:${fingerprint}` };
  }

  async revoke(providerReference: string | null, operationId?: string) {
    if (!providerReference) throw new Error('PROVIDER_REFERENCE_REQUIRED');
    const config = cryptoProviderConfig();
    if (config.mode === 'HTTP') {
      const id = this.operationId(operationId);
      const result = responseObject(await this.call(config, '/assets/revoke', { providerReference, operationId: id }, id), id);
      if (result.revoked !== true || result.providerReference !== providerReference) invalidResponse();
    }
    return { revoked: true };
  }

  private operationId(id: string | undefined) {
    if (!id || !/^[a-zA-Z0-9_.-]{1,128}$/.test(id)) throw new Error('CRYPTO_PROVIDER_OPERATION_ID_INVALID');
    return id;
  }

  private validateProvisionResult(raw: unknown, input: ProvisionInput, operationId: string): ProvisionResult {
    const data = responseObject(raw, operationId);
    const providerReference = requiredText(data.providerReference, 255);
    if (providerReference !== data.providerReference || !/^[\x21-\x7e]+$/.test(providerReference) ||
        providerReference === input.replacesProviderReference || data.status !== 'ACTIVE' || data.assetType !== input.assetType) invalidResponse();
    if (input.assetType === 'CERTIFICATE') return { providerReference, ...this.certificate(data.certificatePem, input) };
    const algorithm = requiredText(data.algorithm, 50);
    const keySize = data.keySize;
    validateKey(algorithm, keySize, input);
    const usage = requiredText(data.usage, 100);
    if (input.usage && usage !== input.usage) invalidResponse();
    const publicKeyFingerprint = requiredText(data.publicKeyFingerprint, 255);
    if (!/^SHA256:[a-f0-9]{64}$/i.test(publicKeyFingerprint)) invalidResponse();
    return { providerReference, algorithm, keySize, usage, publicKeyFingerprint,
      ...validateValidity(parseUtc(data.validFrom), parseUtc(data.expiresAt), input.validityDays) };
  }

  private certificate(value: unknown, input: ProvisionInput) {
    const pem = requiredText(value, 16 * 1024);
    if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----$/.test(pem)) invalidResponse();
    let cert: X509Certificate;
    try { cert = new X509Certificate(pem); }
    catch { invalidResponse(); }
    const { asymmetricKeyType, asymmetricKeyDetails } = cert.publicKey;
    switch (asymmetricKeyType) {
      case 'rsa': validateKey('RSA', asymmetricKeyDetails?.modulusLength, input); break;
      case 'ec': validateKey('ECDSA', ecBits[asymmetricKeyDetails?.namedCurve ?? ''], input); break;
      case 'ed25519': validateKey('ED25519', 256, input); break;
      default: invalidResponse();
    }
    if (cert.ca || !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.1')) invalidResponse();
    return {
      serialNumber: requiredText(cert.serialNumber, 100), subjectDn: requiredText(cert.subject, 500),
      issuerDn: requiredText(cert.issuer, 500), fingerprint: `SHA256:${cert.fingerprint256.replaceAll(':', '').toLowerCase()}`,
      ...validateValidity(cert.validFromDate, cert.validToDate, input.validityDays),
    };
  }

  private async call(config: HttpProviderConfig, path: string, payload: object, operationId: string): Promise<unknown> {
    const signal = AbortSignal.timeout(config.timeoutMs);
    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST', body: JSON.stringify(payload), redirect: 'error', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}`, 'idempotency-key': operationId },
      });
      if (response.status !== 200 && response.status !== 201) {
        void response.body?.cancel().catch(() => {});
        if (response.status >= 400 && response.status <= 599) throw new ProviderResponseError(`CRYPTO_PROVIDER_HTTP_${response.status}`);
        invalidResponse();
      }
      return await this.readJson(response);
    } catch (error) {
      if (error instanceof ProviderResponseError) throw error;
      throw new Error(signal.aborted ? 'CRYPTO_PROVIDER_TIMEOUT' : 'CRYPTO_PROVIDER_TRANSPORT_FAILED');
    }
  }

  private async readJson(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) invalidResponse();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxResponseBytes) {
          void reader.cancel().catch(() => {});
          invalidResponse();
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
    catch { invalidResponse(); }
  }
}
