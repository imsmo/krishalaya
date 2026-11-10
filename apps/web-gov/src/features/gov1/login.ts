// apps/web-gov/src/features/gov1/login.ts · PC-56 GOV-1a — the sign-in's PURE pieces (W355 + the login chain W3229–W3232): which step a
// query names, which API answer becomes which named refusal and which chain state, and the wait in whole minutes. No Next, no SDK runtime.
//
// The steps (GOV-0 `/v1/gov/auth/*`, Q5-A): phone → code → (choose, when the phone holds a role in several authorities) → the authenticator
// code; or, for an account without a confirmed authenticator, enrol (show the set-up key) → enrol-confirm (a current code) → enrolled (the
// recovery codes, once) → sign in again. `off` is the platform switch `gov_console` OFF (every /v1/gov route answers 404).
export type LoginStep = 'phone' | 'verify' | 'choose' | '2fa' | 'enrol' | 'enrol-confirm' | 'enrolled' | 'off';
export const LOGIN_STEPS: readonly LoginStep[] = ['phone', 'verify', 'choose', '2fa', 'enrol', 'enrol-confirm', 'enrolled'];
export function loginStep(raw: string | undefined | null): LoginStep {
  return (LOGIN_STEPS as readonly string[]).includes(raw ?? '') ? (raw as LoginStep) : 'phone';
}

/** Every refusal the sign-in names, its key (en/hi/gu) and the chain state it lands in. */
export const LOGIN_ERRORS: Readonly<Record<string, { key: string; state: 'form-error' | 'failure' }>> = Object.freeze({
  OTP_WRONG: { key: 'gov1.login.err.otpWrong', state: 'form-error' },
  OTP_EXPIRED: { key: 'gov1.login.err.otpExpired', state: 'form-error' },
  INVALID_PHONE: { key: 'gov1.login.err.phone', state: 'form-error' },
  TOTP_INVALID: { key: 'gov1.login.err.totpInvalid', state: 'form-error' },
  TOTP_REPLAY: { key: 'gov1.login.err.totpReplay', state: 'form-error' },
  RECOVERY_CODE_INVALID: { key: 'gov1.login.err.recoveryInvalid', state: 'form-error' },
  RECOVERY_CODE_USED: { key: 'gov1.login.err.recoveryUsed', state: 'form-error' },
  OTP_LOCKED: { key: 'gov1.login.err.otpLocked', state: 'failure' },
  GOV_ACCESS_NONE: { key: 'gov1.login.err.accessNone', state: 'failure' },
  GOV_CHOICE_INVALID: { key: 'gov1.login.err.choiceInvalid', state: 'failure' },
  GOV_ENROL_TOKEN_INVALID: { key: 'gov1.login.err.enrolInvalid', state: 'failure' },
  TWO_FACTOR_CHALLENGE_INVALID: { key: 'gov1.login.err.challengeInvalid', state: 'failure' },
  TOTP_ALREADY_CONFIRMED: { key: 'gov1.login.err.totpAlready', state: 'failure' },
  PHONE_MISSING: { key: 'gov1.login.err.phoneMissing', state: 'failure' },
  NOT_A_GOVERNMENT_ACCOUNT: { key: 'gov1.login.err.notGov', state: 'failure' },
  SESSION_ENDED: { key: 'gov1.login.err.sessionEnded', state: 'failure' },
  RATE_LIMITED: { key: 'gov1.login.err.rateLimited', state: 'failure' },
  LOGIN_FAILED: { key: 'gov1.login.err.failed', state: 'failure' },
});
export const loginErrorCode = (raw: string | undefined | null): string | null => (raw ? (LOGIN_ERRORS[raw] ? raw : 'LOGIN_FAILED') : null);

/** A wait in seconds, as whole minutes, rounded UP (never 0 while a wait remains). */
export function waitMinutes(sec: unknown): number {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.ceil(n / 60));
}

/** An API answer (code, status, details), and where the sign-in lands: a step, or a chain state with a named refusal. PURE (the action maps). */
export type LoginLanding =
  | { kind: 'step'; step: 'choose' | '2fa' | 'enrol' }
  | { kind: 'chain'; act: 'form-error' | 'failure'; error: string; left?: number; wait?: number }
  | { kind: 'off' };
export function landing(code: string | null | undefined, status: number | null | undefined, details: Record<string, unknown> | null | undefined): LoginLanding {
  const d = details ?? {};
  if (code === 'GOV_CHOICE_REQUIRED') return { kind: 'step', step: 'choose' };
  if (code === 'TWO_FACTOR_PENDING') return { kind: 'step', step: '2fa' };
  if (code === 'GOV_TWO_FACTOR_REQUIRED') return { kind: 'step', step: 'enrol' };
  if (code === 'OTP_INVALID') {
    if (d.reason === 'locked') return { kind: 'chain', act: 'failure', error: 'OTP_LOCKED', wait: waitMinutes(d.retryAfterSec) };
    if (d.reason === 'wrong') return { kind: 'chain', act: 'form-error', error: 'OTP_WRONG', left: Math.max(0, Number(d.attemptsLeft) || 0) };
    return { kind: 'chain', act: 'form-error', error: 'OTP_EXPIRED' };
  }
  if (status === 429) return { kind: 'chain', act: 'failure', error: 'RATE_LIMITED' };
  if (status === 404) return { kind: 'off' };
  const known = code ? LOGIN_ERRORS[code] : undefined;
  if (known && code) return { kind: 'chain', act: known.state, error: code };
  return { kind: 'chain', act: 'failure', error: 'LOGIN_FAILED' };
}

/** The `/login?…` address of a landing (no phone, no token ever rides it). */
export function landingHref(l: LoginLanding, step?: LoginStep): string {
  if (l.kind === 'off') return '/login';
  if (l.kind === 'step') return `/login?step=${l.step}`;
  const q = new URLSearchParams({ act: l.act, error: l.error });
  if (l.act === 'form-error' && step && step !== 'phone') q.set('step', step);
  if (l.left !== undefined) q.set('left', String(l.left));
  if (l.wait !== undefined) q.set('wait', String(l.wait));
  return `/login?${q.toString()}`;
}

/** A 6-digit authenticator code, or a recovery code (anything else the person typed). */
export function secondFactorInput(raw: string): { code: string } | { recoveryCode: string } {
  const v = raw.trim();
  return /^\d{6}$/.test(v) ? { code: v } : { recoveryCode: v };
}
