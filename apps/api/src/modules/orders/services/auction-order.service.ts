// modules/orders/services/auction-order.service.ts · PC-56 TENANT-11a · THE ORDER AN AUCTION SETTLES INTO, CREATED IN THE
// SETTLEMENT'S OWN TRANSACTION.
//
// F-16: canon W139 — "Settlement creates the order atomically (status settled, settled_order_id set)". Before this wave the
// auction wrote `settled` and announced `auctions.auction_won`; the order appeared later, asynchronously, on the relay, and
// `auctions.settled_order_id` was never written. This is the orders module's PUBLIC service for that one act (Law 11: the
// auctions module calls a service, never `OrderRepository`): it builds the order and its single line inside the CALLER's
// transaction and hands back the order id, so the auction's `status='settled'`, its `settled_order_id`, the order and the
// EMD apply leg commit or roll back together.
//
// F-12 (founder: PER UNIT): the line is `quantity × hammer unit price` in the LISTING's unit — the auction's own lot,
// copied from the listing at create — not `1 × lot`. The line total comes from OrderItem's own bigint floor
// (`lineTotalMinor`), the same function the auction uses for its lot value (domain/lot.ts mirrors it), and the service
// refuses to write an order whose total disagrees with the lot value the auction computed: two numbers for one sale is
// how a farmer is short-paid by a rounding.
//
// IDEMPOTENT on `orders.auction_id`: a second call (or the legacy `auctions.auction_won` handler running afterwards for the
// same auction) finds the order and returns it.
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { TxContext } from '../../../core/database/unit-of-work';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Metrics, METRICS } from '../../../core/observability/metrics';
import { OrderRepository } from '../repositories/order.repository';
import { Order } from '../domain/order.entity';
import { OrderItem } from '../domain/order-item.entity';
import { OrderStatus } from '../domain/order.state';
import { DomainError } from '../../../shared/errors/app-error';

// PC-56 HOTFIX-5 · B2 (survey F-6): the order number is the ONE helper's — the v7 id's RANDOM bits. `id.slice(0, 8)` was the TIMESTAMP prefix:
// two auctions of one organisation settled in one close sweep (one `now`) collided on `uq_orders_no` and the second never settled.
import { orderNoFor } from '../domain/order-no';
import { currencyFromListing } from '../domain/order-currency';
// PC-56 STORE-3c · B7 (founder D7): the payments module's PUBLIC service (OrdersModule imports PaymentsModule) — "paid" also means a CAPTURED
// payment for the order, read in the cancel's transaction.
import { PaymentService } from '../../payments/services/payment.service';

/** PC-56 STORE-3c · B5 (founder D5): the system's cancel reason when an OFFLINE auction order is still unconfirmed at its balance due time. */
export const AUCTION_SELLER_SILENT_REASON = 'seller_silent';

export class AuctionOrderMismatchError extends DomainError {
  constructor(expected: bigint, got: bigint) { super('AUCTION_ORDER_MISMATCH', `The order line (${got}) does not equal the auction's lot value (${expected})`, 409, { expected: expected.toString(), got: got.toString() }); }
}

export class AuctionOrderSelfDealError extends DomainError {
  constructor() { super('AUCTION_ORDER_SELF_DEAL', 'The seller cannot be the buyer of their own auction lot', 409); }
}

export interface AuctionOrderInput {
  tenantId: string; auctionId: string; listingId: string; productId: string; title: string; currencyCode: string;
  sellerUserId: string; buyerUserId: string;
  /** The lot, as the auction holds it: 3-place quantity text and the listing's unit. */
  quantity: string; unitCode: string;
  /** The hammer, PER UNIT. */
  unitPriceMinor: bigint;
  /** What the auction computed (quantity × hammer). The order must equal it. */
  expectedLotValueMinor: bigint;
  now?: Date;
}

@Injectable()
export class AuctionOrderService {
  constructor(
    private readonly repo: OrderRepository,
    private readonly flags: FlagsService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly payments: PaymentService,
  ) {}

  /** Create the auction's order in the caller's tx. Returns the order id and whether it awaits online payment. */
  async createInTx(tx: TxContext, input: AuctionOrderInput): Promise<{ orderId: string; totalMinor: bigint; requiresPayment: boolean; created: boolean }> {
    const existing = await this.repo.findIdForAuction(tx, input.tenantId, input.auctionId);
    if (existing) return { orderId: existing.id, totalMinor: existing.totalMinor, requiresPayment: existing.status === 'payment_pending', created: false };
    if (input.sellerUserId === input.buyerUserId) throw new AuctionOrderSelfDealError();   // defensive: BidService refuses the seller's bids

    const requiresPayment = await this.flags.isEnabled('online_payments', { tenantId: input.tenantId, userId: input.buyerUserId });
    const now = input.now ?? new Date();
    const orderId = uuidv7();
    const quantity = Number(input.quantity);
    const item = OrderItem.of({
      id: uuidv7(), orderId, orderCreatedAt: now, tenantId: input.tenantId, listingId: input.listingId, productId: input.productId,
      titleSnapshot: `${input.title} (auction lot)`, quantity, unitCode: input.unitCode,
      unitPriceMinor: input.unitPriceMinor, gstRatePct: null, hsnCode: null, batchId: null,
    });
    if (item.props.lineTotalMinor !== input.expectedLotValueMinor) throw new AuctionOrderMismatchError(input.expectedLotValueMinor, item.props.lineTotalMinor);
    const order = Order.place({
      id: orderId, tenantId: input.tenantId, orderNo: orderNoFor(orderId, now), checkoutGroupId: null, buyerUserId: input.buyerUserId,
      sellerUserId: input.sellerUserId, source: 'auction', currencyCode: currencyFromListing(input.currencyCode, 'auction', input.auctionId), items: [item],   // HOTFIX-5 · B4: never 'INR'
      deliveryMethodId: null, deliveryAddressId: null, requiresPayment, now,
    });
    await this.repo.insertGraph(tx, order, [item]);
    await this.repo.linkAuction(tx, input.tenantId, orderId, input.auctionId);          // the idempotency anchor
    for (const e of order.pullEvents()) {
      await this.outbox.write(tx, { tenantId: input.tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload, auctionId: input.auctionId } });
    }
    this.metrics.inc('orders.from_auction', { tenant: input.tenantId });
    return { orderId, totalMinor: order.toProps().totalMinor, requiresPayment, created: true };
  }

  /** The order's current status, read under a row lock in the caller's tx (the default sweep decides on it). */
  async statusForUpdate(tx: TxContext, tenantId: string, orderId: string): Promise<OrderStatus | null> {
    const o = await this.repo.getForUpdate(tx, tenantId, orderId);
    return o ? o.status : null;
  }

  /** PC-56 HOTFIX-5 · B5 (founder D4): was this (cancelled) auction order PAID before it was cancelled? The ORDER's own timeline, read in the
   *  caller's kv_app tx (OrderRepository.paidBeforeCancelTx) — never the settlement's `paid` outcome alone, which a relay delivering
   *  `orders.order_cancelled` before `payments.payment_succeeded` would not yet show.
   *  PC-56 STORE-3c · B7 (founder D7): OR a CAPTURED payment for the order (its payment row `success` / `refund_initiated` / `refunded` /
   *  `partially_refunded`, read in the same transaction) — the race where the capture landed but the order was still `payment_pending` when
   *  the buyer cancelled: the deposit is RETURNED (never forfeited) and 2c's refund handler refunds the captured balance, once. */
  async paidBeforeCancelInTx(tx: TxContext, tenantId: string, orderId: string): Promise<boolean> {
    if (await this.repo.paidBeforeCancelTx(tx, tenantId, orderId)) return true;
    return this.payments.capturedForOrderInTx(tx, tenantId, orderId);
  }

  /** PC-56 STORE-3c · B5 (founder D5): an OFFLINE auction order the seller never confirmed — still `created` at its balance due time — is
   *  cancelled by the SYSTEM (reason `seller_silent`), in the caller's tx, through the order's own state machine; `orders.order_cancelled`
   *  carries the auction id so its consumers see a system cancel. Returns `'cancelled'`, or `'confirmed'` when the order moved past `created`
   *  (the organisation took it — the caller records the settlement `paid`), or `'gone'` (no row / already cancelled: the caller skips). */
  async cancelUnconfirmedOfflineInTx(tx: TxContext, tenantId: string, orderId: string, auctionId: string): Promise<'cancelled' | 'confirmed' | 'gone'> {
    const o = await this.repo.getForUpdate(tx, tenantId, orderId);
    if (!o || o.status === 'cancelled') return 'gone';
    const from = o.status;
    if (from !== 'created') return 'confirmed';
    o.systemCancel(AUCTION_SELLER_SILENT_REASON);
    if (!(await this.repo.update(tx, o, from))) return 'gone';
    for (const e of o.pullEvents()) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload, auctionId, sellerSilent: true } });
    }
    return 'cancelled';
  }

  /** F-2 default: cancel the unpaid auction order (system), in the caller's tx. Returns false when it is no longer
   *  cancellable (it was paid / moved on) — the caller then records the sale as paid instead. */
  async cancelForDefaultInTx(tx: TxContext, tenantId: string, orderId: string, auctionId: string): Promise<boolean> {
    const o = await this.repo.getForUpdate(tx, tenantId, orderId);
    if (!o) return false;
    const from = o.status;
    if (from !== 'payment_pending') return false;
    o.systemCancel('auction_default');
    if (!(await this.repo.update(tx, o, from))) return false;
    for (const e of o.pullEvents()) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload, auctionId, auctionDefault: true } });
    }
    return true;
  }
}
