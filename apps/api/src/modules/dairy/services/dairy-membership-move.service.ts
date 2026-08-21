// modules/dairy/services/dairy-membership-move.service.ts · PC-56 TENANT-6d-3 · W171's move.
//
// *"Moving house? The membership moves centres without losing history — the member_code changes, the person's record
// never resets."*
//
// FOUR THINGS HAPPEN IN ONE TRANSACTION, and either all of them or none: the old route period is CLOSED the day
// before the move, the new one is OPENED on the day of it, the membership's current route and card move, and the
// event goes out naming both centres, both cards and the effective day.
//
// WHY IT IS IDEMPOTENT: a village tablet retries on a dropped connection, and a replayed move would close the period
// it had just opened and open a third — leaving a route history with a one-day phantom in it, which is exactly the
// thing this wave exists to prevent.
//
// WHAT IT WILL NOT DO: invent a member code (a cooperative's numbering is a cooperative's, Law 6), re-date a pour to
// make a chosen effective date work, or move a membership between tenants.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import {
  MoveVerdict, Route, assertDay, earliestEffectiveFrom, moveRows, moveVerdict,
} from '../domain/dairy-membership-move';
import { DomainEvent } from '../domain/dairy.events';
import {
  DairyForbiddenError, MccNotFoundError, MembershipNotFoundError, MembershipMoveRefusedError,
} from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';

export const MEMBERSHIP_TRANSFER_FLAG = 'dairy_membership_transfer';

export interface MoveMembershipInput {
  toMccId: string;
  /** The card the member will carry at the destination. Required: this platform does not number a cooperative's cards. */
  newMemberCode: string;
  /** Inclusive, in the cooperative's own calendar. Omitted means the database's today. */
  effectiveFrom?: string | null;
  reason?: string | null;
}

@Injectable()
export class DairyMembershipMoveService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly flags: FlagsService,
    private readonly memberships: DairyMembershipRepository,
    private readonly routes: DairyMembershipRouteRepository,
    private readonly centres: MccCentreRepository,
    private readonly collections: MilkCollectionRepository,
    private readonly cycles: DairyBillCycleRepository,
    private readonly instructions: DairyDeductionInstructionRepository,
  ) {}

  /**
   * Can this membership move, and from when — WITHOUT moving it.
   *
   * The screen draws its button from this, so a village operator learns *"not until tomorrow, she poured here this
   * morning"* before pressing rather than from a 422 afterwards. Every refusal the act can produce is produced here
   * too, by the same function, so the two can never disagree.
   */
  async preview(tenantId: string, actor: DairyActor, membershipId: string, input: MoveMembershipInput): Promise<MoveVerdict & { current: Route | null }> {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const gathered = await this.gather(tx, tenantId, actor, membershipId, input);
      return { ...moveVerdict(gathered.input), current: gathered.current };
    }, { userId: actor.userId });
  }

  /** The move itself. */
  async move(tenantId: string, actor: DairyActor, idemKey: string, membershipId: string, input: MoveMembershipInput, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.membership.move', () =>
      timed(this.metrics, 'dairy.membership_move', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const g = await this.gather(tx, tenantId, actor, membershipId, input);
          const verdict = moveVerdict(g.input);
          // ONE decision function for the button and for the act. A service that re-derived its own refusal is how a
          // screen comes to offer something the API rejects.
          if (!verdict.can) throw new MembershipMoveRefusedError(verdict.refusal as string, { earliestFrom: verdict.earliestFrom });

          const current = g.current as Route & { id: string };
          const rows = moveRows(current, input.toMccId, g.input.newMemberCode, g.input.effectiveFrom);

          await this.routes.close(tx, tenantId, current.id, rows.close.validTo, actor.userId);
          await this.routes.open(tx, {
            tenantId, membershipId, mccId: rows.open.mccId, memberCode: rows.open.memberCode,
            validFrom: rows.open.validFrom, movedBy: actor.userId, reason: input.reason ?? null,
          });

          g.membership.moveTo(input.toMccId, g.input.newMemberCode, g.input.effectiveFrom);
          await this.memberships.updateRoute(tx, g.membership, actor.userId);

          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.membership.moved',
            entityType: 'dairy_membership', entityId: membershipId,
            oldValue: { mccId: current.mccId, memberCode: current.memberCode },
            newValue: { mccId: input.toMccId, memberCode: g.input.newMemberCode, effectiveFrom: g.input.effectiveFrom, reason: input.reason ?? null },
            ip,
          });
          await this.flush(tx, tenantId, membershipId, g.membership.pullEvents());
          return { ...g.membership.toJSON(), effectiveFrom: g.input.effectiveFrom, caution: verdict.caution };
        }, { userId: actor.userId })));
  }

  /** Everywhere a membership has poured, oldest first — the history the canon promises is not lost. */
  async trail(tenantId: string, actor: DairyActor & { userId: string }, membershipId: string, limit: number) {
    return this.uow.run(tenantId, async (tx) => {
      const m = await this.memberships.getById(tenantId, membershipId, tx);
      if (!m) throw new MembershipNotFoundError(membershipId);
      // A member may read their OWN trail; staff read any in-tenant. Same ownership rule as every member-facing dairy
      // route, and a 404 rather than a 403 so a membership id cannot be probed.
      if (m.farmerUserId !== actor.userId && !actor.canManage) throw new MembershipNotFoundError(membershipId);
      return this.routes.trail(tx, tenantId, membershipId, limit);
    }, { userId: actor.userId });
  }

  /**
   * Everything `moveVerdict` needs, read once, inside the transaction that will act on it.
   *
   * Read INSIDE the transaction and with the membership and its route LOCKED: a preview that read on the replica and
   * an act that read in-tx could answer differently about a card that was taken a second ago.
   */
  private async gather(tx: TxContext, tenantId: string, actor: DairyActor, membershipId: string, input: MoveMembershipInput) {
    const membership = await this.memberships.getForUpdate(tx, tenantId, membershipId);
    if (!membership) throw new MembershipNotFoundError(membershipId);
    const destination = await this.centres.getById(tenantId, input.toMccId, tx);
    if (!destination) throw new MccNotFoundError(input.toMccId);

    const current = await this.routes.current(tx, tenantId, membershipId);
    const today = await this.today(tx);
    const newMemberCode = String(input.newMemberCode ?? '').trim();
    // The default is the cooperative's TODAY, from the DATABASE — never the API process's clock, for the reason
    // TENANT-6a gave about a counter and a desk disagreeing which day a pour belongs to.
    const effectiveFrom = input.effectiveFrom ? assertDay(input.effectiveFrom) : today;

    const p = membership.toProps();
    const lastPour = current === null ? null : await this.collections.lastPourDayAt(tx, tenantId, membershipId, current.mccId);
    const unbilled = current === null ? 0 : await this.collections.unbilledPoursAt(tx, tenantId, membershipId, current.mccId);
    const openCycle = await this.cycles.findCoveringDay(tx, tenantId, p.paymentCycle, effectiveFrom);
    const liveDebts = await this.instructions.countActiveFor(tx, tenantId, membershipId);

    return {
      membership,
      current: current as (Route & { id: string }) | null,
      input: {
        flagOn: await this.flags.isEnabled(MEMBERSHIP_TRANSFER_FLAG, { tenantId, userId: actor.userId }),
        canManage: actor.canManage,
        membershipActive: p.isActive,
        current: current === null ? null : { mccId: current.mccId, memberCode: current.memberCode, validFrom: current.validFrom, validTo: current.validTo },
        toMccId: input.toMccId,
        destinationActive: destination.toProps().isActive,
        newMemberCode,
        codeTakenNow: newMemberCode.length === 0 ? true : await this.memberships.codeTakenAt(tx, tenantId, input.toMccId, newMemberCode, membershipId),
        codeHeldInPeriod: newMemberCode.length === 0 ? false : await this.routes.codeHeldInPeriod(tx, tenantId, input.toMccId, newMemberCode, effectiveFrom, membershipId),
        effectiveFrom,
        lastPourAtCurrent: lastPour,
        openCycleCovers: openCycle !== null,
        unbilledAtCurrent: unbilled,
        liveDebts,
      },
      earliest: earliestEffectiveFrom(current, lastPour),
    };
  }

  /** The DATABASE's today, in the cooperative's own calendar. */
  private async today(tx: TxContext): Promise<string> {
    const r = await tx.query(`SELECT current_date::text AS d`);
    return String((r.rows[0] as { d: string }).d);
  }

  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'dairy_membership', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
    }
  }
}
