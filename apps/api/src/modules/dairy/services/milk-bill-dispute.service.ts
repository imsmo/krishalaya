// modules/dairy/services/milk-bill-dispute.service.ts · PC-56 TENANT-6c-2 · the member's voice.
//
// W169: *"member sees every pour + every deduction, 24h dispute window"* and *"Last cycle disputes 2 / 309 · both
// resolved before payday"*, with *"disputed pauses one bill, never the cycle"*.
//
// Two acts, and they belong to DIFFERENT PEOPLE, which is the whole reason this is its own service:
//   raise()   — the MEMBER, about their own bill, inside their own window. No `dairy.manage` anywhere near it.
//   resolve() — the COOPERATIVE, with a note the member is told, optionally voiding and rebuilding the bill.
import { DairyNoticeVarsService } from './dairy-notice-vars.service';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MilkBillDispute } from '../domain/milk-bill-dispute.entity';
import { DomainEvent } from '../domain/dairy.events';
import { MilkBillDisputeRepository } from '../repositories/milk-bill-dispute.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkBillService } from './milk-bill.service';
import {
  BillNotFoundError, DairyForbiddenError, DisputeNotFoundError, MembershipNotFoundError,
} from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';

@Injectable()
export class MilkBillDisputeService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly disputes: MilkBillDisputeRepository,
    private readonly bills: MilkBillRepository,
    private readonly memberships: DairyMembershipRepository,
    private readonly cycles: DairyBillCycleRepository,
    private readonly billService: MilkBillService,
    private readonly noticeVars: DairyNoticeVarsService,
  ) {}

  /**
   * THE MEMBER OBJECTS. The one act in the dairy module that a farmer performs on their own money.
   *
   * Authorised by OWNERSHIP, not by a permission: the caller must be the farmer on the bill's membership. Staff hold
   * `dairy.manage` and are deliberately NOT allowed here — an objection recorded as if the member made it, by the
   * cooperative that wrote the bill, is the opposite of what the window is for. (Staff who need to correct a bill have
   * `resolve` + `void`, which are recorded as theirs.)
   *
   * A bill that is not `previewed` is refused by the aggregate, and so is one whose window has closed — which is why
   * `dispute()` takes `now`: the promise is 24 hours, and a promise nothing measures is decoration.
   */
  async raise(tenantId: string, actorUserId: string, billId: string, reason: string, idemKey: string, ip: string | null, now = new Date()) {
    return this.idem.remember(idemKey, actorUserId, 'dairy.bill.dispute', () =>
      timed(this.metrics, 'dairy.bill.dispute', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const bill = await this.bills.getForUpdate(tx, tenantId, billId);
          if (!bill) throw new BillNotFoundError(billId);
          const membership = await this.memberships.getById(tenantId, bill.membershipIdRef, tx);
          if (!membership) throw new MembershipNotFoundError(bill.membershipIdRef);
          // 404, not 403: a member must not be able to probe which bill ids exist (the same no-IDOR ruling
          // `MilkBillService.getById` already makes for reads).
          if (membership.farmerUserId !== actorUserId) throw new BillNotFoundError(billId);

          MilkBillDispute.assertNoOpen(await this.disputes.openForBill(tx, tenantId, billId), billId);

          // The aggregate refuses a closed window and an un-previewed bill, and moves the bill to `disputed` — which is
          // what "pauses one bill, never the cycle" means in the state machine: no cycle status changes here.
          bill.dispute(now, reason);
          const dispute = MilkBillDispute.open({
            id: uuidv7(), tenantId, billId, membershipId: bill.membershipIdRef,
            raisedByUserId: actorUserId, reason, windowEndedAt: bill.disputeWindowEnds!, at: now,
          });
          await this.disputes.insert(tx, dispute);
          await this.bills.update(tx, bill);
          await this.audit.write(tx, {
            tenantId, actorUserId, action: 'dairy.bill.disputed', entityType: 'milk_bill', entityId: billId,
            newValue: { disputeId: dispute.id, reason: reason.trim(), windowEndedAt: bill.disputeWindowEnds!.toISOString() }, ip,
          });
          await this.flush(tx, tenantId, billId, [...dispute.pullEvents(), ...bill.pullEvents()]);
          return dispute.toJSON();
        }, { userId: actorUserId })));
  }

  /**
   * THE COOPERATIVE ANSWERS.
   *
   * `rejected` → the bill stands, and goes back to `previewed` with a FRESH window, because the member is being shown
   * the same figures again with an explanation and must not lose the ability to object to the explanation.
   *
   * `upheld` + `void` → the bill was wrong. Voiding releases its pours and soft-deletes it, and the cycle's next
   * generation pass rebuilds it from whatever the pours now say. That is the ONLY correction this platform can make:
   * `milk_bills` has no adjustment line and no credit note, so amending the arithmetic in place is not possible and is
   * not faked. `upheld` WITHOUT a void is allowed and means "you were right and the fix is outside this bill" — it
   * leaves the bill `disputed` and therefore unpayable, which is the honest state for money nobody can yet compute.
   */
  async resolve(
    tenantId: string, actor: DairyActor, disputeId: string,
    input: { outcome: 'upheld' | 'rejected'; note: string; voidBill: boolean }, ip: string | null, now = new Date(),
  ) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return timed(this.metrics, 'dairy.bill.dispute_resolve', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const dispute = await this.disputes.getForUpdate(tx, tenantId, disputeId);
        if (!dispute) throw new DisputeNotFoundError(disputeId);
        const bill = await this.bills.getForUpdate(tx, tenantId, dispute.billId);
        if (!bill) throw new BillNotFoundError(dispute.billId);
        const membership = await this.memberships.getById(tenantId, bill.membershipIdRef, tx);
        if (!membership) throw new MembershipNotFoundError(bill.membershipIdRef);

        const billProps = bill.toProps();
        dispute.resolve({
          outcome: input.outcome, byUserId: actor.userId, at: now, note: input.note, voidedBill: input.voidBill,
          // [PC-56 TENANT-6d-7] `{{period}}` and a verdict in the member's own language.
          notice: await this.noticeVars.billDisputeResolved(tx, {
            periodStart: billProps.periodStart, periodEnd: billProps.periodEnd, outcome: input.outcome, note: input.note,
          }),
        });
        await this.disputes.resolve(tx, dispute);

        if (input.voidBill) {
          // Voided INSIDE THIS TRANSACTION, through the bill service's tx-taking form. Calling the self-opening
          // `voidBill` here deadlocked: this transaction already holds the bill under FOR UPDATE, so a second
          // connection asking for the same row lock waits on us forever (found by a live test that timed out). One
          // transaction also means "the query was upheld" and "the bill was voided" cannot end up disagreeing.
          await this.billService.voidLoaded(tx, tenantId, actor, bill, input.note, ip, now);
        } else if (input.outcome === 'rejected') {
          bill.resolveToPreviewed(now, await this.windowEnd(tx, tenantId, now), membership.farmerUserId, input.outcome,
            await this.noticeVars.billDisputeResolved(tx, {
              periodStart: billProps.periodStart, periodEnd: billProps.periodEnd, outcome: input.outcome, note: input.note,
            }));
          await this.bills.update(tx, bill);
          await this.flush(tx, tenantId, bill.id, bill.pullEvents());
        }
        // An UPHELD dispute with no void leaves the bill `disputed` deliberately: the member was right, the correction
        // is not expressible on this bill, and a bill that cannot be computed correctly must not become payable.

        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'dairy.bill.dispute_resolved', entityType: 'milk_bill_dispute', entityId: disputeId,
          newValue: { outcome: input.outcome, voidedBill: input.voidBill, note: input.note.trim(), billId: bill.id }, ip,
        });
        await this.flush(tx, tenantId, dispute.billId, dispute.pullEvents());
        return dispute.toJSON();
      }, { userId: actor.userId }));
  }

  /** The cooperative's queue. Staff only — a member sees their own bill's history through the bill read. */
  async listOpen(tenantId: string, actor: DairyActor, limit: number) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return (await this.disputes.listOpen(tenantId, limit)).map((d) => d.toJSON());
  }

  /** One bill's dispute history. Readable by the member who owns the bill, or by staff. */
  async listForBill(tenantId: string, actor: DairyActor & { userId: string }, billId: string, limit: number) {
    const bill = await this.bills.getById(tenantId, billId);
    if (!bill) throw new BillNotFoundError(billId);
    if (!actor.canManage) {
      const membership = await this.memberships.getById(tenantId, bill.membershipIdRef);
      if (!membership || membership.farmerUserId !== actor.userId) throw new BillNotFoundError(billId);
    }
    return (await this.disputes.listForBill(tenantId, billId, limit)).map((d) => d.toJSON());
  }

  private async windowEnd(tx: TxContext, tenantId: string, now: Date): Promise<Date> {
    const hours = await this.cycles.disputeWindowHours(tx, tenantId);
    return new Date(now.getTime() + hours * 3_600_000);
  }

  private async flush(tx: TxContext, tenantId: string, billId: string, events: DomainEvent[]) {
    for (const e of events) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'milk_bill', aggregateId: billId, eventType: e.type, payload: { v: 1, ...e.payload } });
    }
  }
}
