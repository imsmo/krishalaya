// apps/web-partner/src/lib/partner-auth.ts · session handling for the partner portal. Access + refresh tokens
// live in HTTPONLY, Secure, SameSite=Lax cookies — unreadable to JS (XSS can't steal them); the SDK reads the
// access token only during SSR. The protected-page gate + silent refresh live in lib/session.ts (requirePartner),
// kept apart to avoid an import cycle with lib/api-client (which imports this file). The API re-enforces
// partner-scoped RBAC on every call, so the cookie is convenience, never the authority (defence in depth, Law 1/4).
import 'server-only';
import { cookies, type UnsafeUnwrappedCookies } from 'next/headers';
import { env } from './env';

export const ACCESS_COOKIE = 'kvp_access';
export const REFRESH_COOKIE = 'kvp_refresh';
const OPTS = { httpOnly: true, secure: env.isProduction, sameSite: 'lax' as const, path: '/' };

export function getAccessToken(): string | undefined { return (cookies() as unknown as UnsafeUnwrappedCookies).get(ACCESS_COOKIE)?.value; }
/** Server-only: the current refresh token (used only to mint a new access token server-side; never reaches JS). */
export function getRefreshToken(): string | undefined { return (cookies() as unknown as UnsafeUnwrappedCookies).get(REFRESH_COOKIE)?.value; }

/** Best-effort read of the access token's `perms` claim — for NAV PERSONA ONLY (which groups to show). The
 *  platform API independently re-enforces RBAC on every call, so this is never an authorization decision; it just
 *  avoids showing a partner a nav group they can't use. Decodes the JWT payload WITHOUT verifying the signature
 *  (the API is the authority); any malformed/absent token → empty set (degrade, never throw). */
export function getPartnerPermissions(): ReadonlySet<string> {
  const token = getAccessToken();
  if (!token) return new Set();
  try {
    const payload = token.split('.')[1];
    if (!payload) return new Set();
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims = JSON.parse(json) as { perms?: unknown };
    const perms = Array.isArray(claims.perms) ? claims.perms.filter((p): p is string => typeof p === 'string') : [];
    return new Set(perms);
  } catch {
    return new Set();
  }
}

export function setSession(accessToken: string, refreshToken: string, accessMaxAgeSec: number): void {
  (cookies() as unknown as UnsafeUnwrappedCookies).set(ACCESS_COOKIE, accessToken, { ...OPTS, maxAge: accessMaxAgeSec });
  (cookies() as unknown as UnsafeUnwrappedCookies).set(REFRESH_COOKIE, refreshToken, { ...OPTS, maxAge: 60 * 60 * 24 * 30 });
}
export function clearSession(): void { (cookies() as unknown as UnsafeUnwrappedCookies).delete(ACCESS_COOKIE); (cookies() as unknown as UnsafeUnwrappedCookies).delete(REFRESH_COOKIE); }
/** Cheap presence check (no network) — true if either cookie is set. Used by the shell to pick chrome vs bare. */
export function isAuthenticated(): boolean { return !!getAccessToken() || !!getRefreshToken(); }
// The protected-page GATE + silent refresh live in lib/session.ts (kept apart to avoid an import cycle with
// lib/api-client, which imports this file). The API re-enforces partner RBAC on every call (defence in depth).
