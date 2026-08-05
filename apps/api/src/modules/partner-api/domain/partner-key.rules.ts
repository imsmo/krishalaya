// modules/partner-api/domain/partner-key.rules.ts · PC-55 A10. PURE rules for partner API-key material and the
// per-key quota window. No DB, no Nest, no clock of its own (every time-dependent function takes nowMs) — so every
// claim below is unit-provable and the guard, the mint script and any future surface can never disagree about what a
// valid key is.
//
// KEY SHAPE  `kv_pk_<env>_<handle>.<secret>`
//   • `kv_pk_live_a1b2c3d4e5f6` — the PREFIX. Stored plainly, uniquely indexed: it is the lookup handle, so the
//     guard does ONE indexed read instead of hashing against every row in the table. Safe to log, safe to print in
//     an ops console, safe to quote in a support ticket.
//   • `<secret>` — 32 bytes of CSPRNG entropy, base64url. NEVER stored. We keep only SHA-256(secret).
// The two halves are split by '.' which base64url cannot produce, so parsing is unambiguous.
//
// WHY SHA-256 AND NOT BCRYPT/ARGON2 (a deliberate, reasoned exception to password dogma): a password is low-entropy
// and human-chosen, so it needs a work factor to survive an offline dictionary attack. This secret is 256 bits of
// randomness — there is no dictionary, and no attacker gains anything from a slow hash — while a work factor WOULD
// be paid on every single API call a bank makes. The comparison is constant-time (`secretMatches`), so the fast hash
// costs us nothing in safety. Documented here because a reviewer SHOULD challenge it.
//
// NO WILDCARD SCOPE, EVER. `hasScope` does exact matching only: there is no '*' and no 'insurance:*' family form. A
// partner key must never be able to become god-mode by a typo in a scopes array, and a new capability must be
// granted deliberately rather than inherited silently by every key ever minted. (Rule Zero: the expensive path.)
import { createHash, timingSafeEqual } from 'node:crypto';

/** Every scope a partner key may hold. Reads only — this realm has no write capability by construction (A10).
 *  `partner:identity:read` is the credential-check scope (GET /me): it exposes only the key's OWN identity and
 *  limits, so every key is minted with it and an integrator can verify their credential without being entitled to a
 *  single farmer's record. The two book scopes are granted independently — an insurer key has no lending reach and
 *  a lender key has no insurance reach, even when the same institution holds both. */
export const PARTNER_SCOPES = ['partner:identity:read', 'insurance:book:read', 'lending:book:read'] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export const KEY_LABEL = 'kv_pk';
const PREFIX_RE = /^kv_pk_(live|test)_[a-z0-9]{12,32}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{32,86}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

/** The canonical wire form. The mint script builds keys with this exact shape (db/scripts/mint-partner-key.js). */
export function formatKey(env: 'live' | 'test', handle: string, secret: string): string {
  return `${KEY_LABEL}_${env}_${handle}.${secret}`;
}

/** Split a presented key into its lookup handle and its secret. Returns null for ANYTHING malformed — a rejected
 *  shape never reaches the database, so a junk header costs one regex, not a query. */
export function parseKey(raw: string | undefined | null): { prefix: string; secret: string } | null {
  if (!raw) return null;
  const value = raw.trim();
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const prefix = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!PREFIX_RE.test(prefix) || !SECRET_RE.test(secret)) return null;
  return { prefix, secret };
}

/** Accepts `Authorization: Bearer <key>` or a bare key (X-Partner-Key). Case-insensitive scheme. */
export function keyFromHeaders(authorization?: string, partnerKeyHeader?: string): string | null {
  if (partnerKeyHeader && partnerKeyHeader.trim()) return partnerKeyHeader.trim();
  if (!authorization) return null;
  const m = /^bearer\s+(.+)$/i.exec(authorization.trim());
  return m ? m[1].trim() : null;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time comparison against the stored hash. A malformed stored hash is a MISS, never a pass. */
export function secretMatches(secret: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !HEX64_RE.test(storedHash)) return false;
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface KeyState { isActive: boolean; revokedAt: string | null }
/** A key is usable only while BOTH facts hold. Revocation is permanent: re-activating `is_active` cannot resurrect
 *  a revoked key, so "revoke" is a promise we can actually keep. */
export function isUsable(k: KeyState): boolean {
  return k.isActive === true && !k.revokedAt;
}

/** Exact-match scope check — see the no-wildcard note in this file's header. */
export function hasScope(granted: readonly string[] | null | undefined, required: string): boolean {
  if (!granted || !required) return false;
  return granted.includes(required);
}

/** Scopes a mint attempt may carry. Anything unknown is returned so the caller can refuse rather than store junk
 *  that would later read as "no capability" (silent breakage) or, worse, be matched by a future scope name. */
export function unknownScopes(scopes: readonly string[]): string[] {
  return scopes.filter((s) => !(PARTNER_SCOPES as readonly string[]).includes(s));
}

/** Page sizes are OURS to decide, not the caller's: a partner book spans tenants, so an unbounded LIMIT is a
 *  cross-tenant table scan. Anything absent/NaN/≤0 → `def`; anything greedy → `max`. */
export function clampLimit(raw: unknown, def = 50, max = 200): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

export const HOUR_MS = 3_600_000;
/** Fixed-window quota key. rate_limit_per_hour is a per-KEY contract quota, so the window is keyed on the key id —
 *  not on IP (a bank calls from many hosts) and not on the partner (two integrations shouldn't starve each other). */
export function rateWindowKey(keyId: string, nowMs: number): string {
  return `pk:rl:${keyId}:${Math.floor(nowMs / HOUR_MS)}`;
}
/** last_used_at is useful for spotting a dead or stolen integration, but writing it on every request would turn a
 *  read API into a write API. One stamp per minute per key is all the resolution that fact needs. */
export function touchWindowKey(keyId: string, nowMs: number): string {
  return `pk:touch:${keyId}:${Math.floor(nowMs / 60_000)}`;
}
