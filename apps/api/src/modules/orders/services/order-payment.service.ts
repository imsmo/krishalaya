// modules/orders/services/order-payment.service.ts
// Pay-from-wallet: settle an order that is awaiting payment from the buyer's OWN wallet balance,
// instead of routing through the gateway. This service OWNS the order load/verify + caller-key
// idempotency + the ACID tx; the actual money move (user wallet → platform escrow) + the Payment
// record + the payments.payment_succeeded event are delegated to the payments module
// (PaymentService.captureOrderFromWalletInTx) — orders NEVER moves money itself (Law 11). The order
// then advances to 'confirmed' ASYNC via the existing PaymentSucceededHandler (consuming the event
// from the outbox relay), exactly like the gateway path — one confirm code path, no duplication.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { PaymentService } from '../../payments/services/payment.service';
import { OrderRepository } from '../repositories/order.repository';
import { OrderNotFoundError, OrderForbiddenError, OrderNotAwaitingPaymentError } from '../domain/orders.errors';

@Injectable()
export class OrderPaymentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly orders: OrderRepository,
    private readonly payments: PaymentService,
  ) {}

  /** Idempotent on the caller's key. The amount is the ORDER's server-side total (never trusted from
   *  the client); the subject (buyer) is re-resolved from the loaded order vs the token → zero IDOR. */
  async payFromWallet(tenantId: string, buyerUserId: string, idemKey: string, orderId: string) {
    return this.idem.remember(idemKey, buyerUserId, 'orders.pay_from_wallet', () =>
      timed(this.metrics, 'orders.pay_from_wallet', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const order = await this.orders.getForUpdate(tx, tenantId, orderId);
          if (!order) throw new OrderNotFoundError(orderId);
          const p = order.toProps();
          if (p.buyerUserId !== buyerUserId) throw new OrderForbiddenError('Only the buyer can pay for this order');
          if (p.status !== 'payment_pending') throw new OrderNotAwaitingPaymentError(orderId, p.status);
          // PC-56 TENANT-11a (F-2): an auction order is paid by its balance — the winner's EMD is already in escrow for it.
          const due = await this.payments.amountDueForOrderInTx(tx, tenantId, orderId, p.totalMinor);
          const r = await this.payments.captureOrderFromWalletInTx(tx, {
            tenantId, buyerUserId, orderId, amountMinor: due, currencyCode: p.currencyCode,
          });
          // order → 'confirmed' happens async via PaymentSucceededHandler; the wallet is debited NOW.
          return { orderId, paymentId: r.paymentId, status: 'success', amountMinor: due.toString(), currencyCode: p.currencyCode };
        }, { userId: buyerUserId })));
  }
}
