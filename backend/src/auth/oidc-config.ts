import { timingSafeEqual } from 'node:crypto';

export type OidcConfig = {
  issuer: URL;
  appOrigin: string;
  callback: URL;
  clientId: string;
  clientSecret: string;
  storageKey: Buffer;
  testHttp: boolean;
};

function configuredUrl(value: string | undefined, key: string) {
  try {
    if (!value || value !== value.trim()) throw new Error();
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !url.hostname) throw new Error();
    return url;
  } catch { throw new Error(`OIDC_${key}_INVALID`); }
}

export function oidcConfiguration(env: NodeJS.ProcessEnv = process.env): OidcConfig | undefined {
  if (env.OIDC_ENABLED === undefined || env.OIDC_ENABLED === 'false') return undefined;
  if (env.OIDC_ENABLED !== 'true') throw new Error('OIDC_ENABLED_INVALID');
  if (env.MFA_REQUIRED !== 'true') throw new Error('OIDC_REQUIRES_MFA');
  const issuer = configuredUrl(env.OIDC_ISSUER, 'ISSUER');
  const app = configuredUrl(env.APP_URL, 'APP_URL');
  if (issuer.href.length > 1024 || issuer.pathname === '/' || issuer.pathname.endsWith('/') || app.pathname !== '/') throw new Error('OIDC_URL_PATH_INVALID');
  const testHttp = env.OIDC_TEST_HTTP === 'true';
  if (testHttp) {
    if (env.CRYPTA_DEPLOYMENT_MODE === 'production' || issuer.protocol !== 'http:' || issuer.hostname !== 'oidc.crypta.test' ||
        issuer.pathname !== '/realms/crypta-oidc-test' || !issuer.port || app.protocol !== 'http:' || app.hostname !== 'app.crypta.test' || !app.port) {
      throw new Error('OIDC_TEST_HTTP_NOT_ISOLATED');
    }
  } else if (issuer.protocol !== 'https:' || app.protocol !== 'https:') {
    throw new Error('OIDC_HTTPS_REQUIRED');
  } else if (env.COOKIE_SECURE !== 'true') {
    throw new Error('OIDC_SECURE_COOKIE_REQUIRED');
  }
  const clientId = env.OIDC_CLIENT_ID;
  if (!clientId || clientId.length > 100 || !/^[A-Za-z0-9._-]+$/.test(clientId)) throw new Error('OIDC_CLIENT_ID_INVALID');
  const clientSecret = env.OIDC_CLIENT_SECRET;
  if (!clientSecret || clientSecret.length < 32 || clientSecret.length > 512 || !/^[!-~]+$/.test(clientSecret)) throw new Error('OIDC_CLIENT_SECRET_INVALID');
  const value = env.OIDC_STORAGE_KEY;
  if (!value || value.length !== 64 || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('OIDC_STORAGE_KEY_INVALID');
  const storageKey = Buffer.from(value, 'hex');
  for (const other of [env.JWT_ACCESS_SECRET, env.MFA_ENCRYPTION_KEY, env.ACCOUNT_ACTION_KEY, clientSecret]) {
    if (other?.length === 64 && /^[a-f0-9]+$/i.test(other) && timingSafeEqual(storageKey, Buffer.from(other, 'hex'))) {
      storageKey.fill(0);
      throw new Error('OIDC_STORAGE_KEY_MUST_DIFFER');
    }
  }
  return { issuer, appOrigin: app.origin, callback: new URL('/api/v1/auth/oidc/callback', app), clientId, clientSecret, storageKey, testHttp };
}
