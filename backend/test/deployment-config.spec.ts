import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareDeploymentEnvironment } from '../src/common/deployment-config';

describe('production deployment configuration', () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;
  let values: Record<string, string>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'crypta-deployment-'));
    values = {
      DATABASE_URL: 'postgresql://crypta_runtime:fixture@postgres.test/crypta?sslmode=verify-full',
      JWT_ACCESS_SECRET: randomBytes(32).toString('base64url'),
      CRYPTO_PROVIDER_TOKEN: randomBytes(24).toString('hex'),
      SMTP_PASSWORD: 'synthetic mailbox credential',
      ACCOUNT_ACTION_KEY: randomBytes(32).toString('hex'),
    };
    env = {
      NODE_ENV: 'production',
      CRYPTA_DEPLOYMENT_MODE: 'production',
      DATABASE_MIGRATION_MODE: 'validate',
      CORS_ORIGIN: 'https://crypta.example.test',
      APP_URL: 'https://crypta.example.test',
      COOKIE_SECURE: 'true',
      CRYPTO_PROVIDER_MODE: 'HTTP',
      CRYPTO_PROVIDER_URL: 'https://provider.example.test',
      SMTP_ENABLED: 'true',
      SMTP_HOST: 'smtp.example.test',
      SMTP_USER: 'smtp-user',
      SMTP_FROM: 'Crypta <sender@example.test>',
      ACCOUNT_ACTIONS_ENABLED: 'true',
    };
    for (const [key, value] of Object.entries(values)) {
      env[key + '_FILE'] = join(directory, key);
      writeFileSync(env[key + '_FILE']!, value + '\r\n');
    }
  });

  afterEach(() => {
    for (const name of Object.keys(values)) unlinkSync(join(directory, name));
    rmdirSync(directory);
  });

  it('loads all secrets only in explicit production and preserves the exact SMTP password', () => {
    const demo = { NODE_ENV: 'production', CRYPTA_DEPLOYMENT_MODE: 'demo' };
    expect(() => prepareDeploymentEnvironment(demo)).not.toThrow();
    expect(demo).toEqual({ NODE_ENV: 'production', CRYPTA_DEPLOYMENT_MODE: 'demo' });
    prepareDeploymentEnvironment(env);
    for (const [name, value] of Object.entries(values)) expect(env[name]).toBe(value);
  });

  it.each([
    ['CRYPTA_DEPLOYMENT_MODE', 'prod', 'CRYPTA_DEPLOYMENT_MODE_INVALID'],
    ['NODE_ENV', 'development', 'PRODUCTION_NODE_ENV_REQUIRED'],
    ['DATABASE_MIGRATION_MODE', 'apply', 'PRODUCTION_DATABASE_VALIDATE_REQUIRED'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0', 'PRODUCTION_TLS_VERIFICATION_REQUIRED'],
    ['COOKIE_SECURE', 'false', 'PRODUCTION_HTTPS_ORIGIN_AND_COOKIE_REQUIRED'],
    ['APP_URL', 'http://localhost:8080', 'PRODUCTION_HTTPS_ORIGIN_AND_COOKIE_REQUIRED'],
    ['CORS_ORIGIN', 'https://other.example.test', 'PRODUCTION_HTTPS_ORIGIN_AND_COOKIE_REQUIRED'],
    ['CRYPTO_PROVIDER_MODE', 'MOCK', 'PRODUCTION_HTTPS_PROVIDER_REQUIRED'],
    ['SMTP_ENABLED', 'false', 'PRODUCTION_SMTP_REQUIRED'],
    ['ACCOUNT_ACTIONS_ENABLED', 'false', 'PRODUCTION_ACCOUNT_ACTIONS_REQUIRED'],
    ['SMTP_PASSWORD', 'injected-directly', 'PRODUCTION_SMTP_PASSWORD_USE_FILE'],
    ['SMTP_PASSWORD_FILE', 'relative-secret', 'PRODUCTION_SMTP_PASSWORD_FILE_REQUIRED'],
  ])('rejects unsafe %s configuration before assigning any secrets', (name, value, code) => {
    env[name] = value;
    expect(() => prepareDeploymentEnvironment(env)).toThrow(code);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.JWT_ACCESS_SECRET).toBeUndefined();
  });

  it.each(['disable', 'require', 'verify-ca', 'verify-full&sslmode=disable', 'verify-full&host=other.test'])(
    'rejects a noncanonical TLS mode or URL override (%s)',
    mode => {
      writeFileSync(env.DATABASE_URL_FILE!, 'postgresql://crypta_runtime:fixture@postgres.test/crypta?sslmode=' + mode);
      expect(() => prepareDeploymentEnvironment(env)).toThrow('PRODUCTION_DATABASE_VERIFY_FULL_REQUIRED');
    },
  );

  it('rejects malformed file contents without returning the secret in the error', () => {
    writeFileSync(env.SMTP_PASSWORD_FILE!, 'synthetic-sensitive-value\nunexpected-line');
    expect(() => prepareDeploymentEnvironment(env)).toThrow(/^PRODUCTION_SMTP_PASSWORD_FILE_INVALID$/);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('rejects reuse of the JWT key as the account-actions key', () => {
    writeFileSync(env.JWT_ACCESS_SECRET_FILE!, values.ACCOUNT_ACTION_KEY);
    expect(() => prepareDeploymentEnvironment(env)).toThrow('PRODUCTION_AUTH_KEYS_MUST_DIFFER');
  });
});
