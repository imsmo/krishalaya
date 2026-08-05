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

// The cycle-close worker job (jobs/milk-bill-cycle-close.job.ts) is instantiated by apps/worker with a
// privileged kv_relay Pool — not a DI provider (it takes a Pool), mirroring the other batch jobs.
@Module({
  controllers: [MccController, RateCardsController, CollectionsController, MilkBillsController, D2cController],
  providers: [
    MccCentreService, DairyMembershipService, MilkRateCardService, MilkCollectionService, MilkBillService,
    MccCentreRepository, DairyMembershipRepository, MilkRateCardRepository, MilkCollectionRepository, MilkBillRepository, D2cService, D2cRepository],
  exports: [MccCentreService, DairyMembershipService, MilkRateCardService, MilkCollectionService, MilkBillService],
})
export class DairyModule {}
