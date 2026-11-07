import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { redactAuditMetadata } from '../src/audit/audit-redaction';
import { AuditController } from '../src/audit/audit.controller';

const admin: AuthUser = { id: 'admin-1', email: 'admin@example.test', displayName: 'Admin', departmentId: 'dept-1', tokenVersion: 1, roles: ['ADMIN'], approverDepartmentIds: [], mustChangePassword: false };

describe('audit metadata redaction', () => {
  it('removes nested credentials while preserving safe context', () => {
    expect(redactAuditMetadata({ event: 'POLICY_CHANGED', configuration: { algorithm: 'RSA', privateKey: 'secret-material', smtp_password: 'smtp-secret', nested: [{ accessToken: 'bearer-token', days: 30 }] } })).toEqual({ event: 'POLICY_CHANGED', configuration: { algorithm: 'RSA', privateKey: '[REDACTED]', smtp_password: '[REDACTED]', nested: [{ accessToken: '[REDACTED]', days: 30 }] } });
  });

  it('redacts MFA enrollment, OTP and recovery material while retaining event codes', () => {
    expect(redactAuditMetadata({ code: 'MFA_ENABLED', digits: 6, nested: {
      otp: '123456', totpCode: '123456', mfa_code: '123456', recoveryCodes: ['ABCD-EFGH-IJKL-MNOP-QRST'],
      mfaRecoveryCode: 'ABCD-EFGH-IJKL-MNOP-QRST', manualKey: 'PUBLIC-REFERENCE-ONLY', challenge: 'fixture-challenge',
      otpauthUri: 'otpauth://totp/Crypta:admin@example.test?secret=PUBLIC',
    } })).toEqual({ code: 'MFA_ENABLED', digits: 6, nested: {
      otp: '[REDACTED]', totpCode: '[REDACTED]', mfa_code: '[REDACTED]', recoveryCodes: '[REDACTED]',
      mfaRecoveryCode: '[REDACTED]', manualKey: '[REDACTED]', challenge: '[REDACTED]', otpauthUri: '[REDACTED]',
    } });
    expect(redactAuditMetadata({ reason: 'Re-enrolled; otpauth://totp/Crypta:admin@example.test?secret=PUBLIC; totp_code=123456; recoveryCode=ABCD-EFGH-IJKL-MNOP-QRST' }))
      .toEqual({ reason: 'Re-enrolled; [REDACTED MFA ENROLLMENT] totp_code=[REDACTED]; recoveryCode=[REDACTED]' });
  });

  it('redacts historical database metadata before returning legacy audit results', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 1, action: 'POLICY_VERSION_CREATED', metadata: { api_key: 'old-secret', version: 2 }, actor_name: 'Admin' }] }));
    const controller = new AuditController({ query } as unknown as Pool);
    const result = await controller.list(admin, {});
    expect(result).toMatchObject([{ metadata: { api_key: '[REDACTED]', version: 2 } }]);
  });

  it.each(['', 'RSA ', 'EC ', 'ENCRYPTED ', 'OPENSSH '])('removes a private PEM block under a free-text key before truncating: %s', kind => {
    const value = `Reason before -----BEGIN ${kind}PRIVATE KEY-----\n${'synthetic-key-material'.repeat(100)}\n-----END ${kind}PRIVATE KEY----- Reason after`;
    expect(redactAuditMetadata({ reason: value })).toEqual({ reason: 'Reason before [REDACTED PRIVATE KEY] Reason after' });
    expect(redactAuditMetadata({ reason: `-----BEGIN ${kind}PRIVATE KEY-----\nsynthetic-unclosed-key` })).toEqual({ reason: '[REDACTED PRIVATE KEY]' });
  });
  it('redacts recognizable credentials in free text while retaining useful recovery context', () => {
    const syntheticJwt = [
      Buffer.from('{"alg":"HS256"}').toString('base64url'),
      Buffer.from('{"sub":"fixture"}').toString('base64url'),
      'syntheticSignature',
    ].join('.');
    const metadata = redactAuditMetadata({ reason: 'Checked receipt; Bearer synthetic.token-value; api_key="synthetic api key"; password=synthetic-password; postgres://fixture:synthetic-password@db/test; ' + syntheticJwt, code: 'CONFIRM_RECEIPT' });
    expect(metadata).toEqual({ reason: 'Checked receipt; Bearer [REDACTED]; api_key=[REDACTED]; password=[REDACTED]; postgres://[REDACTED]@db/test; [REDACTED TOKEN]', code: 'CONFIRM_RECEIPT' });
  });
});
