// apps/web-storefront/src/lib/login-flow.ts · PC-56 STORE-1a · C5–C7 — what the sign-in chain carries BETWEEN steps, kept out of the URL.
//
// Two short-lived httpOnly cookies (JavaScript cannot read them; SameSite=Lax; Secure in production; path "/"):
//   • `kv_login` (15 minutes): what was typed in the phone field (kept on every refusal — canon W321 "the field keeps what you typed"),
//     the normalised phone a code was sent to, when the code was sent, how long it lives (the API's ttlSec) and when a resend is allowed
//     (the API's resendInSec), and the code last typed (kept on a wrong/expired answer — canon W322 "your digits STAY").
//   • `kv_2fa` (the challenge's own lifetime, ≤ 5 minutes): the second-factor challenge token (never in the URL, never in the HTML).
// Both are cleared on success, on "wrong number?", and on sign-out.
import 'server-only';
import { cookies } from 'next/headers';

const LOGIN_COOKIE = 'kv_login';
const TWO_FA_COOKIE = 'kv_2fa';
const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const LOGIN_MAX_AGE_SEC = 15 * 60;

export interface PendingLogin {
  /** Exactly what was typed (≤ 32 chars). */
  typed: string;
  /** The E.164 phone a code was sent to (absent until one was). */
  phone?: string;
  /** Epoch seconds: sent at, resend allowed from. */
  sentAt?: number; resendAt?: number;
  /** The code's lifetime as the API stated it. */
  ttlSec?: number;
  /** The code last typed (kept on a refusal only). */
  code?: string;
}

const enc = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
function dec<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as T; } catch { return null; }
}

export function readPendingLogin(): PendingLogin | null {
  const p = dec<PendingLogin>(cookies().get(LOGIN_COOKIE)?.value);
  if (!p || typeof p.typed !== 'string') return null;
  return {
    typed: p.typed.slice(0, 32),
    phone: typeof p.phone === 'string' && /^\+[1-9]\d{7,14}$/.test(p.phone) ? p.phone : undefined,
    sentAt: Number.isFinite(p.sentAt) ? p.sentAt : undefined, resendAt: Number.isFinite(p.resendAt) ? p.resendAt : undefined,
    ttlSec: Number.isFinite(p.ttlSec) ? p.ttlSec : undefined,
    code: typeof p.code === 'string' && /^\d{1,8}$/.test(p.code) ? p.code : undefined,
  };
}
export function writePendingLogin(p: PendingLogin): void {
  cookies().set(LOGIN_COOKIE, enc({ ...p, typed: p.typed.slice(0, 32) }), { ...OPTS, maxAge: LOGIN_MAX_AGE_SEC });
}

export interface PendingTwoFactor { challengeToken: string; until: number }
export function readPendingTwoFactor(): PendingTwoFactor | null {
  const p = dec<PendingTwoFactor>(cookies().get(TWO_FA_COOKIE)?.value);
  return p && typeof p.challengeToken === 'string' && p.challengeToken.length >= 20 && Number.isFinite(p.until) ? p : null;
}
export function writePendingTwoFactor(challengeToken: string, ttlSec: number): void {
  const sec = Math.max(30, Math.min(600, Math.floor(ttlSec)));
  cookies().set(TWO_FA_COOKIE, enc({ challengeToken, until: Math.floor(Date.now() / 1000) + sec }), { ...OPTS, maxAge: sec });
}

export function clearLoginFlow(): void {
  const c = cookies();
  c.delete(LOGIN_COOKIE);
  c.delete(TWO_FA_COOKIE);
}
