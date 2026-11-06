// modules/warehousing/domain/nwr-receipt.entity.ts · the nwr_receipts aggregate — a RECORD of an electronic Negotiable Warehouse Receipt number.
// Lifecycle via nwr-receipt.state (issued → released | cancelled; nothing else is reachable). PC-56 OPS-2b (survey C-5, C-10; founder Q3-A, Q4-A,
// Q5-A): this platform does not issue an eNWR (`issue` is refused by name in the service; `NwrReceipt.issue` survives only for that kept body and
// the domain spec), a receipt is never released on its own (refused by name), and cancel is the named operator's audited act. valuation_minor is
// bigint minor units (Law 2), operator-typed at the time with no basis — it values nothing and the ops console never renders it; nothing is pledged.
import { NwrStatus, assertTransition } from './nwr-receipt.state';
import { NwrRepository, DomainEvent, WarehousingEventType } from './warehousing.events';
import { InvalidNwrError } from './warehousing.errors';
import { formatQuantityMilli } from './quantity';   // PC-56 OPS-2c B23: printed from the scaled integer, never a float

export interface NwrReceiptProps {
  id: string; tenantId: string; storageBookingId: string; repository: NwrRepository; enwrNo: string; holderUserId: string;
  quantityMilli: bigint; valuationMinor: bigint; status: NwrStatus; pledgedLoanId: string | null; issuedAt: Date; expiresAt: string | null; createdAt?: Date;
}
export class NwrReceipt {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: NwrReceiptProps) {}
  static issue(input: Omit<NwrReceiptProps, 'status' | 'pledgedLoanId'>): NwrReceipt {
    if (input.quantityMilli <= 0n) throw new InvalidNwrError('quantity must be greater than zero');
    if (input.valuationMinor <= 0n) throw new InvalidNwrError('valuation must be greater than zero');
    const n = new NwrReceipt({ ...input, status: 'issued', pledgedLoanId: null });
    n.events.push({ type: WarehousingEventType.NwrIssued, payload: { nwrId: n.props.id, enwrNo: n.props.enwrNo, holderUserId: n.props.holderUserId, valuationMinor: n.props.valuationMinor.toString() } });
    return n;
  }
  static rehydrate(props: NwrReceiptProps): NwrReceipt { return new NwrReceipt(props); }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get storageBookingId() { return this.props.storageBookingId; }
  get holderUserId() { return this.props.holderUserId; }
  get status() { return this.props.status; }
  toProps(): Readonly<NwrReceiptProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  private transition(to: NwrStatus, eventType: string): void { const from = this.props.status; assertTransition(from, to); this.props.status = to; this.events.push({ type: eventType, payload: { nwrId: this.props.id, from, to } }); }
  release(): void { this.transition('released', WarehousingEventType.NwrReleased); }
  cancel(): void { this.transition('cancelled', WarehousingEventType.NwrCancelled); }
  toJSON() { const v = this.props; return { id: v.id, storageBookingId: v.storageBookingId, repository: v.repository, enwrNo: v.enwrNo, holderUserId: v.holderUserId,
    quantity: formatQuantityMilli(v.quantityMilli), valuationMinor: v.valuationMinor.toString(), status: v.status, pledgedLoanId: v.pledgedLoanId, issuedAt: v.issuedAt, expiresAt: v.expiresAt, createdAt: v.createdAt }; }
}
