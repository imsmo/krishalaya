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
import { DairyNoticeVarsService } from './services/dairy-notice-vars.service';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { LookupsModule } from '../lookups/lookups.module';
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
import { DairyInsightsReadModel } from './read-models/dairy-insights.read-model';
// PC-56 TENANT-6c-6 · W169's own console: the register, its tiles, and every act's refusal.
import { DairyCycleConsoleReadModel } from './read-models/dairy-cycle-console.read-model';
import { DairyCycleConsoleRepository } from './repositories/dairy-cycle-console.repository';
// PC-56 TENANT-6d-1 · W170 · the tank. `bmc_units` has been in the schema since 0009 with no code at all; these are
// its first repository, service, reading path, read-model and routes. `LogisticsModule` is imported for ONE public
// service — `ColdChainService.appendForOwner` — because `cold_chain_logs` is logistics' table and there is exactly one
// writer of it (CLAUDE.md's module rule), and for `OpsAlertRepository`'s rule list, which is how the monitor can say
// WHO would be phoned about a warm tank.
import { LogisticsModule } from '../logistics/logistics.module';
import { BmcUnitRepository } from './repositories/bmc-unit.repository';
// PC-56 TENANT-6d-2 · W171's board, its custody register and the reads behind them.
import { MccConsoleRepository } from './repositories/mcc-console.repository';
import { MccOperatorAssignmentRepository } from './repositories/mcc-operator-assignment.repository';
import { DairyCentresReadModel } from './read-models/dairy-centres.read-model';
// PC-56 TENANT-6d-3 · W171's move, and the route history that keeps it honest.
import { DairyMembershipRouteRepository } from './repositories/dairy-membership-route.repository';
import { DairyMembershipMoveService } from './services/dairy-membership-move.service';
import { BmcUnitService } from './services/bmc-unit.service';
import { BmcReadingService } from './services/bmc-reading.service';
import { DairyBmcReadModel } from './read-models/dairy-bmc.read-model';
import { BmcController } from './controllers/v1/bmc.controller';
import { DairyQualityRepository } from './repositories/dairy-quality.repository';
import { DairyInsightsRepository } from './repositories/dairy-insights.repository';
// PC-56 TENANT-6c-1 · W169's cycle: the noun this platform did not have, and the cadence job that fills it.
import { DairyCycleCloseCadenceJob } from './jobs/dairy-cycle-close.cadence-job';
import { DairyBillCycleService } from './services/dairy-bill-cycle.service';
import { DairyBillCycleRepository } from './repositories/dairy-bill-cycle.repository';
import { FlagsService } from '../../core/feature-flags/flags.service';
// PC-56 TENANT-6c-2 · W169's preview act, the member's dispute and the void that makes an upheld one actionable.
import { BillCyclesController } from './controllers/v1/bill-cycles.controller';
import { BillDisputesController } from './controllers/v1/bill-disputes.controller';
import { MilkBillDisputeService } from './services/milk-bill-dispute.service';
import { MilkBillDisputeRepository } from './repositories/milk-bill-dispute.repository';
// PC-56 TENANT-6c-4 · the deduction's DESTINATION: the vocabulary, the line, the feed credit it pays, the member's
// fresh consent above 25%, and the applier that posts each line in the payment's own transaction.
//
// `FintechModule` is imported for ONE public service method — `LoanService.applyMilkBillDeduction` — because
// `REPAYMENT_STYLES` has included `milk_bill_deduction` since the fintech module was written and nothing implemented
// it. A repository is never crossed: the loan's invariants stay with the module that owns them (CLAUDE.md).
import { FintechModule } from '../fintech/fintech.module';
import { MemberCreditsController } from './controllers/v1/member-credits.controller';
import { DairyMemberCreditService } from './services/dairy-member-credit.service';
import { DairyMemberCreditRepository } from './repositories/dairy-member-credit.repository';
import { MilkBillDeductionService } from './services/milk-bill-deduction.service';
import { MilkBillDeductionRepository } from './repositories/milk-bill-deduction.repository';
import { MilkBillDeductionConsentService } from './services/milk-bill-deduction-consent.service';
import { MilkBillDeductionConsentRepository } from './repositories/milk-bill-deduction-consent.repository';
import { DairyDeductionTypeRepository } from './repositories/dairy-deduction-type.repository';
// PC-56 TENANT-6c-5 · the STANDING INSTRUCTION W169 contrasts fresh consent against, and the cycle pass that acts on
// it. 6c-4 left this named: the cadence passed `deductions: []`, so the canon's "₹1,84,300 this cycle" was zero on
// the automatic path.
import { DeductionInstructionsController } from './controllers/v1/deduction-instructions.controller';
import { DairyDeductionInstructionService } from './services/dairy-deduction-instruction.service';
import { DairyDeductionInstructionRepository } from './repositories/dairy-deduction-instruction.repository';
import { DairyDeductionAssemblerService } from './services/dairy-deduction-assembler.service';
import { CommunicationModule } from '../communication/communication.module';
import { BmcCallService } from './services/bmc-call.service';
import { DiversionsController } from './controllers/v1/diversions.controller';
import { DairyInsightsController } from './controllers/v1/dairy-insights.controller';
import { DairyDiversionService } from './services/dairy-diversion.service';
import { DairyDiversionRepository } from './repositories/dairy-diversion.repository';

// [PC-56 TENANT-6c-1] What used to stand here said the cycle-close job "is instantiated by apps/worker with a
// privileged kv_relay Pool". APPS/WORKER INSTANTIATED NOTHING OF THE KIND, and could not have: its JOBS registry is
// pg-native by contract (WORKER-RUNTIME.md, "Deferred: domain-handler jobs") and generating a milk bill needs this
// module's unit of work, outbox and idempotency. The comment was the only thing keeping the job's absence invisible.
// It now runs through core/jobs/jobs.runner.ts, registered below beside the D2C cadence job — the pattern this file
// already used for the one job it did wire.
@Module({
  // PC-56 TENANT-6d-5 · CommunicationModule for `MaskedCallService` — W170's *"Call MCC-AND-03 operator"* is a
  // privacy-proxy call, and the module that owns telephony owns it. CLAUDE.md's rule holds: a module's PUBLIC SERVICE
  // (exported here) or its events, never its repositories. No cycle — CommunicationModule imports nothing.
  // [PC-56 TENANT-6d-7] `LookupsModule` for the deduction vocabulary in three languages — its PUBLIC service, per
  // CLAUDE.md's rule that a module reaches another module through its service and never its repositories.
  imports: [FintechModule, LogisticsModule, CommunicationModule, LookupsModule],
  controllers: [MccController, RateCardsController, CollectionsController, MilkBillsController, D2cController, DairyCounterController, QualityReviewsController, DairyQualityController,
    // PC-56 TENANT-6c-2
    BillCyclesController, BillDisputesController,
    // PC-56 TENANT-6c-4
    MemberCreditsController,
    // PC-56 TENANT-6c-5
    DeductionInstructionsController,
    // PC-56 TENANT-6d-1 · W170
    BmcController,
    // PC-56 TENANT-6d-6 · W170's playbook step 2
    DiversionsController, DairyInsightsController],
  providers: [
    MccCentreService, DairyMembershipService, MilkRateCardService, MilkCollectionService, MilkBillService,
    MccCentreRepository, DairyMembershipRepository, MilkRateCardRepository, MilkCollectionRepository, MilkBillRepository, D2cService, D2cRepository,
    // PC-56 TENANT-6c-1
    DairyBillCycleRepository, DairyBillCycleService,
    { provide: DairyCycleCloseCadenceJob,
      // Hourly. A cycle shuts at local midnight and W169 promises members see their bill "Thu morning", so an hour of
      // lag is invisible to the people waiting and the sweep stays proportional to the number of dairy tenants.
      useFactory: (cycles: DairyBillCycleService, flags: FlagsService) => new DairyCycleCloseCadenceJob(60 * 60_000, cycles, flags),
      inject: [DairyBillCycleService, FlagsService] },
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
    // [PC-56 TENANT-6e-1] W172's derived read plane. No service: it decides nothing and writes nothing.
    DairyInsightsRepository, DairyInsightsReadModel,
    // PC-56 TENANT-6c-2
    MilkBillDisputeRepository, MilkBillDisputeService,
    // PC-56 TENANT-6c-4
    DairyMemberCreditRepository, DairyMemberCreditService,
    MilkBillDeductionRepository, MilkBillDeductionService,
    MilkBillDeductionConsentRepository, MilkBillDeductionConsentService,
    DairyDeductionTypeRepository,
    // PC-56 TENANT-6c-5
    DairyDeductionInstructionRepository, DairyDeductionInstructionService, DairyDeductionAssemblerService,
    // PC-56 TENANT-6c-6
    DairyCycleConsoleRepository, DairyCycleConsoleReadModel,
    // PC-56 TENANT-6d-1
    BmcUnitRepository, BmcUnitService, BmcReadingService, BmcCallService, DairyBmcReadModel, DairyDiversionRepository, DairyDiversionService,
    MccConsoleRepository, MccOperatorAssignmentRepository, DairyCentresReadModel,
    DairyMembershipRouteRepository, DairyMembershipMoveService,
    // PC-56 TENANT-6d-7 · THE WORDS THAT NEVER ARRIVED. `UiMessageRepository` is core (platform vocabulary, no tenant
    // column) and is provided here because this is its first caller on the server — `ui_messages` has existed since
    // 0001 with no reader at all.
    UiMessageRepository, DairyNoticeVarsService,
  ],
  exports: [MccCentreService, DairyMembershipService, MilkRateCardService, MilkCollectionService, MilkBillService, MilkQualityService, DairyBillCycleService, MilkBillDisputeService,
    // PC-56 TENANT-6c-4
    DairyMemberCreditService, MilkBillDeductionConsentService,
    // PC-56 TENANT-6c-5
    DairyDeductionInstructionService],
})
export class DairyModule implements OnModuleInit {
  constructor(
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly deliveryRuns: D2cDeliveryRunsCadenceJob,
    private readonly cycleClose: DairyCycleCloseCadenceJob,
  ) {}
  onModuleInit(): void {
    this.jobs.register(this.deliveryRuns);
    // PC-56 TENANT-6c-1: the registration whose absence made "312 bills in draft" mean zero bills, on every tenant.
    this.jobs.register(this.cycleClose);
  }
}
