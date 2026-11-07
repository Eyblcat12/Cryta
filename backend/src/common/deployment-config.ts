import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readAccountActionKey } from '../auth/account-action-token';
import { emailConfiguration } from '../notifications/email-template';

type ProductionSecret = 'DATABASE_URL' | 'JWT_ACCESS_SECRET' | 'CRYPTO_PROVIDER_TOKEN' | 'SMTP_PASSWORD' |
  'ACCOUNT_ACTION_KEY' | 'BOOTSTRAP_ADMIN_PASSWORD' | 'MFA_ENCRYPTION_KEY' | 'OIDC_CLIENT_SECRET' | 'OIDC_STORAGE_KEY';

export function productionSecret(env: NodeJS.ProcessEnv, name: ProductionSecret) {
  if (env[name] !== undefined) throw new Error(`PRODUCTION_${name}_USE_FILE`);
  const path = env[`${name}_FILE`];
  if (!path || !isAbsolute(path)) throw new Error(`PRODUCTION_${name}_FILE_REQUIRED`);
  try {
    const file = statSync(path);
    if (!file.isFile() || file.size > 16_384) throw new Error();
    const value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    if (!value.trim() || /[\r\n]/.test(value) || value.includes(String.fromCharCode(0))) throw new Error();
    return value;
  } catch {
    throw new Error(`PRODUCTION_${name}_FILE_INVALID`);
  }
}

export function assertVerifiedDatabaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
    // pg decodes these fields. Reject malformed escapes before opening a socket.
    for (const field of [url.username, url.password, url.pathname]) decodeURIComponent(field);
  } catch { throw new Error('PRODUCTION_DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname || !url.username || !url.password || url.pathname.length <= 1 ||
      url.pathname.slice(1).includes('/') || url.hash || value !== value.trim()) {
    throw new Error('PRODUCTION_DATABASE_URL_INVALID');
  }
  const parameters = [...url.searchParams.entries()];
  if (parameters.length !== 1 || parameters[0][0] !== 'sslmode' || parameters[0][1] !== 'verify-full') {
    throw new Error('PRODUCTION_DATABASE_VERIFY_FULL_REQUIRED');
  }
}

export function prepareDeploymentEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.CRYPTA_DEPLOYMENT_MODE;
  if (mode === undefined || mode === 'demo') return;
  if (mode !== 'production') throw new Error('CRYPTA_DEPLOYMENT_MODE_INVALID');

  if (env.NODE_ENV !== 'production') throw new Error('PRODUCTION_NODE_ENV_REQUIRED');
  if (env.DATABASE_MIGRATION_MODE !== 'validate') throw new Error('PRODUCTION_DATABASE_VALIDATE_REQUIRED');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('PRODUCTION_TLS_VERIFICATION_REQUIRED');
  const { appUrl } = emailConfiguration(env);
  if (!appUrl.startsWith('https://') || appUrl !== env.CORS_ORIGIN || appUrl !== env.APP_URL || env.COOKIE_SECURE !== 'true') {
    throw new Error('PRODUCTION_HTTPS_ORIGIN_AND_COOKIE_REQUIRED');
  }
  if (env.CRYPTO_PROVIDER_MODE !== 'HTTP' || !env.CRYPTO_PROVIDER_URL?.startsWith('https://')) {
    throw new Error('PRODUCTION_HTTPS_PROVIDER_REQUIRED');
  }
  const smtpHost = env.SMTP_HOST?.trim();
  if (env.SMTP_ENABLED !== 'true' || !smtpHost || !env.SMTP_USER?.trim() || !env.SMTP_FROM?.trim()) {
    throw new Error('PRODUCTION_SMTP_REQUIRED');
  }
  if (env.ACCOUNT_ACTIONS_ENABLED !== 'true') throw new Error('PRODUCTION_ACCOUNT_ACTIONS_REQUIRED');

  const secrets = {
    DATABASE_URL: productionSecret(env, 'DATABASE_URL'),
    JWT_ACCESS_SECRET: productionSecret(env, 'JWT_ACCESS_SECRET'),
    CRYPTO_PROVIDER_TOKEN: productionSecret(env, 'CRYPTO_PROVIDER_TOKEN'),
    SMTP_PASSWORD: productionSecret(env, 'SMTP_PASSWORD'),
    ACCOUNT_ACTION_KEY: productionSecret(env, 'ACCOUNT_ACTION_KEY'),
    ...((env.MFA_REQUIRED === 'true' || env.MFA_ENCRYPTION_KEY_FILE !== undefined || env.MFA_ENCRYPTION_KEY !== undefined) &&
      { MFA_ENCRYPTION_KEY: productionSecret(env, 'MFA_ENCRYPTION_KEY') }),
    ...(env.OIDC_ENABLED === 'true' && {
      OIDC_CLIENT_SECRET: productionSecret(env, 'OIDC_CLIENT_SECRET'),
      OIDC_STORAGE_KEY: productionSecret(env, 'OIDC_STORAGE_KEY'),
    }),
  };
  assertVerifiedDatabaseUrl(secrets.DATABASE_URL);
  if (!/^[A-Za-z0-9_-]{43,}$/.test(secrets.JWT_ACCESS_SECRET)) {
    throw new Error('PRODUCTION_JWT_ACCESS_SECRET_INVALID');
  }
  readAccountActionKey(secrets.ACCOUNT_ACTION_KEY);
  if (secrets.JWT_ACCESS_SECRET.toLowerCase() === secrets.ACCOUNT_ACTION_KEY.toLowerCase()) {
    throw new Error('PRODUCTION_AUTH_KEYS_MUST_DIFFER');
  }
  // Apply only after the full file and configuration checks have passed.
  Object.assign(env, secrets);
}
