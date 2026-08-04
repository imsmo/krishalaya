// apps/web-storefront/src/lib/auth.ts · session handling. Two httpOnly + Secure + SameSite=Lax cookies, both
// UNREADABLE to JavaScript (XSS can't exfiltrate them): `kv_session` holds the short-lived ACCESS token (the SDK
// reads it only on the server during SSR); `kv_refresh` holds the longer-lived REFRESH token, used solely by
// the server to mint a fresh access token when the access cookie has expired (silent refresh — see lib/session).
// The browser never sees either raw token. Login/refresh write these from a Server Action; logout clears both.
import 'server-only';
import { cookies } from 'next/headers';
import type { AuthTokens } from '@krishalaya/sdk-js';

export const SESSION_COOKIE = 'kv_session';
export const REFRESH_COOKIE = 'kv_refresh';

const BASE_OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
// The refresh token outlives any single access token; cap it so an abandoned session can't live forever.
const REFRESH_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

/** Server-only: the current access token (or undefined when the access cookie is absent/expired). */
export function getSessionToken(): string | undefined {
  return cookies().get(SESSION_COOKIE)?.value;
}

/** Server-only: the current refresh token (or undefined). Used only to mint a new access token server-side. */
export function getRefreshToken(): string | undefined {
  return cookies().get(REFRESH_COOKIE)?.value;
}

/**
 * Persist a freshly-issued token pair (call from a Route Handler / Server Action after a successful
 * login or refresh). The access cookie's lifetime tracks the token's own `expiresInSec` so the browser
 * stops sending a stale token; the refresh cookie gets the longer cap.
 */
export function setSession(tokens: AuthTokens): void {
  const c = cookies();
  c.set(SESSION_COOKIE, tokens.accessToken, { ...BASE_OPTS, maxAge: Math.max(1, tokens.expiresInSec) });
  c.set(REFRESH_COOKIE, tokens.refreshToken, { ...BASE_OPTS, maxAge: REFRESH_MAX_AGE_SEC });
}

/** Log out: drop both cookies. */
export function clearSession(): void {
  const c = cookies();
  c.delete(SESSION_COOKIE);
  c.delete(REFRESH_COOKIE);
}

/** Cheap presence check (no network) — true if either cookie is set. Used by the header to pick login vs logout. */
export function hasSessionCookie(): boolean {
  return !!getSessionToken() || !!getRefreshToken();
}
