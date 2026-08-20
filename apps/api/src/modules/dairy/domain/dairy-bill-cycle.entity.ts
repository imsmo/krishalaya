// modules/dairy/domain/dairy-bill-cycle.entity.ts · PC-56 TENANT-6c-1 · the cycle aggregate.
//
// One fortnight (or day/week/month) of one cooperative's milk: its window, the instant it shuts, the day it pays, and
// what happened when its bills were built. It moves NO money — a cycle closing produces DRAFT bills, and every act
// after that (preview, approve, pay) stays a human decision.
import { CycleStatus, assertTransition, cycleApprovalRefusal } from './dairy-cycle';
import { DairyEventType, DomainEvent, PaymentCycle } from './dairy.events';
import { CycleApprovalRefusedError, CycleNotClosableError } from './dairy.errors';

export interface DairyBillCycleProps {
  id: string;
  tenantId: string;
  paymentCycle: PaymentCycle;
  periodStart: string;
  periodEnd: string;
  /** EXCLUSIVE: the first instant of the day after `periodEnd`, in the tenant's own timezone. Resolved in SQL. */
  closesAt: Date;
  payday: string;
  status: CycleStatus;
  closedAt: Date | null;
  billsGeneratedAt: Date | null;
  billsGenerated: number | null;
  billsSkipped: number | null;
  billsFailed: number | null;
  /** [PC-56 TENANT-6c-2] W169's header act: who showed this cycle's bills to their members, and when. */
  previewedAt: Date | null;
  previewedBy: string | null;
  /** How many bills the bounded, resumable preview pass has moved. Makes "is it done?" answerable. */
  billsPreviewed: number | null;
  /** [PC-56 TENANT-6c-3] The second signature, and how far its own pass got. */
  approvedAt: Date | null;
  approvedBy: string | null;
  billsApproved: number | null;
  createdAt?: Date;
}

export class DairyBillCycle {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: DairyBillCycleProps) {}

  static rehydrate(props: DairyBillCycleProps): DairyBillCycle { return new DairyBillCycle(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get paymentCycle() { return this.props.paymentCycle; }
  get periodStart() { return this.props.periodStart; }
  get periodEnd() { return this.props.periodEnd; }
  get payday() { return this.props.payday; }
  get previewedAt() { return this.props.previewedAt; }
  get previewedBy() { return this.props.previewedBy; }
  get approvedAt() { return this.props.approvedAt; }
  get approvedBy() { return this.props.approvedBy; }
  get closesAt() { return this.props.closesAt; }
  get status() { return this.props.status; }
  /**
   * A cycle that HAS SHUT and whose bills were never built, or whose last run left failures behind, still has work.
   *
   * [PC-56 TENANT-6c-2] Keyed on `closedAt`, NOT on `status === 'closed'`. The first version said the latter, which was
   * indistinguishable while `closed` was the only state past `open` — and became a bug the moment `previewed` existed:
   * a bill VOIDED after its cycle was previewed released its pours and would then never have been rebuilt, because
   * neither this getter nor the claim query would look at that cycle again. Found by a live test, and it is the SECOND
   * instance of the same shape in this wave (0158's header records the first, a CHECK constraint phrased the same way).
   * The database always had it right: `ck_dairy_bill_cycle_generate_after_close` tests `closed_at IS NOT NULL`.
   */
  get needsBills(): boolean {
    return this.props.closedAt !== null && (this.props.billsGeneratedAt === null || (this.props.billsFailed ?? 0) > 0);
  }
  toProps(): Readonly<DairyBillCycleProps> { return Object.freeze({ ...this.props }); }

  /**
   * [PC-56 TENANT-6c-2] W169's header button: *"Preview cycle 01–15 Jul (Wed close)"*.
   *
   * The act is on the CYCLE, not on 312 bills, because that is what the canon's button is — and because the alternative
   * (312 separate decisions) is how a cooperative ends up having previewed 280 of them and not knowing which 32 are
   * missing. The per-bill work it drives is bounded and resumable; `recordPreviewPass` is how far it got.
   *
   * Only a CLOSED cycle can be previewed. Showing a member a bill for a fortnight that is still collecting milk is
   * showing them a number that will change — which is the opposite of what a preview is for.
   */
  preview(at: Date, byUserId: string): void {
    assertTransition(this.props.status, 'previewed');
    this.props.status = 'previewed';
    this.props.previewedAt = at;
    this.props.previewedBy = byUserId;
    this.events.push({
      type: DairyEventType.CyclePreviewed,
      payload: {
        cycleId: this.props.id, paymentCycle: this.props.paymentCycle,
        periodStart: this.props.periodStart, periodEnd: this.props.periodEnd, payday: this.props.payday,
      },
    });
  }

  /**
   * [PC-56 TENANT-6c-3] THE SECOND SIGNATURE. W169: *"approved Thu evening (maker-checker)"*, and *"Preview/approve
   * needs dairy-desk + `settlement.close` + checker — this is 312 families' milk money."*
   *
   * The checker must not be the previewer, unconditionally and with no threshold — 0144's ruling for a settlement cycle
   * close, borrowed here because a milk cycle is a fortnight of 312 families' income. The rule is ALSO a database
   * constraint (`ck_dairy_bill_cycle_maker_ne_checker`): this refusal is what an operator reads, and the constraint is
   * what makes the rule true of the row whatever wrote it.
   *
   * Deliberately NOT gated on the dispute windows being shut. W169's timeline approves on Thursday evening while the
   * windows run to Friday morning, and that ordering is right: approval is the cooperative agreeing its own figures,
   * and it is the PAYMENT that waits for the member (TENANT-6c-2 put that guard on `markPaid`).
   */
  approve(at: Date, byUserId: string): void {
    const refusal = cycleApprovalRefusal({ status: this.props.status, previewedBy: this.props.previewedBy }, byUserId);
    if (refusal) throw new CycleApprovalRefusedError(this.props.id, refusal, this.props.previewedBy);
    assertTransition(this.props.status, 'approved');
    this.props.status = 'approved';
    this.props.approvedAt = at;
    this.props.approvedBy = byUserId;
    this.events.push({
      type: DairyEventType.CycleApproved,
      payload: {
        cycleId: this.props.id, paymentCycle: this.props.paymentCycle,
        periodStart: this.props.periodStart, periodEnd: this.props.periodEnd, payday: this.props.payday,
        previewedBy: this.props.previewedBy, approvedBy: byUserId,
      },
    });
  }

  /** How far the (re-callable) approval pass got. */
  recordApprovalPass(count: number): void { this.props.billsApproved = count; }

  /** How many of this cycle's bills the (re-callable) preview pass has moved so far. Emits nothing: the member-facing
   *  event is per BILL, because it is a different member each time. */
  recordPreviewPass(count: number): void {
    this.props.billsPreviewed = count;
  }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /**
   * Shut the cycle.
   *
   * Refuses to close EARLY, not merely because the claim query filters on `closes_at <= now()` but because that filter
   * is one predicate away from a cycle being billed mid-fortnight — and the consequence is a member paid for eight
   * days of milk with the other six silently rolling into the next bill. The invariant belongs where it cannot be
   * queried around. (Law 12: a write that moves a family's milk money may fail loudly, and may not guess.)
   */
  close(at: Date): void {
    if (at.getTime() < this.props.closesAt.getTime()) {
      throw new CycleNotClosableError(this.props.id, 'the window has not shut yet', this.props.closesAt.toISOString());
    }
    assertTransition(this.props.status, 'closed');
    this.props.status = 'closed';
    this.props.closedAt = at;
    this.events.push({
      type: DairyEventType.CycleClosed,
      payload: {
        cycleId: this.props.id, paymentCycle: this.props.paymentCycle,
        periodStart: this.props.periodStart, periodEnd: this.props.periodEnd, payday: this.props.payday,
      },
    });
  }

  /**
   * Record what a generation run did. Only on a cycle that has SHUT — the constraint is also in the database
   * (`ck_dairy_bill_cycle_generate_after_close`), because "bills exist for a cycle that never shut" is the kind of
   * state a later reader would have to guess about.
   */
  recordGeneration(at: Date, counts: { generated: number; skipped: number; failed: number }): void {
    // `closedAt`, not `status === 'closed'` — see `needsBills` above. A previewed cycle whose member had a bill voided
    // MUST be able to build a replacement, and that is the whole point of a void.
    if (this.props.closedAt === null) {
      throw new CycleNotClosableError(this.props.id, `cannot generate bills for a cycle that has not shut (status '${this.props.status}')`, null);
    }
    this.props.billsGeneratedAt = at;
    this.props.billsGenerated = counts.generated;
    this.props.billsSkipped = counts.skipped;
    this.props.billsFailed = counts.failed;
    this.events.push({
      type: DairyEventType.CycleBillsGenerated,
      payload: { cycleId: this.props.id, periodStart: this.props.periodStart, periodEnd: this.props.periodEnd, ...counts },
    });
  }

  toJSON() {
    const v = this.props;
    return {
      id: v.id, paymentCycle: v.paymentCycle, periodStart: v.periodStart, periodEnd: v.periodEnd,
      closesAt: v.closesAt, payday: v.payday, status: v.status, closedAt: v.closedAt,
      billsGeneratedAt: v.billsGeneratedAt, billsGenerated: v.billsGenerated,
      billsSkipped: v.billsSkipped, billsFailed: v.billsFailed,
      previewedAt: v.previewedAt, previewedBy: v.previewedBy, billsPreviewed: v.billsPreviewed,
      approvedAt: v.approvedAt, approvedBy: v.approvedBy, billsApproved: v.billsApproved,
      createdAt: v.createdAt,
    };
  }
}
