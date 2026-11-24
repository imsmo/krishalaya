// PC-56 ADMIN-AUTH-1 · OpenID Connect: id_token verification (dependency-free, Node crypto) and the IdP client (discovery,
// JWKS cache with bounded refetch-on-unknown-kid, the code exchange with PKCE). A local fake IdP signs real RS256/ES256 tokens.
import { createHmac } from 'node:crypto';
import { AdminConfig } from '../../../core/config/admin-config';
import { IdTokenError, KeyResolver, pkcePair, verifyIdToken, b64urlEncode, sha256hex } from '../domain/oidc';
import { OidcClient, OidcUnavailableError } from '../services/oidc-client';
import { FakeIdp } from './fixtures/soft-authenticator';
import { createHash } from 'node:crypto';

const ISSUER = 'https://idp.example.test';
const CLIENT = 'client-123.apps.example.test';
const NONCE = 'n-0123456789abcdef';
const EXP = { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, allowedDomains: ['krishalaya.test'] };
const GOOD = { sub: '1098765', email: 'Founder@Krishalaya.test', nonce: NONCE, hd: 'krishalaya.test' };

function cfg(over: Record<string, unknown> = {}) {
  return new AdminConfig({ NODE_ENV: 'test', ADMIN_OIDC_ISSUER: ISSUER, ADMIN_OIDC_CLIENT_ID: CLIENT, ADMIN_OIDC_CLIENT_SECRET: 's3cret',
    ADMIN_OIDC_REDIRECT_URI: 'https://api.example.test/v1/auth/sso/callback', ADMIN_OIDC_ALLOWED_DOMAINS: 'krishalaya.test', ...over });
}
const resolverOf = (idp: FakeIdp): KeyResolver => ({ keyFor: async (kid) => (idp.keys.find((k) => k.kid === kid)?.jwk as never) ?? null });
const reason = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof IdTokenError ? e.reason : `other:${(e as Error).message}`; } };

describe('ADMIN-AUTH-1 · id_token verification', () => {
  const idp = new FakeIdp({ issuer: ISSUER, clientId: CLIENT });
  const keys = resolverOf(idp);

  it('accepts a good RS256 token and returns the lower-cased verified identity', async () => {
    const v = await verifyIdToken(idp.idToken(GOOD), EXP, keys);
    expect(v).toEqual({ issuer: ISSUER, subject: '1098765', email: 'founder@krishalaya.test', hd: 'krishalaya.test' });
  });
  it('accepts a good ES256 token', async () => {
    const es = new FakeIdp({ issuer: ISSUER, clientId: CLIENT }); es.keys = []; es.rotate('ES256');
    await expect(verifyIdToken(es.idToken(GOOD), EXP, resolverOf(es))).resolves.toMatchObject({ subject: '1098765' });
  });
  it('refuses the wrong issuer, audience and nonce', async () => {
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, iss: 'https://evil.test' }), EXP, keys))).toBe('bad_issuer');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, aud: 'someone-else' }), EXP, keys))).toBe('bad_audience');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, aud: [CLIENT, 'other'], azp: 'other' }), EXP, keys))).toBe('bad_azp');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, nonce: 'replayed' }), EXP, keys))).toBe('bad_nonce');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, nonce: undefined }), EXP, keys))).toBe('bad_nonce');
  });
  it('refuses an expired token, a future iat and an ancient iat (60 s skew)', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, exp: now - 61 }), EXP, keys))).toBe('expired');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, exp: now - 30 }), EXP, keys))).toBe('ok');   // inside the skew
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, iat: now + 120 }), EXP, keys))).toBe('iat_in_future');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, iat: now - 3600 }), EXP, keys))).toBe('iat_too_old');
  });
  it('refuses an unverified email (strictly boolean true), a missing email and a missing subject', async () => {
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, email_verified: false }), EXP, keys))).toBe('email_not_verified');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, email_verified: 'true' }), EXP, keys))).toBe('email_not_verified');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, email: undefined }), EXP, keys))).toBe('no_email');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, sub: '' }), EXP, keys))).toBe('no_subject');
  });
  it('refuses a disallowed email domain and a disallowed hd; hd absent is fine when the email domain is allowed', async () => {
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, email: 'x@gmail.com', hd: undefined }), EXP, keys))).toBe('email_domain_not_allowed');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, hd: 'other.test' }), EXP, keys))).toBe('hd_not_allowed');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, hd: 7 }), EXP, keys))).toBe('hd_not_allowed');
    expect(await reason(verifyIdToken(idp.idToken({ ...GOOD, hd: undefined }), EXP, keys))).toBe('ok');
    expect(await reason(verifyIdToken(idp.idToken(GOOD), { ...EXP, allowedDomains: [] }, keys))).toBe('no_allowed_domains_configured');
  });
  it('refuses alg none and HS256 (alg confusion with the client secret), and an unknown alg', async () => {
    expect(await reason(verifyIdToken(idp.idToken(GOOD, { header: { alg: 'none' }, rawSig: '' }), EXP, keys))).toBe('alg_not_allowed:none');
    const hs = idp.idToken(GOOD, { header: { alg: 'HS256' }, rawSig: 'x' });
    const [h, p] = hs.split('.');
    const forged = `${h}.${p}.${createHmac('sha256', 's3cret').update(`${h}.${p}`).digest('base64url')}`;
    expect(await reason(verifyIdToken(forged, EXP, keys))).toBe('alg_not_allowed:HS256');
    expect(await reason(verifyIdToken(idp.idToken(GOOD, { header: { alg: 'PS512' } }), EXP, keys))).toBe('alg_not_allowed:PS512');
  });
  it('refuses a tampered payload, a key/alg mismatch and garbage', async () => {
    const t = idp.idToken(GOOD).split('.');
    const evil = b64urlEncode(Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(t[1], 'base64url').toString()), email: 'attacker@krishalaya.test' })));
    expect(await reason(verifyIdToken(`${t[0]}.${evil}.${t[2]}`, EXP, keys))).toBe('bad_signature');
    expect(await reason(verifyIdToken(idp.idToken(GOOD, { header: { alg: 'ES256' } }), EXP, keys))).toBe('key_alg_mismatch');
    expect(await reason(verifyIdToken('a.b', EXP, keys))).toBe('malformed');
    expect(await reason(verifyIdToken('!!.??.x', EXP, keys))).toBe('undecodable');
  });
  it('an unknown kid asks the resolver to refresh exactly once, then refuses', async () => {
    const calls: boolean[] = [];
    const r: KeyResolver = { keyFor: async (_k, refresh) => { calls.push(refresh); return null; } };
    expect(await reason(verifyIdToken(idp.idToken(GOOD), EXP, r))).toBe('unknown_kid');
    expect(calls).toEqual([false, true]);
  });
  it('PKCE S256: challenge = base64url(sha256(verifier)), 43-char verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(sha256hex('a')).toHaveLength(64);
  });
});

describe('ADMIN-AUTH-1 · OidcClient (discovery, JWKS rotation, code exchange, timeout)', () => {
  it('builds the authorization URL: code + PKCE S256 + state + nonce + hd hint', async () => {
    const idp = new FakeIdp({ issuer: ISSUER, clientId: CLIENT });
    const c = new OidcClient(cfg(), idp.fetch as never);
    const u = new URL(await c.authorizationUrl({ state: 'st', nonce: 'no', codeChallenge: 'ch' }));
    expect(u.origin + u.pathname).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code', client_id: CLIENT, state: 'st', nonce: 'no', code_challenge: 'ch', code_challenge_method: 'S256',
      redirect_uri: 'https://api.example.test/v1/auth/sso/callback', scope: 'openid email', hd: 'krishalaya.test',
    });
  });

  it('JWKS ROTATION: an unknown kid triggers ONE refetch that finds the new key; a forged kid cannot hammer the IdP', async () => {
    const idp = new FakeIdp({ issuer: ISSUER, clientId: CLIENT });
    let now = 1_000_000;
    const c = new OidcClient(cfg(), idp.fetch as never, () => now);
    await expect(verifyIdToken(idp.idToken(GOOD), EXP, c)).resolves.toBeTruthy();
    expect(idp.jwksHits).toBe(1);
    now += 31_000;                                 // past the 30 s refetch floor
    const kid2 = idp.rotate('RS256');
    await expect(verifyIdToken(idp.idToken(GOOD, { kid: kid2 }), EXP, c)).resolves.toBeTruthy();
    expect(idp.jwksHits).toBe(2);                  // exactly one refetch
    await expect(verifyIdToken(idp.idToken(GOOD, { kid: kid2 }), EXP, c)).resolves.toBeTruthy();
    expect(idp.jwksHits).toBe(2);                  // cached
    // A forged kid within 30 s of the last fetch: refused WITHOUT another JWKS request.
    expect(await reason(verifyIdToken(idp.idToken(GOOD, { header: { kid: 'forged' } }), EXP, c))).toBe('unknown_kid');
    expect(idp.jwksHits).toBe(2);
    expect(c.jwksFetchCount).toBe(2);
  });

  it('exchanges the code with client_secret + code_verifier and returns the id_token', async () => {
    const idp = new FakeIdp({ issuer: ISSUER, clientId: CLIENT });
    idp.codes.set('the-code', 'the.id.token');
    const c = new OidcClient(cfg(), idp.fetch as never);
    await expect(c.exchangeCode('the-code', 'verifier-xyz')).resolves.toBe('the.id.token');
    expect(Object.fromEntries(idp.lastTokenRequest!)).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', code_verifier: 'verifier-xyz', client_id: CLIENT, client_secret: 's3cret' });
    await expect(c.exchangeCode('the-code', 'v')).rejects.toBeInstanceOf(OidcUnavailableError);   // single use at the IdP
  });

  it('refuses a discovery document for a different issuer, and times out a hanging IdP', async () => {
    const wrong = new OidcClient(cfg(), (async () => ({ ok: true, status: 200, json: async () => ({ issuer: 'https://evil', authorization_endpoint: 'a', token_endpoint: 't', jwks_uri: 'j' }) })) as never);
    await expect(wrong.discover()).rejects.toThrow(/does not match/);
    const hang = (_u: string, init?: { signal?: AbortSignal }) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const slow = new OidcClient(cfg({ ADMIN_OIDC_HTTP_TIMEOUT_MS: '500' }), hang as never);
    await expect(slow.discover()).rejects.toMatchObject({ reason: 'timeout' });
  });
});
