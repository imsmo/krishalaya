// modules/payments/domain/payment-attempt.ts · PC-56 STORE-2c · B3 (survey B6 / B22 / F-4) — ONE ORDER, ONE LIVE ATTEMPT; A FAILURE SAID BY CODE. PURE.
//
// ATTEMPTS. An order is paid through ATTEMPTS — each a gateway order and a Payment row. Before this wave the storefront reused one stable key
// (`order-pay:<orderId>`), so "Send again" after a lapsed UPI collect replayed the SAME intent; and nothing stopped a second live gateway order
// for the same order (two sheets, two captures). The rule now: an attempt is LIVE while it is initiated / pending / authorized and younger than
// `platform.payment_attempt_ttl_seconds` (0209 — a setting, never a literal); a second attempt is refused while one is live; a NEW attempt
// (new gateway order, new row) is allowed once the previous one FAILED or LAPSED. An authorized card hold is never lapsed by us (only the
// gateway can release it), so it stays live past the TTL.
//
// FAILURE REASONS. The gateway's reason is stored as it came (`failure_reason`); the buyer's page is given a CODE it localizes, never the
// provider's English. `chargedNothing` is true only for failures that happen BEFORE money leaves the buyer (cancelled, timed out, declined,
// insufficient funds, a failed OTP / PIN, a limit) — for a technical error the bank may have debited and will reverse, so the page does not
// claim "you were not charged". (The mapping follows Razorpay's documented `error_reason` values; UNPROVEN in test mode — wave report §8.)
export type AttemptStatus = 'initiated' | 'pending' | 'authorized' | 'success' | 'failed' | 'expired' | 'refund_initiated' | 'refunded' | 'partially_refunded';

export interface AttemptFacts { id: string; status: AttemptStatus | string; createdAt: Date }

/** When an attempt stops being live (null = the TTL is not configured → it never lapses by time; it can still fail). */
export function attemptExpiresAt(createdAt: Date, ttlSeconds: number | null): Date | null {
  if (ttlSeconds === null || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return null;
  return new Date(createdAt.getTime() + ttlSeconds * 1000);
}

/** Is this attempt LIVE now — could it still be paid? */
export function isLiveAttempt(a: AttemptFacts, ttlSeconds: number | null, now: Date): boolean {
  if (a.status === 'authorized') return true;                       // a card hold: only the gateway ends it
  if (a.status !== 'initiated' && a.status !== 'pending') return false;
  const exp = attemptExpiresAt(a.createdAt, ttlSeconds);
  return exp === null || exp.getTime() > now.getTime();
}

/** Has this attempt LAPSED by time (initiated / pending past the TTL) — the platform marks it `expired` when a fresh attempt replaces it. */
export function isLapsedAttempt(a: AttemptFacts, ttlSeconds: number | null, now: Date): boolean {
  if (a.status !== 'initiated' && a.status !== 'pending') return false;
  const exp = attemptExpiresAt(a.createdAt, ttlSeconds);
  return exp !== null && exp.getTime() <= now.getTime();
}

/** The buyer-facing failure vocabulary (the storefront has one catalogue key per code — en/hi/gu). */
export const FAILURE_REASON_CODES = ['cancelled', 'timed_out', 'declined', 'insufficient_funds', 'authentication_failed', 'limit_exceeded', 'gateway_error', 'unknown'] as const;
export type FailureReasonCode = (typeof FAILURE_REASON_CODES)[number];

const RULES: ReadonlyArray<[RegExp, FailureReasonCode]> = [
  [/cancel/, 'cancelled'],
  [/timed?[_ ]?out|expired/, 'timed_out'],
  [/insufficient|balance/, 'insufficient_funds'],
  [/otp|pin|authenticat|3ds|verification/, 'authentication_failed'],
  [/limit/, 'limit_exceeded'],
  [/declin|reject|not_allowed|blocked|invalid_(card|vpa|account)/, 'declined'],
  [/technical|server|gateway|bank_error|network|unavailable/, 'gateway_error'],
];

/** The code for a stored gateway reason (and code). Unrecognised → `unknown` (said as "the payment did not go through"). */
export function failureReasonCode(reason: string | null | undefined, code?: string | null): FailureReasonCode {
  const text = `${reason ?? ''} ${code ?? ''}`.toLowerCase();
  if (!text.trim()) return 'unknown';
  for (const [re, c] of RULES) if (re.test(text)) return c;
  if (/gateway_error|server_error/.test(text)) return 'gateway_error';
  return 'unknown';
}

/** Failures that happen before any money leaves the buyer — only these let the page say "nothing was charged". */
const PRE_DEBIT: ReadonlySet<FailureReasonCode> = new Set<FailureReasonCode>(['cancelled', 'timed_out', 'declined', 'insufficient_funds', 'authentication_failed', 'limit_exceeded']);
export function chargedNothing(c: FailureReasonCode): boolean { return PRE_DEBIT.has(c); }
