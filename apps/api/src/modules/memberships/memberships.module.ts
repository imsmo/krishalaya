// modules/memberships/memberships.module.ts
// Memberships (PRD M13): subscription tiers (free or wallet-paid) with a benefits bundle, and user
// subscriptions. Tier admin (membership.manage) + self-serve subscribe/renew/cancel. Paid tiers DEBIT the
// wallet (userMain → platform fees) via the wallet boundary (Law 2); free tiers move no money. Gated by
// the `memberships` feature flag (default OFF).
//
// SCOPE: this build ships the tier + subscription engine (wallet-paid) PLUS the card/gateway-payment
// activation path (payment intent → payments.payment_succeeded[referenceType 'membership'] →
// confirm/activate) via MembershipPaymentSucceededHandler. Auto-renew (stored-mandate wallet auto-debit)
// and the charge-engine member-fee override are deferred.
import { CoopPayoutService } from './services/coop-payout.service';
import { CoopPayoutRepository } from './repositories/coop-payout.repository';
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { MembershipTiersController } from './controllers/v1/membership-tiers.controller';
import { MembershipsController } from './controllers/v1/memberships.controller';
import { GovernanceController } from './controllers/v1/governance.controller';
import { GovernanceService } from './services/governance.service';
import { GovernanceRepository } from './repositories/governance.repository';
import { ShareRegisterReadModel } from './read-models/share-register.read-model';
import { MembershipTierService } from './services/membership-tier.service';
import { UserMembershipService } from './services/user-membership.service';
import { MembershipTierRepository } from './repositories/membership-tier.repository';
import { UserMembershipRepository } from './repositories/user-membership.repository';
import { MembershipPaymentSucceededHandler } from './events/handlers/payment-succeeded.handler';

// The expiry worker job (jobs/membership-renewals.job.ts) is instantiated by apps/worker with a
// privileged kv_relay Pool — not a DI provider (it takes a Pool), mirroring the other expiry jobs.
@Module({
  controllers: [MembershipTiersController, MembershipsController, GovernanceController],
  providers: [MembershipTierService, UserMembershipService, MembershipTierRepository, UserMembershipRepository,
    MembershipPaymentSucceededHandler, GovernanceService, GovernanceRepository, ShareRegisterReadModel, CoopPayoutService, CoopPayoutRepository],
  exports: [MembershipTierService, UserMembershipService],
})
export class MembershipsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly paymentSucceeded: MembershipPaymentSucceededHandler,
  ) {}
  // activate/confirm a gateway-paid subscription when its payment settles (payments.payment_succeeded)
  onModuleInit(): void { this.registry.register(this.paymentSucceeded); }
}
