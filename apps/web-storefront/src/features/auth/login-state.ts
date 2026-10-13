// apps/web-storefront/src/features/auth/login-state.ts · PC-56 STORE-1a · C5–C9 — the sign-in chain's states, carried in the URL.
//
// Canon W321/W322 + their six chain pages, as ONE route with URL-carried steps (the house chain, `features/forms/chain.ts`
// `carryValues`): `?step=phone` (W321; W3108 = its named failures), `?step=code` (W322 = W3107 "code sent"; W3133 = its named failures),
// `?step=2fa` (W3132's second-factor sub-state), `?step=done` (W3132 signed in). W3106 / W3131 (confirm pages) are NOT built: a confirm
// before "Send my code" writes nothing to confirm (DELTA), and the "Sending…" lock is the double-tap guard.
//
// NEVER PII IN THE URL. The URL carries only the step, a named error code, and small numbers (seconds to wait, tries left, the digit rule).
// The phone itself, the code typed and the 2FA challenge live in short-lived httpOnly cookies (lib/login-flow.ts) — `assertPiiFree`
// is the test's guard and the builder's own last check.
import { carryValues } from '../forms/chain';
import { safeNext } from './redirect';

export const LOGIN_STEPS = ['phone', 'code', '2fa', 'done'] as const;
export type LoginStep = (typeof LOGIN_STEPS)[number];
export function loginStep(raw: unknown): LoginStep {
  return (LOGIN_STEPS as readonly string[]).includes(String(raw ?? '')) ? (raw as LoginStep) : 'phone';
}

/** Every named failure the chain can show (W3108 / W3133). Each has its own sentence in the catalogues (`auth.err.<code>`). */
export const LOGIN_ERRORS = [
  // phone step (W3108)
  'phone_empty', 'phone_digits', 'phone_invalid', 'rate_cooldown', 'rate_hourly', 'rate_ip', 'channel',
  // code step (W3133)
  'code_format', 'code_wrong', 'code_expired', 'code_locked', 'rate_verify', 'suspended', 'inactive', 'start_again',
  // 2fa sub-step
  'totp_format', 'totp_invalid', 'totp_replay', 'recovery_invalid', 'recovery_used', 'challenge_expired',
  // anywhere
  'unavailable', 'tenant',
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];
export function loginError(raw: unknown): LoginError | null {
  return (LOGIN_ERRORS as readonly string[]).includes(String(raw ?? '')) ? (raw as LoginError) : null;
}

/** What the person's buyer account looked like after sign-in (D4): ready already, just granted, flag OFF, or could not be finished. */
export const BUYER_STATES = ['ready', 'granted', 'off', 'unavailable'] as const;
export type BuyerState = (typeof BUYER_STATES)[number];

export interface LoginParams {
  step: LoginStep;
  next: string;
  err: LoginError | null;
  /** Seconds to wait (rate limits, a locked code). */
  n: number | null;
  /** Tries left on this code. */
  left: number | null;
  /** The digit rule of a refused number (need digits after +dial; have typed). */
  need: number | null; have: number | null; dial: string | null;
  /** The hourly cap's own number, so the real rule is printed. */
  max: number | null;
  buy: BuyerState | null;
  /** A fresh code was just sent (resend). */
  sent: boolean;
}

const int = (raw: unknown, max: number): number | null => {
  const s = String(raw ?? '');
  return /^\d{1,6}$/.test(s) && Number(s) <= max ? Number(s) : null;
};
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function readLoginParams(sp: Record<string, string | string[] | undefined>): LoginParams {
  const buy = String(first(sp.buy) ?? '');
  const dial = String(first(sp.dial) ?? '');
  return {
    step: loginStep(first(sp.step)),
    next: safeNext(first(sp.next)),
    err: loginError(first(sp.err)),
    n: int(first(sp.n), 86_400), left: int(first(sp.left), 99),
    need: int(first(sp.need), 20), have: int(first(sp.have), 40), dial: /^\d{1,3}$/.test(dial) ? dial : null,
    max: int(first(sp.max), 1000),
    buy: (BUYER_STATES as readonly string[]).includes(buy) ? (buy as BuyerState) : null,
    sent: first(sp.sent) === '1',
  };
}

export type LoginHrefInput = { step: LoginStep; next?: string } & Partial<Omit<LoginParams, 'step' | 'next' | 'sent'>> & { sent?: boolean };

/** The href of a sign-in state. Carries no PII — and refuses to (throws) if a phone-shaped value ever reaches it. */
export function loginHref(base: string, p: LoginHrefInput): string {
  const v: Record<string, string | undefined> = {
    next: p.next && safeNext(p.next) !== '/' ? safeNext(p.next) : undefined,
    err: p.err ?? undefined,
    n: p.n != null ? String(p.n) : undefined, left: p.left != null ? String(p.left) : undefined,
    need: p.need != null ? String(p.need) : undefined, have: p.have != null ? String(p.have) : undefined,
    dial: p.dial ?? undefined, max: p.max != null ? String(p.max) : undefined,
    buy: p.buy ?? undefined, sent: p.sent ? '1' : undefined,
  };
  const href = `${base}?${carryValues(p.step, v).query}`;
  assertPiiFree(href);
  return href;
}

/** A sign-in URL never carries a phone number, a code or a token. Seven or more consecutive digits anywhere is refused. */
export function assertPiiFree(href: string): void {
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  const decoded = decodeURIComponent(query.replace(/\+/g, ' '));
  if (/\d{7,}/.test(decoded.replace(/next=[^&]*/, '')) || /(^|&)(phone|code|challenge|token)=/i.test(query)) {
    throw new Error('sign-in URL would carry personal data');
  }
}
