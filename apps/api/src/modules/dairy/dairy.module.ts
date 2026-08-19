// modules/dairy/dairy.module.ts
// Dairy (PRD M16): the MILK PROCUREMENT spine for cooperatives/MCCs. A cooperative runs Milk Collection
// Centres, enrols farmer members, defines quality-based rate cards, records twice-daily collections
// (priced float-free), and SETTLES per-cycle milk bills — paying each farmer the NET through the wallet
// boundary (tenant 'main' → farmer userMain, txnType 'milk_payment', zero-sum + idempotent — Law 2).
// Gated by the `dairy` feature flag (default OFF).
//
// SCOPE (this build): MCC centres + memberships + milk rate cards (pricing engine) + milk collections
// (partitioned) + milk bills (generate→preview→approve→pay) + the cycle-close job.
// DEFERRED (schema in 0009, not wired): BMC cold-chain units + IoT temperature watch, cooperative
// governance (share registers / resolutions / votes), D2C subscriptions + deliveries, adulteration-pattern
// scan, D2C route planning, Lactoscan analyzer ingestion, and BANK-DISBURSEMENT payout (payout_id) — the
// current settlement credits the farmer's in-platform wallet; bank withdrawal rides the payments payout path.
import { D2cDeliveryRunsCadenceJob } from './jobs/d2c-delivery-runs.cadence-job';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { Inject, OnModuleInit } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { MccController } from './controllers/v1/mcc.controller';
import { RateCardsController } from './controllers/v1/rate-cards.controller';
import { D2cController } from './controllers/v1/d2c.controller';
import { D2cService } from './services/d2c.service';
import { D2cRepository } from './repositories/d2c.repository';
import { CollectionsController } from './controllers/v1/collections.controller';
import { MilkBillsController } from './controllers/v1/milk-bills.controller';
import { MccCentreService } from './services/mcc-centre.service';
import { DairyMembershipService } from './services/dairy-membership.service';
import { MilkRateCardService } from './services/milk-rate-card.service';
import { MilkCollectionService } from './services/milk-collection.service';
import { MilkBillService } from './services/milk-bill.service';
import { MccCentreRepository } from './repositories/mcc-centre.repository';
import { DairyMembershipRepository } from './repositories/dairy-membership.repository';
import { MilkRateCardRepository } from './repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from './repositories/milk-collection.repository';
import { MilkBillRepository } from './repositories/milk-bill.repository';
// PC-56 TENANT-6a · W167's counter board (the first read of a DAY's collections this platform has ever had).
import { DairyCounterController } from './controllers/v1/dairy-counter.controller';
import { DairyCounterReadModel } from './read-models/dairy-counter.read-model';
import { DairyCounterRepository } from './repositories/dairy-counter.repository';
// PC-56 TENANT-6b-1 · W168's flag protocol: the pour-level HOLD, its review record, and the premium band the pricing
// engine now reads. NOT gated by the quality-desk flag — the hold is a money path, not a screen.
import { QualityReviewsController } from './controllers/v1/quality-reviews.controller';
import { MilkQualityService } from './services/milk-quality.service';
import { MilkQualityReviewRepository } from './repositories/milk-quality-review.repository';
// PC-56 TENANT-6b-2 · W168's desk itself — a pure read over 6b-1's writes.
import { DairyQualityController } from './controllers/v1/dairy-quality.controller';
import { DairyQualityReadModel } from './read-models/dairy-quality.read-model';
import { DairyQualityRepository } from './repositories/dairy-quality.repository';

// The cycle-close worker job (jobs/milk-bill-cycle-close.job.ts) is instantiated by apps/worker with a
// privileged kv_relay Pool — not a DI provider (it takes a Pool), mirroring the other batch jobs.
@Module({
  controllers: [MccController, RateCardsController, CollectionsController, MilkBillsController, D2cController, DairyCounterController, QualityReviewsController, DairyQualityController],
  providers: [
    MccCentreService, DairyMembershipService, MilkRateCardService, MilkCollectionService, MilkBillService,
    MccCentreRepository, DairyMembershipRepository, MilkRateCardRepository, MilkCollectionRepository, MilkBillRepository, D2cService, D2cRepository,
    { provide: D2cDeliveryRunsCadenceJob,
      // Every 30 minutes: frequent enough that a new subscription gets today's drop quickly, cheap because
      // the DB's unique index makes every re-run a no-op (0085).
      useFactory: (uow: UnitOfWork, repo: D2cRepository) => new D2cDeliveryRunsCadenceJob(30 * 60_000, uow, repo),
      inject: [UNIT_OF_WORK, D2cRepository] },
    // PC-56 TENANT-6a
    DairyCounterRepository, DairyCounterReadModel,
    // PC-56 TENANT-6b-1
    MilkQualityService, MilkQualityReviewRepository,
    // PC-56 TENANT-6b-2
    DairyQualityRepository, DairyQualityReadModel,
  ],
  exports: [MccCentreService, DairyMembershipService, MilkRateCardService, MilkCollectionService, MilkBillService, MilkQualityService],
})
export class DairyModule implements OnModuleInit {
  constructor(
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly deliveryRuns: D2cDeliveryRunsCadenceJob,
  ) {}
  onModuleInit(): void { this.jobs.register(this.deliveryRuns); }
}
