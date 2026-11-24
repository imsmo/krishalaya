// apps/admin-api/src/modules/operator-auth/domain/oidc.ts · PC-56 ADMIN-AUTH-1 — OpenID Connect id_token verification.
//
// DEPENDENCY-FREE, like the admin JWT strategy: Node `crypto` only. An id_token is a JWS; verifying one needs base64url,
// JSON, a JWK → KeyObject (`createPublicKey({ key: jwk, format: 'jwk' })`) and `crypto.verify`. A JOSE library would add a
// supply-chain surface to the realm's front door for four lines of code. (WebAuthn is the opposite case — see
// webauthn.ceremony.ts — and is why that one IS a dependency.)
//
// What is checked, and why each one:
//   • alg ∈ {RS256, ES256} — pinned. `none` is no signature; HS256 would let anybody holding the CLIENT SECRET (which a
//     confidential client stores in plain config) forge an IdP token. Anything else is refused.
//   • the key: by `kid` from the issuer's JWKS; kty/crv must match the alg; `use`/`alg` on the JWK, when present, must agree.
//   • iss === the configured issuer (exact string), aud contains our client_id (and azp === client_id when aud has more
//     than one entry), exp in the future and iat not in the future (60 s skew), and iat not ancient (10 min).
//   • nonce === the one this realm generated for THIS flow (constant-time) — binds the token to our authorization request.
//   • email_verified === true (strictly boolean true), and the email's domain ∈ ADMIN_OIDC_ALLOWED_DOMAINS, and Google's
//     `hd` claim ∈ the same list whenever it is present.
import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify, KeyObject, randomBytes, type JsonWebKey } from 'node:crypto';
import { emailDomain, normaliseEmail } from '../../../core/auth/operator-bindings';

export const ID_TOKEN_SKEW_SEC = 60;
export const ID_TOKEN_MAX_AGE_SEC = 600;
export const ALLOWED_ID_TOKEN_ALGS = ['RS256', 'ES256'] as const;

export class IdTokenError extends Error {
  constructor(public readonly reason: string) { super(`id_token refused: ${reason}`); this.name = 'IdTokenError'; }
}

export interface Jwk { kty: string; kid?: string; use?: string; alg?: string; n?: string; e?: string; crv?: string; x?: string; y?: string }

export interface VerifiedIdentity { issuer: string; subject: string; email: string; hd: string | null }

export interface IdTokenExpectations {
  issuer: string;
  clientId: string;
  nonce: string;
  allowedDomains: readonly string[];
}

/** Supplies the verification key for a kid. `refresh` asks for a JWKS refetch (bounded by the caller's cache). */
export interface KeyResolver { keyFor(kid: string | undefined, refresh: boolean): Promise<Jwk | null> }

export const b64urlDecode = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
export const b64urlEncode = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const sha256hex = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => b64urlEncode(randomBytes(bytes));

/** PKCE S256 (RFC 7636): verifier = 43 base64url chars of 32 random bytes; challenge = b64url(sha256(verifier)). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  return { verifier, challenge: b64urlEncode(createHash('sha256').update(verifier).digest()) };
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8'); const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function keyMatchesAlg(jwk: Jwk, alg: string): boolean {
  if (jwk.use && jwk.use !== 'sig') return false;
  if (jwk.alg && jwk.alg !== alg) return false;
  if (alg === 'RS256') return jwk.kty === 'RSA';
  if (alg === 'ES256') return jwk.kty === 'EC' && jwk.crv === 'P-256';
  return false;
}

function verifySignature(alg: string, key: KeyObject, data: Buffer, sig: Buffer): boolean {
  if (alg === 'RS256') return cryptoVerify('sha256', data, key, sig);
  if (alg === 'ES256') return cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
  return false;
}

/** Verify an id_token. Throws IdTokenError (reason is an audit code, never shown to the browser). */
export async function verifyIdToken(
  idToken: string, exp: IdTokenExpectations, keys: KeyResolver, nowSec = Math.floor(Date.now() / 1000),
): Promise<VerifiedIdentity> {
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3 || !parts[0] || !parts[1]) throw new IdTokenError('malformed');
  let header: { alg?: unknown; kid?: unknown; typ?: unknown }; let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch { throw new IdTokenError('undecodable'); }
  const alg = String(header?.alg ?? '');
  if (!(ALLOWED_ID_TOKEN_ALGS as readonly string[]).includes(alg)) throw new IdTokenError(`alg_not_allowed:${alg || 'missing'}`);
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const sig = b64urlDecode(parts[2]);
  if (sig.length === 0) throw new IdTokenError('no_signature');

  // Unknown kid → ONE refetch (the IdP rotated its keys). The resolver bounds how often a refetch actually happens, so a
  // stream of forged kids cannot turn this realm into a JWKS-hammering amplifier.
  let jwk = await keys.keyFor(kid, false);
  if (!jwk) jwk = await keys.keyFor(kid, true);
  if (!jwk) throw new IdTokenError('unknown_kid');
  if (!keyMatchesAlg(jwk, alg)) throw new IdTokenError('key_alg_mismatch');
  let key: KeyObject;
  try { key = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' }); }
  catch { throw new IdTokenError('bad_jwk'); }
  if (!verifySignature(alg, key, Buffer.from(`${parts[0]}.${parts[1]}`), sig)) throw new IdTokenError('bad_signature');

  if (payload.iss !== exp.issuer) throw new IdTokenError('bad_issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud ?? '')];
  if (!aud.includes(exp.clientId)) throw new IdTokenError('bad_audience');
  if (aud.length > 1 && payload.azp !== exp.clientId) throw new IdTokenError('bad_azp');
  if (typeof payload.exp !== 'number' || payload.exp + ID_TOKEN_SKEW_SEC <= nowSec) throw new IdTokenError('expired');
  if (typeof payload.iat !== 'number' || payload.iat - ID_TOKEN_SKEW_SEC > nowSec) throw new IdTokenError('iat_in_future');
  if (nowSec - payload.iat > ID_TOKEN_MAX_AGE_SEC + ID_TOKEN_SKEW_SEC) throw new IdTokenError('iat_too_old');
  if (typeof payload.nonce !== 'string' || !constantTimeEqual(payload.nonce, exp.nonce)) throw new IdTokenError('bad_nonce');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new IdTokenError('no_subject');
  if (payload.email_verified !== true) throw new IdTokenError('email_not_verified');
  if (typeof payload.email !== 'string' || !payload.email.includes('@')) throw new IdTokenError('no_email');

  const email = normaliseEmail(payload.email);
  const allowed = exp.allowedDomains.map((d) => d.toLowerCase());
  if (allowed.length === 0) throw new IdTokenError('no_allowed_domains_configured');
  if (!allowed.includes(emailDomain(email))) throw new IdTokenError('email_domain_not_allowed');
  const hd = typeof payload.hd === 'string' ? payload.hd.toLowerCase() : null;
  if (payload.hd !== undefined && (hd === null || !allowed.includes(hd))) throw new IdTokenError('hd_not_allowed');

  return { issuer: exp.issuer, subject: payload.sub, email, hd };
}
