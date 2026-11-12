import { describe, expect, it } from 'vitest';
import { createMfaRecoveryCodes, createTotpEnrollment, matchTotp, matchesMfaRecoveryHash, mfaRecoveryCodeHash, openMfaSecret, readMfaEncryptionKey, sealMfaSecret } from '../src/auth/mfa-credentials';

const key = readMfaEncryptionKey('b1'.repeat(32));
const subject = { userId: 'b50fe664-2499-4f06-b3c8-c4c6262cbfe1', credentialId: '8cb7883a-518a-4d99-a2dc-94140184fa32' };
// Published RFC 6238 Appendix B vector, never a deployed credential.
const referenceSecret = Buffer.from('12345678901234567890', 'ascii');

describe('MFA TOTP interoperability and validation', () => {
  it.each([
    [59, '287082'], [1111111109, '081804'], [1111111111, '050471'],
    [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130'],
  ] as const)('matches the RFC SHA-1 vector truncated to six digits at %i seconds', (seconds, code) => {
    expect(matchTotp(referenceSecret, code, -1, seconds * 1000)).toBe(Math.floor(seconds / 30));
  });

  it('accepts at most one step of clock drift and preserves leading zeroes', () => {
    expect(matchTotp(referenceSecret, '081804', -1, 1111111109000 - 30_000)).toBe(37037036);
    expect(matchTotp(referenceSecret, '081804', -1, 1111111109000 + 30_000)).toBe(37037036);
    expect(matchTotp(referenceSecret, '081804', -1, 1111111109000 - 60_000)).toBeUndefined();
    expect(matchTotp(referenceSecret, '081804', -1, 1111111109000 + 60_000)).toBeUndefined();
  });

  it('refuses an already accepted step and older steps even after the clock moves backward', () => {
    expect(matchTotp(referenceSecret, '287082', 1, 59_000)).toBeUndefined();
    expect(matchTotp(referenceSecret, '081804', 37037037, 1111111109000)).toBeUndefined();
    expect(matchTotp(referenceSecret, '050471', 37037036, 1111111111000)).toBe(37037037);
  });

  it('handles the first Unix step without attempting a negative counter', () => {
    expect(matchTotp(referenceSecret, '755224', -1, 0)).toBe(0);
    expect(matchTotp(referenceSecret, '755224', 0, 0)).toBeUndefined();
  });

  it.each(['', '28708', '0287082', ' 287082', '287082 ', '２８７０８２', '287082\n', '287082\r\n', '28-7082'])('rejects malformed OTP %j', code => {
    expect(matchTotp(referenceSecret, code, -1, 59_000)).toBeUndefined();
  });

  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuses an invalid verifier clock %j', now => {
    expect(() => matchTotp(referenceSecret, '287082', -1, now)).toThrow(/^MFA_TOTP_STATE_INVALID$/);
  });

  it.each([NaN, -2, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuses a corrupt persisted replay counter %j', step => {
    expect(() => matchTotp(referenceSecret, '287082', step, 59_000)).toThrow(/^MFA_TOTP_STATE_INVALID$/);
  });
});

describe('MFA encrypted enrollment material', () => {
  it('generates interoperable registration parameters and a fresh secret for each enrollment', () => {
    const first = createTotpEnrollment(key, subject, 'admin+test@example.test');
    const second = createTotpEnrollment(key, subject, 'admin+test@example.test');
    const uri = new URL(first.uri);
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.hostname).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Crypta:admin+test@example.test');
    expect(Object.fromEntries(uri.searchParams)).toEqual({ secret: first.manualKey, issuer: 'Crypta', algorithm: 'SHA1', digits: '6', period: '30' });
    expect(first.manualKey).toMatch(/^[A-Z2-7]{32}$/);
    expect(second.manualKey).not.toBe(first.manualKey);
    const decodedNumber = [...first.manualKey].reduce((value, char) => value * 32n + BigInt('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char)), 0n);
    expect(openMfaSecret(key, first.sealedSecret, subject)).toEqual(Buffer.from(decodedNumber.toString(16).padStart(40, '0'), 'hex'));
    expect(first.sealedSecret).not.toContain(first.manualKey);
  });

  it('encrypts with a fresh nonce and authenticates the subject as well as ciphertext', () => {
    const envelope = sealMfaSecret(key, referenceSecret, subject);
    expect(sealMfaSecret(key, referenceSecret, subject)).not.toBe(envelope);
    expect(openMfaSecret(key, envelope, subject)).toEqual(referenceSecret);
    expect(openMfaSecret(key, envelope, { userId: subject.userId.toUpperCase(), credentialId: subject.credentialId.toUpperCase() })).toEqual(referenceSecret);
    for (const changed of [{ ...subject, userId: subject.credentialId }, { ...subject, credentialId: subject.userId }]) {
      expect(() => openMfaSecret(key, envelope, changed)).toThrow(/^MFA_SECRET_UNREADABLE$/);
    }
    expect(() => openMfaSecret(readMfaEncryptionKey('a2'.repeat(32)), envelope, subject)).toThrow(/^MFA_SECRET_UNREADABLE$/);
  });

  it.each([1, 2, 3])('refuses mutation of envelope component %i', component => {
    const parts = sealMfaSecret(key, referenceSecret, subject).split('.');
    parts[component] = (parts[component][0] === 'A' ? 'B' : 'A') + parts[component].slice(1);
    expect(() => openMfaSecret(key, parts.join('.'), subject)).toThrow(/^MFA_SECRET_UNREADABLE$/);
  });

  it('refuses legacy, truncated, extended and noncanonical envelopes', () => {
    const envelope = sealMfaSecret(key, referenceSecret, subject);
    const parts = envelope.split('.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const tail = parts[3].at(-1)!;
    parts[3] = parts[3].slice(0, -1) + alphabet[alphabet.indexOf(tail) + 1];
    // The unused base64 pad bits must be zero, although the bytes decode identically.
    expect(Buffer.from(parts[3], 'base64url')).toEqual(Buffer.from(envelope.split('.')[3], 'base64url'));
    for (const malformed of ['', envelope.replace('v1.', 'v2.'), envelope.slice(0, -1), envelope + '.extra', parts.join('.')]) {
      expect(() => openMfaSecret(key, malformed, subject)).toThrow(/^MFA_SECRET_UNREADABLE$/);
    }
  });

  it('validates key, secret and binding without echoing supplied values', () => {
    for (const invalid of [undefined, '', 'x'.repeat(64), 'b1'.repeat(31), 'b1'.repeat(33), ' ' + 'b1'.repeat(32), 'b1'.repeat(32) + '\n']) {
      expect(() => readMfaEncryptionKey(invalid)).toThrow(/^MFA_ENCRYPTION_KEY_INVALID$/);
    }
    expect(() => sealMfaSecret(Buffer.alloc(31), referenceSecret, subject)).toThrow(/^MFA_ENCRYPTION_KEY_INVALID$/);
    expect(() => sealMfaSecret(key, Buffer.alloc(19), subject)).toThrow(/^MFA_TOTP_SECRET_INVALID$/);
    expect(() => matchTotp(Buffer.alloc(21), '287082', -1, 59_000)).toThrow(/^MFA_TOTP_SECRET_INVALID$/);
    expect(() => sealMfaSecret(key, referenceSecret, { ...subject, userId: 'invalid' })).toThrow(/^MFA_CREDENTIAL_SUBJECT_INVALID$/);
    expect(() => sealMfaSecret(key, referenceSecret, { ...subject, userId: subject.userId + '\n' })).toThrow(/^MFA_CREDENTIAL_SUBJECT_INVALID$/);
  });

  it.each(['', ' admin@example.test', 'admin@example.test\n', 'admin\0@example.test', 'admin\u0085@example.test', 'a'.repeat(321)])('refuses an unsafe registration label', email => {
    expect(() => createTotpEnrollment(key, subject, email)).toThrow(/^MFA_ACCOUNT_LABEL_INVALID$/);
  });
});

describe('MFA recovery credential material', () => {
  it('creates ten independently random, readable credentials per issuance', () => {
    const first = createMfaRecoveryCodes(), second = createMfaRecoveryCodes();
    expect(first).toHaveLength(10);
    expect(new Set([...first, ...second]).size).toBe(20);
    for (const code of first) expect(code).toMatch(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){4}$/);
  });

  it('matches grouped or ungrouped input without storing a clear code', () => {
    const code = createMfaRecoveryCodes()[0];
    const stored = mfaRecoveryCodeHash(code, subject);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain(code.replaceAll('-', ''));
    expect(matchesMfaRecoveryHash(code, stored, subject)).toBe(true);
    expect(matchesMfaRecoveryHash(' ' + code.toLowerCase().replaceAll('-', '') + ' ', stored, subject)).toBe(true);
    expect(matchesMfaRecoveryHash(code, stored, { ...subject, userId: subject.credentialId })).toBe(false);
    expect(matchesMfaRecoveryHash(code, stored, { ...subject, credentialId: subject.userId })).toBe(false);
    expect(matchesMfaRecoveryHash(createMfaRecoveryCodes()[0], stored, subject)).toBe(false);
  });

  it.each(['', 'ABC1-EFGH-IJKL-MNOP-QRST', 'ABCD EFGH IJKL MNOP QRST', 'ABCD-EFGH-IJKL-MNOP', 'ＡＢＣＤ-EFGH-IJKL-MNOP-QRST', 'ABCD-EFGH-ıJKL-MNOP-QRST', 'ABCD--EFGH-IJKL-MNOP-QRST'])('rejects malformed recovery input', code => {
    expect(matchesMfaRecoveryHash(code, 'a'.repeat(64), subject)).toBe(false);
    expect(() => mfaRecoveryCodeHash(code, subject)).toThrow(/^MFA_RECOVERY_CODE_INVALID$/);
  });

  it.each(['', 'a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64), 'a'.repeat(65), 'a'.repeat(64) + '\n'])('rejects malformed persisted hashes', stored => {
    expect(matchesMfaRecoveryHash(createMfaRecoveryCodes()[0], stored, subject)).toBe(false);
  });
});
