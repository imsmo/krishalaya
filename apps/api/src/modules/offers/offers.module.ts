// modules/offers/offers.module.ts
// Buyer↔seller price negotiation (offers, counters, accept/reject, expiry) on a published listing.
// Reads the listing price/seller via ListingService (cross-module public API, Law 11). NO money
// moves here — an accepted offer is announced via the outbox (offers.offer_accepted); the order +
// payment are created downstream (orders). Gated by the `offers` feature flag (default OFF).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { ListingsModule } from '../listings/listings.module';
import { OffersController } from './controllers/v1/offers.controller';
import { ListingOfferService } from './services/listing-offer.service';
import { ListingOfferRepository } from './repositories/listing-offer.repository';
import { OrderFromOfferCreatedHandler } from './events/handlers/order-from-offer-created.handler';
import { ExpireOffersJob } from './jobs/expire-offers.job';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { cadenceOf } from '../../core/jobs/clock-cadence';

// PC-56 HOTFIX-5 · B1 (founder D2): the expiry clock (jobs/expire-offers.job.ts) is a DI provider now and REGISTERED in
// SCHEDULED_JOB_REGISTRY as `offers-expire` (it said "instantiated by apps/worker" — nothing instantiated it, and no offer ever expired).
@Module({
  imports: [ListingsModule],
  controllers: [OffersController],
  providers: [ListingOfferService, ListingOfferRepository, OrderFromOfferCreatedHandler,
    { provide: ExpireOffersJob, inject: [UNIT_OF_WORK, ListingOfferRepository, ListingOfferService],
      useFactory: (u: UnitOfWork, r: ListingOfferRepository, s: ListingOfferService) => new ExpireOffersJob(cadenceOf('offers-expire'), u, r, s) },
  ],
  exports: [ListingOfferService],
})
export class OffersModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly orderFromOffer: OrderFromOfferCreatedHandler,
    private readonly expireJob: ExpireOffersJob,
  ) {}
  // Link an accepted offer to the order the orders module creates (offers.offer_accepted →
  // orders.order_from_offer_created → here): status accepted → converted, converted_order_id set.
  // PC-56 HOTFIX-5 · B1: + the expiry clock (orders/__tests__/hotfix5-job-registry.spec.ts fails if it is missing).
  onModuleInit(): void { this.registry.register(this.orderFromOffer); this.jobs.register(this.expireJob); }
}
