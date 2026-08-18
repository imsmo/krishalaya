// modules/identity/__tests__/rbac-security.spec.ts
// Privilege-escalation guards (no DB needed — all checks fire before any I/O):
//  • platform/owner roles cannot be assigned through the tenant API (Law 11);
//  • staff overrides cannot hand out money/god permissions, nor perms the granter lacks.
import { UserTenantRoleService } from '../services/user-tenant-role.service';
import { Role } from '../domain/role.entity';
import { ForbiddenError } from '../../../shared/errors/app-error';

function svc(role: Role | null) {
  const uow: any = { run: jest.fn() };
  const roles: any = { findByCode: jest.fn().mockResolvedValue(role) };
  const noop: any = { write: jest.fn(), invalidate: jest.fn() };
  const utr: any = { getForUpdate: jest.fn() };
  const users: any = {};
  // PC-56 TENANT-4d-1: the service now asks tenancy's PlanUsageService for a member seat before attaching a
  // NEW member (W118's pause). This suite is about RBAC, so the seat check is stubbed to allow — the pause
  // itself is covered by tenant4d1-plan-usage.spec.ts.
  const planUsage = { assertMemberSeatAvailable: async () => ({ kind: 'allow' as const }) } as any;
  return new UserTenantRoleService(uow, noop, noop, noop, utr, roles, users, planUsage);
}
const platform = new Role({ id: 'r', code: 'super_admin', defaultName: 'SA', scope: 'platform', requiresKyc: true, requiresApproval: false, moduleCode: null, isActive: true });

describe('RBAC escalation guards', () => {
  it('refuses to assign a platform role via the tenant API', async () => {
    await expect(svc(platform).assign('t1', 'admin', { userId: 'u1', roleCode: 'super_admin' }, null))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
  it('staff override cannot grant an ungrantable (money/god) permission', async () => {
    await expect(svc(null).setStaffOverride('t1', 'admin', new Set(['user.approve']), { userTenantRoleId: 'x', permissionCode: 'wallet.adjust', isGranted: true }, null))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
  it('staff override cannot grant a permission the actor does not hold', async () => {
    await expect(svc(null).setStaffOverride('t1', 'admin', new Set(['report.view']), { userTenantRoleId: 'x', permissionCode: 'listing.create', isGranted: true }, null))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});
