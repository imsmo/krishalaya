// apps/web-storefront/src/lib/auth.ts · session handling. Two httpOnly + Secure + SameSite=Lax cookies, both
// UNREADABLE to JavaScript (XSS can't exfiltrate them): `kv_session` holds the short-lived ACCESS token (the SDK
// reads it only on the server during SSR); `kv_refresh` holds the longer-lived REFRESH token, used solely by
// the server to mint a fresh access token when the access cookie has expired (silent refresh — see lib/session).
// The browser never sees either raw token. Login/refresh write these from a Server Action; logout clears both.
// PC-56 STORE-1a: a third cookie, `kv_tid`, remembers WHICH tenant the session was minted for (not a secret — a uuid).
import 'server-only';
import { cookies } from 'next/headers';
import type { AuthTokens } from '@krishalaya/sdk-js';

export const SESSION_COOKIE = 'kv_session';
export const REFRESH_COOKIE = 'kv_refresh';
/** PC-56 STORE-1a · C8: the tenant the session was minted for — a refresh rotates INTO THE SAME tenant (the API scopes refresh to one).
 *  Before this the refresh sent no tenant, the API answered 422, and every buyer was signed out ~15 minutes after signing in. */
export const SESSION_TENANT_COOKIE = 'kv_tid';

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
export function setSession(tokens: AuthTokens, tenantId: string): void {
  const c = cookies();
  c.set(SESSION_COOKIE, tokens.accessToken, { ...BASE_OPTS, maxAge: Math.max(1, tokens.expiresInSec) });
  c.set(REFRESH_COOKIE, tokens.refreshToken, { ...BASE_OPTS, maxAge: REFRESH_MAX_AGE_SEC });
  c.set(SESSION_TENANT_COOKIE, tenantId, { ...BASE_OPTS, maxAge: REFRESH_MAX_AGE_SEC });
}

/** PC-56 STORE-1a · C8: the tenant this browser's session belongs to (a uuid), or undefined. */
export function getSessionTenant(): string | undefined {
  const v = cookies().get(SESSION_TENANT_COOKIE)?.value;
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined;
}

/** Log out: drop every session cookie. */
export function clearSession(): void {
  const c = cookies();
  c.delete(SESSION_COOKIE);
  c.delete(REFRESH_COOKIE);
  c.delete(SESSION_TENANT_COOKIE);
}

/** Cheap presence check (no network) — true if either cookie is set. Used by the header to pick login vs logout. */
export function hasSessionCookie(): boolean {
  return !!getSessionToken() || !!getRefreshToken();
}
