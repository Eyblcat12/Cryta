import * as oidc from 'openid-client';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OidcConfig } from './oidc-config';

export type OidcChallenge = { state: string; nonce: string; verifier: string };
export type OidcTokens = { accessToken: string; refreshToken?: string; expiresAt: Date };
export type OidcIdentity = OidcTokens & { issuer: string; subject: string; sid: string; authenticatedAt: Date };
const logoutEvent = 'http://schemas.openid.net/event/backchannel-logout';

export class OidcProvider {
  private configuration?: Promise<oidc.Configuration>;
  private logoutKeys?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly options: OidcConfig) {}

  async begin() {
    const client = await this.getClient(true);
    const challenge = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier() };
    const redirect = oidc.buildAuthorizationUrl(client, {
      redirect_uri: this.options.callback.href, scope: 'openid', response_mode: 'form_post', prompt: 'login', max_age: '300',
      state: challenge.state, nonce: challenge.nonce, code_challenge_method: 'S256',
      code_challenge: await oidc.calculatePKCECodeChallenge(challenge.verifier),
    });
    return { redirect, challenge };
  }

  async exchange(body: URLSearchParams, challenge: OidcChallenge): Promise<OidcIdentity> {
    const client = await this.getClient();
    const response = new Request(this.options.callback, { method: 'POST', body });
    const tokens = await oidc.authorizationCodeGrant(client, response, {
      expectedState: challenge.state, expectedNonce: challenge.nonce, pkceCodeVerifier: challenge.verifier, maxAge: 300,
    });
    const claims = tokens.claims();
    if (!claims || !validIdentifier(claims.sub) || !validIdentifier(claims.sid) ||
        typeof claims.auth_time !== 'number' || claims.auth_time > Date.now() / 1000 + 10) throw new Error('OIDC_IDENTITY_INVALID');
    return { issuer: claims.iss, subject: claims.sub, sid: claims.sid,
      authenticatedAt: new Date(claims.auth_time * 1000), ...providerTokens(tokens) };
  }

  async active(identity: OidcTokens & { subject: string; sid: string }) {
    if (identity.expiresAt.getTime() <= Date.now()) return false;
    const result = await oidc.tokenIntrospection(await this.getClient(), identity.accessToken, { token_type_hint: 'access_token' });
    const sid = result.sid ?? result.session_state;
    return result.active === true && result.sub === identity.subject && result.client_id === this.options.clientId &&
      (sid === undefined || sid === identity.sid);
  }

  async renew(identity: OidcIdentity): Promise<OidcIdentity | undefined> {
    if (identity.expiresAt.getTime() > Date.now() + 30_000) return identity;
    if (!identity.refreshToken) return identity.expiresAt.getTime() > Date.now() ? identity : undefined;
    try {
      const tokens = await oidc.refreshTokenGrant(await this.getClient(), identity.refreshToken);
      const claims = tokens.claims();
      if (claims && (claims.sub !== identity.subject || (claims.sid !== undefined && claims.sid !== identity.sid))) return undefined;
      return { ...identity, ...providerTokens(tokens, identity.refreshToken) };
    } catch (error) {
      if (error instanceof oidc.ResponseBodyError && error.error === 'invalid_grant') return undefined;
      throw error;
    }
  }

  async verifyLogout(token: string) {
    const { jwks_uri } = (await this.getClient()).serverMetadata();
    this.logoutKeys ??= createRemoteJWKSet(new URL(jwks_uri!), { timeoutDuration: 8000 });
    const { payload } = await jwtVerify(token, this.logoutKeys, {
      issuer: this.options.issuer.href, audience: this.options.clientId, algorithms: ['RS256'],
      requiredClaims: ['iat', 'jti', 'sid', 'events'], maxTokenAge: '2 minutes', clockTolerance: 10,
    });
    const events = payload.events;
    const event = events && typeof events === 'object' && !Array.isArray(events) && (events as Record<string, unknown>)[logoutEvent];
    if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).length || 'nonce' in payload ||
        !validIdentifier(payload.jti) || !validIdentifier(payload.sid)) throw new Error('OIDC_LOGOUT_INVALID');
    return payload.sid;
  }

  async logoutUrl() {
    return oidc.buildEndSessionUrl(await this.getClient(), {
      client_id: this.options.clientId, post_logout_redirect_uri: new URL('/login', this.options.appOrigin).href,
    }).href;
  }

  private getClient(checkAvailability = false) {
    if (!this.configuration || checkAvailability) {
      const config = this.discover();
      this.configuration = config;
      void config.catch(() => { if (this.configuration === config) this.configuration = undefined; });
    }
    return this.configuration;
  }

  private async discover() {
    const config = await oidc.discovery(this.options.issuer, this.options.clientId, {
      redirect_uris: [this.options.callback.href], id_token_signed_response_alg: 'RS256',
    }, oidc.ClientSecretBasic(this.options.clientSecret), {
      timeout: 8,
      execute: [oidc.enableNonRepudiationChecks, ...(this.options.testHttp ? [oidc.allowInsecureRequests] : [])],
    });
    const metadata = config.serverMetadata();
    if (!metadata.code_challenge_methods_supported?.includes('S256') || !metadata.response_modes_supported?.includes('form_post')) {
      throw new Error('OIDC_PROVIDER_CAPABILITY_MISSING');
    }
    for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri,
      metadata.introspection_endpoint, metadata.end_session_endpoint]) {
      if (!endpoint) throw new Error('OIDC_PROVIDER_ENDPOINT_MISSING');
      const url = new URL(endpoint);
      if (url.origin !== this.options.issuer.origin || url.username || url.password || url.hash || url.search) {
        throw new Error('OIDC_PROVIDER_ENDPOINT_INVALID');
      }
    }
    return config;
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/\p{Cc}/u.test(value);
}

function providerTokens(tokens: oidc.TokenEndpointResponse & { expiresIn: () => number | undefined }, previousRefresh?: string): OidcTokens {
  const expires = tokens.expiresIn();
  const refreshToken = tokens.refresh_token ?? previousRefresh;
  if (!expires || expires > 3600 || !tokens.access_token || tokens.access_token.length > 16_384 ||
      (refreshToken !== undefined && (!refreshToken || refreshToken.length > 16_384))) throw new Error('OIDC_TOKENS_INVALID');
  return { accessToken: tokens.access_token, refreshToken, expiresAt: new Date(Date.now() + expires * 1000) };
}
