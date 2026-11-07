import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditAnchorDigest, auditAnchorKeyId, auditRowsDigest, parseAuditAnchor, signAuditAnchor, verifyAuditAnchor } from '../src/audit/audit-anchor-format';

const rows = [{ id: '9007199254740993', canonical: '["9007199254740993","LOGIN",null]' },
  { id: '9007199254740997', canonical: '["9007199254740997","LOGOUT",null]' }];
const oldKey = generateKeyPairSync('ed25519');
const newKey = generateKeyPairSync('ed25519');
const first = signAuditAnchor({ deployment: 'crypta-test', sequence: 1, afterId: '0', throughId: rows[1].id,
  rowCount: 2, rowsDigest: auditRowsDigest(rows, '0'), previous: null, createdAt: '2026-11-07T00:00:00.000Z' }, oldKey.privateKey);

describe('Independent audit checkpoints', () => {
  it('preserves exact bigint IDs and detects edits, deletions and inserted rows', () => {
    expect(parseAuditAnchor(JSON.parse(JSON.stringify(first)))).toEqual(first);
    expect(auditRowsDigest([{ ...rows[0], canonical: '["9007199254740993","ALTERED",null]' }, rows[1]], '0')).not.toBe(first.rowsDigest);
    expect(auditRowsDigest([rows[1]], '0')).not.toBe(first.rowsDigest);
    expect(auditRowsDigest([rows[0], { id: '9007199254740995', canonical: '["9007199254740995","FAKE",null]' }, rows[1]], '0')).not.toBe(first.rowsDigest);
    expect(() => auditRowsDigest([...rows].reverse(), '0')).toThrow('AUDIT_ANCHOR_ROWS_INVALID');
  });

  it('ties the signature to all checkpoint metadata and supports key rotation', () => {
    expect(() => verifyAuditAnchor(first, oldKey.publicKey)).not.toThrow();
    expect(() => verifyAuditAnchor(first, newKey.publicKey)).toThrow('AUDIT_ANCHOR_SIGNATURE_INVALID');
    expect(() => verifyAuditAnchor({ ...first, deployment: 'different-deployment' }, oldKey.publicKey)).toThrow('AUDIT_ANCHOR_SIGNATURE_INVALID');
    const next = signAuditAnchor({ deployment: first.deployment, sequence: 2, afterId: first.throughId,
      throughId: '9007199254741000', rowCount: 1, rowsDigest: 'aa'.repeat(32), previous: auditAnchorDigest(first),
      createdAt: '2026-11-07T00:15:00.000Z' }, newKey.privateKey);
    expect(next.keyId).toBe(auditAnchorKeyId(newKey.publicKey));
    expect(next.keyId).not.toBe(first.keyId);
    expect(() => verifyAuditAnchor(next, newKey.publicKey)).not.toThrow();
  });

  it('rejects out-of-range IDs, invalid timestamp forms and unknown fields', () => {
    expect(() => parseAuditAnchor({ ...first, throughId: '9223372036854775808' })).toThrow();
    expect(() => parseAuditAnchor({ ...first, createdAt: '2026-11-31T00:00:00.000Z' })).toThrow();
    expect(() => parseAuditAnchor({ ...first, unexpected: 1 })).toThrow();
  });
});
