// apps/web-storefront/src/features/auth/failure.ts · PC-56 STORE-1a · C5/C6 — every refusal the sign-in API can give, NAMED.
//
// Before this wave the storefront swallowed every request-code error ("a code is on its way" even when none was) and showed one generic
// sentence for every verify failure. The API now says what happened (STORE-1a A2): a cooldown or the hourly cap with the seconds to wait,
// a per-connection limit, wrong code with tries left, expired, locked (with the wait), a suspended membership, the second factor. Each maps
// to one `LoginError` and its numbers; an error this does not recognise is `unavailable` (Law 12: "we could not reach the sign-in
// service" — never a fake success). Enumeration-safety is unaffected: the API sends a code to EVERY number, so a per-phone limit or a
// wrong code says nothing about whether an account exists.
import type { LoginError } from './login-state';

/** The duck-typed shape of an SdkError (or a network/timeout error, which has no status). */
export interface ErrLike { code?: unknown; status?: unknown; details?: unknown; name?: unknown }
export interface Failure { err: LoginError; n?: number; left?: number; max?: number; challengeToken?: string; challengeSec?: number }

const det = (e: unknown): Record<string, unknown> => {
  const d = (e as ErrLike | null)?.details;
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
};
const code = (e: unknown) => String((e as ErrLike | null)?.code ?? '');
const status = (e: unknown) => Number((e as ErrLike | null)?.status ?? 0);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.ceil(v) : undefined);

function rateLimited(e: unknown, perPhone: LoginError): Failure {
  const d = det(e);
  if (d.limit === 'resend_cooldown') return { err: 'rate_cooldown', n: num(d.retryAfterSec) };
  if (d.limit === 'requests_per_hour') return { err: 'rate_hourly', n: num(d.retryAfterSec), max: num(d.max) };
  if (d.limit === 'verifications_per_hour') return { err: perPhone, n: num(d.retryAfterSec), max: num(d.max) };
  // the edge guard (per connection): { limit: <number>, windowSec }
  return { err: 'rate_ip', n: num(d.windowSec) };
}

/** POST /v1/auth/otp failed. */
export function classifyRequestFailure(e: unknown): Failure {
  if (status(e) === 429) return rateLimited(e, 'rate_hourly');
  if (code(e) === 'INVALID_PHONE' || code(e) === 'VALIDATION_FAILED') return { err: 'phone_invalid' };
  if (code(e) === 'OTP_CHANNEL_UNAVAILABLE') return { err: 'channel' };
  if (code(e) === 'TENANT_REQUIRED' || code(e) === 'TENANT_NOT_FOUND') return { err: 'tenant' };
  return { err: 'unavailable' };
}

/** POST /v1/auth/verify failed. `two_factor` is not a failure — the caller moves to the 2FA step with the challenge. */
export function classifyVerifyFailure(e: unknown): Failure | { err: 'two_factor'; challengeToken: string; challengeSec?: number } {
  const c = code(e); const d = det(e);
  if (c === 'TWO_FACTOR_PENDING' && typeof d.challengeToken === 'string' && d.challengeToken.length >= 20) {
    return { err: 'two_factor', challengeToken: d.challengeToken, challengeSec: num(d.expiresInSec) };
  }
  if (c === 'OTP_INVALID') {
    if (d.reason === 'wrong') return { err: 'code_wrong', left: num(d.attemptsLeft) };
    if (d.reason === 'locked') return { err: 'code_locked', n: num(d.retryAfterSec) };
    return { err: 'code_expired' };
  }
  if (status(e) === 429) return rateLimited(e, 'rate_verify');
  if (c === 'TENANT_MEMBERSHIP_SUSPENDED') return { err: 'suspended' };
  if (c === 'USER_NOT_ACTIVE') return { err: 'inactive' };
  if (c === 'INVALID_PHONE') return { err: 'phone_invalid' };
  if (c === 'VALIDATION_FAILED') return { err: 'code_format' };
  if (c === 'TENANT_REQUIRED' || c === 'TENANT_NOT_FOUND') return { err: 'tenant' };
  return { err: 'unavailable' };
}

/** POST /v1/auth/2fa/verify failed. */
export function classifyTwoFactorFailure(e: unknown): Failure {
  switch (code(e)) {
    case 'TOTP_INVALID': return { err: 'totp_invalid' };
    case 'TOTP_REPLAY': return { err: 'totp_replay' };
    case 'RECOVERY_CODE_INVALID': return { err: 'recovery_invalid' };
    case 'RECOVERY_CODE_USED': return { err: 'recovery_used' };
    case 'TWO_FACTOR_CHALLENGE_INVALID': return { err: 'challenge_expired' };
    case 'TENANT_MEMBERSHIP_SUSPENDED': return { err: 'suspended' };
    case 'VALIDATION_FAILED': return { err: 'totp_format' };
    default: return status(e) === 429 ? { err: 'rate_ip', n: num(det(e).windowSec) } : { err: 'unavailable' };
  }
}

/** Which step a failure is shown on. */
export function failureStep(f: Failure, current: 'phone' | 'code' | '2fa'): 'phone' | 'code' | '2fa' {
  if (f.err === 'challenge_expired' || f.err === 'start_again') return 'phone';
  if (f.err === 'phone_invalid' && current === 'code') return 'phone';
  return current;
}
