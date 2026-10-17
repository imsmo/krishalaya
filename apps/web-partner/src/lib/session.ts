// apps/web-partner/src/lib/session.ts · the partner portal's session gate. Builds on lib/partner-auth's cookies + the SDK's PARTNER realm:
//   - refreshSession(): when the access cookie has expired but a refresh cookie survives, mint a new token pair server-side through
//     `partner.auth.refresh` (the PARTNER realm — a tenant refresh token is refused there) and re-write the cookies → silent refresh.
//   - requirePartner(): PC-56 PARTNER-0 · F-11 — a REAL persona gate (features/partner/persona.ts): no token → /login; a token that is not a
//     partner session's (no `realm: 'partner'` or no `pid` — a tenant token, a farmer's) → the cookies are CLEARED (by the /api/session route
//     handler: a page render cannot modify cookies) and /login?error=NOT_A_PARTNER. The API still re-enforces the realm, the partner, the
//     session and the membership on every call (defence in depth).
// Network calls are timeout-bounded by the SDK and wrapped so a flaky auth API degrades to "log in again" rather than 500-ing the portal
// (Law 12). Lives apart from lib/partner-auth.ts to avoid an import cycle with lib/api-client (which imports partner-auth for the token).
import 'server-only';
import { redirect } from 'next/navigation';
import { anonClient } from './api-client';
import { getAccessToken, getRefreshToken, setSession, clearSession } from './partner-auth';
import { gateDecision, partnerPersona, NOT_A_PARTNER_PATH, type PartnerClaims } from '../features/partner/persona';

/** Mint a new access token from the refresh cookie. Returns the new access token, or null (clearing dead cookies where allowed). */
export async function refreshSession(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const tokens = await anonClient().partner.auth.refresh(refreshToken);
    try { setSession(tokens.accessToken, tokens.refreshToken, tokens.expiresInSec); } catch { /* a page render cannot write cookies; the next action will */ }
    return tokens.accessToken;
  } catch {
    try { clearSession(); } catch { /* idem — the gate below sends the person through /login */ }
    return null;
  }
}

/** Resolve a usable access token (refreshing silently if needed), or null when the visitor is anonymous. */
export async function resolveSessionToken(): Promise<string | null> {
  return getAccessToken() ?? (await refreshSession());
}

/** Server-only gate for protected pages + Server Actions: the partner persona, else /login (or the NOT_A_PARTNER door). */
export async function requirePartner(): Promise<PartnerClaims> {
  const token = await resolveSessionToken();
  const decision = gateDecision(token);
  if (decision === 'login') redirect('/login');
  if (decision === 'not_partner') redirect(NOT_A_PARTNER_PATH);
  return partnerPersona(token) as PartnerClaims;
}
