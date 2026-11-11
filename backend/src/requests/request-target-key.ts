import type { PoolClient } from 'pg';

export async function readRequestTargetKey(client: PoolClient, assetId: string) {
  const { rows: [key] } = await client.query<{ algorithm: string; key_size: number; usage: string }>(
    'SELECT algorithm,key_size,usage FROM cryptographic_keys WHERE asset_id=$1 FOR SHARE', [assetId]);
  return { algorithm: key?.algorithm ?? null, keySize: key?.key_size ?? null, usage: key?.usage ?? null };
}
