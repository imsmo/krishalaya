// apps/web-storefront/src/lib/signup-flow.ts · PC-56 STORE-1c · C1 — what the organisation-signup chain (canon W307 + its chain pages) carries
// BETWEEN steps, kept out of the URL (STORE-1a's lib/login-flow.ts pattern).
//
// ONE short-lived httpOnly cookie, `kv_signup` (15 minutes; JavaScript cannot read it; SameSite=Lax; Secure in production; path "/"):
// the organisation name, type, your name, the phone as typed, the console language (kept on every refusal — W2466 "your values are
// preserved"), the E.164 number a code was sent to with the server's TTL and resend time, the code typed (verified ONCE, by the signup call
// itself — checking it earlier would spend it), the Idempotency-Key of the last submit (Retry replays it), and — after creation — the
// outcome the done step prints. The codec is pure (features/signup/flow.ts: every field re-validated on the way in).
import 'server-only';
import { cookies } from 'next/headers';
import { decodePending, encodePending, type PendingSignup } from '../features/signup/flow';

export const SIGNUP_COOKIE = 'kv_signup';
const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const SIGNUP_MAX_AGE_SEC = 15 * 60;

export function readPendingSignup(): PendingSignup | null {
  return decodePending(cookies().get(SIGNUP_COOKIE)?.value);
}
export function writePendingSignup(p: PendingSignup): void {
  cookies().set(SIGNUP_COOKIE, encodePending(p), { ...OPTS, maxAge: SIGNUP_MAX_AGE_SEC });
}
export function clearSignupFlow(): void {
  cookies().delete(SIGNUP_COOKIE);
}
