import { createHash } from 'node:crypto';

export function cryptoProviderMode(env = process.env): 'MOCK' | 'HTTP' {
  const mode = env.CRYPTO_PROVIDER_MODE ?? 'MOCK';
  if (mode !== 'MOCK' && mode !== 'HTTP') throw new Error('CRYPTO_PROVIDER_MODE_INVALID');
  return mode;
}

export function cryptoProviderConfig(env = process.env) {
  if (cryptoProviderMode(env) === 'MOCK') return { mode: 'MOCK', scope: 'MOCK' } as const;
  if (!env.CRYPTO_PROVIDER_URL) throw new Error('CRYPTO_PROVIDER_URL_REQUIRED');
  let url: URL;
  try { url = new URL(env.CRYPTO_PROVIDER_URL); }
  catch { throw new Error('CRYPTO_PROVIDER_URL_INVALID'); }
  if (url.username || url.password || url.href.includes('?') || url.href.includes('#')) throw new Error('CRYPTO_PROVIDER_URL_INVALID');
  const loopback = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && env.NODE_ENV !== 'production')) throw new Error('CRYPTO_PROVIDER_HTTPS_REQUIRED');
  const token = env.CRYPTO_PROVIDER_TOKEN;
  if (!token || token.length > 8192 || !/^[\x21-\x7e]+$/.test(token)) throw new Error('CRYPTO_PROVIDER_TOKEN_INVALID');
  const account = env.CRYPTO_PROVIDER_SCOPE;
  if (!account || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$/.test(account)) throw new Error('CRYPTO_PROVIDER_SCOPE_INVALID');
  const timeout = env.CRYPTO_PROVIDER_TIMEOUT_MS ?? '15000';
  const timeoutMs = Number(timeout);
  if (!/^\d{1,6}$/.test(timeout) || timeoutMs < 100 || timeoutMs > 120_000) throw new Error('CRYPTO_PROVIDER_TIMEOUT_INVALID');
  const baseUrl = url.href.replace(/\/+$/, '');
  const scope = createHash('sha256').update(JSON.stringify([baseUrl, account])).digest('hex');
  return { mode: 'HTTP', scope, baseUrl, token, timeoutMs } as const;
}

export type HttpProviderConfig = Extract<ReturnType<typeof cryptoProviderConfig>, { mode: 'HTTP' }>;
