// apps/web-tenant/src/test/team-permissions.spec.ts · unit tests for the staff-permissions matrix guards. These
// mirror the SERVER escalation rules; the security assertions (no platform role, no UNGRANTABLE grant) are the
// first client gate before the audited SDK call — the API re-enforces all of them.
import {
  UNGRANTABLE_PERMISSIONS, isRoleAssignable, assignableRoles, canGrantPermission, buildAssign, buildOverride,
} from '../features/team/permissions';
import type { RoleDef } from '@krishalaya/sdk-js';

const role = (over: Partial<RoleDef>): RoleDef => ({
  id: 'r', code: 'manager', defaultName: 'Manager', scope: 'tenant', requiresKyc: false, requiresApproval: false, moduleCode: null, isActive: true, ...over,
});
const UID = '0190a0c1-2b3c-7d4e-8f90-1234567890ab';

describe('isRoleAssignable / assignableRoles', () => {
  it('only tenant-scoped + active roles are assignable', () => {
    expect(isRoleAssignable(role({}))).toBe(true);
    expect(isRoleAssignable(role({ scope: 'platform' }))).toBe(false);   // god-mode → never
    expect(isRoleAssignable(role({ isActive: false }))).toBe(false);
  });
  it('filters out platform + inactive', () => {
    const list = [role({ code: 'a' }), role({ code: 'super_admin', scope: 'platform' }), role({ code: 'b', isActive: false })];
    expect(assignableRoles(list).map((r) => r.code)).toEqual(['a']);
  });
});

describe('canGrantPermission', () => {
  it('blocks every UNGRANTABLE permission regardless of actor', () => {
    for (const p of UNGRANTABLE_PERMISSIONS) expect(canGrantPermission(p, new Set(['*']))).toBe(false);
  });
  it('allows a normal permission; defers subset-check to server when actor perms unknown', () => {
    expect(canGrantPermission('listing.publish')).toBe(true);
    expect(canGrantPermission('listing.publish', new Set())).toBe(true); // empty → server decides
  });
  it('enforces the subset rule when actor perms are known', () => {
    expect(canGrantPermission('listing.publish', new Set(['order.read']))).toBe(false);
    expect(canGrantPermission('listing.publish', new Set(['listing.publish']))).toBe(true);
    expect(canGrantPermission('listing.publish', new Set(['*']))).toBe(true);
  });
});

describe('buildAssign', () => {
  const assignable = new Set(['manager', 'staff']);
  it('accepts a valid uuid + assignable role', () => {
    const r = buildAssign({ userId: UID, roleCode: 'manager' }, assignable);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ userId: UID, roleCode: 'manager' });
  });
  it('rejects a bad uuid', () => {
    expect(buildAssign({ userId: 'nope', roleCode: 'manager' }, assignable).ok).toBe(false);
  });
  it('rejects a role outside the assignable set (escalation attempt)', () => {
    const r = buildAssign({ userId: UID, roleCode: 'super_admin' }, assignable);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('platform');
  });
});

describe('buildOverride', () => {
  it('accepts a grant of a normal permission', () => {
    const r = buildOverride({ userTenantRoleId: UID, permissionCode: 'listing.publish', isGranted: 'true' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.isGranted).toBe(true);
  });
  it('rejects granting an UNGRANTABLE permission', () => {
    const r = buildOverride({ userTenantRoleId: UID, permissionCode: 'wallet.adjust', isGranted: 'true' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('ungrantable');
  });
  it('ALLOWS revoking an UNGRANTABLE permission (you can always take away)', () => {
    const r = buildOverride({ userTenantRoleId: UID, permissionCode: 'wallet.adjust', isGranted: 'false' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.isGranted).toBe(false);
  });
  it('rejects a bad assignment id or malformed permission code', () => {
    expect(buildOverride({ userTenantRoleId: 'x', permissionCode: 'listing.publish', isGranted: 'true' }).ok).toBe(false);
    expect(buildOverride({ userTenantRoleId: UID, permissionCode: 'BAD CODE', isGranted: 'true' }).ok).toBe(false);
  });
});
