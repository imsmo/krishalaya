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
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
// PC-56 TENANT-SW-d · the AGM pack (W199 + W2473–W2477: immutable, from facts, maker-checker, PDF + dataset, public verify) and the
// share-register import (W2626–W2628: consent evidence + checker + an idempotent apply job).
import { MediaModule } from '../../core/media/media.module';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { DATASET_REGISTRY, DatasetRegistry } from '../../core/exports-plane/dataset.registry';
import { AgmPacksController, VerifyAgmController } from './controllers/v1/agm-packs.controller';
import { RegisterImportsController } from './controllers/v1/register-imports.controller';
import { AgmPackService } from './services/agm-pack.service';
import { AgmPackRepository } from './repositories/agm-pack.repository';
import { RegisterImportService } from './services/register-import.service';
import { RegisterImportRepository } from './repositories/register-import.repository';
import { AgmPackDataset } from './exports/agm-pack.dataset';
import { AgmPackRenderJob } from './jobs/agm-pack-render.job';
import { RegisterImportApplyJob } from './jobs/register-import-apply.job';

// The expiry worker job (jobs/membership-renewals.job.ts) is instantiated by apps/worker with a
// privileged kv_relay Pool — not a DI provider (it takes a Pool), mirroring the other expiry jobs.
@Module({
  imports: [MediaModule],
  controllers: [MembershipTiersController, MembershipsController, GovernanceController, AgmPacksController, VerifyAgmController, RegisterImportsController],
  providers: [MembershipTierService, UserMembershipService, MembershipTierRepository, UserMembershipRepository,
    MembershipPaymentSucceededHandler, GovernanceService, GovernanceRepository, ShareRegisterReadModel, CoopPayoutService, CoopPayoutRepository,
    // [PC-56 TENANT-9b] the outcome words a resolution notice is worded with (ui_messages, seed 0020).
    UiMessageRepository,
    // PC-56 TENANT-SW-d
    AgmPackService, AgmPackRepository, RegisterImportService, RegisterImportRepository, AgmPackDataset,
    { provide: AgmPackRenderJob, inject: [AgmPackService], useFactory: (s: AgmPackService) => new AgmPackRenderJob(60_000, s) },
    { provide: RegisterImportApplyJob, inject: [RegisterImportService], useFactory: (s: RegisterImportService) => new RegisterImportApplyJob(60_000, s) }],
  exports: [MembershipTierService, UserMembershipService],
})
export class MembershipsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly paymentSucceeded: MembershipPaymentSucceededHandler,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    @Inject(DATASET_REGISTRY) private readonly datasets: DatasetRegistry,
    private readonly agmRender: AgmPackRenderJob,
    private readonly importApply: RegisterImportApplyJob,
    private readonly agmDataset: AgmPackDataset,
  ) {}
  // activate/confirm a gateway-paid subscription when its payment settles (payments.payment_succeeded)
  onModuleInit(): void {
    this.registry.register(this.paymentSucceeded);
    // PC-56 TENANT-SW-d: the confirmed pack is issued (PDF, sha256, dataset) and the confirmed import is applied ONLY because these run;
    // registered unconditionally (a confirmed pack sitting "issuing" for ever would make the console's "being issued" false).
    this.jobs.register(this.agmRender);
    this.jobs.register(this.importApply);
    this.datasets.register(this.agmDataset);
  }
}
