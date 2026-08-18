// modules/identity/services/user-tenant-role.service.ts · RBAC assignment lifecycle.
// Every mutation: validates the role, enforces age/approval gates, writes the change +
// an audit row in ONE transaction, emits an outbox event, and INVALIDATES the role
// cache so the user's next token reflects the new grants.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { RoleNotFoundError, RoleAlreadyAssignedError, UserNotFoundError } from '../domain/identity.errors';
import { ForbiddenError } from '../../../shared/errors/app-error';
import { UserTenantRole } from '../domain/user-tenant-role.entity';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { RoleRepository } from '../repositories/role.repository';
import { PlanUsageService } from '../../tenancy/services/plan-usage.service';
import { UserRepository } from '../repositories/user.repository';
import { AssignRoleDto, StaffOverrideDto } from '../dto/create-user-tenant-role.dto';

const ADULT_ROLES = new Set(['worker', 'sardar', 'vet', 'banker', 'insurance_agent', 'gov_officer', 'farmer', 'vyapari', 'equipment_owner']);

@Injectable()
export class UserTenantRoleService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
    private readonly roleCache: RoleCacheService,
    private readonly utr: UserTenantRoleRepository,
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    // PC-56 TENANT-4d-1: the tenancy module's PUBLIC service (never its repositories — module blueprint).
    // W118: "at 100% new additions pause (existing operations never do)", which had no code anywhere.
    private readonly planUsage: PlanUsageService,
  ) {}

  async assign(tenantId: string, actorUserId: string, dto: AssignRoleDto, ip: string | null) {
    const role = await this.roles.findByCode(tenantId, dto.roleCode);
    if (!role) throw new RoleNotFoundError(dto.roleCode);
    // SECURITY (Law 11): platform/owner roles (super_admin, platform_*) are NEVER
    // assignable through the tenant API — that would be privilege escalation to god-mode.
    // They are granted only in apps/admin-api (separate, hardened auth realm).
    if (role.isPlatform) throw new ForbiddenError('Platform roles cannot be assigned via the tenant API', { role: role.code });
    let id: string;
    try {
    id = await this.uow.run(tenantId, async (tx) => {
      const existing = await this.utr.findExisting(tenantId, dto.userId, role.id);
      if (existing) throw new RoleAlreadyAssignedError();
      // THE PLAN's MEMBER LIMIT (W118), checked inside this write's own transaction so the count the refusal
      // cites is the count as of the write. Behind `plan_limit_enforcement` (0145, default OFF); a person who
      // already holds a role in this tenant is not a new member, so the check runs only for a NEW member —
      // adding a second role to an existing member never consumes a seat.
      if (!(await this.utr.hasAnyRole(tx, tenantId, dto.userId))) {
        await this.planUsage.assertMemberSeatAvailable(tx, tenantId);
      }
      if (ADULT_ROLES.has(role.code)) {
        const u = await this.users.getForUpdate(tx, dto.userId);
        if (!u) throw new UserNotFoundError(dto.userId);
        u.assertMinAge(18);
      }
      const utr = UserTenantRole.assign({ id: uuidv7(), userId: dto.userId, tenantId, roleId: role.id, roleCode: role.code, requiresApproval: role.requiresApproval, roleData: dto.roleData });
      await this.utr.insert(tx, utr);
      await this.flush(tx, utr.id, utr.pullEvents(), tenantId);
      await this.audit.write(tx, { tenantId, actorUserId, action: 'role.assigned', entityType: 'user_tenant_role', entityId: utr.id, newValue: { userId: dto.userId, roleCode: role.code, active: utr.isActive }, ip });
      return utr.id;
    }, { userId: actorUserId });
    } catch (e: any) {
      if (e?.code === '23505') throw new RoleAlreadyAssignedError(); // unique(user,tenant,role) race
      throw e;
    }
    await this.roleCache.invalidate(dto.userId, tenantId);
    return { id };
  }

  async approve(tenantId: string, approverUserId: string, utrId: string, ip: string | null) {
    let userId = '';
    await this.uow.run(tenantId, async (tx) => {
      const utr = await this.utr.getForUpdate(tx, tenantId, utrId);
      if (!utr) throw new RoleNotFoundError(utrId);
      userId = utr.toProps().userId;
      utr.approve(approverUserId);
      await this.utr.update(tx, utr);
      await this.flush(tx, utr.id, utr.pullEvents(), tenantId);
      await this.audit.write(tx, { tenantId, actorUserId: approverUserId, action: 'role.approved', entityType: 'user_tenant_role', entityId: utr.id, ip });
    }, { userId: approverUserId });
    await this.roleCache.invalidate(userId, tenantId);
    return { ok: true };
  }

  async revoke(tenantId: string, actorUserId: string, utrId: string, reason: string | null, ip: string | null) {
    let userId = '';
    await this.uow.run(tenantId, async (tx) => {
      const utr = await this.utr.getForUpdate(tx, tenantId, utrId);
      if (!utr) throw new RoleNotFoundError(utrId);
      userId = utr.toProps().userId;
      utr.revoke(actorUserId);
      await this.utr.update(tx, utr);
      await this.flush(tx, utr.id, utr.pullEvents(), tenantId);
      await this.audit.write(tx, { tenantId, actorUserId, action: 'role.revoked', entityType: 'user_tenant_role', entityId: utr.id, reason, ip });
    }, { userId: actorUserId });
    await this.roleCache.invalidate(userId, tenantId);
    return { ok: true };
  }

  async setStaffOverride(tenantId: string, actorUserId: string, actorPerms: ReadonlySet<string>, dto: StaffOverrideDto, ip: string | null) {
    // SECURITY: a grant can never (a) hand out platform/money/god permissions, nor
    // (b) exceed what the granter themselves holds. Revokes (is_granted=false) are always allowed.
    const UNGRANTABLE = new Set(['*', 'plan.manage', 'tenant.manage', 'user.impersonate', 'wallet.adjust', 'payout.approve', 'flag.toggle']);
    if (dto.isGranted) {
      if (UNGRANTABLE.has(dto.permissionCode)) throw new ForbiddenError('This permission cannot be granted via a staff override', { permission: dto.permissionCode });
      if (!actorPerms.has(dto.permissionCode) && !actorPerms.has('*')) throw new ForbiddenError('You cannot grant a permission you do not hold', { permission: dto.permissionCode });
    }
    let userId = '';
    await this.uow.run(tenantId, async (tx) => {
      const utr = await this.utr.getForUpdate(tx, tenantId, dto.userTenantRoleId);
      if (!utr) throw new RoleNotFoundError(dto.userTenantRoleId);
      userId = utr.toProps().userId;
      await this.roles.upsertStaffOverride(tx, dto.userTenantRoleId, dto.permissionCode, dto.isGranted);
      await this.audit.write(tx, { tenantId, actorUserId, action: 'role.override_set', entityType: 'user_tenant_role', entityId: dto.userTenantRoleId, newValue: { permission: dto.permissionCode, granted: dto.isGranted }, ip });
    }, { userId: actorUserId });
    await this.roleCache.invalidate(userId, tenantId);
    return { ok: true };
  }

  list(tenantId: string, opts: { userId?: string; roleCode?: string; pendingOnly: boolean }) {
    return this.utr.list(tenantId, opts);
  }

  private async flush(tx: TxContext, id: string, events: { type: string; payload: Record<string, unknown> }[], tenantId: string) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'user_tenant_role', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
