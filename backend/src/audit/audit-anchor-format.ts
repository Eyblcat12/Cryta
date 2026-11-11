import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const anchorRowsLimit = 1000;
const digestPattern = /^[a-f0-9]{64}$/;
const signaturePattern = /^[A-Za-z0-9_-]{86}$/;
const deploymentPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const maximumAuditId = 9_223_372_036_854_775_807n;

export type AuditRow = { id: string; canonical: string };
export type AuditAnchor = {
  version: 1;
  deployment: string;
  sequence: number;
  afterId: string;
  throughId: string;
  rowCount: number;
  rowsDigest: string;
  previous: string | null;
  keyId: string;
  createdAt: string;
};
export type SignedAuditAnchor = AuditAnchor & { signature: string };

export function auditId(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw new Error('AUDIT_ANCHOR_ID_INVALID');
  const id = BigInt(value);
  if (id > maximumAuditId) throw new Error('AUDIT_ANCHOR_ID_INVALID');
  return id;
}

export function auditRowsDigest(rows: AuditRow[], afterId: string) {
  const hash = createHash('sha256').update('crypta:audit:rows:v1\0');
  const length = Buffer.alloc(4);
  let lastId = auditId(afterId);
  for (const row of rows) {
    const id = auditId(row.id);
    if (id <= lastId || !row.canonical.startsWith('[')) throw new Error('AUDIT_ANCHOR_ROWS_INVALID');
    lastId = id;
    const bytes = Buffer.from(row.canonical, 'utf8');
    length.writeUInt32BE(bytes.length);
    hash.update(length).update(bytes);
  }
  return hash.digest('hex');
}

function canonical(anchor: AuditAnchor) {
  return Buffer.from(JSON.stringify(['crypta:audit:anchor:v1', anchor.version, anchor.deployment, anchor.sequence,
    anchor.afterId, anchor.throughId, anchor.rowCount, anchor.rowsDigest, anchor.previous, anchor.keyId, anchor.createdAt]), 'utf8');
}

export function auditAnchorDigest(anchor: SignedAuditAnchor) {
  return createHash('sha256').update('crypta:audit:signed-anchor:v1\0').update(canonical(anchor))
    .update(Buffer.from(anchor.signature, 'base64url')).digest('hex');
}

export function auditAnchorKeyId(key: KeyObject) {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') throw new Error('AUDIT_ANCHOR_KEY_INVALID');
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

export function signAuditAnchor(input: Omit<AuditAnchor, 'version' | 'keyId'>, key: KeyObject): SignedAuditAnchor {
  if (key.type !== 'private') throw new Error('AUDIT_ANCHOR_KEY_INVALID');
  const anchor: AuditAnchor = { ...input, version: 1, keyId: auditAnchorKeyId(key) };
  const signature = sign(null, canonical(anchor), key).toString('base64url');
  return parseAuditAnchor({ ...anchor, signature });
}

export function parseAuditAnchor(input: unknown): SignedAuditAnchor {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('AUDIT_ANCHOR_FORMAT_INVALID');
  const anchor = input as SignedAuditAnchor;
  if (Object.keys(anchor).length !== 11 || anchor.version !== 1 || typeof anchor.deployment !== 'string' ||
      !deploymentPattern.test(anchor.deployment) || !Number.isSafeInteger(anchor.sequence) || anchor.sequence < 1 ||
      anchor.sequence > 999_999_999_999 || !Number.isSafeInteger(anchor.rowCount) || anchor.rowCount < 1 ||
      anchor.rowCount > anchorRowsLimit || !isAuditDigest(anchor.rowsDigest) || !isAuditDigest(anchor.keyId) ||
      (anchor.previous !== null && !isAuditDigest(anchor.previous)) ||
      typeof anchor.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(anchor.createdAt) ||
      !Number.isFinite(Date.parse(anchor.createdAt)) || new Date(anchor.createdAt).toISOString() !== anchor.createdAt ||
      typeof anchor.signature !== 'string' || !signaturePattern.test(anchor.signature) ||
      Buffer.from(anchor.signature, 'base64url').toString('base64url') !== anchor.signature ||
      auditId(anchor.throughId) - auditId(anchor.afterId) < BigInt(anchor.rowCount)) {
    throw new Error('AUDIT_ANCHOR_FORMAT_INVALID');
  }
  return anchor;
}

export function isAuditDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value);
}

export function verifyAuditAnchor(anchor: SignedAuditAnchor, publicKey: KeyObject) {
  if (publicKey.type !== 'public' || auditAnchorKeyId(publicKey) !== anchor.keyId ||
      !verify(null, canonical(anchor), publicKey, Buffer.from(anchor.signature, 'base64url'))) {
    throw new Error('AUDIT_ANCHOR_SIGNATURE_INVALID');
  }
}
