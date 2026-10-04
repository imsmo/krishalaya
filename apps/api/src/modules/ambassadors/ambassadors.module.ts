// modules/ambassadors/ambassadors.module.ts
// Ambassadors (PRD §16.10 + Ambassador Brochure) — the village field-agent / referral growth engine.
// An admin enrolls ambassadors (profiles, tiers, mentor hierarchy). Anyone can mint a referral code; a new user
// claims it; an admin activates the referral → if the referrer is an ambassador, an onboarding commission
// accrues. Sales by referred farmers accrue a sale commission (OrderCompletedHandler). Earnings are ledgered in
// ambassador_earnings (no wallet) and SETTLED weekly: one ZERO-SUM 'commission' wallet transfer per ambassador
// (platform Fees → ambassador userMain, idempotent — Law 2/3/4). Gated by the `ambassadors` flag (default OFF).
//
// SCOPE: profiles + commission-plan resolution (7 seeded streams as data) + referrals (create/claim/activate) +
// earning accrual (onboarding + sale, idempotent) + the WEEKLY RUN (PC-56 TENANT-SW-b: prepared Thursday 23:00 IST, confirmed by a
// second tenant_admin, paid from the TENANT Main wallet, commission + the monthly stipend). DEFERRED: milestone-bonus + 60-day
// inactivity-reassignment jobs; AePS/kiosk operations; tier auto-promotion; coupling the run to the dairy cycle (refused by name).
//
// PC-56 TENANT-10a — two module-level facts:
//   • CONTROLLER ORDER IS ROUTE ORDER. Express matches in registration order, and AmbassadorsController owns the
//     parametric `GET /ambassadors/:id` and `POST /ambassadors/:id/...`. Registered FIRST (as it was), `:id` swallowed
//     `GET /ambassadors/leaderboard`, `/visits`, `/referrals`, `/targets/me` and `/aeps/events` — the leaderboard answered
//     403 to every ambassador (and a manager's request died on a uuid cast). It is registered LAST; the
//     `tenant10a-routes.spec.ts` gate walks the real metadata and fails if any earlier parametric route can shadow a
//     later static one.
//   • THE SALE-COMMISSION HANDLER RUNS ON kv_app (F-27) — see order-completed.handler.ts.
import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { OnBehalfListingService } from './services/on-behalf-listing.service';
import { docExtractionProvider } from './gateway/doc-extraction.provider';
import { AmbassadorsController } from './controllers/v1/ambassadors.controller';
import { AepsController } from './controllers/v1/aeps.controller';
import { AepsService } from './services/aeps.service';
import { AepsEventRepository } from './repositories/aeps-event.repository';
import { ReferralsController } from './controllers/v1/referrals.controller';
import { EarningsController } from './controllers/v1/earnings.controller';
import { FieldOpsController } from './controllers/v1/field-ops.controller';
import { AmbassadorProfileService } from './services/ambassador-profile.service';
import { CommissionPlanService } from './services/commission-plan.service';
import { ReferralService } from './services/referral.service';
import { AmbassadorEarningService } from './services/ambassador-earning.service';
import { AssistedOnboardingService } from './services/assisted-onboarding.service';
import { AmbassadorVisitService } from './services/ambassador-visit.service';
import { AmbassadorTargetService } from './services/ambassador-target.service';
import { LeaderboardReadModel } from './read-models/leaderboard.read-model';
import { AmbassadorRosterReadModel } from './read-models/ambassador-roster.read-model';
import { ReferralDeskReadModel } from './read-models/referral-desk.read-model';
import { AmbassadorProfileRepository } from './repositories/ambassador-profile.repository';
import { CommissionPlanRepository } from './repositories/commission-plan.repository';
import { AmbassadorEarningRepository } from './repositories/ambassador-earning.repository';
import { ReferralRepository } from './repositories/referral.repository';
import { AmbassadorVisitRepository } from './repositories/ambassador-visit.repository';
import { AmbassadorTargetRepository } from './repositories/ambassador-target.repository';
import { OrderCompletedHandler } from './events/handlers/order-completed.handler';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { FlagsService } from '../../core/feature-flags/flags.service';
import { PayoutRunsController } from './controllers/v1/payout-runs.controller';
import { PayoutRunService } from './services/payout-run.service';
import { PayoutRunRepository } from './repositories/payout-run.repository';
import { AmbassadorMessageService } from './services/ambassador-message.service';
import { AmbassadorPayoutRunJob } from './jobs/payout-run.job';

@Module({
  imports: [IdentityModule, ListingsModule],   // ConsentService + UserService (assisted onboarding) + ListingService (on-behalf listing) — Law 11 reuse
  // PC-56 TENANT-SW-b: PayoutRunsController (`ambassadors/payout-runs`) is a static prefix — registered BEFORE AmbassadorsController (`:id`).
  controllers: [ReferralsController, EarningsController, FieldOpsController, AepsController, PayoutRunsController, AmbassadorsController],
  providers: [
    AmbassadorProfileService, CommissionPlanService, ReferralService, AmbassadorEarningService,
    AssistedOnboardingService, AmbassadorVisitService, AmbassadorTargetService, OnBehalfListingService, docExtractionProvider, LeaderboardReadModel, AmbassadorRosterReadModel, ReferralDeskReadModel,
    AmbassadorProfileRepository, CommissionPlanRepository, AmbassadorEarningRepository, ReferralRepository,
    AmbassadorVisitRepository, AmbassadorTargetRepository, AepsService, AepsEventRepository,
    // PC-56 TENANT-SW-b · A — the weekly run (tenant wallet, maker-checker), its Thursday 23:00 IST preparer, the W160 message act
    PayoutRunService, PayoutRunRepository, AmbassadorMessageService,
    { provide: AmbassadorPayoutRunJob, inject: [PayoutRunService, FlagsService],
      useFactory: (runs: PayoutRunService, flags: FlagsService) => new AmbassadorPayoutRunJob(15 * 60_000, runs, (tenantId) => flags.isEnabled('ambassadors', { tenantId })) }],
  exports: [AmbassadorEarningService],
})
export class AmbassadorsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly referrals: ReferralRepository,
    private readonly profiles: AmbassadorProfileRepository,
    private readonly earnings: AmbassadorEarningService,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly runJob: AmbassadorPayoutRunJob,
  ) {}
  // Referred-seller sale commission: consume orders.order_completed and accrue to the referring ambassador.
  onModuleInit(): void {
    this.registry.register(new OrderCompletedHandler(this.uow, this.referrals, this.profiles, this.earnings));
    // PC-56 TENANT-SW-b: the Thursday 23:00 IST weekly-run PREPARER (kv_app UoW per tenant; it never pays — a checker confirms)
    this.jobs.register(this.runJob);
  }
}
