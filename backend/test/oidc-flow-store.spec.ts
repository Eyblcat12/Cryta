import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { newOidcFlowToken, OidcFlowStore } from '../src/auth/oidc-flow-store';

const key = Buffer.from('ab'.repeat(32), 'hex');
const state = newOidcFlowToken();
const browser = newOidcFlowToken();
const payload = { state, nonce: newOidcFlowToken(), verifier: newOidcFlowToken() };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function setup() {
  const rows = new Map<string, { browser: string; phase: string; sealed: string }>();
  const query = vi.fn(async (sql: string, parameters: [string, string, string, string?]) => {
    const [ticket, browserHash, phase, sealed] = parameters;
    if (sql.startsWith('INSERT')) {
      rows.set(ticket, { browser: browserHash, phase, sealed: sealed! });
      return { rows: [] };
    }
    const row = rows.get(ticket);
    if (!row || row.browser !== browserHash || row.phase !== phase) return { rows: [] };
    rows.delete(ticket);
    return { rows: [{ sealed_payload: row.sealed }] };
  });
  return { rows, query, store: new OidcFlowStore({ query } as unknown as Pool, key) };
}

describe('OIDC flow confidentiality and binding', () => {
  it('stores neither the original tickets nor the PKCE verifier in database parameters', async () => {
    const { store, rows, query } = setup();
    await store.put('AUTHORIZE', state, browser, payload);
    const saved = rows.get(digest(state));
    expect(saved?.browser).toBe(digest(browser));
    expect(saved?.sealed).toMatch(/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    for (const credential of [state, browser, payload.nonce, payload.verifier]) {
      expect(JSON.stringify(query.mock.calls)).not.toContain(credential);
    }
    await expect(store.consume('AUTHORIZE', state, newOidcFlowToken())).resolves.toBeUndefined();
    await expect(store.consume('HANDOFF', state, browser)).resolves.toBeUndefined();
    await expect(store.consume('AUTHORIZE', state, browser)).resolves.toEqual(payload);
  });

  it('refuses ciphertext copied to another flow or modified in storage', async () => {
    const { store, rows } = setup();
    const another = newOidcFlowToken();
    await store.put('AUTHORIZE', state, browser, payload);
    await store.put('AUTHORIZE', another, browser, { ...payload, state: another });
    const first = rows.get(digest(state))!;
    const next = rows.get(digest(another))!;
    next.sealed = first.sealed;
    await expect(store.consume('AUTHORIZE', another, browser)).rejects.toThrow(/^OIDC_FLOW_UNREADABLE$/);
    const [nonce, ciphertext, tag] = first.sealed.split('.');
    first.sealed = [nonce, (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1), tag].join('.');
    await expect(store.consume('AUTHORIZE', state, browser)).rejects.toThrow(/^OIDC_FLOW_UNREADABLE$/);
  });
});
