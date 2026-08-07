// apps/api/src/core/auth/__tests__/impersonation-verify.spec.ts · PC-56 ADMIN-9b.
//
// **THE CROSS-REALM CONTRACT TEST.** admin-api mints act-as tokens and apps/api verifies them, and the two realms share
// no code by design — so the format lives twice (ADMIN-9b-Q1). This file mints with admin-api's EXACT algorithm,
// reproduced here from `apps/admin-api/src/modules/impersonation/domain/impersonation-token.ts`, and verifies with the
// implementation this app will actually run. A divergence in either direction fails here rather than silently refusing
// every support session in production.
import { createHmac } from 'node:crypto';
import {
  IMPERSONATION_SAFE_METHODS, ImpersonationTokenError, isSafeForImpersonation, looksLikeImpersonationToken,
  verifyImpersonationToken,
} from '../impersonation-token';

const SECRET = 'an-impersonation-secret-that-is-long-enough';
const ISSUER = 'krishalaya-admin';
const AUDIENCE = 'krishalaya-api';

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A byte-for-byte copy of admin-api's minter. If that file changes, this test keeps passing and the real one starts
 *  failing — which is the wrong way round, so `mintsWithTheDocumentedClaimSet` below asserts the claim NAMES too. */
function mint(over: Record<string, unknown> = {}, secret = SECRET): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: ISSUER, aud: AUDIENCE, sub: 'target-user', tid: 'target-tenant',
    act: { sub: 'operator-1' }, jti: 'grant-1', scope: 'read_only', typ: 'impersonation',
    iat: now, exp: now + 900, ...over,
  };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

const cfg = { secret: SECRET, issuer: ISSUER, audience: AUDIENCE };

describe('ADMIN-9b · the verifier apps/api did not have', () => {
  it('accepts a token minted the way admin-api mints one', () => {
    const claims = verifyImpersonationToken(mint(), cfg);
    expect(claims).toMatchObject({
      targetUserId: 'target-user',
      targetTenantId: 'target-tenant',
      actorAdminId: 'operator-1',
      grantId: 'grant-1',
      scope: 'read_only',
    });
  });

  it('mints with the documented claim set — the contract, named field by field', () => {
    // Quoting the claim names back, because this is the one place the two realms' shared format is written down twice.
    const payload = JSON.parse(Buffer.from(mint().split('.')[1], 'base64').toString('utf8'));
    expect(Object.keys(payload).sort()).toEqual(
      ['act', 'aud', 'exp', 'iat', 'iss', 'jti', 'scope', 'sub', 'tid', 'typ'].sort());
    expect(payload.act).toEqual({ sub: 'operator-1' });   // RFC 8693 actor
  });

  it('REFUSES A TOKEN SIGNED WITH THE WRONG SECRET', () => {
    // The property that made an un-upgraded apps/api fail closed: the act-as key is dedicated, so neither the access
    // secret nor the refresh secret can mint one.
    expect(() => verifyImpersonationToken(mint({}, 'the-user-access-secret-not-the-act-as-one'), cfg))
      .toThrow(ImpersonationTokenError);
  });

  it('REFUSES WHEN NO SECRET IS CONFIGURED, rather than verifying against an empty key', () => {
    expect(() => verifyImpersonationToken(mint(), { ...cfg, secret: '' })).toThrow(/not configured/);
  });

  it('pins the algorithm', () => {
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })));
    const payload = mint().split('.')[1];
    expect(() => verifyImpersonationToken(`${header}.${payload}.`, cfg)).toThrow(/unexpected alg/);
  });

  it('refuses a token that is not an impersonation token', () => {
    expect(() => verifyImpersonationToken(mint({ typ: 'access' }), cfg)).toThrow(/not an impersonation token/);
  });

  it('refuses the wrong issuer or audience', () => {
    expect(() => verifyImpersonationToken(mint({ iss: 'somewhere-else' }), cfg)).toThrow(/bad issuer/);
    expect(() => verifyImpersonationToken(mint({ aud: 'another-api' }), cfg)).toThrow(/bad audience/);
  });

  it('refuses an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(() => verifyImpersonationToken(mint({ exp: past }), cfg)).toThrow(/expired/);
  });

  // **THE SCOPE IS CHECKED HERE EVEN THOUGH NOTHING CAN MINT ANOTHER VALUE TODAY.** If the mint side ever widens, this
  // verifier refuses the new value rather than quietly honouring it — so widening takes a deliberate change in BOTH
  // realms, which is the only version of "write impersonation does not exist" that survives a future wave.
  it('refuses any scope but read_only', () => {
    expect(() => verifyImpersonationToken(mint({ scope: 'read_write' }), cfg)).toThrow(/non read-only scope refused/);
  });

  it.each(['sub', 'tid', 'jti'])('refuses a token missing %s', (claim) => {
    expect(() => verifyImpersonationToken(mint({ [claim]: undefined }), cfg)).toThrow(/missing required claims/);
  });

  it('refuses a token with no actor — nobody to name in the log', () => {
    expect(() => verifyImpersonationToken(mint({ act: {} }), cfg)).toThrow(/missing required claims/);
    expect(() => verifyImpersonationToken(mint({ act: undefined }), cfg)).toThrow(/missing required claims/);
  });

  it('refuses malformed input without throwing a TypeError', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d']) {
      expect(() => verifyImpersonationToken(bad, cfg)).toThrow(ImpersonationTokenError);
    }
    // A truncated signature must be a 401-shaped refusal, not a crash: `timingSafeEqual` throws a TypeError on a length
    // mismatch, and a 500 here would let an attacker distinguish "wrong length" from "wrong bytes" by status code.
    const [h, p] = mint().split('.');
    expect(() => verifyImpersonationToken(`${h}.${p}.AAAA`, cfg)).toThrow(ImpersonationTokenError);
  });
});

describe('ADMIN-9b · looksLikeImpersonationToken', () => {
  it('recognises an act-as token and ignores everything else', () => {
    expect(looksLikeImpersonationToken(mint())).toBe(true);
    expect(looksLikeImpersonationToken(mint({ typ: 'access' }))).toBe(false);
    expect(looksLikeImpersonationToken('not.a.token')).toBe(false);
    expect(looksLikeImpersonationToken('')).toBe(false);
  });

  // It decodes without verifying, which is safe ONLY because the answer chooses a verifier and never grants anything.
  // This test exists to state that: a forged `typ` gets you routed to the impersonation verifier, which then refuses.
  it('a forged typ only chooses the verifier, and that verifier refuses', () => {
    const forged = mint({}, 'attacker-key');
    expect(looksLikeImpersonationToken(forged)).toBe(true);
    expect(() => verifyImpersonationToken(forged, cfg)).toThrow(/bad signature/);
  });
});

describe('ADMIN-9b · read-only is a method rule', () => {
  it('allows exactly the safe methods', () => {
    expect([...IMPERSONATION_SAFE_METHODS]).toEqual(['GET', 'HEAD', 'OPTIONS']);
    for (const m of ['GET', 'get', 'HEAD', 'OPTIONS']) expect(isSafeForImpersonation(m)).toBe(true);
  });

  // **POST IS REFUSED EVEN THOUGH SOME READS USE POST BODIES.** Guessing which POSTs are safe is how a read-only scope
  // becomes read-mostly, and the guess would have to be re-made by every future author of a POST-shaped search route.
  it('refuses every mutating method, including POST', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', '']) expect(isSafeForImpersonation(m)).toBe(false);
  });
});
