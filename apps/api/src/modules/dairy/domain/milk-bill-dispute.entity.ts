// modules/dairy/domain/milk-bill-dispute.entity.ts · PC-56 TENANT-6c-2 · the member's objection, as a record.
//
// W169 counts *"Last cycle disputes 2 / 309 · both resolved before payday"* and promises the member a *"24h dispute
// window"*. Before this file a member could not dispute a bill at all: `MilkBill.dispute()` existed on the aggregate
// and was called by no service and no route, `dispute_window_ends` had a reader in apps/mobile and no writer anywhere,
// and nothing recorded a reason, a raiser, a time or an outcome.
//
// The rows are append-mostly by grant (0158): the testimony cannot be edited, only the resolution can be written, once.
import { DomainEvent, DairyEventType } from './dairy.events';
import { DisputeAlreadyOpenError } from './dairy.errors';
import { DomainError } from '../../../shared/errors/app-error';

export const DISPUTE_STATUSES = ['open', 'upheld', 'rejected'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** The same floor every note in this programme uses. A one-word reason is not a reason. */
export const REASON_FLOOR = 10;

export class DisputeReasonTooShortError extends DomainError {
  constructor(field: 'reason' | 'resolution_note') {
    super('DISPUTE_TEXT_TOO_SHORT', `A milk bill dispute's ${field} must be at least ${REASON_FLOOR} characters`, 422, { field, floor: REASON_FLOOR });
  }
}
export class DisputeAlreadyResolvedError extends DomainError {
  constructor(id: string, status: string) {
    super('DISPUTE_ALREADY_RESOLVED', `This query was already ${status}`, 409, { id, status });
  }
}

export interface MilkBillDisputeProps {
  id: string;
  tenantId: string;
  billId: string;
  membershipId: string;
  /** The MEMBER's user id. Staff objecting on a member's behalf is a different act and is not built. */
  raisedByUserId: string;
  raisedAt: Date;
  reason: string;
  /** The window this dispute was raised INSIDE, copied at insert so it stays arguable years later. */
  windowEndedAt: Date;
  status: DisputeStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  voidedBill: boolean;
  createdAt?: Date;
}

export class MilkBillDispute {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: MilkBillDisputeProps) {}

  /**
   * The member objects, inside their own window.
   *
   * `windowEndedAt` is copied from the bill rather than referenced, because a bill's window is rewritten every time it
   * is re-previewed — and "was this raised in time?" must remain answerable after that has happened three times.
   */
  static open(input: {
    id: string; tenantId: string; billId: string; membershipId: string;
    raisedByUserId: string; reason: string; windowEndedAt: Date; at: Date;
  }): MilkBillDispute {
    const reason = (input.reason ?? '').trim();
    if (reason.length < REASON_FLOOR) throw new DisputeReasonTooShortError('reason');
    const d = new MilkBillDispute({
      id: input.id, tenantId: input.tenantId, billId: input.billId, membershipId: input.membershipId,
      raisedByUserId: input.raisedByUserId, raisedAt: input.at, reason,
      windowEndedAt: input.windowEndedAt, status: 'open',
      resolvedAt: null, resolvedBy: null, resolutionNote: null, voidedBill: false,
    });
    // No member-facing notification on OPENING: the member is the one who just acted, and telling somebody what they
    // themselves did a second ago is noise. The outcome is what they are owed a message about.
    d.events.push({
      type: DairyEventType.BillDisputed,
      payload: { billId: input.billId, disputeId: d.props.id, membershipId: input.membershipId, reason },
    });
    return d;
  }

  static rehydrate(props: MilkBillDisputeProps): MilkBillDispute { return new MilkBillDispute(props); }

  get id() { return this.props.id; }
  get billId() { return this.props.billId; }
  get status() { return this.props.status; }
  get membershipId() { return this.props.membershipId; }
  get raisedByUserId() { return this.props.raisedByUserId; }
  get voidedBill() { return this.props.voidedBill; }
  toProps(): Readonly<MilkBillDisputeProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /**
   * The cooperative answers.
   *
   * `upheld` means the bill was WRONG, and the only correction this platform can make is to void and rebuild it — so
   * `voidedBill` records whether that happened, and the database refuses the combination `rejected + voidedBill`
   * (rejecting a query and deleting the bill anyway is two decisions recorded as one).
   *
   * The note is REQUIRED at the same floor as the objection. A member told "rejected" with no explanation has been
   * processed, not answered — and W169's tile claims both of last cycle's disputes were "resolved", which is a word
   * that has to mean something.
   */
  resolve(input: { outcome: 'upheld' | 'rejected'; byUserId: string; at: Date; note: string; voidedBill: boolean }): void {
    if (this.props.status !== 'open') throw new DisputeAlreadyResolvedError(this.props.id, this.props.status);
    const note = (input.note ?? '').trim();
    if (note.length < REASON_FLOOR) throw new DisputeReasonTooShortError('resolution_note');
    if (input.voidedBill && input.outcome !== 'upheld') {
      throw new DomainError('DISPUTE_VOID_REQUIRES_UPHELD', 'Only an upheld query can void the bill', 422, { id: this.props.id });
    }
    this.props.status = input.outcome;
    this.props.resolvedAt = input.at;
    this.props.resolvedBy = input.byUserId;
    this.props.resolutionNote = note;
    this.props.voidedBill = input.voidedBill;
    // The member-facing event. `userId` is the RAISER's, put into the payload rather than assumed, because ADMIN-6b's
    // finding was a notification-map row pointing at a payload with no recipient — which looks like a fix and sends
    // nothing.
    this.events.push({
      type: DairyEventType.BillDisputeResolved,
      payload: {
        billId: this.props.billId, disputeId: this.props.id, membershipId: this.props.membershipId,
        userId: this.props.raisedByUserId, outcome: input.outcome, note, voidedBill: input.voidedBill,
      },
    });
  }

  static assertNoOpen(existing: MilkBillDispute | null, billId: string): void {
    if (existing && existing.status === 'open') throw new DisputeAlreadyOpenError(billId);
  }

  toJSON() {
    const v = this.props;
    return {
      id: v.id, billId: v.billId, membershipId: v.membershipId, raisedByUserId: v.raisedByUserId,
      raisedAt: v.raisedAt, reason: v.reason, windowEndedAt: v.windowEndedAt, status: v.status,
      resolvedAt: v.resolvedAt, resolvedBy: v.resolvedBy, resolutionNote: v.resolutionNote,
      voidedBill: v.voidedBill, createdAt: v.createdAt,
    };
  }
}
