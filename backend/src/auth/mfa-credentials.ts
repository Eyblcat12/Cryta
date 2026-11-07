import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type MfaCredentialSubject = { userId: string; credentialId: string };

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stepMilliseconds = 30_000;

function subjectContext(subject: MfaCredentialSubject, purpose: string) {
  if (subject.userId.length !== 36 || subject.credentialId.length !== 36 ||
      !uuidPattern.test(subject.userId) || !uuidPattern.test(subject.credentialId)) {
    throw new Error('MFA_CREDENTIAL_SUBJECT_INVALID');
  }
  return JSON.stringify(['crypta:mfa:v1', purpose, subject.userId.toLowerCase(), subject.credentialId.toLowerCase()]);
}

function base32(bytes: Buffer) {
  let value = 0, bits = 0, encoded = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += base32Alphabet[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  if (bits) encoded += base32Alphabet[(value << (5 - bits)) & 31];
  return encoded;
}

export function readMfaEncryptionKey(value: string | undefined): Buffer {
  if (!value || value.length !== 64 || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('MFA_ENCRYPTION_KEY_INVALID');
  return Buffer.from(value, 'hex');
}

function requireKey(key: Buffer) {
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY_INVALID');
}

function requireSecret(secret: Buffer) {
  if (secret.length !== 20) throw new Error('MFA_TOTP_SECRET_INVALID');
}

/** The caller must keep this dedicated encryption key outside the database. */
export function sealMfaSecret(key: Buffer, secret: Buffer, subject: MfaCredentialSubject) {
  requireKey(key);
  requireSecret(secret);
  const context = subjectContext(subject, 'totp-secret');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ['v1', nonce.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

/** Authenticate the entire envelope before returning any plaintext. */
export function openMfaSecret(key: Buffer, envelope: string, subject: MfaCredentialSubject): Buffer {
  requireKey(key);
  const context = subjectContext(subject, 'totp-secret');
  try {
    if (!/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{27}\.[A-Za-z0-9_-]{22}$/.test(envelope)) throw new Error();
    const [, ...encoded] = envelope.split('.');
    const [nonce, ciphertext, tag] = encoded.map(part => Buffer.from(part, 'base64url'));
    if ([nonce, ciphertext, tag].some((part, index) => part.toString('base64url') !== encoded[index])) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('MFA_SECRET_UNREADABLE');
  }
}

/** Return clear registration material only to the enrollment response, never audit/email. */
export function createTotpEnrollment(key: Buffer, subject: MfaCredentialSubject, email: string) {
  if (!email || email.length > 320 || email !== email.trim() || /\p{Cc}/u.test(email)) {
    throw new Error('MFA_ACCOUNT_LABEL_INVALID');
  }
  const secret = randomBytes(20);
  try {
    const sealedSecret = sealMfaSecret(key, secret, subject);
    const manualKey = base32(secret);
    const parameters = new URLSearchParams({ secret: manualKey, issuer: 'Crypta', algorithm: 'SHA1', digits: '6', period: '30' });
    return { manualKey, uri: `otpauth://totp/${encodeURIComponent(`Crypta:${email}`)}?${parameters}`, sealedSecret };
  } finally { secret.fill(0); }
}

function totpForStep(secret: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Fixed six digits, SHA-1, 30 seconds, drift at most one step each way.
 * The caller MUST lock the credential row, load lastAcceptedStep, then persist
 * the returned step in the same transaction as granting authentication.
 * This pure function alone does not provide durable replay/rate protection.
 */
export function matchTotp(secret: Buffer, code: string, lastAcceptedStep: number, nowMilliseconds = Date.now()): number | undefined {
  requireSecret(secret);
  if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0 ||
      !Number.isSafeInteger(lastAcceptedStep) || lastAcceptedStep < -1) throw new Error('MFA_TOTP_STATE_INVALID');
  if (code.length !== 6 || !/^[0-9]{6}$/.test(code)) return undefined;
  const currentStep = Math.floor(nowMilliseconds / stepMilliseconds);
  const supplied = Buffer.from(code);
  let accepted: number | undefined;
  for (let step = Math.max(0, currentStep - 1); step <= currentStep + 1; step++) {
    const matches = timingSafeEqual(supplied, Buffer.from(totpForStep(secret, step)));
    if (matches && step > lastAcceptedStep) accepted = step;
  }
  return accepted;
}

/** Ten independent 100-bit credentials, displayed as five groups of four. */
export function createMfaRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => base32(randomBytes(13)).slice(0, 20).match(/.{4}/g)!.join('-'));
}

function normalizeRecoveryCode(code: string) {
  const trimmed = code.trim();
  if (!/^(?:[A-Za-z2-7]{20}|[A-Za-z2-7]{4}(?:-[A-Za-z2-7]{4}){4})$/.test(trimmed)) return undefined;
  return trimmed.replaceAll('-', '').toUpperCase();
}

export function mfaRecoveryCodeHash(code: string, subject: MfaCredentialSubject): string {
  const context = subjectContext(subject, 'recovery-code');
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new Error('MFA_RECOVERY_CODE_INVALID');
  return createHash('sha256').update(context).update('\0').update(normalized).digest('hex');
}

/** Persist only hashes; consuming a match still requires an atomic database update. */
export function matchesMfaRecoveryHash(code: string, storedHash: string, subject: MfaCredentialSubject) {
  if (!normalizeRecoveryCode(code) || storedHash.length !== 64 || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(mfaRecoveryCodeHash(code, subject), 'hex'), Buffer.from(storedHash, 'hex'));
}
