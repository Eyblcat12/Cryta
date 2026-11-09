import { describe, expect, it } from 'vitest';
import { startupFailure } from '../src/common/startup-failure';

describe('startup failure diagnostics', () => {
  it('reports a known ledger reason without serializing the stored migration identifier', () => {
    expect(startupFailure(new Error('UNKNOWN_DATABASE_MIGRATION:synthetic-private-ledger-value'))).toEqual({
      event: 'application.startup_failed', code: 'UNKNOWN_DATABASE_MIGRATION',
    });
  });

  it('keeps fixed configuration and SMTP diagnostics for operators', () => {
    expect(startupFailure(new Error('PRODUCTION_DATABASE_URL_FILE_INVALID')).code).toBe('PRODUCTION_DATABASE_URL_FILE_INVALID');
    expect(startupFailure(new Error('SMTP_VERIFY_FAILED'))).toEqual({
      event: 'email.smtp_verify_failed', code: 'SMTP_VERIFY_FAILED',
    });
  });

  it('does not print unrecognized messages, driver data, or stack traces', () => {
    const error = Object.assign(new Error('SYNTHETIC_PRIVATE_DRIVER_DATA'), { code: 'PRODUCTION_UNKNOWN_PRIVATE_VALUE' });
    expect(startupFailure(error)).toEqual({ event: 'application.startup_failed', code: 'APPLICATION_STARTUP_FAILED' });
    expect(startupFailure('another synthetic value').code).toBe('APPLICATION_STARTUP_FAILED');
  });
});
