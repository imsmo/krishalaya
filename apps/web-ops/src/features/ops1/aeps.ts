// apps/web-ops/src/features/ops1/aeps.ts · PC-56 OPS-1b — PURE helpers for the AePS log pages and the biometric pages (founder Q1-A, Q5-A,
// Q7-A). Framework-free and unit-provable: the canon addresses, the old-address 307s, the record act's chain result codes (the server's own
// reasons, named), what "did not go straight through" means for an event, and which exceptions view a URL asks for. No money math: an amount
// is only ever handed to the money formatter, never added, subtracted or averaged.
export const AEPS_HOME = '/aeps/home';                       // W390 (honest, reads nothing)
export const AEPS_RECORD = '/aeps/withdrawal';               // W391 (the record act, REAL) + the W3289–W3291 chain (`?act=`)
export const AEPS_EXCEPTIONS = '/aeps/exceptions';           // W392 (read: own; `?view=all` the audited supervisor read)
export const AEPS_RECEIPT = '/aeps/receipt';                 // W393 (honest: there is no receipt here)
export const FACE_ENROLL = '/attendance/face-enroll';        // W397 (honest)
export const FACE_ATTENDANCE = '/attendance/face-attendance';// W398 (honest — see the registry note for why it is not a read)
export const BIOMETRIC_CANON = '/canon/biometric';           // W399 (honest reference)

/** The old OW-5 addresses → their canon homes: REAL HTTP 307s in next.config.js (pinned equal by test/ops1b-pages.spec.ts). */
export const OPS1B_REDIRECTS: readonly { source: string; destination: string }[] = Object.freeze([
  { source: '/money', destination: AEPS_RECORD },
  { source: '/money/oversight', destination: `${AEPS_EXCEPTIONS}?view=all` },
]);

/** Why the record act did not record — every value is a key `ops1.aeps.reason.<code>` ×3 and is printed on the failure state (W3291). */
export const AEPS_FAILURE_REASONS = [
  'notEnabled', 'off', 'q7aAadhaar', 'q7aCustomer', 'rule', 'dup', 'record',
  'ev_serviceKind', 'ev_status', 'ev_attempt', 'ev_exception', 'ev_amountMissing', 'ev_amountNotAllowed', 'ev_amount', 'ev_balance',
  'ev_last4Account', 'ev_uncertified', 'ev_escalation', 'ev_successException', 'ev_rrn',
] as const;
export type AepsFailureReason = (typeof AEPS_FAILURE_REASONS)[number];

/** The server's answer → the failure reason the page names. 403 not enabled · 404 switched off · 400 a Q7-A refusal BY ITS CODE, or a rule ·
 *  422 a rule · 409 already recorded · anything else: not recorded. */
export function aepsFailureReason(status: number, code: string | undefined | null): AepsFailureReason {
  if (status === 403) return 'notEnabled';
  if (status === 404) return 'off';
  if (code === 'AEPS_AADHAAR_NOT_RECORDED') return 'q7aAadhaar';
  if (code === 'AEPS_CUSTOMER_LINK_NOT_RECORDED') return 'q7aCustomer';
  if (status === 400 || status === 422) return 'rule';
  if (status === 409) return 'dup';
  return 'record';
}
export function isAepsFailureReason(v: unknown): v is AepsFailureReason {
  return typeof v === 'string' && (AEPS_FAILURE_REASONS as readonly string[]).includes(v);
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** The reason in a failure URL, or 'record' when it is missing or not one of ours (an injected value is never echoed). */
export function parseAepsReason(searchParams: Record<string, string | string[] | undefined> | undefined): AepsFailureReason {
  const v = first(searchParams?.reason);
  return isAepsFailureReason(v) ? v : 'record';
}

/** W392's two views: the operator's own events (default) or the supervisor's read of every operator's (`?view=all`, audited server-side). */
export type ExceptionsView = 'mine' | 'all';
export function exceptionsView(searchParams: Record<string, string | string[] | undefined> | undefined): ExceptionsView {
  return first(searchParams?.view) === 'all' ? 'all' : 'mine';
}
/** An event that "did not go straight through": every result but a success (the log's own status — never a judgement of the person). */
export function isException(e: { status?: string | null }): boolean { return e.status !== 'success'; }

export type ExceptionsState = 'ok' | 'empty' | 'not_enabled' | 'forbidden' | 'off' | 'error';
/** The page state from what the read answered: 403 on the own view = not an AePS-enabled ambassador; 403 on `all` = no supervisor permission. */
export function exceptionsState(view: ExceptionsView, result: 'ok' | number | 'failed', exceptions: number): ExceptionsState {
  if (result === 'ok') return exceptions > 0 ? 'ok' : 'empty';
  if (result === 404) return 'off';
  if (result === 403) return view === 'all' ? 'forbidden' : 'not_enabled';
  return 'error';
}
