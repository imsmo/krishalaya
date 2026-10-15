// modules/offers/services/listing-offer.service.ts
// Offer (price negotiation) use-cases. Every write: one ACID tx (UoW), status via the machine
// (Law 5), outbox events in the SAME tx (Law 4). NO money moves here — an accepted offer is a deal
// announced via the outbox (offers.offer_accepted); the order + payment are created downstream
// (orders, Law 11). Seller authority is resolved from the listing via ListingService (Law 11 — never
// the listings repository). The negotiation row has no version column, so mutations lock it FOR UPDATE.
//
// PC-56 STORE-3b (founder D1–D3, 2026-10-15; survey F-5 / F-13 / F-20 / B5 / B14–B18):
//   • THE CLOCK (D1): the first offer and every counter give the other side `offers.round_ttl_hours` (0211) to answer; the negotiation ends
//     `offers.max_life_hours` after the first offer (domain/offer-clock.ts; the entity refuses a counter past it, OFFER_MAX_LIFE). A buyer's own
//     expiresAt is bounded (OFFER_EXPIRY_TOO_LATE). The 72 h literal is gone.
//   • ACCEPT RESERVES (D2, Law 9): inside the accept transaction, after the entity's turn / clock checks, the listing must still be published
//     (OFFER_LISTING_UNAVAILABLE), its seller not suspended (OFFER_SELLER_UNAVAILABLE — the predicate the five read models use), and the
//     quantity is RESERVED through 2c's `ListingService.reserveInTx` (locks the listing row, re-reads it, decrements — or OFFER_STOCK_SHORT
//     {available}, the LOCKED remainder). `offers.offer_accepted` says `stockReserved: true`; the order the relay creates carries
//     `stock_reserved_at`, so 2c's restock releases it once on cancel / decline / the 24 h timeout.
//   • THE THREAD (D3): every act writes a `listing_offer_rounds` row (0211) in its own transaction; a decline may carry a reason code from the
//     `offer_decline_reason` vocabulary (validated here, in the transaction — OFFER_DECLINE_REASON_UNKNOWN).
//   • THE READ (B6): listing title + unit (ListingService), the organisation (never a person), the server's `offerValueMinor`, `yourTurn` +
//     `allowedActs` for the CALLER, the thread, the clock (`respondBy`, `roundTtlHours`, `maxLifeEndsAt`), the conversion state and — for the
//     buyer — the converted order's status. Counts (B7) bounded; the keyset cursor is microsecond-exact (B8).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { memberSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { encodeKeyset } from '../../../shared/pagination/us-keyset';
import { ListingService } from '../../listings/services/listing.service';
import { InsufficientStockError, ListingNotEditableError } from '../../listings/domain/listing.errors';
import { compareQty, milliToDecimal, toMilli } from '../../orders/domain/cart-rules';
import { ListingOffer, ListingOfferProps } from '../domain/listing-offer.entity';
import { DomainEvent, OfferParty } from '../domain/offers.events';
import { isNegotiable } from '../domain/listing-offer.state';
import { OfferClock, makeExpiry, counterClock, maxLifeEndsAt } from '../domain/offer-clock';
import { allowedActsFor, conversionOf, offerValueMinor, roundsOf, turnOf, OfferRoundView, OFFER_COUNT_CAP, OfferCounts } from '../domain/offer-read';
import {
  OfferNotFoundError, OfferForbiddenError, InvalidOfferError, SellerCannotOfferError, OfferStockShortError, OfferListingUnavailableError,
  OfferSellerUnavailableError, OfferDeclineReasonUnknownError,
} from '../domain/offers.errors';
import { ListingOfferRepository, OfferListQuery } from '../repositories/listing-offer.repository';
import { CreateOfferDto } from '../dto/create-listing-offer.dto';

export interface OfferActor { userId: string; canModerate: boolean; }
type Props = Readonly<ListingOfferProps>;
interface ReadContext { viewer: OfferParty; clock: OfferClock; rounds: Map<string, OfferRoundView[]>; now: Date; buyerScope: string | null }

@Injectable()
export class ListingOfferService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly listings: ListingService,
    private readonly repo: ListingOfferRepository,
  ) {}

  private async sellerOf(tenantId: string, listingId: string): Promise<string> {
    const l: any = await this.listings.getById(tenantId, listingId);
    if (!l) throw new InvalidOfferError('listing not found');
    return l.sellerUserId;
  }

  /** Resolve which side of the negotiation the actor is. Moderators act on the seller's behalf. */
  private async partyOf(tenantId: string, offer: ListingOffer, actor: OfferActor): Promise<OfferParty> {
    if (actor.userId === offer.buyerUserId) return 'buyer';
    const seller = await this.sellerOf(tenantId, offer.listingId);
    if (seller === actor.userId || actor.canModerate) return 'seller';
    throw new OfferForbiddenError();
  }

  /** A buyer makes an offer on someone else's published listing. */
  async make(tenantId: string, buyerUserId: string, idemKey: string, dto: CreateOfferDto) {
    return this.idem.remember(idemKey, buyerUserId, 'offers.make', () =>
      timed(this.metrics, 'offers.make', { tenant: tenantId }, async () => {
        const l: any = await this.listings.getById(tenantId, dto.listingId);
        if (!l || l.status !== 'published') throw new InvalidOfferError('listing not found or not published');
        // **THE SIXTH SITE (PC-56 TENANT-1b-2).** `getById` reads the listing directly rather than through the public
        // feed, so the suspension filter on the five read models does not reach it — and an offer is the act the feed
        // exists to lead to. Without this a buyer holding a stale link could still negotiate with a suspended seller, and
        // the platform would be brokering a deal it has decided not to show.
        if (l.sellerUserId === buyerUserId) throw new SellerCannotOfferError();
        // PC-56 STORE-3b · E8 (survey F-23): decimal quantities compared as decimals (thousandths, bigint) — never `Number(...)`.
        if (compareQty(dto.quantity, l.minOrderQty ?? 0) < 0) throw new InvalidOfferError('quantity is below the listing minimum order');
        if (compareQty(dto.quantity, l.quantityAvailable) > 0) throw new InvalidOfferError('quantity exceeds the available quantity');
        return this.uow.run(tenantId, async (tx) => {
          // **THE SEVENTH ENFORCEMENT SITE (PC-56 TENANT-1b-2).** `getById` above reads the listing directly rather than
          // through the public feed, so the filter on the five read models does not reach it — and an offer is the act
          // the feed exists to lead to. Without this, a buyer holding a stale link could still negotiate with a seller
          // the platform has decided not to show.
          //
          // Checked INSIDE the existing transaction rather than by injecting a read replica: one connection, one
          // consistent view, and no new dependency on a service whose module did not have one.
          await this.assertSellerNotSuspended(tx, tenantId, l.sellerUserId);
          // PC-56 STORE-3b · B1 (founder D1): one round of the platform clock, or the buyer's own instant within it (OFFER_EXPIRY_TOO_LATE)
          const now = new Date();
          const clock = await this.repo.clock(tenantId, tx);
          const expiresAt = makeExpiry(now, clock, dto.expiresAt ? new Date(dto.expiresAt) : null);
          const offer = ListingOffer.make({
            id: uuidv7(), tenantId, listingId: dto.listingId, buyerUserId,
            quantity: dto.quantity, offeredPriceMinor: BigInt(dto.offeredPriceMinor), expiresAt, now,
          });
          await this.repo.insert(tx, offer);
          const p = offer.toProps();
          await this.repo.insertRound(tx, { tenantId, offerId: p.id, round: 1, party: 'buyer', act: 'offer', priceMinor: p.offeredPriceMinor });   // D3
          await this.flush(tx, tenantId, p.id, offer.pullEvents());
          const rounds = await this.repo.roundsFor(tenantId, [p.id], tx);
          return { props: { ...p, currencyCode: l.currencyCode ?? null } as Props, clock, rounds, now };   // HOTFIX-5 · B4: the listing's currency
        }, { userId: buyerUserId }).then((r) => this.enrichOne(tenantId, r.props, { viewer: 'buyer', clock: r.clock, rounds: r.rounds, now: r.now, buyerScope: buyerUserId }));
      }));
  }

  /** The responding party counters with a new per-unit price (flips the turn) — and RESETS the round's clock (founder D1). */
  async counter(tenantId: string, actor: OfferActor, offerId: string, priceMinor: string) {
    return this.mutate(tenantId, actor, offerId, async (tx, o, party, now, clock) => {
      o.counter(party, BigInt(priceMinor), now, counterClock(now, o.firstOfferedAt, clock));
      await this.repo.insertRound(tx, { tenantId, offerId, round: o.round, party, act: 'counter', priceMinor: BigInt(priceMinor) });
    });
  }

  /** The party whose turn it is accepts the price on the table → a deal (downstream order creation). PC-56 STORE-3b · B2 (founder D2): the
   *  quantity is RESERVED in this transaction first — re-checked against the LOCKED listing — or the accept is refused by name. */
  async accept(tenantId: string, actor: OfferActor, offerId: string) {
    let listingId: string | null = null;
    const out = await this.mutate(tenantId, actor, offerId, async (tx, o, party, now) => {
      o.assertCanAccept(party, now);                                  // the turn and the round's clock, BEFORE anything is reserved
      await this.reserveForAccept(tx, tenantId, o);                    // published · seller not suspended · stock — under the listing's row lock
      listingId = o.listingId;
      o.accept(party, now, { stockReserved: true });
      await this.repo.insertRound(tx, { tenantId, offerId, round: o.round, party, act: 'accept', priceMinor: o.agreedPriceMinor });
    });
    // the reserved lot's cached copy is dropped AFTER commit (the 2c checkout rule: a read never repopulates the cache with the pre-commit row)
    if (listingId) await this.listings.invalidate(tenantId, listingId).catch(() => undefined);
    this.metrics.inc('offers.accepted_reserved', { tenant: tenantId });
    return out;
  }

  /** Either party declines / withdraws — with an optional reason from the `offer_decline_reason` vocabulary (founder D3; no free text). */
  async reject(tenantId: string, actor: OfferActor, offerId: string, reasonCode: string | null = null) {
    return this.mutate(tenantId, actor, offerId, async (tx, o, party, now) => {
      if (reasonCode !== null && !(await this.repo.declineReasonActiveTx(tx, reasonCode))) throw new OfferDeclineReasonUnknownError(reasonCode);
      o.reject(party, now, reasonCode);
      await this.repo.insertRound(tx, { tenantId, offerId, round: o.round, party, act: 'decline', priceMinor: null });
    });
  }

  /**
   * PC-56 STORE-3b · B2 (founder D2, survey F-5 / B5) — THE ACCEPT'S GUARDS AND THE RESERVATION, in the accept's transaction. The listing must be
   * on sale (the cached read is a fast path; the LOCKED row is re-checked by `reserveInTx`), the seller not under a suspension (the five read
   * models' predicate), and the quantity available — then it is decremented under the listing's row lock (2c's one function). Refusals by name:
   * OFFER_LISTING_UNAVAILABLE {status} · OFFER_SELLER_UNAVAILABLE · OFFER_STOCK_SHORT {available} (the locked remainder, 3-place decimal text).
   */
  private async reserveForAccept(tx: TxContext, tenantId: string, o: ListingOffer): Promise<void> {
    const l: any = await this.listings.getById(tenantId, o.listingId);
    if (!l || l.status !== 'published') throw new OfferListingUnavailableError(l?.status ?? 'not_found');
    if (await this.sellerSuspendedTx(tx, tenantId, l.sellerUserId)) throw new OfferSellerUnavailableError();
    try {
      await this.listings.reserveInTx(tx, tenantId, o.listingId, o.quantity);
    } catch (e) {
      if (e instanceof InsufficientStockError) {
        const d = (e as unknown as { details?: { available?: number } }).details;
        this.metrics.inc('offers.accept_refused', { tenant: tenantId, code: 'OFFER_STOCK_SHORT' });
        throw new OfferStockShortError(milliToDecimal(toMilli(d?.available ?? 0)));
      }
      if (e instanceof ListingNotEditableError) {
        const d = (e as unknown as { details?: { status?: string } }).details;
        throw new OfferListingUnavailableError(d?.status ?? 'not_found');
      }
      throw e;
    }
  }

  private async mutate(tenantId: string, actor: OfferActor, offerId: string,
    act: (tx: TxContext, o: ListingOffer, party: OfferParty, now: Date, clock: OfferClock) => Promise<void>) {
    const r = await this.uow.run(tenantId, async (tx) => {
      const o = await this.repo.getForUpdate(tx, tenantId, offerId);
      if (!o) throw new OfferNotFoundError(offerId);
      const party = await this.partyOf(tenantId, o, actor);
      const now = new Date();
      const clock = await this.repo.clock(tenantId, tx);
      await act(tx, o, party, now, clock);
      await this.repo.update(tx, o);
      await this.flush(tx, tenantId, offerId, o.pullEvents());
      const rounds = await this.repo.roundsFor(tenantId, [offerId], tx);
      return { props: o.toProps(), party, clock, rounds, now };
    }, { userId: actor.userId });
    return this.enrichOne(tenantId, r.props, { viewer: r.party, clock: r.clock, rounds: r.rounds, now: r.now, buyerScope: r.party === 'buyer' ? actor.userId : null });
  }

  /** The expiry clock's act (PC-56 HOTFIX-5 · B1: `offers-expire`, registered). Idempotent — skips an offer no longer in negotiation or
   *  not yet due; returns whether THIS call expired it. `now` is the tick's instant (one instant per sweep). PC-56 STORE-3b · D3: + the
   *  `expire` round row, in the same transaction. */
  async expire(tenantId: string, offerId: string, now: Date = new Date()): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const o = await this.repo.getForUpdate(tx, tenantId, offerId);
      if (!o || !isNegotiable(o.status)) return false;
      if (now.getTime() < o.expiresAt.getTime()) return false;
      o.expire(now);
      await this.repo.update(tx, o);
      await this.repo.insertRound(tx, { tenantId, offerId, round: o.round, party: 'system', act: 'expire', priceMinor: null });
      await this.flush(tx, tenantId, offerId, o.pullEvents());
      return true;
    }, { userId: 'system' });
  }

  async getById(tenantId: string, actor: OfferActor, offerId: string) {
    const o = await this.repo.getById(tenantId, offerId);
    if (!o) throw new OfferNotFoundError(offerId);
    const viewer = await this.partyOf(tenantId, o, actor);   // authorize: throws unless buyer/seller/moderator
    const [clock, rounds] = await Promise.all([this.repo.clock(tenantId), this.repo.roundsFor(tenantId, [offerId])]);
    return this.enrichOne(tenantId, o.toProps(), { viewer, clock, rounds, now: new Date(), buyerScope: viewer === 'buyer' ? actor.userId : null });
  }

  async list(tenantId: string, actor: OfferActor, q: { box: 'outgoing' | 'incoming'; listingId?: string; status?: string; cursor?: { ts: string; id: string }; limit: number }) {
    const lq: OfferListQuery = { status: q.status, cursor: q.cursor, limit: q.limit };
    let rows: ListingOffer[];
    if (q.box === 'incoming') {
      if (!q.listingId) throw new InvalidOfferError('listingId is required to list incoming offers');
      const seller = await this.sellerOf(tenantId, q.listingId);
      if (seller !== actor.userId && !actor.canModerate) throw new OfferForbiddenError('only the listing seller can view its offers');
      rows = await this.repo.listForListing(tenantId, q.listingId, lq);
    } else {
      rows = await this.repo.listForBuyer(tenantId, actor.userId, lq);
    }
    const props = rows.map((o) => o.toProps());
    const [clock, rounds] = await Promise.all([this.repo.clock(tenantId), this.repo.roundsFor(tenantId, props.map((p) => p.id))]);
    const viewer: OfferParty = q.box === 'incoming' ? 'seller' : 'buyer';
    const items = await this.enrich(tenantId, props, { viewer, clock, rounds, now: new Date(), buyerScope: viewer === 'buyer' ? actor.userId : null });
    const last = props[props.length - 1];
    // PC-56 STORE-3b · B8 (survey F-20): the cursor carries the MICROSECOND instant the database printed — never a millisecond Date
    const nextCursor = props.length === q.limit && last?.createdAtUs ? encodeKeyset(last.createdAtUs, last.id) : null;
    return { items, nextCursor };
  }

  /** PC-56 STORE-3b · B7 (survey B18) — the caller's OUTGOING offers counted per status, each bounded (`capped` past the cap). */
  async counts(tenantId: string, buyerUserId: string, cap: number = OFFER_COUNT_CAP): Promise<OfferCounts> {
    return this.repo.countsForBuyer(tenantId, buyerUserId, cap);
  }

  private async enrichOne(tenantId: string, p: Props, ctx: ReadContext) { return (await this.enrich(tenantId, [p], ctx))[0]; }

  /** B6 — a PAGE of offers as the caller reads them: one listing read per distinct listing (the 300 s cached service read), one organisation
   *  read, one rounds read, one order-status read (the buyer's converted rows only). */
  private async enrich(tenantId: string, list: readonly Props[], ctx: ReadContext) {
    const listingIds = [...new Set(list.map((p) => p.listingId))];
    const listingFacts = new Map<string, { title: string | null; unitCode: string | null }>();
    await Promise.all(listingIds.map(async (id) => {
      const l: any = await this.listings.getById(tenantId, id).catch(() => null);
      listingFacts.set(id, { title: l?.title ?? null, unitCode: l?.unitCode ?? null });
    }));
    const organisation = list.length > 0 ? await this.repo.organisationOf(tenantId) : null;
    const converted = list.filter((p) => p.convertedOrderId).map((p) => p.convertedOrderId as string);
    const orderStatuses = ctx.buyerScope && converted.length > 0 ? await this.repo.orderStatusesForBuyer(tenantId, ctx.buyerScope, converted) : new Map<string, string>();
    return list.map((p) => {
      const f = listingFacts.get(p.listingId);
      return this.serialize(p, ctx, {
        listingTitle: f?.title ?? null, unitCode: f?.unitCode ?? null, organisation,
        convertedOrderStatus: p.convertedOrderId ? (orderStatuses.get(p.convertedOrderId) ?? null) : null,
      });
    });
  }

  private serialize(p: Props, ctx: ReadContext, extra: { listingTitle: string | null; unitCode: string | null; organisation: { slug: string; name: string } | null; convertedOrderStatus: string | null }) {
    const current = ListingOffer.rehydrate({ ...p }).currentPriceMinor;
    return {
      offerId: p.id, listingId: p.listingId, buyerUserId: p.buyerUserId, quantity: p.quantity,
      offeredPriceMinor: p.offeredPriceMinor.toString(), counterPriceMinor: p.counterPriceMinor?.toString() ?? null,
      round: p.round, status: p.status, expiresAt: p.expiresAt, convertedOrderId: p.convertedOrderId, createdAt: p.createdAt,
      currencyCode: p.currencyCode ?? null,   // PC-56 HOTFIX-5 · B4 (Rule Zero): the listing's currency — the minor units above are in it
      // ---- PC-56 STORE-3b (B1 / B4 / B5 / B6) ----
      listingTitle: extra.listingTitle, unitCode: extra.unitCode, organisation: extra.organisation,
      currentPriceMinor: current.toString(),
      offerValueMinor: offerValueMinor(p.quantity, current),   // the SERVER's quantity × price on the table (the order line's floor)
      yourTurn: turnOf(p.status, p.round) === ctx.viewer,
      allowedActs: allowedActsFor(ctx.viewer, p, ctx.now),
      respondBy: p.expiresAt, roundTtlHours: ctx.clock.roundTtlHours, maxLifeEndsAt: maxLifeEndsAt(p.createdAt, ctx.clock),
      rounds: roundsOf(ctx.rounds.get(p.id) ?? [], p),
      declineReasonCode: p.declineReasonCode ?? null, declinedBy: p.declinedBy ?? null,
      conversion: conversionOf(p.status), convertedOrderStatus: extra.convertedOrderStatus,
    };
  }

  private async flush(tx: TxContext, tenantId: string, offerId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'listing_offer', aggregateId: offerId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }

  /** Is the seller suspended in this tenant? The SAME predicate as the five listing read models (`shared/sql/member-suspension.sql`). */
  private async sellerSuspendedTx(tx: TxContext, tenantId: string, sellerUserId: string): Promise<boolean> {
    const r = await tx.query<{ suspended: boolean }>(`SELECT ${memberSuspendedSql('$2', '$1')} AS suspended`, [sellerUserId, tenantId]);
    return r.rows[0]?.suspended === true;
  }

  /**
   * The make's refusal reuses the "not found or not published" message ON PURPOSE: a buyer must not learn from an error message
   * that a particular farmer has been suspended by their FPO. That is the member's business, and the buyer's question is
   * only whether they can transact. (The accept's refusal, OFFER_SELLER_UNAVAILABLE, says the same thing: the organisation cannot
   * take this sale right now.)
   */
  private async assertSellerNotSuspended(tx: TxContext, tenantId: string, sellerUserId: string): Promise<void> {
    if (await this.sellerSuspendedTx(tx, tenantId, sellerUserId)) throw new InvalidOfferError('listing not found or not published');
  }
}
