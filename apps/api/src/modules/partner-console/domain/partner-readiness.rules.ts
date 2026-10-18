// modules/partner-console/domain/partner-readiness.rules.ts · PC-56 PARTNER-1b · founder D3 — THE READINESS PAGE'S SIX FACTS, PURE (no I/O).
//
// `GET /v1/partner/readiness` answers what the platform HAS set up for this partner, from facts the database holds — nothing is stored,
// ticked or promised here:
//   (1) the organisation is active                     financial_partners.is_active AND not deleted;
//   (2) an administrator with a second factor          ACTIVE partner_admin members (distinct people), and how many of THEM have a confirmed,
//                                                      not-disabled TOTP — counts only, no names (any other member's TOTP is not this fact);
//   (3) keys issued                                    active keys (is_active AND not revoked) — a revoked key never counts;
//   (4) an endpoint registered                         active endpoints;
//   (5) a delivery succeeded in the last 90 days       yes / no + the last delivered-at (the rail's retention window);
//   (6) the decision promise is published              financial_partners.sla.decision_hours (or not yet).
// Each fact is `ready` or not; the console prints the ones still with the platform's partner operations beside the partners mailbox fact.
export const READINESS_DELIVERY_WINDOW_DAYS = 90;

export interface TeamFactRow { userId: string; roleCode: string; active: boolean; twoFactor: boolean }
/** (2) — the ACTIVE administrators (distinct people) and how many of them have a confirmed second factor. */
export function administratorsFact(team: readonly TeamFactRow[]): { count: number; withTwoFactor: number } {
  const admins = team.filter((m) => m.active && m.roleCode === 'partner_admin');
  const people = new Map<string, boolean>();
  for (const a of admins) people.set(a.userId, (people.get(a.userId) ?? false) || a.twoFactor === true);
  return { count: people.size, withTwoFactor: [...people.values()].filter(Boolean).length };
}

export interface PartnerReadiness {
  computedAt: string;
  organisation: { active: boolean; ready: boolean };
  administrators: { count: number; withTwoFactor: number; ready: boolean };
  keys: { active: number; ready: boolean };
  endpoints: { active: number; ready: boolean };
  deliveries: { windowDays: number; deliveredWithinWindow: boolean; lastDeliveredAt: string | null; ready: boolean };
  sla: { published: boolean; decisionHours: number | null; ready: boolean };
}

export function readinessFacts(i: {
  computedAt: string; organisationActive: boolean; team: readonly TeamFactRow[]; activeKeys: number; activeEndpoints: number;
  lastDeliveredAt: string | null; decisionHours: number | null;
}): PartnerReadiness {
  const admins = administratorsFact(i.team);
  return {
    computedAt: i.computedAt,
    organisation: { active: i.organisationActive, ready: i.organisationActive },
    administrators: { count: admins.count, withTwoFactor: admins.withTwoFactor, ready: admins.withTwoFactor > 0 },
    keys: { active: i.activeKeys, ready: i.activeKeys > 0 },
    endpoints: { active: i.activeEndpoints, ready: i.activeEndpoints > 0 },
    deliveries: { windowDays: READINESS_DELIVERY_WINDOW_DAYS, deliveredWithinWindow: i.lastDeliveredAt !== null, lastDeliveredAt: i.lastDeliveredAt, ready: i.lastDeliveredAt !== null },
    sla: { published: i.decisionHours !== null, decisionHours: i.decisionHours, ready: i.decisionHours !== null },
  };
}
