// modules/requirements/domain/requirement-response.entity.ts
// RequirementResponse aggregate — a seller's QUOTE against a buyer's requirement. Pure domain: the
// quoted price is bigint minor units (per-unit), status transitions ONLY via the state machine
// (Law 5). NO money moves here — an accepted quote is announced via the outbox
// (requirements.quote_accepted) and the order is created downstream (orders, Law 11). No version
// column → the service serializes mutations with SELECT … FOR UPDATE.
//
// PC-56 TENANT-11d: a response may belong to a POOLED quote (`groupId`, sent by the desk with the member's consent `consentId`);
// the buyer accepts it BY QUANTITY (`acceptedQuantity` ≤ quantity — a partial accept is a smaller number); the one order made
// for it is recorded once (`orderId`). The accepted event carries the response id, the accepted quantity and the
// REQUIREMENT's unit, so orders makes ONE order per response in the unit the buyer asked in (F-27d).
import { formatQtyMilli, isQty, parseQtyMilli } from './quantity';
import { ResponseStatus, assertTransition, isLive } from './requirement-response.state';
import { ResponseEventType, DomainEvent } from './requirements.events';
import { InvalidResponseError, ResponseNotLiveError, ResponseNotAcceptableError } from './requirements.errors';

export interface ResponseProps {
  id: string; requirementId: string; tenantId: string; sellerUserId: string; listingId: string | null;
  quotedPriceMinor: bigint; quantity: string; validUntil: Date | null; message: string | null; status: ResponseStatus; createdAt: Date;
  groupId?: string | null; consentId?: string | null; acceptedQuantity?: string | null; acceptedAt?: Date | null; acceptedBy?: string | null;
  decisionConsentId?: string | null; orderId?: string | null; submittedBy?: string | null;
}
const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;

export class RequirementResponse {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: ResponseProps) {}

  static submit(input: {
    id: string; requirementId: string; tenantId: string; sellerUserId: string; listingId?: string | null;
    quotedPriceMinor: bigint; quantity: string; validUntil?: Date | null; message?: string | null; now?: Date;
    groupId?: string | null; consentId?: string | null; submittedBy?: string | null;
  }): RequirementResponse {
    const now = input.now ?? new Date();
    if (input.quotedPriceMinor <= 0n) throw new InvalidResponseError('quoted price must be positive');
    if (!QTY_RE.test(input.quantity) || Number(input.quantity) <= 0) throw new InvalidResponseError('quantity must be a positive number (max 3 decimals)');
    if (input.validUntil && input.validUntil.getTime() <= now.getTime()) throw new InvalidResponseError('validUntil must be in the future');
    const r = new RequirementResponse({
      id: input.id, requirementId: input.requirementId, tenantId: input.tenantId, sellerUserId: input.sellerUserId,
      listingId: input.listingId ?? null, quotedPriceMinor: input.quotedPriceMinor, quantity: input.quantity,
      validUntil: input.validUntil ?? null, message: input.message ?? null, status: 'submitted', createdAt: now,
      groupId: input.groupId ?? null, consentId: input.consentId ?? null, acceptedQuantity: null, acceptedAt: null, acceptedBy: null,
      decisionConsentId: null, orderId: null, submittedBy: input.submittedBy ?? input.sellerUserId,
    });
    if (r.props.groupId && !r.props.consentId) throw new InvalidResponseError('a linked response is sent only with its member\'s consent');
    r.events.push({ type: ResponseEventType.Submitted, payload: { responseId: r.props.id, requirementId: r.props.requirementId, sellerUserId: r.props.sellerUserId } });
    return r;
  }
  static rehydrate(props: ResponseProps): RequirementResponse { return new RequirementResponse(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get requirementId() { return this.props.requirementId; }
  get sellerUserId() { return this.props.sellerUserId; }
  get listingId() { return this.props.listingId; }
  get validUntil() { return this.props.validUntil; }
  get quantity() { return this.props.quantity; }
  get groupId() { return this.props.groupId ?? null; }
  get acceptedQuantity() { return this.props.acceptedQuantity ?? null; }
  toProps(): Readonly<ResponseProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Buyer shortlists the quote (submitted → shortlisted). */
  shortlist(): void {
    if (!isLive(this.props.status)) throw new ResponseNotLiveError(this.props.status);
    this.to('shortlisted', ResponseEventType.Shortlisted, {});
  }
  /** The buyer accepts the quote — all of it, or `quantity` of it (A2: accept by quantity) → a deal for that quantity.
   *  Requires a listing (the order needs a listing + product) and a non-lapsed quote. The event carries what orders needs to
   *  make THIS response's one order: the accepted quantity, the quoted unit price and the REQUIREMENT's unit. */
  accept(input: { buyerUserId: string; acceptedBy: string; now: Date; quantity?: string | null; unitCode: string; decisionConsentId?: string | null }): bigint {
    if (!isLive(this.props.status)) throw new ResponseNotLiveError(this.props.status);
    if (!this.props.listingId) throw new ResponseNotAcceptableError();
    if (this.props.validUntil && input.now.getTime() >= this.props.validUntil.getTime()) throw new ResponseNotLiveError('expired');
    const max = parseQtyMilli(this.props.quantity);
    const take = input.quantity == null ? max : (isQty(input.quantity) ? parseQtyMilli(input.quantity) : -1n);
    if (take <= 0n || take > max) throw new InvalidResponseError(`accept between 0 and ${this.props.quantity}`);
    this.props.acceptedQuantity = formatQtyMilli(take);
    this.props.acceptedAt = input.now; this.props.acceptedBy = input.acceptedBy; this.props.decisionConsentId = input.decisionConsentId ?? null;
    this.to('accepted', ResponseEventType.Accepted, {
      buyerUserId: input.buyerUserId, sellerUserId: this.props.sellerUserId, listingId: this.props.listingId,
      quotedPriceMinor: this.props.quotedPriceMinor.toString(), quantity: this.props.acceptedQuantity,
      quotedQuantity: this.props.quantity, unitCode: input.unitCode, groupId: this.props.groupId ?? null, partial: take < max,
    });
    return take;
  }
  /** Buyer rejects, or the seller withdraws their quote. */
  reject(): void {
    if (!isLive(this.props.status)) throw new ResponseNotLiveError(this.props.status);
    this.to('rejected', ResponseEventType.Rejected, {});
  }
  /** Worker job: lapse a quote past its valid_until. */
  expire(): void {
    if (!isLive(this.props.status)) throw new ResponseNotLiveError(this.props.status);
    this.to('expired', ResponseEventType.Expired, {});
  }

  private to(status: ResponseStatus, evt: string, payload: Record<string, unknown>): void {
    assertTransition(this.props.status, status);
    this.props.status = status;
    this.events.push({ type: evt, payload: { responseId: this.props.id, requirementId: this.props.requirementId, ...payload } });
  }
}
