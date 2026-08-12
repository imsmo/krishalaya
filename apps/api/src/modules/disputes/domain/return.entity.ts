// modules/disputes/domain/return.entity.ts
// Return/RMA aggregate — a buyer asks to send a delivered order back; the seller/moderator approves,
// goods travel back, and a refund is issued once received. Pure domain: status transitions ONLY via the
// state machine (Law 5); NO money moves here — the refund is applied downstream (orders/payments) on the
// return_refunded event. No version column (add_std_columns) → the service serializes mutations with
// SELECT … FOR UPDATE.
import { ReturnStatus, assertTransition } from './return.state';
import { ReturnEventType, DomainEvent } from './disputes.events';
import { InvalidReturnError } from './disputes.errors';

/** Same floor as a refund proposal note (0139) and a moderation reason (0112): "ok" is not an inspection. */
export const MIN_INSPECTION_CHARS = 20;

export interface ReturnProps {
  id: string; tenantId: string; orderId: string; disputeId: string | null;
  status: ReturnStatus; reasonId: string | null; refundTxnId: string | null; createdAt: Date;
  /** W142's "Refund value" column, which had no column behind it before 0139. NULL = not recorded. */
  refundAmountMinor: bigint | null;
  /** W142's "inspect within 24h → refund", which had nowhere to write before 0139. */
  inspectedAt: Date | null; inspectedBy: string | null; inspectionNote: string | null;
}

export class Return {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: ReturnProps) {}

  static request(input: { id: string; tenantId: string; orderId: string; disputeId?: string | null; reasonId?: string | null; now?: Date; refundAmountMinor?: bigint | null }): Return {
    if (input.refundAmountMinor != null && input.refundAmountMinor <= 0n) throw new InvalidReturnError('refund amount must be positive');
    const r = new Return({
      id: input.id, tenantId: input.tenantId, orderId: input.orderId, disputeId: input.disputeId ?? null,
      status: 'requested', reasonId: input.reasonId ?? null, refundTxnId: null, createdAt: input.now ?? new Date(),
      refundAmountMinor: input.refundAmountMinor ?? null, inspectedAt: null, inspectedBy: null, inspectionNote: null,
    });
    r.events.push({ type: ReturnEventType.Requested, payload: { returnId: r.props.id, orderId: r.props.orderId } });
    return r;
  }
  static rehydrate(props: ReturnProps): Return { return new Return(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get orderId() { return this.props.orderId; }
  get refundAmountMinor() { return this.props.refundAmountMinor; }
  get inspectedAt() { return this.props.inspectedAt; }
  toProps(): Readonly<ReturnProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  approve(): void { this.to('approved', ReturnEventType.Approved, {}); }
  reject(): void { this.to('rejected', ReturnEventType.Rejected, {}); }
  ship(): void { this.to('in_transit', ReturnEventType.InTransit, {}); }   // buyer sends the goods back
  receive(): void { this.to('received', ReturnEventType.Received, {}); }   // seller/moderator confirms arrival

  /** W142's "Inspect" button, which until 0139 had nothing to write to. Recorded on a RECEIVED return only: an
   *  inspection of goods that have not arrived is a note about an expectation. The note is required and floored at
   *  MIN_INSPECTION_CHARS because the buyer whose refund it decides reads it. */
  inspect(byUser: string, note: string, now: Date = new Date()): void {
    if (this.props.status !== 'received') throw new InvalidReturnError('only a received return can be inspected');
    const body = (note ?? '').trim();
    if (body.length < MIN_INSPECTION_CHARS) throw new InvalidReturnError(`inspection note must be at least ${MIN_INSPECTION_CHARS} characters`);
    this.props.inspectedAt = now;
    this.props.inspectedBy = byUser;
    this.props.inspectionNote = body;
    // No status hop: 'received' → 'refunded' is the only transition the machine has, and inventing an 'inspected'
    // state would add a status nothing else reads. The inspection is EVIDENCE on the received return, and the
    // refund below refuses without it — which is the control W142 describes.
    this.events.push({ type: ReturnEventType.Inspected, payload: { returnId: this.props.id, orderId: this.props.orderId, inspectedBy: byUser } });
  }

  /** Goods received → issue the refund. The ledger reversal txn id (if any) is stamped downstream;
   *  callers may pass it so the event carries it, but the entity does NOT move money.
   *
   *  **AND IT REFUSES WITHOUT AN INSPECTION AND WITHOUT AN AMOUNT.** W142: "Refund fires only on received — money
   *  follows goods" and "inspect within 24h → refund". Before 0139 a refund could be issued on a parcel nobody had
   *  opened, for a figure nobody had recorded — and since `disputes.return_refunded` had no subscriber, the status
   *  said refunded while no money moved at all. */
  refund(refundTxnId?: string | null): void {
    if (this.props.inspectedAt == null) throw new InvalidReturnError('the returned goods must be inspected before a refund');
    if (this.props.refundAmountMinor == null) throw new InvalidReturnError('this return has no recorded refund amount');
    this.to('refunded', ReturnEventType.Refunded, {
      refundTxnId: refundTxnId ?? null,
      refundAmountMinor: this.props.refundAmountMinor.toString(),
    });
    if (refundTxnId) this.props.refundTxnId = refundTxnId;
  }

  /** Stamped by the payments module's reversal, through the repository. */
  stampRefundTxn(txnId: string): void { this.props.refundTxnId = txnId; }

  private to(status: ReturnStatus, evt: string, payload: Record<string, unknown>): void {
    assertTransition(this.props.status, status);
    this.props.status = status;
    this.events.push({ type: evt, payload: { returnId: this.props.id, orderId: this.props.orderId, ...payload } });
  }
}
