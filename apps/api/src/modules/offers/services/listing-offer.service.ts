// modules/offers/services/listing-offer.service.ts
// Offer (price negotiation) use-cases. Every write: one ACID tx (UoW), status via the machine
// (Law 5), outbox events in the SAME tx (Law 4). NO money moves here — an accepted offer is a deal
// announced via the outbox (offers.offer_accepted); the order + payment are created downstream
// (orders, Law 11). Seller authority is resolved from the listing via ListingService (Law 11 — never
// the listings repository). The negotiation row has no version column, so mutations lock it FOR UPDATE.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { memberSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { ListingService } from '../../listings/services/listing.service';
import { ListingOffer } from '../domain/listing-offer.entity';
import { DomainEvent, OfferParty } from '../domain/offers.events';
import { isNegotiable } from '../domain/listing-offer.state';
import { OfferNotFoundError, OfferForbiddenError, InvalidOfferError, SellerCannotOfferError } from '../domain/offers.errors';
import { ListingOfferRepository, OfferListQuery } from '../repositories/listing-offer.repository';
import { CreateOfferDto } from '../dto/create-listing-offer.dto';

export interface OfferActor { userId: string; canModerate: boolean; }
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000;   // an offer lapses 72h after it is made unless told otherwise

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
        const qty = Number(dto.quantity);
        if (qty < Number(l.minOrderQty)) throw new InvalidOfferError('quantity is below the listing minimum order');
        if (qty > Number(l.quantityAvailable)) throw new InvalidOfferError('quantity exceeds the available quantity');
        const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : new Date(Date.now() + DEFAULT_TTL_MS);
        const offer = ListingOffer.make({
          id: uuidv7(), tenantId, listingId: dto.listingId, buyerUserId,
          quantity: dto.quantity, offeredPriceMinor: BigInt(dto.offeredPriceMinor), expiresAt,
        });
        return this.uow.run(tenantId, async (tx) => {
          // **THE SEVENTH ENFORCEMENT SITE (PC-56 TENANT-1b-2).** `getById` above reads the listing directly rather than
          // through the public feed, so the filter on the five read models does not reach it — and an offer is the act
          // the feed exists to lead to. Without this, a buyer holding a stale link could still negotiate with a seller
          // the platform has decided not to show.
          //
          // Checked INSIDE the existing transaction rather than by injecting a read replica: one connection, one
          // consistent view, and no new dependency on a service whose module did not have one.
          await this.assertSellerNotSuspended(tx, tenantId, l.sellerUserId);
          await this.repo.insert(tx, offer);
          const p = offer.toProps();
          await this.flush(tx, tenantId, p.id, offer.pullEvents());
          return this.serialize(p);
        }, { userId: buyerUserId });
      }));
  }

  /** The responding party counters with a new per-unit price (flips the turn). */
  async counter(tenantId: string, actor: OfferActor, offerId: string, priceMinor: string) {
    return this.mutate(tenantId, actor, offerId, (o, party) => o.counter(party, BigInt(priceMinor), new Date()));
  }
  /** The party whose turn it is accepts the price on the table → a deal (downstream order creation). */
  async accept(tenantId: string, actor: OfferActor, offerId: string) {
    return this.mutate(tenantId, actor, offerId, (o, party) => o.accept(party, new Date()));
  }
  /** Either party declines / withdraws. */
  async reject(tenantId: string, actor: OfferActor, offerId: string) {
    return this.mutate(tenantId, actor, offerId, (o, party) => o.reject(party, new Date()));
  }

  private async mutate(tenantId: string, actor: OfferActor, offerId: string, act: (o: ListingOffer, party: OfferParty) => void) {
    return this.uow.run(tenantId, async (tx) => {
      const o = await this.repo.getForUpdate(tx, tenantId, offerId);
      if (!o) throw new OfferNotFoundError(offerId);
      const party = await this.partyOf(tenantId, o, actor);
      act(o, party);
      await this.repo.update(tx, o);
      await this.flush(tx, tenantId, offerId, o.pullEvents());
      return this.serialize(o.toProps());
    }, { userId: actor.userId });
  }

  /** Worker job: lapse an expired offer. Idempotent — skips offers no longer in negotiation. */
  async expire(tenantId: string, offerId: string): Promise<void> {
    await this.uow.run(tenantId, async (tx) => {
      const o = await this.repo.getForUpdate(tx, tenantId, offerId);
      if (!o || !isNegotiable(o.status)) return;
      const now = new Date();
      if (now.getTime() < o.expiresAt.getTime()) return;
      o.expire(now);
      await this.repo.update(tx, o);
      await this.flush(tx, tenantId, offerId, o.pullEvents());
    }, { userId: 'system' });
  }

  async getById(tenantId: string, actor: OfferActor, offerId: string) {
    const o = await this.repo.getById(tenantId, offerId);
    if (!o) throw new OfferNotFoundError(offerId);
    await this.partyOf(tenantId, o, actor);   // authorize: throws unless buyer/seller/moderator
    return this.serialize(o.toProps());
  }

  async list(tenantId: string, actor: OfferActor, q: { box: 'outgoing' | 'incoming'; listingId?: string; status?: string; cursor?: { c: string; id: string }; limit: number }) {
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
    const items = rows.map((o) => this.serialize(o.toProps()));
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last
      ? Buffer.from(`${(last as any).createdAt.toISOString?.() ?? last.createdAt}|${last.offerId}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private serialize(p: ReturnType<ListingOffer['toProps']>) {
    return {
      offerId: p.id, listingId: p.listingId, buyerUserId: p.buyerUserId, quantity: p.quantity,
      offeredPriceMinor: p.offeredPriceMinor.toString(), counterPriceMinor: p.counterPriceMinor?.toString() ?? null,
      round: p.round, status: p.status, expiresAt: p.expiresAt, convertedOrderId: p.convertedOrderId, createdAt: p.createdAt,
    };
  }

  private async flush(tx: TxContext, tenantId: string, offerId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'listing_offer', aggregateId: offerId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }

  /**
   * Is the seller suspended in this tenant? Uses the SAME predicate as the five listing read models
   * (`shared/sql/member-suspension.sql`), so there is one rule and not two.
   *
   * The refusal reuses the "not found or not published" message ON PURPOSE: a buyer must not learn from an error message
   * that a particular farmer has been suspended by their FPO. That is the member's business, and the buyer's question is
   * only whether they can transact.
   */
  private async assertSellerNotSuspended(tx: TxContext, tenantId: string, sellerUserId: string): Promise<void> {
    const r = await tx.query<{ suspended: boolean }>(
      `SELECT ${memberSuspendedSql('$2', '$1')} AS suspended`, [sellerUserId, tenantId]);
    if (r.rows[0]?.suspended === true) throw new InvalidOfferError('listing not found or not published');
  }
}
