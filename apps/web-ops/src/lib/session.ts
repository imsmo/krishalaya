// apps/web-ops/src/lib/session.ts · the console's session gate. Builds on lib/auth's cookies + the SDK auth
// resource:
//   - refreshSession(): when the access cookie has expired but a refresh cookie survives, mint a new token pair
//     server-side (the refresh token never reaches the browser) and re-write the cookies → silent refresh.
//   - requireSession(returnTo): resolve a usable access token or redirect anonymous staff to /login?next=…, so a
//     protected page never renders before auth. The API still re-enforces RBAC on every call (defence in depth).
// Network calls are timeout-bounded by the SDK and wrapped so a flaky auth API degrades to "log in again" rather
// than 500-ing the console (Law 12). Lives apart from lib/auth.ts to avoid an import cycle with lib/api-client.
import 'server-only';
import { redirect } from 'next/navigation';
import { anonClient } from './api-client';
import { env } from './env';
import { getAccessToken, getRefreshToken, setSession, clearSession } from './auth';
import { safeNext } from '../features/nav/safe-next';

export { safeNext };

/** Mint a new access token from the refresh cookie. Returns the new access token, or null (clearing dead cookies). */
export async function refreshSession(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const tokens = await anonClient().auth.refresh(refreshToken, env.tenantId);
    setSession(tokens.accessToken, tokens.refreshToken, tokens.expiresInSec);
    return tokens.accessToken;
  } catch {
    clearSession(); // expired/rotated/invalid → send the user back through login
    return null;
  }
}

/** Resolve a usable access token (refreshing silently if needed), or null when the visitor is anonymous. */
export async function resolveSessionToken(): Promise<string | null> {
  return getAccessToken() ?? (await refreshSession());
}

/** Gate a protected console page: returns the access token, or redirects anonymous staff to login with a return path. */
export async function requireSession(returnTo = '/dashboard'): Promise<string> {
  const token = await resolveSessionToken();
  if (!token) redirect(`/login?next=${encodeURIComponent(safeNext(returnTo))}`);
  return token;
}
