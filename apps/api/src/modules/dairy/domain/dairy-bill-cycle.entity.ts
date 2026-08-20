// modules/dairy/domain/dairy-bill-cycle.entity.ts · PC-56 TENANT-6c-1 · the cycle aggregate.
//
// One fortnight (or day/week/month) of one cooperative's milk: its window, the instant it shuts, the day it pays, and
// what happened when its bills were built. It moves NO money — a cycle closing produces DRAFT bills, and every act
// after that (preview, approve, pay) stays a human decision.
import { CycleStatus, assertTransition } from './dairy-cycle';
import { DairyEventType, DomainEvent, PaymentCycle } from './dairy.events';
import { CycleNotClosableError } from './dairy.errors';

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
  get closesAt() { return this.props.closesAt; }
  get status() { return this.props.status; }
  /** A closed cycle whose bills were never built, or whose last run left failures behind, still has work. */
  get needsBills(): boolean {
    return this.props.status === 'closed' && (this.props.billsGeneratedAt === null || (this.props.billsFailed ?? 0) > 0);
  }
  toProps(): Readonly<DairyBillCycleProps> { return Object.freeze({ ...this.props }); }
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
   * Record what a generation run did. Only on a CLOSED cycle — the constraint is also in the database
   * (`ck_dairy_bill_cycle_generate_after_close`), because "bills exist for a cycle that never shut" is the kind of
   * state a later reader would have to guess about.
   */
  recordGeneration(at: Date, counts: { generated: number; skipped: number; failed: number }): void {
    if (this.props.status !== 'closed') {
      throw new CycleNotClosableError(this.props.id, `cannot generate bills for a cycle in status '${this.props.status}'`, null);
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
      billsSkipped: v.billsSkipped, billsFailed: v.billsFailed, createdAt: v.createdAt,
    };
  }
}
