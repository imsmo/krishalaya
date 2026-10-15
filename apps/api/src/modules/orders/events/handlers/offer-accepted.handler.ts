// modules/orders/events/handlers/offer-accepted.handler.ts
// Consumes offers.offer_accepted (delivered by the outbox relay). A buyer↔seller negotiation that
// was ACCEPTED becomes a real order at the agreed per-unit price × quantity, source='offer'.
// Cross-module rule: the seller/product/title come from ListingService (Law 11 — never the listings repo);
// we touch only the orders module's own repository here. IDEMPOTENT: if an order already exists for this offer (its
// offer_id), we no-op — so at-least-once re-delivery never double-creates an order.
//
// PC-56 STORE-3b · B2 / B3 (founder D2, survey F-5 — Law 9, the report's §9):
//   • THE ORDER CARRIES CHECKOUT'S FEES. The buyer-side charges come from the ONE function checkout uses (domain/placement-charges.ts): no
//     delivery quote (the regime is NAMED — "collection or delivery arranged with the organisation; no delivery charge in this order"), so the
//     platform fee is the member-benefit override or 0, and the commission rule is FROZEN at placement (source 'offer', the goods value = the
//     server's quantity × agreed price) — a buyer-charged commission (+GST, `commission_split` ON) is added to the order exactly as on a
//     checkout order of the same goods value. `deliveryFeeMinor` 0.
//   • THE STOCK WAS RESERVED AT ACCEPT (ListingOfferService.accept → `reserveInTx`, the accept's transaction). The event says so
//     (`stockReserved: true`) and the order records it (`stock_reserved_at`), so 2c's restock handler releases the quantity ONCE when the order
//     is cancelled, declined or auto-cancelled at 24 h. An `offer_accepted` event written before this wave (no `stockReserved`) creates an
//     order that reserved nothing (NULL) — nothing is ever released for it.
//   • THE QUANTITY is the event's decimal string, normalised (3 places, thousandths — `normaliseQty`) and handed to the order line exactly as
//     checkout hands its own (E8: the bare `Number(quantity)` on the raw payload is gone).
//   • IF THE ORDER CAN NEVER BE CREATED (the listing vanished, or a self-deal slipped through), a reservation made at accept is RELEASED here
//     (`ListingService.releaseInTx`, once — guarded by the same "no order exists for this offer" check) and `offer.conversion_failed` is
//     audited; the offer stays `accepted` (its state machine has no way back — named for the founder / ops, report §7–§8).
//   • kv_app's UNIT OF WORK, NOT THE RELAY TRANSACTION (the HOTFIX-2 house rule; the OrderFromOfferCreatedHandler precedent): the relay runs as
//     kv_relay, which holds no grant on the commission / tax / membership tables the charges read; every read and write here runs as kv_app,
//     RLS-bound to the event's tenant. The relay transaction is not used. No grant is added to kv_relay (the relay gate proves it).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { AuditWriter } from '../../../../core/audit/audit.writer';
import { uuidv7 } from '../../../../core/database/uuid.util';
import { Metrics, METRICS } from '../../../../core/observability/metrics';
import { ListingService } from '../../../listings/services/listing.service';
import { CommissionSnapshotService } from '../../../payments/services/commission-snapshot.service';
import { UserMembershipService } from '../../../memberships/services/user-membership.service';
import { OrderRepository } from '../../repositories/order.repository';
import { Order } from '../../domain/order.entity';
import { OrderItem } from '../../domain/order-item.entity';
import { OrderEventType, DomainEvent } from '../../domain/orders.events';
import { normaliseQty } from '../../domain/cart-rules';
import { placementCharges, NO_QUOTE } from '../../domain/placement-charges';

// PC-56 HOTFIX-5 · B2: the order number is the ONE helper's (random bits); B4: the currency is the listing's (Rule Zero)
import { orderNoFor } from '../../domain/order-no';
import { currencyFromListing } from '../../domain/order-currency';

@Injectable()
export class OfferAcceptedHandler implements OutboxHandler {
  readonly eventType = 'offers.offer_accepted';
  private readonly log = new Logger(OfferAcceptedHandler.name);
  constructor(
    private readonly repo: OrderRepository,
    private readonly listings: ListingService,
    private readonly flags: FlagsService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly memberships: UserMembershipService,
    private readonly commission: CommissionSnapshotService,
    private readonly audit: AuditWriter,
  ) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const offerId = p.offerId as string | undefined;
    const listingId = p.listingId as string | undefined;
    const buyerUserId = p.buyerUserId as string | undefined;
    const agreedPriceMinor = p.agreedPriceMinor as string | undefined;
    const rawQuantity = p.quantity as string | undefined;
    const stockReserved = p.stockReserved === true;
    if (!tenantId || !offerId || !listingId || !buyerUserId || !agreedPriceMinor || !rawQuantity) return;  // malformed → ignore
    const quantity = normaliseQty(rawQuantity);

    // the flags are read before the unit of work (their own reads — the checkout order)
    const [requiresPayment, applyCharges, applyMemberBenefits, splitOn] = await Promise.all([
      this.flags.isEnabled('online_payments', { tenantId, userId: buyerUserId }),
      this.flags.isEnabled('buyer_charges', { tenantId, userId: buyerUserId }),
      this.flags.isEnabled('memberships', { tenantId, userId: buyerUserId }),
      this.flags.isEnabled('commission_split', { tenantId }),
    ]);

    const outcome = await this.uow.run(tenantId, async (tx) => {
      if (await this.repo.existsForOffer(tx, tenantId, offerId)) return 'exists' as const;              // idempotent (re-delivery)
      const l: any = await this.listings.getById(tenantId, listingId);                                    // Law 11: seller/product via the service
      if (!l || l.sellerUserId === buyerUserId) {                                                         // vanished · defensive self-deal
        await this.conversionFailed(tx, tenantId, offerId, listingId, quantity, stockReserved, !l ? 'listing_vanished' : 'self_deal');
        return 'failed' as const;
      }
      const now = new Date();
      const orderId = uuidv7();
      const item = OrderItem.of({
        id: uuidv7(), orderId, orderCreatedAt: now, tenantId, listingId, productId: l.productId,
        titleSnapshot: l.title, quantity: Number(quantity), unitCode: l.unitCode,                       // checkout's own hand-over (E8)
        unitPriceMinor: BigInt(agreedPriceMinor), gstRatePct: null, hsnCode: null, batchId: null,
      });
      // D2 — checkout's charges, by checkout's function: no delivery quote (the named regime), the member override, the frozen commission
      const charged = await placementCharges({ memberships: this.memberships, commission: this.commission }, tx, {
        tenantId, buyerUserId, source: 'offer', categoryId: l.categoryId ? String(l.categoryId) : null, goodsMinor: item.props.lineTotalMinor, now,
        quote: NO_QUOTE, applyCharges, applyMemberBenefits, splitOn });
      const order = Order.place({
        id: orderId, tenantId, orderNo: orderNoFor(orderId, now), checkoutGroupId: null, buyerUserId,
        sellerUserId: l.sellerUserId as string, source: 'offer', offerId, currencyCode: currencyFromListing(l.currencyCode, 'offer', offerId), items: [item],
        deliveryFeeMinor: 0n, platformFeeMinor: charged.platformFeeMinor, buyerCommissionMinor: charged.buyerCommissionMinor,
        commissionRuleSnapshot: charged.chargeSnapshot, commissionSnapshot: charged.commissionSnapshot,
        deliveryMethodId: null, deliveryAddressId: null, requiresPayment, now, stockReserved,
      });
      await this.repo.insertGraph(tx, order, [item]);
      await this.flush(tx, tenantId, orderId, order.pullEvents());                                          // order_created (+ payment_required)
      // link-back event → the offers module marks the offer converted (sets converted_order_id)
      await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: OrderEventType.FromOfferCreated, payload: { v: 1, orderId, offerId } });
      return 'created' as const;
    }, { userId: 'system' });

    if (outcome === 'created') this.metrics.inc('orders.from_offer', { tenant: tenantId });
    if (outcome === 'failed') {
      this.metrics.inc('orders.from_offer_failed', { tenant: tenantId });
      await this.listings.invalidate(tenantId, listingId).catch(() => undefined);
    }
  }

  /** The order can never be created: give back what the accept reserved (once — no order exists for this offer, checked in this same
   *  transaction) and record why. The offer stays `accepted` (founder / ops line in the report). */
  private async conversionFailed(tx: TxContext, tenantId: string, offerId: string, listingId: string, quantity: string, stockReserved: boolean, why: 'listing_vanished' | 'self_deal'): Promise<void> {
    let released = false;
    if (stockReserved) {
      try { await this.listings.releaseInTx(tx, tenantId, listingId, quantity); released = true; }
      catch (e) { this.log.error(`offer ${offerId}: the reservation of ${quantity} on listing ${listingId} could not be released: ${(e as Error).message}`); }
    }
    await this.audit.write(tx, { tenantId, actorUserId: null, actorRole: 'system', action: 'offer.conversion_failed', entityType: 'listing_offer', entityId: offerId,
      newValue: { reason: why, listingId, quantity, stockReserved, released } });
    this.log.warn(`offer ${offerId} accepted but no order can be created (${why}); reservation ${stockReserved ? (released ? 'released' : 'NOT released') : 'none'}`);
  }

  private async flush(tx: TxContext, tenantId: string, orderId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
