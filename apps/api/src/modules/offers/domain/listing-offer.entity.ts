// modules/offers/domain/listing-offer.entity.ts
// ListingOffer aggregate — a buyer↔seller price negotiation on a published listing. Pure domain:
// prices in bigint minor units (per-unit price offered), status transitions ONLY via the state
// machine (Law 5). NO money moves here (a non-binding negotiation): an accepted offer is announced
// via the outbox (offers.offer_accepted) and the order/payment is created downstream (orders, Law 11).
//
// Turn model: the negotiation alternates. `round` starts at 1 (the buyer's initial offer). An ODD
// round means the buyer acted last ⇒ it is the SELLER's turn; an EVEN round means the seller
// countered last ⇒ it is the BUYER's turn. Either party may reject/withdraw at any live moment.
// The price on the table is the buyer's offered_price when it is the seller's turn, and the seller's
// counter_price when it is the buyer's turn. There is no version column — the service serializes
// concurrent actions with SELECT … FOR UPDATE on the offer row.
import { OfferStatus, assertTransition, isNegotiable } from './listing-offer.state';
import { OfferEventType, DomainEvent, OfferParty } from './offers.events';
import { InvalidOfferError, OfferNotNegotiableError, NotYourTurnError, OfferExpiredError } from './offers.errors';
import { assertWithinMaxLife } from './offer-clock';

export interface ListingOfferProps {
  id: string; tenantId: string; listingId: string; buyerUserId: string;
  quantity: string;                       // numeric(14,3) — kept as string to preserve precision
  offeredPriceMinor: bigint;              // buyer's per-unit offer (minor units)
  counterPriceMinor: bigint | null;       // seller's per-unit counter (minor units)
  round: number; status: OfferStatus; expiresAt: Date;
  convertedOrderId: string | null; createdAt: Date;
  /** PC-56 HOTFIX-5 · B4: the LISTING's currency, projected on read (listing_offers has no currency column — 0015). Never written. */
  currencyCode?: string | null;
  /** PC-56 STORE-3b · B4 (founder D3, 0211): the decline reason's CODE (`offer_decline_reason`) and which side declined; null otherwise. */
  declineReasonCode?: string | null;
  declinedBy?: OfferParty | null;
  /** PC-56 STORE-3b · B8 (survey F-20): `created_at` AS THE DATABASE PRINTED IT (six fractional digits, UTC — shared/pagination/us-keyset.ts),
   *  projected on read for the keyset cursor; never a Date (a millisecond Date skipped rows written in one millisecond). Never written. */
  createdAtUs?: string | null;
}

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;

export class ListingOffer {
  private readonly events: DomainEvent[] = [];
  private acceptedPriceMinor: bigint | null = null;
  private constructor(private props: ListingOfferProps) {}

  static make(input: {
    id: string; tenantId: string; listingId: string; buyerUserId: string;
    quantity: string; offeredPriceMinor: bigint; expiresAt: Date; now?: Date;
  }): ListingOffer {
    const now = input.now ?? new Date();
    if (!QTY_RE.test(input.quantity) || Number(input.quantity) <= 0) throw new InvalidOfferError('quantity must be a positive number (max 3 decimals)');
    if (input.offeredPriceMinor <= 0n) throw new InvalidOfferError('offered price must be positive');
    if (input.expiresAt.getTime() <= now.getTime()) throw new InvalidOfferError('expiresAt must be in the future');
    const o = new ListingOffer({
      id: input.id, tenantId: input.tenantId, listingId: input.listingId, buyerUserId: input.buyerUserId,
      quantity: input.quantity, offeredPriceMinor: input.offeredPriceMinor, counterPriceMinor: null,
      round: 1, status: 'open', expiresAt: input.expiresAt, convertedOrderId: null, createdAt: now,
    });
    o.events.push({ type: OfferEventType.Made, payload: { offerId: o.props.id, listingId: o.props.listingId, buyerUserId: o.props.buyerUserId, quantity: o.props.quantity, offeredPriceMinor: o.props.offeredPriceMinor.toString() } });
    return o;
  }
  static rehydrate(props: ListingOfferProps): ListingOffer { return new ListingOffer(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get round() { return this.props.round; }
  get listingId() { return this.props.listingId; }
  get buyerUserId() { return this.props.buyerUserId; }
  get expiresAt() { return this.props.expiresAt; }
  /** The FIRST offer's instant — the negotiation's ceiling (`offers.max_life_hours`) runs from here (founder D1). */
  get firstOfferedAt(): Date { return this.props.createdAt; }
  get quantity() { return this.props.quantity; }
  /** The per-unit price on the table NOW, by round parity (odd: the buyer's offer awaits the seller; even: the seller's counter awaits the
   *  buyer) — after an accept, the price that was agreed (the round does not move on accept). */
  get currentPriceMinor(): bigint {
    return this.props.round % 2 === 1 ? this.props.offeredPriceMinor : (this.props.counterPriceMinor ?? this.props.offeredPriceMinor);
  }
  get agreedPriceMinor(): bigint | null { return this.acceptedPriceMinor; }
  toProps(): Readonly<ListingOfferProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Whose turn it is to respond, given round parity (only meaningful while negotiable). */
  isSellersTurn(): boolean { return isNegotiable(this.props.status) && this.props.round % 2 === 1; }
  isBuyersTurn(): boolean { return isNegotiable(this.props.status) && this.props.round % 2 === 0; }
  /** The per-unit price on the table for the party whose turn it is. */
  priceOnTableFor(party: OfferParty): bigint {
    return party === 'seller' ? this.props.offeredPriceMinor : (this.props.counterPriceMinor ?? this.props.offeredPriceMinor);
  }

  /** The responding party puts a new per-unit price on the table. Seller sets counter_price; a buyer
   *  re-counter replaces offered_price and clears the stale seller counter. round++ flips the turn.
   *  PC-56 STORE-3b · B1 (founder D1): every counter RESETS THE CLOCK — the other side gets a full round (`respondBy` = now + the
   *  round TTL, computed by the service from the setting) — and a round that would end after the negotiation's ceiling is refused
   *  OFFER_MAX_LIFE {endsAt} (the negotiation then lapses by its clock). */
  counter(party: OfferParty, newPriceMinor: bigint, now: Date, clock: { respondBy: Date; maxLifeEndsAt: Date }): void {
    this.assertLive(now); this.assertTurn(party);
    if (newPriceMinor <= 0n) throw new InvalidOfferError('counter price must be positive');
    assertWithinMaxLife(clock.respondBy, clock.maxLifeEndsAt);
    this.props.expiresAt = clock.respondBy;
    if (party === 'seller') this.props.counterPriceMinor = newPriceMinor;
    else { this.props.offeredPriceMinor = newPriceMinor; this.props.counterPriceMinor = null; }
    this.props.round += 1;
    this.to('countered', OfferEventType.Countered, { by: party, round: this.props.round, priceMinor: newPriceMinor.toString(), respondBy: clock.respondBy.toISOString() });
  }

  /** PC-56 STORE-3b · B2: may `party` accept right now? (live, not past its round's deadline, its turn) — the same two checks `accept` makes,
   *  run FIRST so the service reserves stock only for an accept that will happen. Throws the entity's named refusals. */
  assertCanAccept(party: OfferParty, now: Date): void { this.assertLive(now); this.assertTurn(party); }

  /** The party whose turn it is accepts the price on the table → a deal (downstream order creation).
   *  PC-56 STORE-3b · B2 (founder D2): `stockReserved` travels in `offers.offer_accepted` — the accept transaction reserved the quantity, so
   *  the order the relay creates carries `stock_reserved_at` (2c's restock path then releases it once on cancel / decline / timeout). */
  accept(party: OfferParty, now: Date, opts: { stockReserved?: boolean } = {}): void {
    this.assertLive(now); this.assertTurn(party);
    const agreed = this.priceOnTableFor(party);
    if (agreed <= 0n) throw new InvalidOfferError('no price to accept');
    this.acceptedPriceMinor = agreed;
    this.to('accepted', OfferEventType.Accepted, { by: party, agreedPriceMinor: agreed.toString(), quantity: this.props.quantity, buyerUserId: this.props.buyerUserId,
      stockReserved: opts.stockReserved === true });
  }

  /** Either party may decline / withdraw while the negotiation is live (turn not enforced).
   *  PC-56 STORE-3b · B4 (founder D3): with an optional reason CODE (validated against the vocabulary by the service, in the transaction). */
  reject(party: OfferParty, now: Date, reasonCode: string | null = null): void {
    if (!isNegotiable(this.props.status)) throw new OfferNotNegotiableError(this.props.status);
    void now;
    this.props.declineReasonCode = reasonCode;
    this.props.declinedBy = party;
    this.to('rejected', OfferEventType.Rejected, { by: party, ...(reasonCode ? { reasonCode } : {}) });
  }

  /** Worker job: lapse an offer past its expiry. Idempotent at the service layer (skips non-live). */
  expire(now: Date): void {
    if (!isNegotiable(this.props.status)) throw new OfferNotNegotiableError(this.props.status);
    if (now.getTime() < this.props.expiresAt.getTime()) throw new InvalidOfferError('offer has not expired yet');
    this.to('expired', OfferEventType.Expired, {});
  }

  /** Downstream (orders) links the created order back to an accepted offer. */
  convert(orderId: string): void {
    this.props.convertedOrderId = orderId;
    this.to('converted', OfferEventType.Converted, { orderId });
  }

  private assertLive(now: Date): void {
    if (!isNegotiable(this.props.status)) throw new OfferNotNegotiableError(this.props.status);
    if (now.getTime() >= this.props.expiresAt.getTime()) throw new OfferExpiredError();
  }
  private assertTurn(party: OfferParty): void {
    const ok = party === 'seller' ? this.isSellersTurn() : this.isBuyersTurn();
    if (!ok) throw new NotYourTurnError(party);
  }
  private to(status: OfferStatus, evt: string, payload: Record<string, unknown>): void {
    assertTransition(this.props.status, status);
    this.props.status = status;
    this.events.push({ type: evt, payload: { offerId: this.props.id, listingId: this.props.listingId, ...payload } });
  }
}
