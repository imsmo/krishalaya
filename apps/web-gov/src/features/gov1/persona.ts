// apps/web-gov/src/features/gov1/persona.ts · PC-56 GOV-1a · E2 — WHO THE SESSION IS, decided in ONE place. PURE (no Next, no cookies) so the
// truth table is unit-tested (src/test/gov1-persona.spec.ts). The web-partner `features/partner/persona.ts` shape.
//
// GOV-1 Q2-A (lead-applied 2026-11-10, the founder may reopen): this console signs into a GOVERNMENT AUTHORITY, never an organisation. GOV-0
// mints the gov token with `realm: 'gov'`, `typ: 'gov_access'`, an `aid` (the authority) and NO `tid` and NO `pid`
// (apps/api/src/core/auth/token.service.ts `mintGovAccessToken`). The claims are decoded WITHOUT verification, for the PERSONA ONLY (which
// shell to show); the API is the authority on every call — it verifies the signature, the realm, the authority, the live session and the
// membership. Nothing here grants anything, and the sidebar is drawn only after the API has answered `GET /v1/gov/me` (lib/session.ts).
//
// THE GATE (requireGov, lib/session.ts):
//   no token at all                                                → 'login'    (send to /login)
//   a token whose claims say realm 'gov', typ 'gov_access', an aid,
//   and carry no tid and no pid                                    → 'gov'      (ask the API who it is)
//   any other token (an organisation's, a partner's, junk)         → 'not_gov'  (the cookies are CLEARED, then the NOT_A_GOVERNMENT_ACCOUNT door)
export interface GovClaims { sub: string; aid: string; realm: 'gov'; roles: string[]; perms: string[] }
export type GovGateDecision = 'login' | 'gov' | 'not_gov';

/** The JWT payload, decoded without verification (persona only). Malformed: null. */
export function decodeClaims(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The government persona of a token, or null when the token is not a government authority's session. */
export function govPersona(token: string | null | undefined): GovClaims | null {
  const c = decodeClaims(token);
  if (!c) return null;
  if (c.realm !== 'gov' || c.typ !== 'gov_access') return null;
  if (typeof c.aid !== 'string' || c.aid.length === 0) return null;
  if (c.tid !== undefined || c.pid !== undefined) return null;
  return { sub: typeof c.sub === 'string' ? c.sub : '', aid: c.aid, realm: 'gov', roles: strings(c.roles), perms: strings(c.perms) };
}

/** The persona gate's truth table (see the header). */
export function gateDecision(token: string | null | undefined): GovGateDecision {
  if (!token) return 'login';
  return govPersona(token) ? 'gov' : 'not_gov';
}

/** Where the gate sends a session that is not a government authority's: a route handler clears the cookies (a page render cannot). */
export const NOT_A_GOV_PATH = '/api/session?clear=NOT_A_GOVERNMENT_ACCOUNT';
/** Where the gate sends a session whose access cookie has lapsed but whose refresh cookie survives: a route handler rotates it (one place,
 *  so two renders never spend the same refresh token). */
export const refreshPath = (next: string) => `/api/session?refresh=1&next=${encodeURIComponent(next)}`;
/** The only codes the session route accepts in `?clear=` (anything else clears to a plain /login). */
export const CLEAR_CODES = Object.freeze(['NOT_A_GOVERNMENT_ACCOUNT', 'SESSION_ENDED'] as const);
