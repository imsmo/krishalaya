// modules/group-lots/events/handlers/order-completed.handler.ts · PC-56 TENANT-11c · A2 — HOP 1 OF THE SALE.
//
// Consumes `orders.order_completed`. Payments' OrderCompletedHandler (unchanged) settles the order IN THIS SAME relay
// transaction: escrow → the seller's Main, and the `settlement_lines` row. This handler does not move money and does not
// write a lot: it reads the order's lines in kv_app's unit of work (the event's tenant, RLS-bound; never as kv_relay) and, for
// a group lot whose listing the order bought, ENQUEUES `group_lot.sale_settled` on the relay's transaction. That event
// therefore exists only if the seller's settlement commits with it — and when it is delivered (hop 2,
// SaleSettledHandler) the settlement it reads is already committed. Doing the hold HERE, on a second connection, would wait
// forever on the seller's Main row the relay transaction has just locked.
//
// An order with no group-lot listing (every ordinary order) is a no-op. An auction's order is an ordinary order for the
// listing it sold (11a), so a lot sold by auction reaches this handler the same way, at completion.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { GroupLotService } from '../../services/group-lot.service';

@Injectable()
export class GroupLotOrderCompletedHandler implements OutboxHandler {
  readonly eventType = 'orders.order_completed';
  constructor(private readonly lots: GroupLotService) {}

  async handle(event: OutboxEvent, relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = event.aggregateId;
    if (!tenantId || !orderId) return;   // malformed event — fail closed
    await this.lots.onOrderCompleted(tenantId, orderId, relayTx);
  }
}
