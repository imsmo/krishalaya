// apps/api/src/core/auth/impersonation-token.ts · PC-56 ADMIN-9b — the verifier that did not exist.
//
// admin-api mints an act-as token (0038 + `impersonation-token.ts`) and **`apps/api` had no verifier**: `grep -rn
// "verifyImpersonation|typ === 'impersonation'|act-as" apps/api/src` returned nothing. The token was therefore inert —
// fail-closed and safe, and the reason every promise on W008 described behaviour that did not exist. This file is the
// honouring side.
//
// **THIS IS A DELIBERATE SECOND IMPLEMENTATION OF ONE FORMAT, AND THAT IS A RISK WITH A NAMED OWNER (ADMIN-9b-Q1).**
// The two realms share no code by design — admin-api must not import from apps/api and vice versa — so the format lives
// twice. Two mitigations, because "be careful" is not one: the claim set is asserted field by field below rather than
// spread from a decoded object, and `__tests__/impersonation-verify.spec.ts` mints with admin-api's exact algorithm and
// verifies here, so a divergence in either direction fails a test rather than silently refusing every session in
// production. Extracting to a shared package is the right fix the moment a third consumer appears.
//
// WHAT THIS FILE DOES NOT DO: it does not decide whether the GRANT is live. A signature proves the token was minted;
// only the database knows whether the grant was revoked thirty seconds ago. That check is in `ImpersonationGrantGate`,
// and it is what makes W008's "their session ends immediately" true rather than "within thirty minutes".
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ImpersonationClaims {
  /** The impersonated (target) user — becomes `RequestContext.userId`. */
  targetUserId: string;
  targetTenantId: string;
  /** The platform operator behind the session (RFC 8693 `act.sub`). Never becomes `userId`: the reads are made ON
   *  BEHALF of the target, and an audit trail that recorded the operator as the actor of a farmer's page view would be
   *  describing a different event. */
  actorAdminId: string;
  /** The grant id, and also the token's `jti` — so revoking the grant invalidates the token server-side. */
  grantId: string;
  scope: 'read_only';
  expSec: number;
  issuedAtSec: number;
}

export class ImpersonationTokenError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ImpersonationTokenError'; }
}

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Cheap pre-check: is this bearer even an impersonation token? Used before verification so an ordinary access token
 * never pays for a second signature check, and so a malformed bearer produces the ordinary 401 rather than an
 * impersonation-specific error that would tell an attacker which of two secrets they missed.
 *
 * Reads the payload WITHOUT verifying, which is safe only because the answer is used to CHOOSE A VERIFIER and never to
 * grant anything. Stated explicitly because "decode without verify" is otherwise a red flag in review.
 */
export function looksLikeImpersonationToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(fromB64url(parts[1]).toString('utf8')) as { typ?: unknown };
    return payload?.typ === 'impersonation';
  } catch { return false; }
}

export interface VerifyInput {
  secret: string;
  issuer: string;
  audience: string;
  nowSec?: number;
}

/** Verify an act-as token. Throws on ANY failure — there is no partial success and no degraded mode here. */
export function verifyImpersonationToken(token: string, input: VerifyInput): ImpersonationClaims {
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (!token) throw new ImpersonationTokenError('missing token');
  if (!input.secret) {
    // A misconfigured secret must never verify anything. Without this, an empty secret would still produce a valid HMAC
    // over attacker-controlled bytes and every forged token would be accepted.
    throw new ImpersonationTokenError('impersonation verification is not configured');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new ImpersonationTokenError('malformed token');
  const [h, p, s] = parts;

  let header: Record<string, unknown>; let payload: Record<string, unknown>;
  try {
    header = JSON.parse(fromB64url(h).toString('utf8')) as Record<string, unknown>;
    payload = JSON.parse(fromB64url(p).toString('utf8')) as Record<string, unknown>;
  } catch { throw new ImpersonationTokenError('undecodable token'); }

  if (header?.alg !== 'HS256') throw new ImpersonationTokenError('unexpected alg');   // pinned — no alg confusion
  const expected = createHmac('sha256', input.secret).update(`${h}.${p}`).digest();
  const given = fromB64url(s);
  // Length check first: timingSafeEqual throws on a length mismatch, and a thrown TypeError would escape as a 500
  // rather than a 401 — an attacker could then distinguish "wrong length" from "wrong bytes" by status code alone.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new ImpersonationTokenError('bad signature');
  }

  if (payload.typ !== 'impersonation') throw new ImpersonationTokenError('not an impersonation token');
  if (payload.iss !== input.issuer) throw new ImpersonationTokenError('bad issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(input.audience)) throw new ImpersonationTokenError('bad audience');
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) throw new ImpersonationTokenError('token expired');
  // **THE SCOPE IS CHECKED HERE AND ENFORCED ELSEWHERE, AND BOTH ARE NECESSARY.** This refuses a token whose scope is
  // anything but read_only — which cannot be minted today, because both the minter and the CHECK constraint allow one
  // value. If that ever changes, this verifier refuses the new value rather than quietly honouring it, so widening the
  // scope requires a deliberate change HERE as well as there. Method-level enforcement is `ImpersonationReadOnlyGuard`.
  if (payload.scope !== 'read_only') throw new ImpersonationTokenError('non read-only scope refused');

  const act = payload.act as { sub?: unknown } | undefined;
  const targetUserId = typeof payload.sub === 'string' ? payload.sub : '';
  const targetTenantId = typeof payload.tid === 'string' ? payload.tid : '';
  const actorAdminId = typeof act?.sub === 'string' ? act.sub : '';
  const grantId = typeof payload.jti === 'string' ? payload.jti : '';
  // Every one of these is load-bearing downstream: no target user and the reads have no subject; no tenant and RLS has
  // no scope; no actor and the action log cannot name who looked; no grant id and the gate cannot check whether the
  // session is still live. A token missing any of them is refused rather than partially honoured.
  if (!targetUserId || !targetTenantId || !actorAdminId || !grantId) {
    throw new ImpersonationTokenError('missing required claims');
  }

  return {
    targetUserId, targetTenantId, actorAdminId, grantId,
    scope: 'read_only',
    expSec: payload.exp as number,
    issuedAtSec: typeof payload.iat === 'number' ? payload.iat : 0,
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* READ-ONLY, AS A METHOD RULE                                                                       */
/* ------------------------------------------------------------------------------------------------ */

/** The methods an impersonated session may use. HEAD and OPTIONS are included because a browser sends them and neither
 *  can change state; everything else — including POST — is refused, and refused for POST specifically even though some
 *  read APIs use POST bodies. A read that has to be a POST is a read this session does not get: guessing which POSTs are
 *  safe is how a read-only scope becomes read-mostly. */
export const IMPERSONATION_SAFE_METHODS: readonly string[] = Object.freeze(['GET', 'HEAD', 'OPTIONS']);

export function isSafeForImpersonation(method: string): boolean {
  return IMPERSONATION_SAFE_METHODS.includes((method || '').toUpperCase());
}
