// modules/logistics/events/handlers/order-confirmed.handler.ts
// Consumes orders.order_confirmed (delivered by the outbox relay). Auto-creates ONE shipment (status
// 'pending') for the confirmed order so ops/riders can fulfil it. Touches only the logistics module's own
// repository. IDEMPOTENT: if a shipment already exists for the order, no-op — so at-least-once re-delivery
// never creates duplicates.
//
// PC-56 HOTFIX-2 (SWEEP F-1, P0, live in production) — THIS HANDLER COULD NOT RUN WHERE IT RUNS. The relay executes
// handlers on its own transaction as `kv_relay`, which holds NO privilege on `shipments` (or its partitions): the
// existence probe died 42501, the event was quarantined, and the trade-invoice handler of the same event rolled back
// with it — no shipment and no invoice for any confirmed order. The relay tx is now used for nothing here: the probe,
// the insert and the `shipment_created` outbox row run in ONE request-tier unit of work (kv_app, RLS-bound to the
// event's tenant — the role that holds exactly these grants), so the shipment and its event still commit together.
// No grant was added to kv_relay. A later handler's failure retries the event; the existence probe makes that a no-op.
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { uuidv7 } from '../../../../core/database/uuid.util';
import { Metrics, METRICS } from '../../../../core/observability/metrics';
import { Shipment } from '../../domain/shipment.entity';
import { DomainEvent } from '../../domain/logistics.events';
import { ShipmentRepository } from '../../repositories/shipment.repository';

@Injectable()
export class OrderConfirmedHandler implements OutboxHandler {
  readonly eventType = 'orders.order_confirmed';
  constructor(
    private readonly repo: ShipmentRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = event.payload.orderId as string | undefined;
    if (!tenantId || !orderId) return;
    const created = await this.uow.run(tenantId, async (tx) => {
      if (await this.repo.existsForOrder(tx, tenantId, orderId)) return false;   // idempotent
      const shipment = Shipment.create({ id: uuidv7(), tenantId, orderId });
      await this.repo.insert(tx, shipment);
      await this.flush(tx, tenantId, shipment.id, shipment.pullEvents());
      return true;
    }, { userId: 'system' });
    if (created) this.metrics.inc('logistics.shipment_auto_created', { tenant: tenantId });
  }

  private async flush(tx: TxContext, tenantId: string, shipmentId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'shipment', aggregateId: shipmentId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
