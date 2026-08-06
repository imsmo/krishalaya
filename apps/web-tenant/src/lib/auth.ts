// apps/web-tenant/src/lib/auth.ts · session cookies for the authenticated console. The access + refresh tokens
// live in HTTPONLY, Secure, SameSite=Lax cookies — unreadable to JS (XSS can't steal them); the SDK reads the
// access token only during SSR. These are low-level cookie helpers; the session GATE + silent refresh live in
// lib/session.ts (kept apart to avoid an import cycle with lib/api-client, which imports this file). The API
// re-enforces RBAC on every call, so the cookie is convenience, never the authority (defence in depth, Law 1/4).
import 'server-only';
import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'kvt_access';
export const REFRESH_COOKIE = 'kvt_refresh';
const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const REFRESH_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

/** Server-only: the current access token (or undefined when the access cookie is absent/expired). */
export function getAccessToken(): string | undefined { return cookies().get(ACCESS_COOKIE)?.value; }
/** Server-only: the current refresh token (used only to mint a new access token server-side). */
export function getRefreshToken(): string | undefined { return cookies().get(REFRESH_COOKIE)?.value; }

/** Persist a freshly-issued token pair (after login / refresh). Access cookie lifetime tracks the token's TTL.
 *  Next.js only permits cookie mutation inside a Server Action / Route Handler. During a silent refresh that runs
 *  while rendering a protected page, the write throws — we swallow it so the request still proceeds with the new
 *  in-memory token; the cookie persists on the next Server Action / navigation. */
export function setSession(accessToken: string, refreshToken: string, accessMaxAgeSec: number): void {
  try {
    const c = cookies();
    c.set(ACCESS_COOKIE, accessToken, { ...OPTS, maxAge: Math.max(1, accessMaxAgeSec) });
    c.set(REFRESH_COOKIE, refreshToken, { ...OPTS, maxAge: REFRESH_MAX_AGE_SEC });
  } catch { /* called during render — cookie write deferred to next action (token still used for this request) */ }
}
export function clearSession(): void {
  try { const c = cookies(); c.delete(ACCESS_COOKIE); c.delete(REFRESH_COOKIE); }
  catch { /* called during render — safe to ignore; the next action/redirect will clear */ }
}

/** Cheap presence check (no network) — true if either cookie is set. Used by the shell to pick chrome vs bare. */
export function hasSessionCookie(): boolean { return !!getAccessToken() || !!getRefreshToken(); }

/** PC-55 B8 · best-effort read of the access token's `perms` claim — FOR DISPLAY ONLY.
 *  Ported from apps/web-partner/src/lib/partner-auth.ts (same token shape, same caveat). The platform API
 *  independently re-enforces RBAC on every call, so this is NEVER an authorization decision: it exists so a console
 *  can WITHHOLD a consequential button (a return refund, a COD reconcile) instead of offering one that 403s. A
 *  button that fails teaches an operator the control is decorative — absence teaches them it is real.
 *  The JWT payload is decoded WITHOUT verifying the signature (the API is the authority); any malformed or absent
 *  token yields an empty set, so the safe answer on failure is "show nothing extra". */
export function getTenantPermissions(): ReadonlySet<string> {
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
/** Does this session hold a permission (or the platform wildcard)? Display-gating only — see above. */
export function tenantHasPerm(perm: string): boolean {
  const perms = getTenantPermissions();
  return perms.has(perm) || perms.has('*');
}
