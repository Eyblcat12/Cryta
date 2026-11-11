import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cryptoProviderConfig } from '../src/jobs/crypto-provider-config';
import { CryptoProviderService, type ProvisionInput } from '../src/jobs/crypto-provider.service';

const input: ProvisionInput = {
  assetType: 'KEY', algorithm: 'RSA', keySize: 2048, usage: 'SIGNING', purpose: 'test', validityDays: 30, operationId: 'request-123',
};
const httpEnvironment = {
  CRYPTO_PROVIDER_MODE: 'HTTP', CRYPTO_PROVIDER_URL: 'https://provider.example.test',
  CRYPTO_PROVIDER_TOKEN: 'fixture-token', CRYPTO_PROVIDER_SCOPE: 'sandbox-1',
};
const keyResponse = {
  operationId: input.operationId, assetType: 'KEY', status: 'ACTIVE', providerReference: 'ref-1',
  algorithm: 'RSA', keySize: 2048, usage: 'SIGNING', publicKeyFingerprint: `SHA256:${'a'.repeat(64)}`,
  validFrom: '2026-10-31T00:00:00Z', expiresAt: '2026-11-21T00:00:00Z',
};
const certificatePem = readFileSync(new URL('./fixtures/provider-tls-test.pem', import.meta.url), 'utf8');
const certificate = new X509Certificate(certificatePem);

function configureHttp() {
  for (const [key, value] of Object.entries(httpEnvironment)) vi.stubEnv(key, value);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T00:00:00Z'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('crypto provider adapter', () => {
  it('returns key metadata without private key material in mock mode', async () => {
    vi.stubEnv('CRYPTO_PROVIDER_MODE', 'MOCK');
    const result = await new CryptoProviderService().provision({ ...input, keySize: 3072 });
    expect(result).toMatchObject({ algorithm: 'RSA', keySize: 3072, usage: 'SIGNING' });
    expect(result.providerReference).toMatch(/^mock-key-/);
    expect(result.publicKeyFingerprint).toMatch(/^SHA256:/);
    expect(result).not.toHaveProperty('privateKey');
  });

  it('returns deterministic certificate metadata in mock mode', async () => {
    vi.stubEnv('CRYPTO_PROVIDER_MODE', 'MOCK');
    const provider = new CryptoProviderService();
    const requested = { ...input, assetType: 'CERTIFICATE' as const };
    const result = await provider.provision(requested);
    expect(result.providerReference).toMatch(/^mock-cert-/);
    expect(result).toMatchObject({ issuerDn: 'CN=Crypta Mock CA' });
    expect(await provider.provision(requested)).toEqual(result);
  });

  it.each(['http', 'TYPO', ''])('rejects invalid mode %j without returning a mock receipt', async mode => {
    vi.stubEnv('CRYPTO_PROVIDER_MODE', mode);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new CryptoProviderService();
    await expect(provider.provision(input)).rejects.toThrow('CRYPTO_PROVIDER_MODE_INVALID');
    await expect(provider.revoke('ref-1', input.operationId)).rejects.toThrow('CRYPTO_PROVIDER_MODE_INVALID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['CRYPTO_PROVIDER_URL', 'https://user:secret@provider.example.test', 'URL_INVALID'],
    ['CRYPTO_PROVIDER_URL', 'https://provider.example.test?q=secret', 'URL_INVALID'],
    ['CRYPTO_PROVIDER_URL', 'https://provider.example.test?', 'URL_INVALID'],
    ['CRYPTO_PROVIDER_URL', 'http://127.0.0.1', 'HTTPS_REQUIRED'],
    ['CRYPTO_PROVIDER_TOKEN', '', 'TOKEN_INVALID'],
    ['CRYPTO_PROVIDER_TOKEN', 'token\r\nheader', 'TOKEN_INVALID'],
    ['CRYPTO_PROVIDER_SCOPE', '', 'SCOPE_INVALID'],
    ['CRYPTO_PROVIDER_TIMEOUT_MS', '0', 'TIMEOUT_INVALID'],
  ])('rejects unsafe %s before any HTTP call', async (name, value, code) => {
    configureHttp();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(name, value);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new CryptoProviderService().provision(input)).rejects.toThrow(`CRYPTO_PROVIDER_${code}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('binds scope to endpoint and account across credential rotation', () => {
    const first = cryptoProviderConfig(httpEnvironment);
    expect(first.scope).toMatch(/^[a-f0-9]{64}$/);
    expect(cryptoProviderConfig({ ...httpEnvironment, CRYPTO_PROVIDER_TOKEN: 'rotated' }).scope).toBe(first.scope);
    expect(cryptoProviderConfig({ ...httpEnvironment, CRYPTO_PROVIDER_SCOPE: 'sandbox-2' }).scope).not.toBe(first.scope);
    expect(cryptoProviderConfig({ ...httpEnvironment, CRYPTO_PROVIDER_URL: 'https://provider.example.test/other' }).scope).not.toBe(first.scope);
  });

  it('sends the approved operation ID and retains only validated public metadata', async () => {
    configureHttp();
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ ...keyResponse, privateKey: 'discarded fixture' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new CryptoProviderService().provision(input);
    expect(result).toMatchObject({ providerReference: 'ref-1', validFrom: '2026-10-31T00:00:00.000Z', expiresAt: '2026-11-21T00:00:00.000Z' });
    expect(result).not.toHaveProperty('privateKey');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://provider.example.test/assets');
    expect(new Headers(options.headers).get('idempotency-key')).toBe(input.operationId);
    expect(options.redirect).toBe('error');
  });

  it.each([
    { operationId: 'wrong' }, { assetType: 'CERTIFICATE' }, { status: 'PENDING' }, { providerReference: 'ref with spaces' },
    { algorithm: 'ECDSA' }, { keySize: 4096 }, { usage: 'ENCRYPTION' }, { publicKeyFingerprint: 'SHA256:bad' },
    { validFrom: '2026-02-30T00:00:00Z' }, { validFrom: '2026-11-09T00:00:00Z' },
    { expiresAt: '2026-11-01T00:00:00Z' }, { expiresAt: '2027-01-01T00:00:00Z' },
  ])('rejects mismatched or invalid key metadata %j', async override => {
    configureHttp();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...keyResponse, ...override })));
    await expect(new CryptoProviderService().provision(input)).rejects.toThrow('CRYPTO_PROVIDER_RESPONSE_INVALID');
  });

  it('uses validity and public key parsed from the TLS leaf certificate', async () => {
    configureHttp();
    vi.setSystemTime(+certificate.validFromDate + 86_400_000);
    const payload = { ...keyResponse, assetType: 'CERTIFICATE', certificatePem, privateKey: 'discarded fixture' };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)));
    const provider = new CryptoProviderService();
    const certInput = { ...input, assetType: 'CERTIFICATE' as const, validityDays: 3650 };
    const result = await provider.provision(certInput);
    expect(result).toMatchObject({ serialNumber: certificate.serialNumber, subjectDn: certificate.subject,
      validFrom: certificate.validFromDate.toISOString(), expiresAt: certificate.validToDate.toISOString() });
    expect(result).not.toHaveProperty('certificatePem');
    expect(result).not.toHaveProperty('privateKey');
    await expect(provider.provision({ ...certInput, validityDays: 30 })).rejects.toThrow('CRYPTO_PROVIDER_RESPONSE_INVALID');
    await expect(provider.provision({ ...certInput, keySize: 3072 })).rejects.toThrow('CRYPTO_PROVIDER_RESPONSE_INVALID');
    vi.setSystemTime(+certificate.validToDate);
    await expect(provider.provision(certInput)).rejects.toThrow('CRYPTO_PROVIDER_RESPONSE_INVALID');
  });

  it.each([
    () => Response.json(keyResponse, { status: 202 }),
    () => new Response('x'.repeat(64 * 1024 + 1)),
    () => new Response('not JSON'),
  ])('rejects incomplete or oversized responses', async makeResponse => {
    configureHttp();
    vi.stubGlobal('fetch', vi.fn(async () => makeResponse()));
    await expect(new CryptoProviderService().provision(input)).rejects.toThrow('CRYPTO_PROVIDER_RESPONSE_INVALID');
  });

  it('requires revoke confirmation for the exact operation and provider reference', async () => {
    configureHttp();
    const response = (revoked: boolean, providerReference: string) => Response.json({ revoked, providerReference, operationId: input.operationId });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(false, 'ref-1')).mockResolvedValueOnce(response(true, 'other')).mockResolvedValueOnce(response(true, 'ref-1')));
    const provider = new CryptoProviderService();
    await expect(provider.revoke('ref-1', input.operationId)).rejects.toThrow('CRYPTO_PROVIDER_RESPONSE_INVALID');
    await expect(provider.revoke('ref-1', input.operationId)).rejects.toThrow('CRYPTO_PROVIDER_RESPONSE_INVALID');
    await expect(provider.revoke('ref-1', input.operationId)).resolves.toEqual({ revoked: true });
  });
});
