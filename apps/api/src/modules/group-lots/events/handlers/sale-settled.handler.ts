// modules/group-lots/events/handlers/sale-settled.handler.ts · PC-56 TENANT-11c · A2 — HOP 2 OF THE SALE.
//
// Consumes `group_lot.sale_settled` (enqueued by hop 1 on the relay transaction that settled the order's seller). Runs
// GroupLotService.recordSale in kv_app's unit of work — never on the relay's kv_relay transaction, which holds no write on
// `group_lots` (0188 narrowed it to SELECT): reads the committed seller settlement, writes `sold_at`, `sale_order_id`,
// `gross_proceeds_minor`, and in the SAME transaction holds the proceeds coordinator Main → Hold (gl-hold:<lotId>).
// Idempotent: a redelivery moves nothing. A settlement line not found throws, so the relay retries the event.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { GroupLotService } from '../../services/group-lot.service';
import { GroupLotEventType } from '../../domain/group-lot.events';

@Injectable()
export class GroupLotSaleSettledHandler implements OutboxHandler {
  readonly eventType = GroupLotEventType.SaleSettled;
  constructor(private readonly lots: GroupLotService) {}

  async handle(event: OutboxEvent): Promise<void> {
    const tenantId = event.tenantId;
    const lotId = typeof event.payload.groupLotId === 'string' ? event.payload.groupLotId : event.aggregateId;
    const orderId = typeof event.payload.orderId === 'string' ? event.payload.orderId : null;
    if (!tenantId || !lotId || !orderId) return;   // malformed event — fail closed
    await this.lots.recordSale(tenantId, lotId, orderId);
  }
}
