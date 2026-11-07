import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function sealOidcData(key: Buffer, purpose: string, data: unknown) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return [nonce, ciphertext, cipher.getAuthTag()].map(value => value.toString('base64url')).join('.');
}

export function openOidcData<T>(key: Buffer, purpose: string, envelope: string): T {
  if (envelope.length > 96_000 || !/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/.test(envelope)) throw new Error('OIDC_DATA_INVALID');
  const parts = envelope.split('.');
  const [nonce, data, tag] = parts.map(part => Buffer.from(part, 'base64url'));
  if ([nonce, data, tag].some((part, index) => part.toString('base64url') !== parts[index])) throw new Error('OIDC_DATA_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')) as T;
}
