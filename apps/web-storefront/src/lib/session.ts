// apps/web-storefront/src/lib/session.ts · the server-side session gate for protected routes (account, cart,
// checkout, orders). It builds on lib/auth's cookies and the SDK auth resource:
//   - refreshSession(): when the access cookie has expired but a refresh cookie survives, mint a new token pair
//     server-side (the refresh token never reaches the browser) and re-write the cookies → silent refresh.
//   - requireSession(returnTo): resolve a usable access token or redirect anonymous users to sign-in,
//     so a protected Server Component never renders private data to a logged-out visitor (no flash, no IDOR).
// All network calls are timeout-bounded by the SDK and wrapped so a flaky auth API degrades to "log in again"
// rather than 500-ing the route (Law 12). This lives apart from lib/auth.ts to avoid an import cycle with
// lib/api-client.ts (which imports lib/auth).
// PC-56 STORE-1a · C8: the refresh names the tenant the session was minted for (`kv_tid`) — it used to send none, the API answered 422,
// and the buyer was silently signed out ~15 minutes after signing in. A tenant store's protected page sends an anonymous visitor to THAT
// store's sign-in (`/<slug>/login`), not the platform's.
import 'server-only';
import { redirect } from 'next/navigation';
import { publicClient } from './api-client';
import { getSessionToken, getRefreshToken, getSessionTenant, setSession, clearSession } from './auth';
import { safeNext as safeNextPure, loginPathFor } from '../features/auth/redirect';

/** A `next` destination is only honoured if it's a same-origin path (open-redirect guard). */
export function safeNext(next: string | undefined | null): string {
  return safeNextPure(next);
}

/**
 * Try to mint a new access token from the refresh cookie, INTO THE SESSION'S OWN TENANT. Returns the new access token on success, or
 * null (clearing the dead cookies) when there is no refresh token / no tenant, or the API rejects it.
 */
export async function refreshSession(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  const tenantId = getSessionTenant();
  if (!refreshToken || !tenantId) { if (refreshToken) clearSession(); return null; }
  try {
    const tokens = await publicClient().auth.refresh(refreshToken, tenantId);
    setSession(tokens, tenantId);
    return tokens.accessToken;
  } catch {
    // Expired/rotated/invalid refresh token, or a transient auth-API failure — drop the session and let the
    // caller send the user back through login. Never surface the underlying error to the client.
    clearSession();
    return null;
  }
}

/** Resolve a usable access token (refreshing silently if needed) or `null` if the visitor is anonymous. */
export async function resolveSessionToken(): Promise<string | null> {
  return getSessionToken() ?? (await refreshSession());
}

/**
 * Gate a protected route: returns the access token, or redirects anonymous users to sign-in with a same-origin
 * return path. Call at the top of a protected Server Component / Server Action.
 */
export async function requireSession(returnTo = '/'): Promise<string> {
  const token = await resolveSessionToken();
  if (!token) redirect(loginPathFor(returnTo));
  return token;
}
