// apps/mobile/src/core/auth/role-switcher.ts · the multi-role model (PRD: one account, many hats). The catalog
// of selectable roles, the mapping from a server permission/role string to an app role, and which home route a
// role lands on. Pure data + helpers (testable). The SERVER is the authority on what a user may actually do —
// these roles only drive navigation + which dashboard to show.
export type AppRole = 'farmer' | 'buyer' | 'worker' | 'trader' | 'owner' | 'ambassador' | 'pashupalak'; // pashupalak: PC-50 W10-1 (Phase-2 activation)

export interface RoleDef { role: AppRole; i18nKey: string; descKey: string; homeRoute: string; }

export const ROLES: readonly RoleDef[] = Object.freeze([
  { role: 'farmer', i18nKey: 'role.farmer', descKey: 'role.farmer.desc', homeRoute: '/(farmer)/home' },
  { role: 'buyer', i18nKey: 'role.buyer', descKey: 'role.buyer.desc', homeRoute: '/(buyer)/home' },
  { role: 'worker', i18nKey: 'role.worker', descKey: 'role.worker.desc', homeRoute: '/(worker)/home' },
  { role: 'trader', i18nKey: 'role.trader', descKey: 'role.trader.desc', homeRoute: '/(trader)/home' },
  { role: 'owner', i18nKey: 'role.owner', descKey: 'role.owner.desc', homeRoute: '/(owner)/home' },
  { role: 'ambassador', i18nKey: 'role.ambassador', descKey: 'role.ambassador.desc', homeRoute: '/(ambassador)/home' },
  { role: 'pashupalak', i18nKey: 'role.pashupalak', descKey: 'role.pashupalak.desc', homeRoute: '/(pashupalak)/home' }, // PC-50 W10-1
]);

const BY_ROLE = new Map(ROLES.map((r) => [r.role, r]));
const VALID = new Set<string>(ROLES.map((r) => r.role));

export function isAppRole(s: string | undefined | null): s is AppRole { return !!s && VALID.has(s); }

/** Where to send the user after auth, given their active role. Farmer is the default landing. */
export function homeRouteFor(role: string | undefined): string {
  return (isAppRole(role) && BY_ROLE.get(role)?.homeRoute) || '/(farmer)/home';
}

/** Pick a sensible default active role from the server profile's role list (first known app role, else farmer). */
export function defaultActiveRole(serverRoles: string[]): AppRole {
  const match = serverRoles.find((r) => VALID.has(r)) as AppRole | undefined;
  return match ?? 'farmer';
}

// --- self-serve onboarding (KV-BL-066, screens 04/433 role picker) ---
// The app's nav-facing AppRole codes predate/diverge from the RBAC catalogue's role codes
// (db/seeds/core/0004_roles_permissions.sql) for a few roles — 'buyer' is the API's 'customer', 'trader' is
// 'vyapari', 'owner' is 'tenant_admin'. This is the ONE place that mapping lives, so onboarding.selectRole()
// always submits a code the API actually recognises.
const BACKEND_ROLE_CODE: Record<AppRole, string> = {
  farmer: 'farmer', buyer: 'customer', worker: 'worker', trader: 'vyapari', owner: 'tenant_admin', ambassador: 'ambassador', pashupalak: 'pashupalak',
};
export function backendRoleCode(role: AppRole): string { return BACKEND_ROLE_CODE[role]; }

/** Self-serve eligibility AT THIS PILOT, mirrored from the API's onboarding.service.ts (SELF_SERVE_ALLOWED /
 * INVITE_ONLY — the pilot allow-list is farmer+customer only; everything else is either invite-only forever or
 * not yet turned on for self-serve). This is a CLIENT-SIDE HINT ONLY, used to label a role card honestly (design
 * canon 433's "invite only" / "coming soon" chips) — it never blocks a tap, and the server re-checks + is the
 * sole authority: POST /v1/onboarding/roles can still 403 regardless of what this says. */
export type RoleEligibility = 'self_serve' | 'invite_only' | 'not_pilot_ga';
const SELF_SERVE_ROLES: ReadonlySet<AppRole> = new Set(['farmer', 'buyer']);
const INVITE_ONLY_ROLES: ReadonlySet<AppRole> = new Set(['owner', 'ambassador']);
export function roleEligibility(role: AppRole): RoleEligibility {
  if (SELF_SERVE_ROLES.has(role)) return 'self_serve';
  if (INVITE_ONLY_ROLES.has(role)) return 'invite_only';
  return 'not_pilot_ga';
}
