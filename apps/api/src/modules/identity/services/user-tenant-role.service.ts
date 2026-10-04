// modules/identity/services/user-tenant-role.service.ts · RBAC assignment lifecycle.
// Every mutation: validates the role, enforces age/approval gates, writes the change +
// an audit row in ONE transaction, emits an outbox event, and INVALIDATES the role
// cache so the user's next token reflects the new grants.
//
// PC-56 TENANT-SW-c (0199):
//   • SEATS — taking a staff seat beyond the plan's `staff_seats` is refused by the DATABASE (`[STAFF_SEATS_EXHAUSTED]`, on assign and on
//     approve); this service names the refusal and also refuses kindly up front when the plan is already full.
//   • REMOVE FROM TEAM (`revoke`, F-15) — a reason is REQUIRED (the controller no longer passes null); the role is revoked (revoked_at /
//     by / reason), its overrides are revoked with the same reason, the person's desk seats go when they hold no other staff role, and
//     their sessions IN THIS TENANT are cut off (`tenant_session_revocations` — a refresh token born before it never refreshes here again,
//     an access token issued before it is refused by SessionPostureGuard within SESSION_POSTURE_CACHE_SECONDS). The LAST tenant_admin is
//     never removed (`LAST_ADMIN`); nobody removes themselves (`REMOVE_SELF`).
//   • OVERRIDES (F-15) — every write carries WHY (reason 10–500, recorded on the row and in the audit) and optionally an expiry; a GRANT of
//     a money / PII code (`override_checker_codes`) becomes a PROPOSAL a second tenant_admin confirms — 0199's gate refuses the override
//     row unless it is written in the confirming transaction (`[OVERRIDE_NEEDS_CHECKER]`); a revoke is a recorded act, never a delete.
import { isUngrantable } from '../../../core/rbac/ungrantable';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { SESSION_POSTURE_CACHE_SECONDS, SessionPostureService } from '../../../core/auth/session-posture.guard';
import { uuidv7 } from '../../../core/database/uuid.util';
import { RoleNotFoundError, RoleAlreadyAssignedError, UserNotFoundError } from '../domain/identity.errors';
import { ForbiddenError } from '../../../shared/errors/app-error';
import { UserTenantRole } from '../domain/user-tenant-role.entity';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { RoleRepository } from '../repositories/role.repository';
import { PlanUsageService } from '../../tenancy/services/plan-usage.service';
import { UserRepository } from '../repositories/user.repository';
import { DeskRepository } from '../repositories/desk.repository';
import { VerificationTeamRepository } from '../repositories/verification-team.repository';
import { AssignRoleDto, StaffOverrideDto } from '../dto/create-user-tenant-role.dto';
import { cleanReason, reasonRefusal, removeRefusals, seatState } from '../domain/verification-team';
import { namedSwcRefusal, swcRefused, SwcRefusedError } from '../domain/swc.errors';

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
    // PC-56 TENANT-SW-c: seats, removal, overrides with a reason and a checker, the session cut-off.
    @Optional() private readonly team?: VerificationTeamRepository,
    @Optional() private readonly desks?: DeskRepository,
    @Optional() private readonly posture?: SessionPostureService,
  ) {}

  private get repo(): VerificationTeamRepository { if (!this.team) throw new Error('VerificationTeamRepository not wired'); return this.team; }

  /** Kind, up-front seat refusal for a staff role (the trigger is the wall; this only says it before the write). */
  private async assertSeatTx(tx: TxContext, tenantId: string, userId: string, isStaffRole: boolean): Promise<void> {
    if (!isStaffRole || !this.team) return;
    if (await this.team.holdsSeatTx(tx, tenantId, userId)) return;
    const st = seatState(await this.team.seatsUsed(tenantId, tx), await this.team.seatPlan(tenantId, tx));
    if (st.kind === 'limited' && st.full) throw swcRefused('STAFF_SEATS_EXHAUSTED', { used: st.used, seats: st.seats, plan: st.planName });
  }

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
      const staffRole = this.team ? Boolean((await this.team.roleByCodeTx(tx, role.code))?.isStaff) : false;
      await this.assertSeatTx(tx, tenantId, dto.userId, staffRole);
      if (ADULT_ROLES.has(role.code)) {
        const u = await this.users.getForUpdate(tx, dto.userId);
        if (!u) throw new UserNotFoundError(dto.userId);
        u.assertMinAge(18);
      }
      const utr = UserTenantRole.assign({ id: uuidv7(), userId: dto.userId, tenantId, roleId: role.id, roleCode: role.code, requiresApproval: role.requiresApproval, roleData: dto.roleData });
      await this.utr.insert(tx, utr);   // created_by = the actor (0199 trg_utr_created_by, from the session) — the ONBOARDER
      await this.flush(tx, utr.id, utr.pullEvents(), tenantId);
      await this.audit.write(tx, { tenantId, actorUserId, action: 'role.assigned', entityType: 'user_tenant_role', entityId: utr.id, newValue: { userId: dto.userId, roleCode: role.code, active: utr.isActive }, ip });
      return utr.id;
    }, { userId: actorUserId });
    } catch (e: any) {
      if (e?.code === '23505') throw new RoleAlreadyAssignedError(); // unique(user,tenant,role) race
      throw namedSwcRefusal(e);
    }
    await this.roleCache.invalidate(dto.userId, tenantId);
    return { id };
  }

  async approve(tenantId: string, approverUserId: string, utrId: string, ip: string | null) {
    let userId = '';
    try {
      await this.uow.run(tenantId, async (tx) => {
        const utr = await this.utr.getForUpdate(tx, tenantId, utrId);
        if (!utr) throw new RoleNotFoundError(utrId);
        userId = utr.toProps().userId;
        utr.approve(approverUserId);
        await this.utr.update(tx, utr);
        // PC-56 TENANT-SW-c: an approve re-opens a revoked row (and takes a seat — the trigger judges it)
        await tx.query(`UPDATE user_tenant_roles SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NOT NULL`, [utrId, tenantId]);
        await this.flush(tx, utr.id, utr.pullEvents(), tenantId);
        await this.audit.write(tx, { tenantId, actorUserId: approverUserId, action: 'role.approved', entityType: 'user_tenant_role', entityId: utr.id, ip });
      }, { userId: approverUserId });
    } catch (e) { throw namedSwcRefusal(e); }
    await this.roleCache.invalidate(userId, tenantId);
    return { ok: true };
  }

  /**
   * REMOVE (W184 "Remove from team", F-15). `reason` is REQUIRED (10–500): a missing one is refused by name, never audited as null.
   */
  async revoke(tenantId: string, actorUserId: string, utrId: string, reason: string | null, ip: string | null) {
    if (reasonRefusal(reason)) throw swcRefused('REASON_REQUIRED');
    const why = cleanReason(reason);
    const out = { userId: '', roleCode: '', desksRemoved: 0, overridesRevoked: [] as string[], cutoffAt: null as string | null };
    try {
      await this.uow.run(tenantId, async (tx) => {
        const row = await this.repo.utrForUpdate(tx, tenantId, utrId);
        if (!row) throw new RoleNotFoundError(utrId);
        out.userId = row.userId; out.roleCode = row.roleCode;
        const admins = await this.repo.activeAdminIdsTx(tx, tenantId);
        const refusals = removeRefusals({ actorUserId, targetUserId: row.userId, targetIsAdmin: row.roleCode === 'tenant_admin' && row.isActive && admins.includes(row.userId),
          activeAdmins: admins.length, reason: why });
        if (refusals.includes('REMOVE_SELF')) throw swcRefused('REMOVE_SELF');
        if (refusals.includes('LAST_ADMIN')) throw swcRefused('LAST_ADMIN', { admins: admins.length });
        if (row.revokedAt) throw swcRefused('ROLE_NOT_FOUND');
        await this.repo.revokeUtrTx(tx, tenantId, utrId, actorUserId, why);
        out.overridesRevoked = await this.repo.revokeAllOverridesTx(tx, utrId, actorUserId, why);
        if (row.isStaff && !(await this.repo.otherLiveStaffRoleTx(tx, tenantId, row.userId, utrId)) && this.desks) {
          for (const deskId of await this.repo.liveDeskIdsTx(tx, tenantId, row.userId)) {
            if (await this.desks.removeMemberTx(tx, tenantId, deskId, row.userId, actorUserId, why.slice(0, 300))) out.desksRemoved++;
          }
        }
        out.cutoffAt = await this.repo.cutSessionsTx(tx, tenantId, row.userId, actorUserId, why);
        await this.outbox.write(tx, { tenantId, aggregateType: 'user_tenant_role', aggregateId: utrId, eventType: 'identity.role_revoked',
          payload: { v: 1, id: utrId, userId: row.userId, tenantId, roleCode: row.roleCode, by: actorUserId } });
        await this.audit.write(tx, { tenantId, actorUserId, action: 'role.revoked', entityType: 'user_tenant_role', entityId: utrId,
          oldValue: { active: row.isActive }, newValue: { active: false, userId: row.userId, roleCode: row.roleCode, desksRemoved: out.desksRemoved,
            overridesRevoked: out.overridesRevoked, sessionsCutOffAt: out.cutoffAt }, reason: why, ip });
      }, { userId: actorUserId });
    } catch (e) { throw namedSwcRefusal(e); }
    await this.roleCache.invalidate(out.userId, tenantId);
    await this.posture?.forgetCutoff(tenantId, out.userId);
    return { ok: true, roleCode: out.roleCode, desksRemoved: out.desksRemoved, overridesRevoked: out.overridesRevoked, sessionsCutOffAt: out.cutoffAt, sessionEndBoundSec: SESSION_POSTURE_CACHE_SECONDS };
  }

  async setStaffOverride(tenantId: string, actorUserId: string, actorPerms: ReadonlySet<string>, dto: StaffOverrideDto, ip: string | null) {
    // SECURITY: a grant can never (a) hand out platform/money/god permissions, nor
    // (b) exceed what the granter themselves holds. Revokes (is_granted=false) are always allowed.
    // PC-56 TENANT-13b: ONE list, shared with desks and the resolver (core/rbac/ungrantable.ts) — this path held its own inline copy.
    if (dto.isGranted) {
      if (isUngrantable(dto.permissionCode)) throw new ForbiddenError('This permission cannot be granted via a staff override', { permission: dto.permissionCode });
      if (!actorPerms.has(dto.permissionCode) && !actorPerms.has('*')) throw new ForbiddenError('You cannot grant a permission you do not hold', { permission: dto.permissionCode });
    }
    // PC-56 TENANT-SW-c (F-15): WHY, recorded — on the row and in the audit. The DTO already refuses < 10; this is the second word.
    if (reasonRefusal(dto.reason)) throw swcRefused('REASON_REQUIRED');
    const why = cleanReason(dto.reason);
    const expiresAt = dto.expiresAt ?? null;
    let userId = '';
    try {
      const out = await this.uow.run(tenantId, async (tx) => {
        const utr = await this.utr.getForUpdate(tx, tenantId, dto.userTenantRoleId);
        if (!utr) throw new RoleNotFoundError(dto.userTenantRoleId);
        userId = utr.toProps().userId;
        const checker = await this.repo.checkerCodes(tenantId, tx);
        if (dto.isGranted && checker.has(dto.permissionCode)) {
          // A MONEY / PII GRANT IS A PROPOSAL — a second tenant_admin confirms it (0199 trg_sop_moves; the gate refuses the row otherwise).
          const admins = await this.repo.activeAdminIdsTx(tx, tenantId);
          if (admins.filter((x) => x !== actorUserId && x !== userId).length === 0) throw swcRefused('NEEDS_SECOND_ADMIN', { admins: admins.length });
          const proposalId = await this.repo.insertProposalTx(tx, { tenantId, utrId: dto.userTenantRoleId, granteeUserId: userId, code: dto.permissionCode, overrideExpiresAt: expiresAt, reason: why, proposedBy: actorUserId });
          await this.audit.write(tx, { tenantId, actorUserId, action: 'role.override_proposed', entityType: 'staff_override_proposal', entityId: proposalId,
            newValue: { userTenantRoleId: dto.userTenantRoleId, permission: dto.permissionCode, class: checker.get(dto.permissionCode), expiresAt }, reason: why, ip });
          return { status: 'proposed' as const, proposalId };
        }
        await this.repo.upsertOverrideTx(tx, { utrId: dto.userTenantRoleId, code: dto.permissionCode, isGranted: dto.isGranted, reason: why, expiresAt, by: actorUserId });
        await this.audit.write(tx, { tenantId, actorUserId, action: 'role.override_set', entityType: 'user_tenant_role', entityId: dto.userTenantRoleId,
          newValue: { permission: dto.permissionCode, granted: dto.isGranted, expiresAt }, reason: why, ip });
        return { status: 'applied' as const, proposalId: null };
      }, { userId: actorUserId });
      if (out.status === 'applied') await this.roleCache.invalidate(userId, tenantId);
      return { ok: true, ...out };
    } catch (e) { throw namedSwcRefusal(e); }
  }

  /** A second tenant_admin confirms a privileged override: the proposal is confirmed AND the override written, in one transaction. */
  async confirmOverrideProposal(tenantId: string, actorUserId: string, id: string, ip: string | null) {
    let userId = '';
    try {
      const out = await this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.proposalForUpdate(tx, tenantId, id);
        if (!p) throw swcRefused('OVERRIDE_PROPOSAL_NOT_FOUND');
        userId = p.granteeUserId;
        await this.repo.confirmProposalTx(tx, tenantId, id, actorUserId);            // the trigger: never the proposer, never the grantee
        await tx.query(`SELECT set_config('app.override_proposal_id', $1, true)`, [id]);
        await this.repo.upsertOverrideTx(tx, { utrId: p.userTenantRoleId, code: p.permissionCode, isGranted: true, reason: p.reason, expiresAt: p.overrideExpiresAt, by: p.proposedBy });
        await this.audit.write(tx, { tenantId, actorUserId, action: 'role.override_confirmed', entityType: 'staff_override_proposal', entityId: id,
          newValue: { userTenantRoleId: p.userTenantRoleId, permission: p.permissionCode, proposedBy: p.proposedBy, expiresAt: p.overrideExpiresAt }, reason: p.reason, ip });
        return { id, status: 'confirmed' as const, permission: p.permissionCode };
      }, { userId: actorUserId });
      await this.roleCache.invalidate(userId, tenantId);
      return out;
    } catch (e) { throw namedSwcRefusal(e); }
  }

  async refuseOverrideProposal(tenantId: string, actorUserId: string, id: string, reason: string, ip: string | null) {
    if (reasonRefusal(reason)) throw swcRefused('REASON_REQUIRED');
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.proposalForUpdate(tx, tenantId, id);
        if (!p) throw swcRefused('OVERRIDE_PROPOSAL_NOT_FOUND');
        await this.repo.refuseProposalTx(tx, tenantId, id, actorUserId, cleanReason(reason));
        await this.audit.write(tx, { tenantId, actorUserId, action: 'role.override_refused', entityType: 'staff_override_proposal', entityId: id,
          newValue: { permission: p.permissionCode }, reason: cleanReason(reason), ip });
        return { id, status: 'refused' as const };
      }, { userId: actorUserId });
    } catch (e) { throw namedSwcRefusal(e); }
  }

  /** Revoke one override (grant or deny) with a reason — recorded on the row, never a delete (W2772–W2774 "revoke override"). */
  async revokeOverride(tenantId: string, actorUserId: string, dto: { userTenantRoleId: string; permissionCode: string; reason: string }, ip: string | null) {
    if (reasonRefusal(dto.reason)) throw swcRefused('REASON_REQUIRED');
    let userId = '';
    try {
      await this.uow.run(tenantId, async (tx) => {
        const utr = await this.utr.getForUpdate(tx, tenantId, dto.userTenantRoleId);
        if (!utr) throw new RoleNotFoundError(dto.userTenantRoleId);
        userId = utr.toProps().userId;
        if ((await this.repo.revokeOverrideTx(tx, dto.userTenantRoleId, dto.permissionCode, actorUserId, cleanReason(dto.reason))) === 0) throw swcRefused('OVERRIDE_NOT_FOUND');
        await this.audit.write(tx, { tenantId, actorUserId, action: 'role.override_revoked', entityType: 'user_tenant_role', entityId: dto.userTenantRoleId,
          newValue: { permission: dto.permissionCode, revoked: true }, reason: cleanReason(dto.reason), ip });
      }, { userId: actorUserId });
    } catch (e) { if (e instanceof SwcRefusedError) throw e; throw namedSwcRefusal(e); }
    await this.roleCache.invalidate(userId, tenantId);
    return { ok: true };
  }

  async overrideProposals(tenantId: string, opts: { status?: string; limit: number }) {
    return this.repo.proposals(tenantId, opts);
  }

  list(tenantId: string, opts: { userId?: string; roleCode?: string; pendingOnly: boolean }) {
    return this.utr.list(tenantId, opts);
  }

  private async flush(tx: TxContext, id: string, events: { type: string; payload: Record<string, unknown> }[], tenantId: string) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'user_tenant_role', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
