import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { oidcConfiguration } from '../src/auth/oidc-config';
import { OidcProvider } from '../src/auth/oidc-provider';

const env = {
  OIDC_ENABLED: 'true', OIDC_ISSUER: 'https://identity.example.test/realms/crypta', APP_URL: 'https://crypta.example.test',
  OIDC_CLIENT_ID: 'crypta-client', OIDC_CLIENT_SECRET: 'fixture-client-secret-for-verification', OIDC_STORAGE_KEY: 'bc'.repeat(32),
  MFA_REQUIRED: 'true', COOKIE_SECURE: 'true',
};
const issuer = env.OIDC_ISSUER;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-signing-key', alg: 'RS256', use: 'sig' };
const jwks = `${issuer}/jwks`;

afterEach(() => vi.unstubAllGlobals());

function signed(claims: object, tamper = false) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${body}`;
  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey);
  if (tamper) signature[0] ^= 1;
  return `${input}.${signature.toString('base64url')}`;
}

function providerFixture(overrides: { endpoint?: string; nonce?: string; invalidSignature?: boolean; subject?: string } = {}) {
  let nonce = '';
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const provider = new OidcProvider(oidcConfiguration(env)!);
  const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: new URLSearchParams(String(init?.body ?? '')) });
    if (url.endsWith('/.well-known/openid-configuration')) return response({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: overrides.endpoint ?? `${issuer}/token`,
      introspection_endpoint: `${issuer}/introspect`, end_session_endpoint: `${issuer}/logout`, jwks_uri: jwks,
      response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], response_modes_supported: ['form_post'],
      id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic'],
    });
    if (url === jwks) return response({ keys: [jwk] });
    if (url === `${issuer}/introspect`) return response({ active: true, sub: overrides.subject ?? 'subject-1', client_id: env.OIDC_CLIENT_ID });
    if (url !== `${issuer}/token`) throw new Error('Unexpected test fetch');
    const now = Math.floor(Date.now() / 1000);
    const idToken = signed({ iss: issuer, sub: 'subject-1', sid: 'provider-session-1', aud: env.OIDC_CLIENT_ID,
      auth_time: now, iat: now, exp: now + 120, nonce: overrides.nonce ?? nonce, email: 'untrusted@example.test' }, overrides.invalidSignature);
    if (new URLSearchParams(String(init?.body)).get('grant_type') === 'refresh_token') {
      return response({ access_token: 'fixture-rotated-access', refresh_token: 'fixture-rotated-refresh', token_type: 'Bearer', expires_in: 120 });
    }
    return response({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', token_type: 'Bearer', expires_in: 120, id_token: idToken });
  }));
  return { provider, calls, setNonce: (value: string) => { nonce = value; } };
}

describe('OIDC configuration', () => {
  it('requires an explicit opt-in and pins the callback to the app origin', () => {
    expect(oidcConfiguration({})).toBeUndefined();
    expect(oidcConfiguration({ ...env, OIDC_ENABLED: 'false' })).toBeUndefined();
    expect(oidcConfiguration(env)?.callback.href).toBe('https://crypta.example.test/api/v1/auth/oidc/callback');
    expect(() => oidcConfiguration({ ...env, OIDC_ISSUER: issuer.replace('https:', 'http:') })).toThrow('OIDC_HTTPS_REQUIRED');
    expect(() => oidcConfiguration({ ...env, APP_URL: env.APP_URL + '/redirect' })).toThrow('OIDC_URL_PATH_INVALID');
    expect(() => oidcConfiguration({ ...env, COOKIE_SECURE: 'false' })).toThrow('OIDC_SECURE_COOKIE_REQUIRED');
    expect(() => oidcConfiguration({ ...env, JWT_ACCESS_SECRET: env.OIDC_STORAGE_KEY.toUpperCase() })).toThrow('OIDC_STORAGE_KEY_MUST_DIFFER');
  });

  it('restricts the HTTP exception to the isolated Keycloak realm and loopback app', () => {
    const local = { ...env, OIDC_TEST_HTTP: 'true', OIDC_ISSUER: 'http://oidc.crypta.test:18160/realms/crypta-oidc-test', APP_URL: 'http://app.crypta.test:18161' };
    expect(oidcConfiguration(local)?.testHttp).toBe(true);
    expect(() => oidcConfiguration({ ...local, CRYPTA_DEPLOYMENT_MODE: 'production' })).toThrow('OIDC_TEST_HTTP_NOT_ISOLATED');
    expect(() => oidcConfiguration({ ...local, OIDC_ISSUER: local.OIDC_ISSUER.replace('oidc.crypta.test', 'example.test') })).toThrow('OIDC_TEST_HTTP_NOT_ISOLATED');
  });
});

describe('OIDC authorization response and provider activity', () => {
  it('uses form_post, PKCE, fresh state and nonce, then validates the signed token and provider activity', async () => {
    const { provider, calls, setNonce } = providerFixture();
    const started = await provider.begin();
    const another = await provider.begin();
    expect(another.challenge.state).not.toBe(started.challenge.state);
    expect(another.challenge.nonce).not.toBe(started.challenge.nonce);
    const parameters = started.redirect.searchParams;
    expect(parameters.get('response_mode')).toBe('form_post');
    expect(parameters.get('code_challenge_method')).toBe('S256');
    expect(parameters.get('code_challenge')).not.toBe(started.challenge.verifier);
    expect(parameters.get('nonce')).toBe(started.challenge.nonce);
    setNonce(started.challenge.nonce);
    const identity = await provider.exchange(new URLSearchParams({ code: 'fixture-code', state: started.challenge.state }), started.challenge);
    expect(identity).toMatchObject({ issuer, subject: 'subject-1', sid: 'provider-session-1' });
    expect(identity).not.toHaveProperty('email');
    expect(calls.find(call => call.url.endsWith('/token'))?.body.get('code_verifier')).toBe(started.challenge.verifier);
    expect(calls.some(call => call.url === jwks)).toBe(true);
    await expect(provider.active(identity)).resolves.toBe(true);
    await expect(provider.active({ ...identity, subject: 'other-user' })).resolves.toBe(false);
    await expect(provider.active({ ...identity, expiresAt: new Date(0) })).resolves.toBe(false);
    expect(calls.filter(call => call.url.endsWith('/introspect'))).toHaveLength(2);
  });

  it('rejects wrong state before requesting a token', async () => {
    const { provider, calls } = providerFixture();
    const { challenge } = await provider.begin();
    await expect(provider.exchange(new URLSearchParams({ code: 'fixture-code', state: 'wrong-state' }), challenge)).rejects.toThrow();
    expect(calls.some(call => call.url.endsWith('/token'))).toBe(false);
  });

  it.each([{ nonce: 'wrong-nonce' }, { invalidSignature: true }])('rejects a failed token check', async overrides => {
    const { provider, setNonce } = providerFixture(overrides);
    const { challenge } = await provider.begin();
    setNonce(challenge.nonce);
    await expect(provider.exchange(new URLSearchParams({ code: 'fixture-code', state: challenge.state }), challenge)).rejects.toThrow();
  });

  it('refuses discovery that points token exchange outside the issuer origin', async () => {
    const { provider, calls } = providerFixture({ endpoint: 'https://outside.example.test/token' });
    await expect(provider.begin()).rejects.toThrow('OIDC_PROVIDER_ENDPOINT_INVALID');
    expect(calls).toHaveLength(1);
  });

  it('renews an expiring provider token with the existing subject and session binding', async () => {
    const { provider, calls } = providerFixture();
    const identity = { issuer, subject: 'subject-1', sid: 'provider-session-1', authenticatedAt: new Date(),
      accessToken: 'fixture-old-access', refreshToken: 'fixture-old-refresh', expiresAt: new Date(0) };
    const renewed = await provider.renew(identity);
    expect(renewed).toMatchObject({ subject: identity.subject, sid: identity.sid, accessToken: 'fixture-rotated-access', refreshToken: 'fixture-rotated-refresh' });
    expect(calls.find(call => call.body.get('grant_type') === 'refresh_token')?.body.get('refresh_token')).toBe('fixture-old-refresh');
    await expect(provider.active(renewed!)).resolves.toBe(true);
  });

  it('accepts only signed, recent logout events issued to this client', async () => {
    const { provider } = providerFixture();
    const now = Math.floor(Date.now() / 1000);
    const logout = { iss: issuer, aud: env.OIDC_CLIENT_ID, iat: now, jti: 'logout-1', sid: 'provider-session-1',
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} } };
    await expect(provider.verifyLogout(signed(logout))).resolves.toBe(logout.sid);
    for (const invalid of [{ aud: 'another-client' }, { iat: now - 200 }, { nonce: 'unexpected' }, { events: {} }, { sid: '' }]) {
      await expect(provider.verifyLogout(signed({ ...logout, ...invalid }))).rejects.toThrow();
    }
    await expect(provider.verifyLogout(signed(logout, true))).rejects.toThrow();
  });
});
