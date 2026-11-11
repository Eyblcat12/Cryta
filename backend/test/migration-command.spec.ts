import { describe, expect, it } from 'vitest';
import { migrationOwnerRole } from '../src/database/migrate';

describe('migration operator owner role', () => {
  it('allows an omitted owner for the existing local/demo command', () => expect(migrationOwnerRole(undefined)).toBeUndefined());
  it.each(['crypta_owner', 'o', 'a'.repeat(63)])('accepts a bounded PostgreSQL role identifier %s', value => expect(migrationOwnerRole(value)).toBe(value));
  it.each(['', 'owner;DROP TABLE users', 'owner"', 'a'.repeat(64), 'Public.Owner', 'owner-name', ' owner', 'OWNER'])('rejects invalid role identifiers before opening a pool: %s', value => expect(() => migrationOwnerRole(value)).toThrow('INVALID_MIGRATION_OWNER_ROLE'));
});
