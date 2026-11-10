// apps/web-gov/src/lib/auth.ts · session cookies for the government console (PC-56 GOV-1a). The GOV access + refresh tokens live in HTTPONLY,
// Secure (production), SameSite=Lax cookies — unreadable to JS (XSS can't steal them); the SDK reads the access token only during SSR. These
// are low-level cookie helpers; the persona GATE (requireGov) lives in lib/session.ts (kept apart to avoid an import cycle with
// lib/api-client, which imports this file). A cookie is never the authority: the sidebar is drawn only from the API's answer to
// `GET /v1/gov/me`, and the API re-enforces the realm, the authority, the session and the membership on every call (GOV-0).
import 'server-only';
import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'kvg_access';
export const REFRESH_COOKIE = 'kvg_refresh';
const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const REFRESH_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days (the API's refresh lifetime; GOV-0 refuses it at once when the membership ends)

/** Server-only: the current access token (or undefined when the access cookie is absent/expired). */
export function getAccessToken(): string | undefined { return cookies().get(ACCESS_COOKIE)?.value; }
/** Server-only: the current refresh token (used only to mint a new access token server-side, in the session route handler). */
export function getRefreshToken(): string | undefined { return cookies().get(REFRESH_COOKIE)?.value; }

/** Persist a freshly-issued token pair — ONLY from a Server Action or a Route Handler (a page render cannot write cookies). */
export function setSession(accessToken: string, refreshToken: string, accessMaxAgeSec: number): void {
  const c = cookies();
  c.set(ACCESS_COOKIE, accessToken, { ...OPTS, maxAge: Math.max(1, accessMaxAgeSec) });
  c.set(REFRESH_COOKIE, refreshToken, { ...OPTS, maxAge: REFRESH_MAX_AGE_SEC });
}
export function clearSession(): void {
  const c = cookies();
  c.delete(ACCESS_COOKIE); c.delete(REFRESH_COOKIE);
}
