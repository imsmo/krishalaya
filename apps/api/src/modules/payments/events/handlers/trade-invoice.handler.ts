// modules/payments/events/handlers/trade-invoice.handler.ts
// Consumes orders.order_completed (via the outbox relay) and generates the buyer's GST trade
// invoice for the order. Runs inside the relay tx; idempotent (one invoice per order). Separate
// from the settlement handler (single responsibility) — the dispatcher fans the event to both.
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

@Injectable()
export class TradeInvoiceHandler implements OutboxHandler {
  readonly eventType = 'orders.order_completed';
  constructor(private readonly invoices: TradeInvoiceService, @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const totalRaw = event.payload.totalMinor as string | undefined;
    if (!tenantId || !totalRaw) return;
    const total = BigInt(totalRaw);
    if (total <= 0n) return;

    await this.uow.run(tenantId, (tx) => this.invoices.generateForOrder(tx, {
      tenantId, orderId: event.aggregateId,
      buyerUserId: (event.payload.buyerUserId as string) ?? null,
      sellerUserId: (event.payload.sellerUserId as string) ?? null,
      totalMinor: total,
      categoryId: (event.payload.categoryId as string) ?? null,
      countryCode: (event.payload.countryCode as string) ?? 'IN',
    }), { userId: 'system' });
  }
}
