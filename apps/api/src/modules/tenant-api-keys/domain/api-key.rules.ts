// modules/tenant-api-keys/domain/api-key.rules.ts · PC-56 TENANT-13c (F-9). PURE rules for tenant API-key material, the per-key
// quota window and the console's issuing form. No DB, no Nest, no clock of its own (time-dependent functions take nowMs).
// The pattern of record is the partner realm (`partner-api/domain/partner-key.rules.ts`): sha256 + timingSafeEqual, exact-match
// scopes, a per-key fixed hourly window, a unique lookup prefix.
//
// KEY SHAPE  `kv_live_<prefix>_<secret>`
//   • `kv_live_a1b2c3d4` — the PREFIX: 8 of [a-z0-9] after `kv_live_`. Stored plainly, UNIQUE (0193): the guard does ONE indexed
//     read by it. Safe to print in the console and to quote in a support ticket.
//   • `<secret>` — 32 base64url characters (24 bytes of CSPRNG entropy, 192 bits). NEVER stored: we keep sha256(secret) only.
//   • `kv_test_` is not issued: the platform has no tenant sandbox mode, so every key is live (the console says so).
//
// WHY SHA-256 AND NOT A SLOW HASH: the secret is 192 random bits, not a human password — there is no dictionary to slow down, and a
// work factor would be paid on every API call. The comparison is constant-time. (The partner realm's reasoning, verbatim in spirit.)
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { TENANT_KEY_RE } from '../../../core/auth/api-key.port';
import { isKnownScope, needsChecker } from './api-scopes';

export const KEY_LABEL = 'kv_live';
export const RATE_DEFAULT = 1_000;
export const RATE_MAX = 10_000;
export const RATE_MIN = 1;
export const HOUR_MS = 3_600_000;
export const TOUCH_DEBOUNCE_MS = 60_000;
/** The real bound the console prints: revocation is read on EVERY call (the guard's lookup hits the row, no cache), so it takes
 *  effect on the next call; 60 s is the promise's ceiling, kept so the copy never over-promises if a cache is ever added. */
export const REVOCATION_BOUND_SECONDS = 60;
const HEX64_RE = /^[0-9a-f]{64}$/;
const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function formatKey(prefixHandle: string, secret: string): string { return `${KEY_LABEL}_${prefixHandle}_${secret}`; }
export function prefixOf(handle: string): string { return `${KEY_LABEL}_${handle}`; }

/** A fresh key: an unbiased 8-character handle and a 32-character base64url secret. */
export function generateKey(rand: (n: number) => Buffer = randomBytes): { handle: string; prefix: string; secret: string; key: string } {
  let handle = '';
  while (handle.length < 8) {
    for (const b of rand(16)) {
      if (b < 252 && handle.length < 8) handle += PREFIX_ALPHABET[b % 36];   // 252 = 7 × 36: rejection sampling, no modulo bias
    }
  }
  const secret = rand(24).toString('base64url');   // 24 bytes → exactly 32 characters
  return { handle, prefix: prefixOf(handle), secret, key: formatKey(handle, secret) };
}

/** Split a presented key; null for ANYTHING malformed (a junk header costs one regex, never a query). */
export function parseKey(raw: string | null | undefined): { prefix: string; secret: string } | null {
  if (!raw) return null;
  const m = TENANT_KEY_RE.exec(String(raw).trim());
  return m ? { prefix: prefixOf(m[1]), secret: m[2] } : null;
}

export function hashSecret(secret: string): string { return createHash('sha256').update(secret, 'utf8').digest('hex'); }

/** Constant-time comparison against the stored hash. A malformed stored hash is a MISS, never a pass. */
export function secretMatches(secret: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !HEX64_RE.test(storedHash)) return false;
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fixed hourly window keyed on the KEY (an ERP calls from many hosts; two integrations must not starve each other). */
export function rateWindowKey(keyId: string, nowMs: number): string { return `tk:rl:${keyId}:${Math.floor(nowMs / HOUR_MS)}`; }
/** Seconds until the current window closes — the `Retry-After` a 429 carries. */
export function secondsToWindowEnd(nowMs: number): number { return Math.max(1, Math.ceil((HOUR_MS - (nowMs % HOUR_MS)) / 1000)); }
/** One last_used_at stamp per key per minute (the database debounces too — api_key_touch). */
export function touchWindowKey(keyId: string, nowMs: number): string { return `tk:touch:${keyId}:${Math.floor(nowMs / TOUCH_DEBOUNCE_MS)}`; }

// ---- the issuing form (W2488–W2491) ----

export interface KeyDraft { name: string; scopes: string[]; ratePerHour: number; expiresAt: string | null; reason: string }
export interface DraftRefusal { field: 'name' | 'scopes' | 'ratePerHour' | 'expiresAt' | 'reason'; code: string; detail?: string }

/** Every refusal a draft earns, against its field — the review page IS the form-error page (the 13a pattern). */
export function reviewDraft(d: Partial<KeyDraft>, nowMs: number): { draft: KeyDraft; refusals: DraftRefusal[]; checker: boolean } {
  const name = String(d.name ?? '').trim();
  const scopes = [...new Set((Array.isArray(d.scopes) ? d.scopes : []).map((s) => String(s).trim()).filter(Boolean))];
  const rate = d.ratePerHour === undefined || d.ratePerHour === null ? RATE_DEFAULT : Number(d.ratePerHour);
  const expiresAt = d.expiresAt ? String(d.expiresAt) : null;
  const reason = String(d.reason ?? '').trim();
  const refusals: DraftRefusal[] = [];
  if (name.length < 3 || name.length > 100) refusals.push({ field: 'name', code: 'name_length' });
  if (scopes.length === 0) refusals.push({ field: 'scopes', code: 'scopes_empty' });
  for (const s of scopes) if (!isKnownScope(s)) refusals.push({ field: 'scopes', code: 'scope_unknown', detail: s });
  if (scopes.length > 20) refusals.push({ field: 'scopes', code: 'scopes_too_many' });
  if (!Number.isInteger(rate) || rate < RATE_MIN || rate > RATE_MAX) refusals.push({ field: 'ratePerHour', code: 'rate_range', detail: `${RATE_MIN}–${RATE_MAX}` });
  if (expiresAt !== null) {
    const t = Date.parse(expiresAt);
    if (!Number.isFinite(t)) refusals.push({ field: 'expiresAt', code: 'expiry_invalid' });
    else if (t <= nowMs + HOUR_MS) refusals.push({ field: 'expiresAt', code: 'expiry_too_soon' });
    else if (t > nowMs + 2 * 365 * 24 * HOUR_MS) refusals.push({ field: 'expiresAt', code: 'expiry_too_far' });
  }
  const checker = needsChecker(scopes.filter(isKnownScope));
  // a checker key carries the proposal's reason (20–500, the 13b shape); an ordinary key's reason is optional (≤ 500)
  if (checker && (reason.length < 20 || reason.length > 500)) refusals.push({ field: 'reason', code: 'reason_checker' });
  if (!checker && reason.length > 500) refusals.push({ field: 'reason', code: 'reason_long' });
  return { draft: { name, scopes, ratePerHour: rate, expiresAt, reason }, refusals, checker };
}

/** A revocation's reason: 5–300 characters (0123 column), required. */
export function revokeReasonRefusal(reason: string | null | undefined): string | null {
  const r = String(reason ?? '').trim();
  if (r.length < 5) return 'reason_required';
  if (r.length > 300) return 'reason_long';
  return null;
}

/** A proposal refusal's reason: 20–500 (the 13b shape). */
export function refuseReasonRefusal(reason: string | null | undefined): string | null {
  const r = String(reason ?? '').trim();
  return r.length < 20 || r.length > 500 ? 'reason_refuse' : null;
}
