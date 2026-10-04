// modules/identity/services/conflict.service.ts · PC-56 TENANT-SW-c · A3 — STAFF SELF-DECLARE CONFLICTS (founder decision).
//
// A staff member declares a conflict with a member from their own security page (`/me/conflicts`); a tenant_admin may record one for
// them (`/team/:userId/conflicts`). An active declaration MECHANICALLY recuses: 0199's trigger refuses that person's KYC decision on
// the member (`[KYC_RECUSED_DECLARED]`) and the take-next query never hands them the member's documents. A declaration is lifted only
// by a tenant_admin who is not the declared person (`[CONFLICT_SELF_LIFT]`), with a reason. Every write audited; the audit row names
// the relation and the member's id — never a phone, never a free-text address.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { VerificationTeamRepository, ConflictRow } from '../repositories/verification-team.repository';
import { cleanReason, conflictRefusals, reasonRefusal } from '../domain/verification-team';
import { namedSwcRefusal, swcRefused, SwcRefusedError } from '../domain/swc.errors';

export interface ConflictActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
export interface ConflictInput { memberUserId?: string; relation?: string; relationNote?: string | null; reason?: string }
const isAdminish = (a: ConflictActor) => a.permissions.has('user.approve') || a.permissions.has('*');

@Injectable()
export class ConflictService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly repo: VerificationTeamRepository,
  ) {}

  mine(tenantId: string, a: ConflictActor): Promise<ConflictRow[]> { return this.repo.conflictsOfStaff(tenantId, a.userId); }
  async ofStaff(tenantId: string, a: ConflictActor, staffUserId: string): Promise<ConflictRow[]> {
    if (!isAdminish(a) && a.userId !== staffUserId) throw swcRefused('TEAM_RESTRICTED');
    return this.repo.conflictsOfStaff(tenantId, staffUserId);
  }
  members(tenantId: string, q: string) { return this.repo.memberSearch(tenantId, String(q ?? '').trim().slice(0, 60)); }

  async declare(tenantId: string, a: ConflictActor, staffUserId: string, input: ConflictInput, key: string): Promise<{ id: string; via: 'self' | 'admin' }> {
    const via: 'self' | 'admin' = staffUserId === a.userId ? 'self' : 'admin';
    if (via === 'admin' && !isAdminish(a)) throw swcRefused('TEAM_RESTRICTED');
    const refusals = conflictRefusals({ ...input, staffUserId });
    if (refusals.length) throw new SwcRefusedError('CONFLICT_INVALID', 'The declaration cannot be recorded as entered', 422, { refusals });
    try {
      return await this.idem.remember(key, a.userId, 'identity.conflict.declare', () => this.uow.run(tenantId, async (tx) => {
        const id = await this.repo.insertConflictTx(tx, { tenantId, staffUserId, memberUserId: input.memberUserId!, relation: input.relation!,
          relationNote: input.relation === 'other' ? cleanReason(input.relationNote) : null, reason: cleanReason(input.reason), declaredBy: a.userId, via });
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'staff.conflict.declared', entityType: 'staff_conflict_declaration', entityId: id,
          newValue: { staffUserId, memberUserId: input.memberUserId, relation: input.relation, via }, reason: cleanReason(input.reason), ip: a.ip, requestId: a.requestId });
        return { id, via };
      }, { userId: a.userId }));
    } catch (e) { throw namedSwcRefusal(e); }
  }

  async lift(tenantId: string, a: ConflictActor, id: string, reason: string): Promise<{ id: string; active: false }> {
    if (!isAdminish(a)) throw swcRefused('CONFLICT_LIFTER_NOT_ADMIN');
    if (reasonRefusal(reason)) throw swcRefused('REASON_REQUIRED');
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const c = await this.repo.conflictByIdTx(tx, tenantId, id);
        if (!c) throw swcRefused('CONFLICT_NOT_FOUND');
        await this.repo.liftConflictTx(tx, tenantId, id, a.userId, cleanReason(reason));
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'staff.conflict.lifted', entityType: 'staff_conflict_declaration', entityId: id,
          oldValue: { active: true }, newValue: { active: false, staffUserId: c.staffUserId, memberUserId: c.memberUserId }, reason: cleanReason(reason), ip: a.ip, requestId: a.requestId });
        return { id, active: false as const };
      }, { userId: a.userId });
    } catch (e) { throw namedSwcRefusal(e); }
  }
}
