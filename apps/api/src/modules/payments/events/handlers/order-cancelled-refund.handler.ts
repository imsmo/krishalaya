// modules/payments/events/handlers/order-cancelled-refund.handler.ts · PC-56 STORE-2c · B2 (founder D3) — A CANCELLED, PAID ORDER IS REFUNDED
// TO SOURCE, AUTOMATICALLY, ONCE.
//
// Consumes `orders.order_cancelled` — the buyer's cancel and the seller's decline (OrderService.cancel), the 24 h auto-cancel
// (SellerConfirmTimeoutJob), the auction default and a dispute that cancels — and hands it to PaymentService.refundCancelledOrder, which:
// books the ledger `order_cancel_refund` (escrow −, source +, key `refund:<orderId>`) and moves the payment to `refund_initiated` in ONE
// kv_app transaction, asks the gateway to refund (once — `gateway-refund:<paymentId>`), and marks it `refunded` when the gateway confirms
// (the sandbox at once; Razorpay's `refund.processed` webhook later), emitting `payments.payment_refunded`. An UNPAID order books nothing.
//
// Before this handler (survey F-3): no consumer of `orders.order_cancelled` moved money — a paid order's money stayed in platform escrow after
// the order was cancelled, and only a moderator could refund it.
//
// WHY kv_app's UNIT OF WORK (the HOTFIX-2 house rule — relay gate): `payments` is reached as kv_app (kv_relay holds no privilege on it — 0078),
// so nothing is granted to the relay role. The relay transaction is not used: every write here commits in PaymentService's own transactions,
// and each is idempotent, so a relay retry (this handler threw on a failed gateway call, or another handler of the same event failed) books
// nothing twice.
import { Injectable, Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { PaymentService } from '../../services/payment.service';

@Injectable()
export class OrderCancelledRefundHandler implements OutboxHandler {
  readonly eventType = 'orders.order_cancelled';
  private readonly log = new Logger(OrderCancelledRefundHandler.name);
  constructor(private readonly payments: PaymentService) {}

  async handle(event: OutboxEvent): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = (event.payload.orderId as string | undefined) ?? event.aggregateId;
    if (!tenantId || !orderId) return;
    const r = await this.payments.refundCancelledOrder(tenantId, orderId);
    if (r.outcome === 'refunded' || r.outcome === 'pending_gateway') {
      this.log.log(`order ${orderId} cancelled — refund to source ${r.outcome === 'refunded' ? 'completed' : 'requested at the gateway'} (payment ${r.paymentId})`);
    }
  }
}
