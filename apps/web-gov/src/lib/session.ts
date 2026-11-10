// apps/web-gov/src/lib/session.ts · PC-56 GOV-1a · E2 — THE PERSONA GATE of the government console (the web-partner `requirePartner` shape).
//
//   govGate()   → who this request is, decided from the ACCESS token only (never the cookie's presence):
//                   no access token, a refresh cookie        → 'refresh'  (the session route rotates it — one place, so two renders never
//                                                                          spend the same refresh token)
//                   no token at all                          → 'login'
//                   a token that is not a gov session's      → 'not_gov'  (features/gov1/persona.ts — an organisation's, a partner's, junk)
//                   a gov token → `GET /v1/gov/me` answers   → 'gov' with the authority and the person — the ONLY state that draws the sidebar
//                   the API refuses it (401: ended, removed, expired) → 'refresh' / 'login'
//                   the API answers 404 (`gov_console` OFF)  → 'off'
//                   anything else (the API unreachable)      → 'unavailable'
//   requireGov(path) → the GovMe, or a redirect: /login · the refresh route · the NOT_A_GOVERNMENT_ACCOUNT door (the route handler clears
//                   the cookies first) · /login (switched off: the sign-in page says so); 'unavailable' throws → the error boundary.
// The API re-enforces the realm, the authority, the live session and the membership on every call (defence in depth).
import 'server-only';
import { redirect } from 'next/navigation';
import { SdkError, type GovMe } from '@krishalaya/sdk-js';
import { govClient } from './api-client';
import { getAccessToken, getRefreshToken } from './auth';
import { gateDecision, NOT_A_GOV_PATH, refreshPath } from '../features/gov1/persona';
import { safeNext } from '../features/nav/safe-next';

export type GovGate =
  | { kind: 'gov'; me: GovMe; token: string }
  | { kind: 'login' } | { kind: 'refresh' } | { kind: 'not_gov' } | { kind: 'off' } | { kind: 'unavailable' };

export async function govGate(): Promise<GovGate> {
  const token = getAccessToken();
  const canRefresh = !!getRefreshToken();
  const decision = gateDecision(token);
  if (decision === 'login') return canRefresh ? { kind: 'refresh' } : { kind: 'login' };
  if (decision === 'not_gov') return { kind: 'not_gov' };
  try {
    const me = await govClient(token).gov.me();
    return { kind: 'gov', me, token: token as string };
  } catch (e) {
    if (e instanceof SdkError && e.status === 401) return canRefresh ? { kind: 'refresh' } : { kind: 'login' };
    if (e instanceof SdkError && e.status === 404) return { kind: 'off' };
    return { kind: 'unavailable' };
  }
}

/** Server-only gate for protected pages + Server Actions: the government persona as the API states it, else a redirect. */
export async function requireGov(returnTo = '/dashboard'): Promise<GovMe> {
  const g = await govGate();
  switch (g.kind) {
    case 'gov': return g.me;
    case 'refresh': redirect(refreshPath(safeNext(returnTo)));
    case 'not_gov': redirect(NOT_A_GOV_PATH);
    case 'login':
    case 'off': redirect('/login');
    default: throw new Error('web-gov: the government console could not be reached');
  }
}
