import { describe, expect, it } from 'vitest';
import { accountActionTokenHash, deriveAccountActionToken, matchesAccountActionHash, readAccountActionKey } from '../src/auth/account-action-token';

const key = readAccountActionKey('b1'.repeat(32));
const action = {
  id: '8cb7883a-518a-4d99-a2dc-94140184fa32',
  userId: 'b50fe664-2499-4f06-b3c8-c4c6262cbfe1',
  purpose: 'PASSWORD_RESET' as const,
};

describe('account action credentials', () => {
  it('recreates a credential for queued delivery without persisting it in clear text', () => {
    const credential = deriveAccountActionToken(key, action);
    expect(deriveAccountActionToken(Buffer.from(key), { ...action })).toBe(credential);
    const stored = accountActionTokenHash(credential);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain(credential);
    expect(matchesAccountActionHash(credential, stored)).toBe(true);
  });

  it('binds credentials to their purpose, user, issuance and signing key', () => {
    const stored = accountActionTokenHash(deriveAccountActionToken(key, action));
    const invitation = deriveAccountActionToken(key, { ...action, purpose: 'INVITATION' });
    const differentUser = deriveAccountActionToken(key, { ...action, userId: action.id });
    const laterIssuance = deriveAccountActionToken(key, { ...action, id: action.userId });
    const rotatedKey = deriveAccountActionToken(readAccountActionKey('a2'.repeat(32)), action);
    for (const credential of [invitation, differentUser, laterIssuance, rotatedKey, 'invalid']) {
      expect(matchesAccountActionHash(credential, stored)).toBe(false);
    }
    expect(matchesAccountActionHash(invitation, 'corrupted-hash')).toBe(false);
  });

  it('rejects a missing or malformed dedicated key without echoing its input', () => {
    expect(() => readAccountActionKey(undefined)).toThrow('ACCOUNT_ACTION_KEY_INVALID');
    expect(() => readAccountActionKey('malformed-secret')).toThrow(/^ACCOUNT_ACTION_KEY_INVALID$/);
  });
});
