// apps/web-partner/src/features/partner/persona.ts · PC-56 PARTNER-0 · E6 / F-11 — WHO THE SESSION IS, decided in ONE place. PURE (no Next, no
// cookies) so the truth table is unit-tested (src/test/partner-session.spec.ts).
//
// The access token's claims are decoded WITHOUT verification, for the PERSONA ONLY: which shell to show, which nav groups to list, whether
// this session is a partner's at all. The API is the authority on every call (it verifies the signature, the realm, the partner, the live
// session and the membership); nothing here grants anything.
//
// THE GATE (requirePartner, lib/session.ts):
//   no token at all                                    → 'login'        (send to /login)
//   a token whose claims say realm 'partner' AND a pid → 'partner'      (render)
//   any other token (a tenant token, a farmer's, junk) → 'not_partner'  (the session is CLEARED and /login?error=NOT_A_PARTNER)
export interface PartnerClaims { sub: string; pid: string; realm: 'partner'; roles: string[]; perms: string[] }
export type GateDecision = 'login' | 'partner' | 'not_partner';

/** The JWT payload, decoded without verification (persona only). Malformed → null. */
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

/** The partner persona of a token, or null when the token is not a partner session's. */
export function partnerPersona(token: string | null | undefined): PartnerClaims | null {
  const c = decodeClaims(token);
  if (!c) return null;
  if (c.realm !== 'partner') return null;
  if (typeof c.pid !== 'string' || c.pid.length === 0) return null;
  return { sub: typeof c.sub === 'string' ? c.sub : '', pid: c.pid, realm: 'partner', roles: strings(c.roles), perms: strings(c.perms) };
}

/** The persona gate's truth table (see the header). */
export function gateDecision(token: string | null | undefined): GateDecision {
  if (!token) return 'login';
  return partnerPersona(token) ? 'partner' : 'not_partner';
}

/** Where the gate sends a session that is not a partner's: a route handler clears the cookies (a page render cannot), then /login. */
export const NOT_A_PARTNER_PATH = '/api/session?clear=NOT_A_PARTNER';
