import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBootstrapConfiguration } from '../src/database/bootstrap-admin';

describe('first administrator operator configuration', () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;
  let password: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'crypta-bootstrap-'));
    password = 'Xy!7' + randomBytes(24).toString('hex');
    env = {
      DATABASE_URL_FILE: join(directory, 'database'),
      BOOTSTRAP_ADMIN_PASSWORD_FILE: join(directory, 'password'),
      BOOTSTRAP_DATABASE_NAME: 'crypta_fixture',
      BOOTSTRAP_ADMIN_EMAIL: ' First.Admin@Example.test ',
      BOOTSTRAP_ADMIN_NAME: ' First Admin ',
      BOOTSTRAP_DEPARTMENT_CODE: 'SECURITY',
      BOOTSTRAP_DEPARTMENT_NAME: 'Security',
    };
    writeFileSync(env.DATABASE_URL_FILE!, 'postgresql://operator:fixture@postgres.test/crypta_fixture?sslmode=verify-full');
    writeFileSync(env.BOOTSTRAP_ADMIN_PASSWORD_FILE!, password + '\r\n');
  });

  afterEach(() => {
    unlinkSync(join(directory, 'database'));
    unlinkSync(join(directory, 'password'));
    rmdirSync(directory);
  });

  it('normalizes identity and loads file secrets without changing process environment', () => {
    const configuration = readBootstrapConfiguration(env);
    expect(configuration.email).toBe('first.admin@example.test');
    expect(configuration.displayName).toBe('First Admin');
    expect(configuration.password).toBe(password);
    expect(configuration.database).toBe('crypta_fixture');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.BOOTSTRAP_ADMIN_PASSWORD).toBeUndefined();
  });

  it.each([
    ['BOOTSTRAP_DATABASE_NAME', '', 'BOOTSTRAP_DATABASE_NAME_REQUIRED'],
    ['BOOTSTRAP_ADMIN_EMAIL', 'invalid', 'BOOTSTRAP_ADMIN_IDENTITY_INVALID'],
    ['BOOTSTRAP_ADMIN_NAME', ' ', 'BOOTSTRAP_ADMIN_IDENTITY_INVALID'],
    ['BOOTSTRAP_DEPARTMENT_CODE', 'invalid code', 'BOOTSTRAP_DEPARTMENT_INVALID'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0', 'BOOTSTRAP_TLS_REQUIRED'],
    ['DATABASE_URL', 'direct-sensitive-value', 'BOOTSTRAP_OPERATOR_CONFIGURATION_INVALID'],
    ['BOOTSTRAP_ADMIN_PASSWORD', 'direct-sensitive-value', 'BOOTSTRAP_OPERATOR_CONFIGURATION_INVALID'],
    ['BOOTSTRAP_ADMIN_PASSWORD_FILE', 'relative-file', 'BOOTSTRAP_OPERATOR_CONFIGURATION_INVALID'],
    ['DATABASE_MIGRATION_OWNER_ROLE', 'owner; SELECT 1', 'BOOTSTRAP_OPERATOR_CONFIGURATION_INVALID'],
  ])('rejects unsafe %s without echoing operator data', (name, value, code) => {
    env[name] = value;
    expect(() => readBootstrapConfiguration(env)).toThrow(new RegExp('^' + code + '$'));
  });

  it('rejects a database URL that bypasses hostname verification', () => {
    writeFileSync(env.DATABASE_URL_FILE!, 'postgresql://operator:fixture@postgres.test/crypta_fixture?sslmode=require');
    expect(() => readBootstrapConfiguration(env)).toThrow(/^BOOTSTRAP_OPERATOR_CONFIGURATION_INVALID$/);
  });

  it.each(['short', 'a'.repeat(32), 'Xy!7' + 'ế'.repeat(30)])(
    'rejects a weak or bcrypt-truncated temporary password',
    value => {
      writeFileSync(env.BOOTSTRAP_ADMIN_PASSWORD_FILE!, value);
      expect(() => readBootstrapConfiguration(env)).toThrow(/^BOOTSTRAP_TEMPORARY_PASSWORD_INVALID$/);
    },
  );
});
