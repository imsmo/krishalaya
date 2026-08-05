// modules/ambassadors/ambassadors.module.ts
// Ambassadors (PRD §16.10 + Ambassador Brochure) — the village field-agent / referral growth engine.
// An admin enrolls ambassadors (profiles, tiers, mentor hierarchy). Anyone can mint a referral code; a new user
// claims it; an admin activates the referral → if the referrer is an ambassador, an onboarding commission
// accrues. Sales by referred farmers accrue a sale commission (OrderCompletedHandler). Earnings are ledgered in
// ambassador_earnings (no wallet) and SETTLED weekly: one ZERO-SUM 'commission' wallet transfer per ambassador
// (platform Fees → ambassador userMain, idempotent — Law 2/3/4). Gated by the `ambassadors` flag (default OFF).
//
// SCOPE: profiles + commission-plan resolution (7 seeded streams as data) + referrals (create/claim/activate) +
// earning accrual (onboarding + sale, idempotent) + weekly payout. DEFERRED: milestone-bonus + 60-day
// inactivity-reassignment jobs; AePS/kiosk operations; stipend disbursement; tier auto-promotion.
import { Module, OnModuleInit, Inject } from '@nestjs/common';
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
import { AmbassadorProfileRepository } from './repositories/ambassador-profile.repository';
import { CommissionPlanRepository } from './repositories/commission-plan.repository';
import { AmbassadorEarningRepository } from './repositories/ambassador-earning.repository';
import { ReferralRepository } from './repositories/referral.repository';
import { AmbassadorVisitRepository } from './repositories/ambassador-visit.repository';
import { AmbassadorTargetRepository } from './repositories/ambassador-target.repository';
import { OrderCompletedHandler } from './events/handlers/order-completed.handler';

@Module({
  imports: [IdentityModule, ListingsModule],   // ConsentService + UserService (assisted onboarding) + ListingService (on-behalf listing) — Law 11 reuse
  controllers: [AmbassadorsController, ReferralsController, EarningsController, FieldOpsController, AepsController],
  providers: [
    AmbassadorProfileService, CommissionPlanService, ReferralService, AmbassadorEarningService,
    AssistedOnboardingService, AmbassadorVisitService, AmbassadorTargetService, OnBehalfListingService, docExtractionProvider, LeaderboardReadModel,
    AmbassadorProfileRepository, CommissionPlanRepository, AmbassadorEarningRepository, ReferralRepository,
    AmbassadorVisitRepository, AmbassadorTargetRepository, AepsService, AepsEventRepository],
  exports: [AmbassadorEarningService],
})
export class AmbassadorsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly referrals: ReferralRepository,
    private readonly profiles: AmbassadorProfileRepository,
    private readonly earnings: AmbassadorEarningService,
  ) {}
  // Referred-seller sale commission: consume orders.order_completed and accrue to the referring ambassador.
  onModuleInit(): void {
    this.registry.register(new OrderCompletedHandler(this.referrals, this.profiles, this.earnings));
  }
}
