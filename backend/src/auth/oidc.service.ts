import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import { oidcConfiguration } from './oidc-config';
import { OidcFlowStore, newOidcFlowToken } from './oidc-flow-store';
import { OidcProvider, type OidcIdentity, type OidcTokens } from './oidc-provider';
import { openOidcData, sealOidcData } from './oidc-seal';

type Queryable = Pick<Pool | PoolClient, 'query'>;
type SessionRow = {
  issuer: string; subject: string; sid: string;
  sealed_tokens: string; access_expires_at: Date; authenticated_at: Date;
};

const sessionQuery = `FROM auth_oidc_sessions s
  JOIN auth_oidc_links l ON l.user_id=s.user_id AND l.issuer=s.issuer AND l.subject=s.subject
  JOIN users u ON u.id=s.user_id
  JOIN departments d ON d.id=u.department_id
  WHERE s.id=$1 AND s.user_id=$2 AND s.issuer=$3 AND s.revoked_at IS NULL
    AND s.expires_at>clock_timestamp() AND l.revoked_at IS NULL
    AND u.status='ACTIVE' AND NOT u.must_change_password AND d.is_active
    AND NOT EXISTS (SELECT 1 FROM auth_oidc_revocations r WHERE r.issuer=s.issuer AND r.sid=s.sid)`;

export function oidcDenied() {
  return new UnauthorizedException({ code: 'OIDC_DENIED', message: 'Phiên SSO không hợp lệ hoặc tài khoản chưa được cấp quyền.' });
}

@Injectable()
export class OidcService {
  readonly options = oidcConfiguration();
  private readonly provider = this.options && new OidcProvider(this.options);
  private readonly flows?: OidcFlowStore;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {
    if (this.options) this.flows = new OidcFlowStore(pool, this.options.storageKey);
  }

  async start() {
    if (!this.provider || !this.flows) throw oidcDenied();
    const { redirect, challenge } = await this.providerCall(() => this.provider!.begin());
    const browser = newOidcFlowToken();
    await this.flows.removeExpired();
    await this.flows.put('AUTHORIZE', challenge.state, browser, challenge);
    return { redirect: redirect.href, browser };
  }

  async callback(body: URLSearchParams, browser: string) {
    if (!this.provider || !this.flows) throw oidcDenied();
    const challenge = await this.flows.consume('AUTHORIZE', body.get('state') ?? '', browser);
    if (!challenge || !body.has('code') || body.has('error')) throw oidcDenied();
    const identity = await this.provider.exchange(body, challenge);
    const ticket = newOidcFlowToken();
    await this.flows.put('HANDOFF', ticket, browser, { ...identity, expiresAt: identity.expiresAt.toISOString(),
      authenticatedAt: identity.authenticatedAt.toISOString() });
    return ticket;
  }

  async finish(ticket: string, browser: string) {
    const handoff = await this.flows?.consume('HANDOFF', ticket, browser);
    if (!handoff) throw oidcDenied();
    const identity = { ...handoff, expiresAt: new Date(handoff.expiresAt), authenticatedAt: new Date(handoff.authenticatedAt) };
    if (!await this.providerCall(() => this.provider!.active(identity))) throw oidcDenied();
    return identity;
  }

  async linkedUser(identity: OidcIdentity) {
    return (await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM auth_oidc_links WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL',
      [identity.issuer, identity.subject],
    )).rows[0]?.user_id;
  }

  async startSession(client: PoolClient, userId: string, identity: OidcIdentity) {
    const id = randomUUID();
    const inserted = await client.query(`INSERT INTO auth_oidc_sessions
      (id,user_id,issuer,subject,sid,sealed_tokens,access_expires_at,authenticated_at)
      SELECT $1::uuid,l.user_id,l.issuer,l.subject,$5::varchar,$6::text,$7::timestamptz,$8::timestamptz
      FROM auth_oidc_links l JOIN users u ON u.id=l.user_id JOIN departments d ON d.id=u.department_id
      WHERE l.user_id=$2 AND l.issuer=$3 AND l.subject=$4 AND l.revoked_at IS NULL
        AND u.status='ACTIVE' AND NOT u.must_change_password AND d.is_active
        AND NOT EXISTS (SELECT 1 FROM auth_oidc_revocations r WHERE r.issuer=l.issuer AND r.sid=$5)
      RETURNING id`, [id, userId, identity.issuer, identity.subject, identity.sid, this.sealTokens(id, identity),
      identity.expiresAt, identity.authenticatedAt]);
    if (!inserted.rowCount) throw oidcDenied();
    return id;
  }

  async checkSession(id: string, userId: string) {
    if (!this.options) return false;
    return Boolean((await this.pool.query(`SELECT 1 ${sessionQuery} AND s.access_expires_at>clock_timestamp()`,
      [id, userId, this.options.issuer.href])).rowCount);
  }

  async recentlyAuthenticated(client: PoolClient, id: string, userId: string) {
    if (!this.options) return false;
    return Boolean((await client.query(`SELECT 1 ${sessionQuery} AND s.authenticated_at>clock_timestamp()-interval '5 minutes'`,
      [id, userId, this.options.issuer.href])).rowCount);
  }

  async renewSession(client: PoolClient, id: string, userId: string) {
    if (!this.options || !this.provider) return false;
    const row = (await client.query<SessionRow>(`SELECT s.issuer,s.subject,s.sid,s.sealed_tokens,s.access_expires_at,s.authenticated_at
      ${sessionQuery} AND s.sealed_tokens IS NOT NULL FOR UPDATE OF s`, [id, userId, this.options.issuer.href])).rows[0];
    if (!row) return false;
    const tokens = openOidcData<Omit<OidcTokens, 'expiresAt'>>(this.options.storageKey, this.sessionPurpose(id), row.sealed_tokens);
    const identity = { ...tokens, issuer: row.issuer, subject: row.subject, sid: row.sid,
      expiresAt: row.access_expires_at, authenticatedAt: row.authenticated_at };
    const renewed = await this.providerCall(() => this.provider!.renew(identity));
    if (!renewed || !await this.providerCall(() => this.provider!.active(renewed))) return false;
    if (renewed !== identity) {
      await client.query('UPDATE auth_oidc_sessions SET sealed_tokens=$2,access_expires_at=$3 WHERE id=$1',
        [id, this.sealTokens(id, renewed), renewed.expiresAt]);
    }
    // A logout arriving during introspection still wins before issuing new credentials.
    return Boolean((await client.query(`SELECT 1 ${sessionQuery}`, [id, userId, this.options.issuer.href])).rowCount);
  }

  async endSession(client: PoolClient, id: string, userId: string) {
    await client.query(`UPDATE auth_oidc_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),sealed_tokens=NULL
      WHERE id=$1 AND user_id=$2`, [id, userId]);
  }

  async logoutUrl() {
    return this.provider?.logoutUrl().catch(() => undefined);
  }

  async backchannel(token: string) {
    if (!this.provider || !this.options) throw oidcDenied();
    const sid = await this.provider.verifyLogout(token).catch(() => { throw oidcDenied(); });
    await this.pool.query('INSERT INTO auth_oidc_revocations (issuer,sid) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [this.options.issuer.href, sid]);
    await this.pool.query(`UPDATE auth_oidc_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),sealed_tokens=NULL
      WHERE issuer=$1 AND sid=$2 AND sealed_tokens IS NOT NULL`, [this.options.issuer.href, sid]);
  }

  async hasLink(queryable: Queryable, userId: string) {
    return Boolean((await queryable.query('SELECT 1 FROM auth_oidc_links WHERE user_id=$1', [userId])).rowCount);
  }

  private sessionPurpose(id: string) { return `crypta:oidc-session:v1:${id}`; }

  private sealTokens(id: string, { accessToken, refreshToken }: OidcTokens) {
    return sealOidcData(this.options!.storageKey, this.sessionPurpose(id), { accessToken, refreshToken });
  }

  private async providerCall<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch {
      throw new ServiceUnavailableException({ code: 'OIDC_UNAVAILABLE', message: 'Keycloak tạm thời gián đoạn. Hãy thử lại sau.' });
    }
  }
}
