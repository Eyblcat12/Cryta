import { afterEach, describe, expect, it } from 'vitest';
import { CryptoProviderService } from '../src/jobs/crypto-provider.service';

const previousMode = process.env.CRYPTO_PROVIDER_MODE;
const previousNodeEnv = process.env.NODE_ENV;
const previousUrl = process.env.CRYPTO_PROVIDER_URL;

afterEach(() => {
  if (previousMode === undefined) delete process.env.CRYPTO_PROVIDER_MODE; else process.env.CRYPTO_PROVIDER_MODE = previousMode;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
  if (previousUrl === undefined) delete process.env.CRYPTO_PROVIDER_URL; else process.env.CRYPTO_PROVIDER_URL = previousUrl;
});

describe('crypto provider adapter', () => {
  it('returns key metadata without private key material in mock mode', async () => {
    process.env.CRYPTO_PROVIDER_MODE = 'MOCK';
    const result = await new CryptoProviderService().provision({ assetType: 'KEY', algorithm: 'RSA', keySize: 3072, usage: 'SIGNING', purpose: 'test', validityDays: 90 });
    expect(result).toMatchObject({ algorithm: 'RSA', keySize: 3072, usage: 'SIGNING' });
    expect(result.providerReference).toMatch(/^mock-key-/);
    expect(result.publicKeyFingerprint).toMatch(/^SHA256:/);
    expect(result).not.toHaveProperty('privateKey');
  });

  it('returns certificate metadata in mock mode', async () => {
    process.env.CRYPTO_PROVIDER_MODE = 'MOCK';
    const result = await new CryptoProviderService().provision({ assetType: 'CERTIFICATE', purpose: 'test', validityDays: 365 });
    expect(result.providerReference).toMatch(/^mock-cert-/);
    expect(result).toMatchObject({ issuerDn: 'CN=Crypta Mock CA' });
    expect(result.fingerprint).toMatch(/^SHA256:/);
  });

  it('rejects an insecure provider URL in production', async () => {
    process.env.CRYPTO_PROVIDER_MODE = 'HTTP';
    process.env.NODE_ENV = 'production';
    process.env.CRYPTO_PROVIDER_URL = 'http://kms.internal';
    await expect(new CryptoProviderService().provision({ assetType: 'KEY', purpose: 'test', validityDays: 30 })).rejects.toThrow('CRYPTO_PROVIDER_HTTPS_REQUIRED');
  });
});
