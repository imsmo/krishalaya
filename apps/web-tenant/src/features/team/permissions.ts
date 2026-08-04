// apps/web-tenant/src/features/team/permissions.ts · PURE guard helpers for the staff-permissions matrix
// (assign/revoke roles + per-assignment permission overrides). No framework, no I/O → unit-tested. These mirror the
// SERVER's *static* escalation guards (apps/api user-tenant-role.service.ts) for UX only — the API is the authority
// (Law 11) and re-checks everything: platform/owner roles are never assignable via the tenant API, and a staff
// override can never hand out `*`/money/god permissions (UNGRANTABLE) nor exceed what the granter holds. The
// granter-subset check is server-only (the app has no endpoint for the actor's full permission set), so the UI
// surfaces the server's 403 rather than pretending to enforce it.

import type { RoleDef } from '@krishalaya/sdk-js';

// MUST stay in lockstep with UNGRANTABLE in apps/api/.../user-tenant-role.service.ts.
export const UNGRANTABLE_PERMISSIONS = new Set<string>([
  '*', 'plan.manage', 'tenant.manage', 'user.impersonate', 'wallet.adjust', 'payout.approve', 'flag.toggle',
]);

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PERM_CODE = /^[a-z][a-z0-9_.]{1,79}$/; // anchored, fixed classes → ReDoS-safe

/** A role is assignable via the tenant API only if it is tenant-scoped and active. Platform roles are god-mode. */
export function isRoleAssignable(role: Pick<RoleDef, 'scope' | 'isActive'>): boolean {
  return role.scope === 'tenant' && role.isActive === true;
}

/** Only the assignable roles, for the assign dropdown. */
export function assignableRoles(roles: RoleDef[]): RoleDef[] {
  return roles.filter(isRoleAssignable);
}

/** Whether a permission may even be offered as a grant. UNGRANTABLE are never grantable via an override.
 *  When `actorPerms` is provided, also require the actor to hold it (or `*`); when omitted the server decides. */
export function canGrantPermission(permissionCode: string, actorPerms?: ReadonlySet<string>): boolean {
  if (UNGRANTABLE_PERMISSIONS.has(permissionCode)) return false;
  if (!actorPerms || actorPerms.size === 0) return true; // server enforces the subset rule
  return actorPerms.has(permissionCode) || actorPerms.has('*');
}

// ---- assign ----
export type AssignResult =
  | { ok: true; value: { userId: string; roleCode: string } }
  | { ok: false; error: 'user' | 'role' | 'platform' };

/** Validate the assign-role form. `assignableCodes` is the set of role codes the API said are assignable
 *  (tenant-scoped) — picking anything else is rejected client-side as a privilege-escalation attempt. */
export function buildAssign(raw: { userId?: unknown; roleCode?: unknown }, assignableCodes: ReadonlySet<string>): AssignResult {
  const userId = String(raw.userId ?? '').trim();
  if (!UUID.test(userId)) return { ok: false, error: 'user' };
  const roleCode = String(raw.roleCode ?? '').trim();
  if (roleCode.length < 2 || roleCode.length > 50) return { ok: false, error: 'role' };
  if (!assignableCodes.has(roleCode)) return { ok: false, error: 'platform' }; // not a tenant-assignable role
  return { ok: true, value: { userId, roleCode } };
}

// ---- override ----
export type OverrideResult =
  | { ok: true; value: { userTenantRoleId: string; permissionCode: string; isGranted: boolean } }
  | { ok: false; error: 'assignment' | 'permission' | 'ungrantable' };

/** Validate a permission-override form. A *grant* of an UNGRANTABLE permission is rejected here (mirrors the
 *  server); a *revoke* (isGranted=false) is always allowed even for UNGRANTABLE codes (you can always take away). */
export function buildOverride(raw: { userTenantRoleId?: unknown; permissionCode?: unknown; isGranted?: unknown }): OverrideResult {
  const userTenantRoleId = String(raw.userTenantRoleId ?? '').trim();
  if (!UUID.test(userTenantRoleId)) return { ok: false, error: 'assignment' };
  const permissionCode = String(raw.permissionCode ?? '').trim();
  if (!PERM_CODE.test(permissionCode)) return { ok: false, error: 'permission' };
  const isGranted = raw.isGranted === true || raw.isGranted === 'true' || raw.isGranted === 'on';
  if (isGranted && UNGRANTABLE_PERMISSIONS.has(permissionCode)) return { ok: false, error: 'ungrantable' };
  return { ok: true, value: { userTenantRoleId, permissionCode, isGranted } };
}
