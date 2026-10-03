// modules/payments/events/handlers/order-confirmed-invoice.handler.ts
// Consumes orders.order_confirmed and generates the buyer's GST trade invoice (PC-56 TENANT-3c-1).
//
// **THE TRIGGER MOVED, AND W151 WAS RIGHT ABOUT WHERE IT BELONGS.** The invoice used to be generated on
// `orders.order_completed` — after delivery and after the quality window — while W151's KPI card says
// "auto-generated on order confirm" and its empty state says "Invoices generate automatically when orders confirm".
// For a supply of goods a tax invoice is due at or before REMOVAL of the goods (dispatch), so an invoice raised
// after delivery is late on every order and the goods travel with no document.
//
// THE COMPLETION HANDLER STAYS AS A BACKSTOP rather than being deleted: generation is idempotent on (tenant, order)
// via 0019's unique index, so an order whose confirm event was lost to a relay failure still gets its invoice at
// completion. Two triggers, one document — and the earlier one wins because it runs first.
//
// PC-56 HOTFIX-2 (SWEEP F-1) — the relay runs handlers as `kv_relay`, which holds NO privilege on `trade_invoices`: the
// idempotency probe died 42501 and quarantined the whole event (every other handler of it rolled back too). The invoice
// is now generated in ONE request-tier unit of work (kv_app, RLS-bound to the event's tenant), which holds exactly the
// grants `TradeInvoiceService` needs; the relay tx is not used. Still idempotent per (tenant, order) — a relay retry after
// another handler's failure generates nothing twice. No grant was added to kv_relay.
import { Inject, Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { TradeInvoiceService } from '../../services/trade-invoice.service';

const big = (v: unknown): bigint | undefined => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : undefined);

@Injectable()
export class OrderConfirmedInvoiceHandler implements OutboxHandler {
  readonly eventType = 'orders.order_confirmed';
  constructor(private readonly invoices: TradeInvoiceService, @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const orderId = (p.orderId as string | undefined) ?? event.aggregateId;
    const total = big(p.totalMinor);
    // No total on the event = an older event shape. The completion backstop carries one, so this returns rather than
    // inventing a figure for a statutory document.
    if (!tenantId || !orderId || total === undefined || total <= 0n) return;

    await this.uow.run(tenantId, (tx) => this.invoices.generateForOrder(tx, {
      tenantId, orderId,
      buyerUserId: (p.buyerUserId as string) ?? null,
      sellerUserId: (p.sellerUserId as string) ?? null,
      totalMinor: total,
      subtotalMinor: big(p.subtotalMinor),
      deliveryFeeMinor: big(p.deliveryFeeMinor),
      discountMinor: big(p.discountMinor),
      platformFeeMinor: big(p.platformFeeMinor),
      deliveryAddressId: (p.deliveryAddressId as string) ?? null,
      categoryId: (p.categoryId as string) ?? null,
      countryCode: (p.countryCode as string) ?? 'IN',
    }), { userId: 'system' });
  }
}
