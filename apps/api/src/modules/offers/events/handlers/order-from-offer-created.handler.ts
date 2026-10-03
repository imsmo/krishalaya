// modules/offers/events/handlers/order-from-offer-created.handler.ts
// Consumes orders.order_from_offer_created (delivered by the outbox relay). Links the accepted offer
// to the order the orders module just created: status accepted → converted, converted_order_id set.
// Runs INSIDE the relay tx and touches only the offers module's own repository. IDEMPOTENT: a
// re-delivery (status already 'converted') is a no-op; a non-accepted offer is skipped defensively.
//
// PC-56 HOTFIX-2 — "INSIDE the relay tx" was the defect: the relay runs as `kv_relay`, which holds NO privilege on
// `listing_offers`, so the lock died 42501 and every offer-made order stayed linked to nothing (its event quarantined). The lock,
// the conversion and the `offers.offer_converted` outbox row now run in ONE request-tier unit of work (kv_app, RLS-bound to the
// event's tenant); the relay tx is not used. No grant was added to kv_relay; idempotency is unchanged.
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { ListingOfferRepository } from '../../repositories/listing-offer.repository';
import { DomainEvent } from '../../domain/offers.events';

@Injectable()
export class OrderFromOfferCreatedHandler implements OutboxHandler {
  readonly eventType = 'orders.order_from_offer_created';
  constructor(private readonly repo: ListingOfferRepository, @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter, @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const offerId = p.offerId as string | undefined;
    const orderId = p.orderId as string | undefined;
    if (!tenantId || !offerId || !orderId) return;

    await this.uow.run(tenantId, async (tx) => {
      const offer = await this.repo.getForUpdate(tx, tenantId, offerId);
      if (!offer) return;                                // unknown offer
      if (offer.status === 'converted') return;          // idempotent: already linked
      if (offer.status !== 'accepted') return;           // only an accepted offer converts (defensive)
      offer.convert(orderId);
      await this.repo.update(tx, offer);
      await this.flush(tx, tenantId, offerId, offer.pullEvents());   // offers.offer_converted
    }, { userId: 'system' });
  }

  private async flush(tx: TxContext, tenantId: string, offerId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'listing_offer', aggregateId: offerId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
