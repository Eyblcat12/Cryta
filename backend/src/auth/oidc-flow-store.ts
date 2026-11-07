import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { OidcChallenge, OidcIdentity } from './oidc-provider';
import { openOidcData, sealOidcData } from './oidc-seal';

type FlowPayloads = {
  AUTHORIZE: OidcChallenge;
  HANDOFF: Omit<OidcIdentity, 'expiresAt' | 'authenticatedAt'> & { expiresAt: string; authenticatedAt: string };
};
type Phase = keyof FlowPayloads;
const lifetimes: Record<Phase, number> = { AUTHORIZE: 300, HANDOFF: 120 };
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function newOidcFlowToken() { return randomBytes(32).toString('base64url'); }

function tokenHash(value: string): string | undefined {
  if (value.length === 43 && tokenPattern.test(value)) return createHash('sha256').update(value).digest('hex');
}

export class OidcFlowStore {
  constructor(private readonly pool: Pick<Pool, 'query'>, private readonly key: Buffer) {}

  async put<T extends Phase>(phase: T, ticket: string, browserToken: string, payload: FlowPayloads[T]) {
    const hash = tokenHash(ticket), browserHash = tokenHash(browserToken);
    if (!hash || !browserHash || hash === browserHash) throw new Error('OIDC_FLOW_TOKEN_INVALID');
    const sealed = this.seal(phase, hash, browserHash, payload);
    await this.pool.query(`INSERT INTO auth_oidc_flows (ticket_hash,browser_hash,phase,sealed_payload,expires_at)
      VALUES ($1,$2,$3,$4,clock_timestamp()+make_interval(secs=>$5))`, [hash, browserHash, phase, sealed, lifetimes[phase]]);
  }

  async consume<T extends Phase>(phase: T, ticket: string, browserToken: string): Promise<FlowPayloads[T] | undefined> {
    const hash = tokenHash(ticket), browserHash = tokenHash(browserToken);
    if (!hash || !browserHash) return undefined;
    const row = (await this.pool.query<{ sealed_payload: string }>(`DELETE FROM auth_oidc_flows
      WHERE ticket_hash=$1 AND browser_hash=$2 AND phase=$3 AND expires_at>clock_timestamp() RETURNING sealed_payload`,
    [hash, browserHash, phase])).rows[0];
    if (!row) return undefined;
    return this.open(phase, hash, browserHash, row.sealed_payload);
  }

  async removeExpired() {
    await this.pool.query(`DELETE FROM auth_oidc_flows WHERE ticket_hash IN (
      SELECT ticket_hash FROM auth_oidc_flows WHERE expires_at<=clock_timestamp()
      ORDER BY expires_at LIMIT 128 FOR UPDATE SKIP LOCKED)`);
  }

  private seal<T extends Phase>(phase: T, ticketHash: string, browserHash: string, payload: FlowPayloads[T]) {
    return sealOidcData(this.key, `crypta:oidc-flow:v1:${phase}:${ticketHash}:${browserHash}`, payload);
  }

  private open<T extends Phase>(phase: T, ticketHash: string, browserHash: string, envelope: string): FlowPayloads[T] {
    try {
      return openOidcData<FlowPayloads[T]>(this.key, `crypta:oidc-flow:v1:${phase}:${ticketHash}:${browserHash}`, envelope);
    } catch { throw new Error('OIDC_FLOW_UNREADABLE'); }
  }
}
