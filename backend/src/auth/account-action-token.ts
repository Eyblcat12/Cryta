import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type AccountActionPurpose = 'INVITATION' | 'PASSWORD_RESET';

export const ACCOUNT_ACTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function readAccountActionKey(value: string | undefined): Buffer {
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('ACCOUNT_ACTION_KEY_INVALID');
  }
  return Buffer.from(value, 'hex');
}

// The issuance ID is generated with randomUUID(). The email worker can recreate
// this one credential with its separate key while PostgreSQL stores only its hash.
export function deriveAccountActionToken(key: Buffer, action: { id: string; userId: string; purpose: AccountActionPurpose }): string {
  return createHmac('sha256', key)
    .update(`crypta:account-action:v1:${action.purpose}:${action.userId}:${action.id}`)
    .digest('base64url');
}

export function accountActionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function matchesAccountActionHash(token: string, expectedHash: string): boolean {
  if (!ACCOUNT_ACTION_TOKEN_PATTERN.test(token) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(accountActionTokenHash(token), 'hex'), Buffer.from(expectedHash, 'hex'));
}
