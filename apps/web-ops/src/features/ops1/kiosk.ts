// apps/web-ops/src/features/ops1/kiosk.ts · PC-56 OPS-1c — PURE helpers for the kiosk pages (founder Q4-A′, Q6-A, Q8-A, Q9-A, Q10-A, Q11-A).
// Framework-free and unit-provable: the canon addresses, the old-address 307, the steps the kiosk home links to, the create act's chain
// result codes (the server's own reasons, named), and the page state a `/me` read answered. No money math: an amount is only ever handed to
// the money formatter — never added, multiplied or totalled (the earnings read returns rows and no total, so none is printed).
// The phone NEVER enters a URL: the create act reads it from the posted form and redirects with `?act=` and a reason code only.
import { kioskCreateOutcome } from '../kiosk/form';

export const KIOSK_HOME = '/kiosk/home';                  // W380 (read: her own profile + earnings)
export const KIOSK_START = '/kiosk/session-start';        // W381 (the create act, REAL) + the W3329–W3331 chain (`?act=`)
export const KIOSK_PROFILE = '/kiosk/profile';            // W382 (honest — the deviation: name + language live on W381's one form)
export const KIOSK_LAND = '/kiosk/land-crops';            // W383 (honest)
export const KIOSK_KYC = '/kiosk/kyc';                    // W384 (honest, Q6-A)
export const KIOSK_BANK = '/kiosk/bank';                  // W385 (honest)
export const KIOSK_LISTING = '/kiosk/first-listing';      // W386 (honest, Q8-A)
export const KIOSK_SCHEMES = '/kiosk/schemes';            // W387 (honest)
export const KIOSK_SUMMARY = '/kiosk/summary';            // W388 (honest, Q4-A′ + Q11-A)
export const KIOSK_EARNINGS = '/kiosk/ambassador';        // W389 (read: her own earnings rows)

/** The old OW-1 address → its canon home: a REAL HTTP 307 in next.config.js (pinned equal by test/ops1c-pages.spec.ts). */
export const OPS1C_REDIRECTS: readonly { source: string; destination: string }[] = Object.freeze([{ source: '/kiosk', destination: KIOSK_HOME }]);

/** Every step the kiosk home links to (W381–W389), in canon order; each label is `ops1.kiosk.step.<id>` ×3. */
export const KIOSK_STEPS: readonly { id: string; href: string }[] = Object.freeze([
  { id: 'start', href: KIOSK_START }, { id: 'profile', href: KIOSK_PROFILE }, { id: 'land', href: KIOSK_LAND }, { id: 'kyc', href: KIOSK_KYC },
  { id: 'bank', href: KIOSK_BANK }, { id: 'listing', href: KIOSK_LISTING }, { id: 'schemes', href: KIOSK_SCHEMES }, { id: 'summary', href: KIOSK_SUMMARY },
  { id: 'earnings', href: KIOSK_EARNINGS },
]);

/** Why the create act created nothing — every value is a key `ops1.kiosk.reason.<code>` ×3, printed on the failure state (W3331). */
export const KIOSK_FAILURE_REASONS = ['exists', 'phone', 'name', 'lang', 'rule', 'forbidden', 'create'] as const;
export type KioskFailureReason = (typeof KIOSK_FAILURE_REASONS)[number];

/** The server's answer → the reason the page names. 409 USER_PHONE_ALREADY_REGISTERED → `exists` (Q9-A: the number has an account — nothing
 *  about the person; decided by HOTFIX-10's `kioskCreateOutcome`, so a different 409, e.g. a key still in flight, is never "exists") ·
 *  400 / 422 → a field rule · 403 → this sign-in may not create accounts · anything else → nothing was created. */
export function kioskFailureReason(status: number | undefined, code: string | undefined | null): KioskFailureReason {
  if (kioskCreateOutcome({ ok: false, status, code: code ?? undefined }) === 'exists') return 'exists';
  if (status === 403) return 'forbidden';
  if (status === 400 || status === 422) return 'rule';
  return 'create';
}
export function isKioskFailureReason(v: unknown): v is KioskFailureReason {
  return typeof v === 'string' && (KIOSK_FAILURE_REASONS as readonly string[]).includes(v);
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** The reason in a failure URL, or 'create' when missing or not one of ours (an injected value is never echoed). */
export function parseKioskReason(searchParams: Record<string, string | string[] | undefined> | undefined): KioskFailureReason {
  const v = first(searchParams?.reason);
  return isKioskFailureReason(v) ? v : 'create';
}

/** What the `/v1/ambassadors/me` (and `/me/earnings`) read answered, as the page's state:
 *  ok · none (404 AMBASSADOR_NOT_FOUND — this sign-in has no ambassador profile here; most ops staff are tenant administrators) ·
 *  off (any other 404 — the `ambassadors` module is switched off; the flag guard answers a bare 404) · error. */
export type KioskReadState = 'ok' | 'none' | 'off' | 'error';
export function kioskReadState(result: 'ok' | { status: number; code?: string | null } | 'failed'): KioskReadState {
  if (result === 'ok') return 'ok';
  if (result === 'failed') return 'error';
  if (result.status === 404) return result.code === 'AMBASSADOR_NOT_FOUND' ? 'none' : 'off';
  return 'error';
}

/** An earning row is "in a pay run" when the server stamped a payout on it, else "not yet paid" — the server's fact, never a judgement. */
export function earningPaid(e: { payoutId?: string | null }): boolean { return typeof e.payoutId === 'string' && e.payoutId.length > 0; }
