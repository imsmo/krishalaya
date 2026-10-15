// modules/orders/events/handlers/order-cancelled-restock.handler.ts · PC-56 STORE-2c · B1 (founder D1) — A CANCELLED ORDER GIVES ITS STOCK BACK, ONCE.
//
// Consumes `orders.order_cancelled` — every cancel path writes it: the buyer's cancel and the seller's decline (OrderService.cancel), the
// 24 h `payment_pending` / `created` auto-cancel (SellerConfirmTimeoutJob → Order.systemCancel), the auction default
// (AuctionOrderService → systemCancel) and a dispute that cancels. For an order whose placement RESERVED stock (`orders.stock_reserved_at`,
// 0209 — set by CheckoutService.reserveAll in the placement transaction) it releases each line's quantity back to its lot.
//
// EXACTLY ONCE, DURABLY: the marker is cleared and the lots are released in ONE kv_app transaction (OrderRepository.releaseReservationTx +
// ListingService.releaseInTx, each lot under its row lock, in listing-id order). A replayed event, a relay retry after a crash, a second
// handler run — each finds the marker NULL and releases nothing. An order that never reserved (placed before 0209, an offer / auction /
// requirement order — the auction restocks its own lot on default) has NULL from the start: nothing is released.
//
// WHY kv_app's UNIT OF WORK, NOT THE RELAY TRANSACTION (the HOTFIX-2 house rule, relay gate): the relay logs in as `kv_relay`, which holds no
// privilege it does not need; the stock lives in `listings` and the marker in `orders`, both reached here as kv_app, RLS-bound to the event's
// tenant. No grant is added to kv_relay (the gate's second test proves it). Brief B1 named "the existing idempotency service" for this; the
// marker is used instead because the idempotency record lives OUTSIDE this transaction (a claim stored while the restock rolled back would
// skip the restock forever, and its 24 h window ends) — named in the wave report §6.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../../core/observability/metrics';
import { ListingService } from '../../../listings/services/listing.service';
import { OrderRepository } from '../../repositories/order.repository';

@Injectable()
export class OrderCancelledRestockHandler implements OutboxHandler {
  readonly eventType = 'orders.order_cancelled';
  private readonly log = new Logger(OrderCancelledRestockHandler.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: OrderRepository,
    private readonly listings: ListingService,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = (event.payload.orderId as string | undefined) ?? event.aggregateId;
    if (!tenantId || !orderId) return;
    const released = await this.restock(tenantId, orderId);
    if (released.length > 0) {
      this.metrics.inc('orders.stock_released', { tenant: tenantId, lines: String(released.length) });
      this.log.log(`order ${orderId} cancelled — released ${released.length} reserved line(s) to their lots`);
    }
  }

  /** The release itself (also the unit-test seam): one kv_app transaction — the marker cleared, every line released under its lot's lock. */
  async restock(tenantId: string, orderId: string): Promise<string[]> {
    const ids = await this.uow.run(tenantId, async (tx) => {
      const lines = await this.repo.releaseReservationTx(tx, tenantId, orderId);
      if (!lines || lines.length === 0) return [] as string[];
      for (const l of lines) await this.listings.releaseInTx(tx, tenantId, l.listingId, l.quantity);
      return lines.map((l) => l.listingId);
    }, { userId: 'system' });
    for (const id of ids) await this.listings.invalidate(tenantId, id).catch(() => undefined);   // the cached copies, after commit
    return ids;
  }
}
