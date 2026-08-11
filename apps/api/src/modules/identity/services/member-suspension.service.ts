// modules/identity/services/member-suspension.service.ts · W154's danger zone, tenant-scoped (PC-56 TENANT-1b-2).
//
// **THIS SERVICE EXISTS BECAUSE THE OBVIOUS IMPLEMENTATION WAS DANGEROUS.** `UserService.changeStatus` already had every
// ingredient — reason, audit row, state machine — and no HTTP route, so the five-line wiring was sitting there. It would
// have set `users.status`, which is GLOBAL: one tenant's member desk locking a farmer out of every other FPO they belong
// to, out of the consumer storefront, and out of the app. 0127's own header carries the full argument.
//
// So a tenant suspension is its own record, scoped to one tenant, and enforced at four points that already touch the
// database. Nothing here writes to `users`.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { uuidv7 } from '../../../core/database/uuid.util';
import { NotFoundError, ConflictError } from '../../../shared/errors/app-error';
import { MemberSuspensionRepository } from '../repositories/member-suspension.repository';
import {
  SuspensionRecord, requireReason, assertNotSelf, suspendVerdict, liftVerdict, SUSPENSION_EFFECTS,
} from '../domain/member-suspension';

export interface SuspensionActor { userId: string; ip: string | null; requestId: string | null }

export interface SuspensionResult {
  outcome: 'suspended' | 'already_suspended' | 'lifted';
  record: SuspensionRecord;
}

@Injectable()
export class MemberSuspensionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly audit: AuditWriter,
    private readonly repo: MemberSuspensionRepository,
    private readonly roleCache: RoleCacheService,
  ) {}

  /**
   * Suspend a member of THIS tenant.
   *
   * **ONE TRANSACTION, WITH THE AUDIT ROW INSIDE IT (Law 4).** The record and its audit entry commit together or not at
   * all: a suspension nobody can trace and an audit row for a suspension that did not happen are both worse than a
   * failed request.
   *
   * The RBAC cache is invalidated AFTER the commit, deliberately. Invalidating inside the transaction would clear the
   * cache for a suspension that then rolled back, and the next request would repopulate it from the pre-suspension
   * database — a cache flush is not transactional and pretending otherwise is how stale becomes wrong.
   */
  async suspend(tenantId: string, actor: SuspensionActor, userId: string, rawReason: string): Promise<SuspensionResult> {
    assertNotSelf(actor.userId, userId);
    const reason = requireReason(rawReason, 'suspend');
    await this.assertMember(tenantId, userId);

    const out = await this.uow.run(tenantId, async (tx) => {
      const existing = await this.repo.liveForUpdate(tx, tenantId, userId);
      // **AN ALREADY-SUSPENDED MEMBER IS REPORTED, NOT SILENTLY RE-SUSPENDED.** A second success would tell staff their
      // new reason was recorded when the unique index would have refused it; the console shows the ORIGINAL reason and
      // date instead, which is the fact they actually need.
      if (suspendVerdict(existing) === 'already_suspended') {
        return { outcome: 'already_suspended' as const, record: existing! };
      }

      const id = uuidv7();
      await this.repo.insert(tx, { id, tenantId, userId, reason, suspendedBy: actor.userId });
      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.userId,
        action: 'member.suspended',
        entityType: 'user',
        entityId: userId,
        // The EFFECTS are recorded alongside the act, so a reviewer a year later knows what this suspension actually did
        // rather than what the feature does today. `blocksPayouts: false` is the line that matters most in that record.
        newValue: { scope: 'tenant', effects: SUSPENSION_EFFECTS },
        reason,
        ip: actor.ip,
        requestId: actor.requestId,
      });
      // Tenant-scoped event. A platform-wide `identity.user_status_changed` would be a lie about what happened, and any
      // consumer treating it as global would propagate the very cross-tenant effect this design refuses.
      await this.outbox.write(tx, {
        tenantId,
        aggregateType: 'user',
        aggregateId: userId,
        eventType: 'identity.tenant_member_suspended',
        payload: { v: 1, tenantId, userId, suspensionId: id, by: actor.userId },
      });
      const record = await this.repo.liveForUpdate(tx, tenantId, userId);
      return { outcome: 'suspended' as const, record: record! };
    }, { userId: actor.userId });

    if (out.outcome === 'suspended') await this.roleCache.invalidate(userId, tenantId);
    return out;
  }

  /**
   * Reinstate a member.
   *
   * **ONE PERSON WITH A REASON, EXACTLY LIKE THE SUSPENSION — AND THAT BREAKS THIS PROGRAMME'S USUAL ASYMMETRY ON
   * PURPOSE.** Sixteen maker-checker sites follow "restrictive = one person, permissive = two". Here the second signature
   * would fall on the wrong side: requiring two people to LIFT keeps a wrongly-suspended farmer off the marketplace for
   * longer, and the whole harm of a mistaken suspension is borne by the member, not the platform. The same scope that can
   * suspend can lift, which makes the mistake cheap to reverse; both reasons are recorded, so the review happens after
   * the farmer is trading again rather than before.
   */
  async lift(tenantId: string, actor: SuspensionActor, userId: string, rawReason: string): Promise<SuspensionResult> {
    assertNotSelf(actor.userId, userId);
    const reason = requireReason(rawReason, 'lift');

    const out = await this.uow.run(tenantId, async (tx) => {
      const existing = await this.repo.liveForUpdate(tx, tenantId, userId);
      // Lifting nothing is an ERROR, not a no-op: the staff member believes this member is suspended and they are not,
      // and quietly agreeing would leave them thinking they had fixed something.
      if (liftVerdict(existing) === 'not_suspended') {
        throw new ConflictError('this member is not currently suspended', { reason: 'not_suspended' });
      }
      const changed = await this.repo.lift(tx, { tenantId, id: existing!.id, liftedBy: actor.userId, liftReason: reason });
      // Belt and braces: the row was locked, so zero rows here would mean the WHERE and the read disagree.
      if (changed !== 1) throw new ConflictError('this member is not currently suspended', { reason: 'not_suspended' });

      await this.audit.write(tx, {
        tenantId,
        actorUserId: actor.userId,
        action: 'member.suspension_lifted',
        entityType: 'user',
        entityId: userId,
        oldValue: { suspensionId: existing!.id, suspendedBy: existing!.suspendedBy, suspendedAt: existing!.createdAt },
        newValue: { lifted: true },
        reason,
        ip: actor.ip,
        requestId: actor.requestId,
      });
      await this.outbox.write(tx, {
        tenantId,
        aggregateType: 'user',
        aggregateId: userId,
        eventType: 'identity.tenant_member_reinstated',
        payload: { v: 1, tenantId, userId, suspensionId: existing!.id, by: actor.userId },
      });
      return { outcome: 'lifted' as const, record: { ...existing!, liftedAt: new Date().toISOString(), liftedBy: actor.userId, liftReason: reason } };
    }, { userId: actor.userId });

    // Immediately, so a reinstated member is not waiting five minutes for a cache to expire before they can trade.
    await this.roleCache.invalidate(userId, tenantId);
    return out;
  }

  /** The live episode plus the history, for W154. */
  async statusFor(tenantId: string, userId: string): Promise<{ live: SuspensionRecord | null; history: SuspensionRecord[] }> {
    const history = await this.repo.historyFor(tenantId, userId);
    return { live: history.find((h) => h.liftedAt === null) ?? null, history };
  }

  /**
   * **THE MEMBERSHIP CHECK, AND IT DOES NOT REQUIRE AN ACTIVE ROLE.** A member whose roles lapsed can still be suspended:
   * a dormant account being used for fraud is exactly the case a member desk needs to stop. What it refuses is suspending
   * somebody who has no relationship with this tenant at all — which would be one tenant writing a record about a
   * stranger, the cross-tenant act this whole design exists to prevent.
   *
   * 404 rather than 403, matching every other member route: "exists but is not yours" is an enumeration oracle.
   */
  private async assertMember(tenantId: string, userId: string): Promise<void> {
    const r = await this.replica.forTenant(tenantId).query<{ ok: boolean }>(
      `SELECT true AS ok FROM user_tenant_roles
        WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, userId]);
    if (r.rows.length === 0) throw new NotFoundError('member not found in this organisation');
  }
}
