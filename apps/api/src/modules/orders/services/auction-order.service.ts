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

function orderNo(id: string): string { return `KV${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`; }

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
      id: orderId, tenantId: input.tenantId, orderNo: orderNo(orderId), checkoutGroupId: null, buyerUserId: input.buyerUserId,
      sellerUserId: input.sellerUserId, source: 'auction', currencyCode: input.currencyCode || 'INR', items: [item],
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
