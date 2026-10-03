// modules/identity/identity.module.ts
// Wires the identity bounded context. Core auth/RBAC/audit services are provided
// globally by CoreModule and injected by token/class. Other modules depend only on
// the public services exported here (Law 11: never on repositories).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AppConfig } from '../../core/config/app-config';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';

// Controllers (HTTP edge)
import { AuthController } from './controllers/v1/auth.controller';
import { UsersController } from './controllers/v1/users.controller';
import { RolesController } from './controllers/v1/roles.controller';
import { OnboardingController } from './controllers/v1/onboarding.controller';
import { KycController } from './controllers/v1/kyc.controller';
import { KycDeskController } from './controllers/v1/kyc-desk.controller';
import { KycDeskService } from './services/kyc-desk.service';
import { KycDeskReadModel } from './read-models/kyc-desk.read-model';
import { KycDocumentExpiryJob } from './jobs/kyc-document-expiry.job';
import { KycDocumentExpiryCadenceJob } from './jobs/kyc-document-expiry.cadence-job';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { MediaModule } from '../../core/media/media.module';
import { AddressesController } from './controllers/v1/addresses.controller';
import { BankAccountsController } from './controllers/v1/bank-accounts.controller';
import { ConsentsController } from './controllers/v1/consents.controller';

// Services
import { AuthService } from './services/auth.service';
import { UserService } from './services/user.service';
import { UserTenantRoleService } from './services/user-tenant-role.service';
import { OnboardingService } from './services/onboarding.service';
import { RoleService } from './services/role.service';
import { PermissionService } from './services/permission.service';
import { KycDocumentService } from './services/kyc-document.service';
import { EkycService } from './services/ekyc.service';
import { BusinessKycService } from './services/business-kyc.service';
import { ekycProviderProvider } from './gateway/ekyc-provider.provider';
import { fundAccountTokeniserProvider } from './gateway/fund-account-tokeniser.provider';
import { AddressService } from './services/address.service';
import { BankAccountService } from './services/bank-account.service';
import { ConsentService } from './services/consent.service';
import { SessionService } from './services/session.service';
import { PrivacyService } from './services/privacy.service';
import { ChangePhoneService } from './services/change-phone.service';
import { PrivacyController } from './controllers/v1/privacy.controller';

// Repositories
import { MemberRosterReadModel } from './read-models/member-roster.read-model';
import { MemberDetailReadModel } from './read-models/member-detail.read-model';
import { MemberPiiService } from './services/member-pii.service';
import { MemberSuspensionService } from './services/member-suspension.service';
import { Farmer360Service } from './services/farmer-360.service';
import { Farmer360ReadModel } from './read-models/farmer-360.read-model';
import { MemberBulkApplier } from './bulk/member-bulk-applier';
import { BULK_APPLIER_REGISTRY, BulkApplierRegistry } from '../../core/bulk/bulk-applier.registry';
import { MemberSuspensionRepository } from './repositories/member-suspension.repository';
import { MemberRosterController } from './controllers/v1/member-roster.controller';
import { UserRepository } from './repositories/user.repository';
import { RoleRepository } from './repositories/role.repository';
import { PermissionRepository } from './repositories/permission.repository';
import { UserTenantRoleRepository } from './repositories/user-tenant-role.repository';
import { KycDocumentRepository } from './repositories/kyc-document.repository';
import { BusinessKycRepository } from './repositories/business-kyc.repository';
import { EkycSessionRepository } from './repositories/ekyc-session.repository';
import { AddressRepository } from './repositories/address.repository';
import { BankAccountRepository } from './repositories/bank-account.repository';
import { DeviceRepository } from './repositories/device.repository';
import { SessionRepository } from './repositories/session.repository';
import { LoginEventRepository } from './repositories/login-event.repository';
import { ConsentRepository } from './repositories/consent.repository';
import { DataSubjectRequestRepository } from './repositories/data-subject-request.repository';
import { RiskScoreRepository } from './repositories/risk-score.repository';

// Event handlers + jobs (run in worker; registered so DI resolves their deps)
import { OrderCompletedHandler } from './events/handlers/order-completed.handler';
import { DisputeResolvedHandler } from './events/handlers/dispute-resolved.handler';
import { KycExpiryRemindersJob } from './jobs/kyc-expiry-reminders.job';
import { KycExpiryRemindersCadenceJob } from './jobs/kyc-expiry-reminders.cadence-job';
import { DpdpErasureCoolingJob } from './jobs/dpdp-erasure-cooling.job';
import { RiskScoreRecomputeJob } from './jobs/risk-score-recompute.job';
// PC-56 TENANT-13b · desks (F-18): the board, proposals (maker ≠ checker by trigger), members, and the 7-day expiry.
import { DesksController } from './controllers/v1/desks.controller';
import { DeskService } from './services/desk.service';
import { DeskRepository } from './repositories/desk.repository';
import { DeskProposalsExpiryJob } from './jobs/desk-proposals-expiry.job';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';

@Module({
  // PC-56 TENANT-4d-1: UserTenantRoleService asks tenancy's PUBLIC PlanUsageService whether a seat is free
  // before attaching a NEW member (W118's "at 100% new additions pause"). Module blueprint: a module may use
  // another's public service, never its repositories. forwardRef because TenancyModule's signup path already
  // reaches back into identity's AuthService (see the note below), so the two are mutually dependent.
  imports: [forwardRef(() => TenancyModule), MediaModule],   // PC-56 TENANT-9a: the reveal mints core/media's signed read
  controllers: [AuthController, UsersController, RolesController, OnboardingController, KycController, KycDeskController, AddressesController, BankAccountsController, ConsentsController, PrivacyController, MemberRosterController, DesksController],
  providers: [
    AuthService, UserService, UserTenantRoleService, OnboardingService, RoleService, PermissionService,
    KycDocumentService, EkycService, BusinessKycService, AddressService, BankAccountService, ConsentService, SessionService, PrivacyService, ChangePhoneService,
    ekycProviderProvider,
    fundAccountTokeniserProvider,
    MemberRosterReadModel, MemberDetailReadModel, MemberPiiService,
    MemberSuspensionService, MemberSuspensionRepository,
    Farmer360Service, Farmer360ReadModel,
    MemberBulkApplier,
    UserRepository, RoleRepository, PermissionRepository, UserTenantRoleRepository, KycDocumentRepository, BusinessKycRepository, EkycSessionRepository,
    AddressRepository, BankAccountRepository, DeviceRepository, SessionRepository, LoginEventRepository,
    ConsentRepository, DataSubjectRequestRepository, RiskScoreRepository,
    OrderCompletedHandler, DisputeResolvedHandler,
    KycExpiryRemindersJob, DpdpErasureCoolingJob, RiskScoreRecomputeJob,
    // PC-56 TENANT-9a · the KYC desk, its read model, the words its notices carry, and the expiry job (F-3).
    KycDeskService, KycDeskReadModel, UiMessageRepository, KycDocumentExpiryJob,
    DeskService, DeskRepository,
    { provide: DeskProposalsExpiryJob, inject: [UNIT_OF_WORK, DeskRepository, DeskService],
      useFactory: (u: UnitOfWork, r: DeskRepository, s: DeskService) => new DeskProposalsExpiryJob(60 * 60_000, u, r, s) },
    {
      provide: KycDocumentExpiryCadenceJob,
      useFactory: (config: AppConfig, job: KycDocumentExpiryJob) => new KycDocumentExpiryCadenceJob(config.jobs.kycExpiryReminders.intervalMs, job),
      inject: [AppConfig, KycDocumentExpiryJob],
    },
    {
      // KV-BL-P0-9-follow-on: the nightly KYC-expiry-reminders cadence job (core/jobs/jobs.runner.ts
      // hosts it; this factory just supplies the configured interval — see AppConfig.jobs.kycExpiryReminders).
      // Mirrors PaymentsModule's SettlementStatementsCadenceJob provider exactly.
      provide: KycExpiryRemindersCadenceJob,
      useFactory: (config: AppConfig, job: KycExpiryRemindersJob) =>
        new KycExpiryRemindersCadenceJob(config.jobs.kycExpiryReminders.intervalMs, job),
      inject: [AppConfig, KycExpiryRemindersJob],
    },
  ],
  // public surface for other modules (Law 11): services + cross-module event handlers + jobs
  exports: [
    // PC-56 TENANT-1d-3a: TenancyModule's self-serve signup opens the first session through AuthService rather than
    // minting tokens a second way.
    AuthService, UserRepository,
    UserService, ConsentService, UserTenantRoleService, RoleService, PermissionService, KycDocumentService,
    OrderCompletedHandler, DisputeResolvedHandler,
    KycExpiryRemindersJob, DpdpErasureCoolingJob, RiskScoreRecomputeJob,
  ],
})
export class IdentityModule implements OnModuleInit {
  constructor(
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobRegistry: ScheduledJobRegistry,
    private readonly config: AppConfig,
    private readonly kycExpiryRemindersCadenceJob: KycExpiryRemindersCadenceJob,
    private readonly kycDocumentExpiryCadenceJob: KycDocumentExpiryCadenceJob,
    @Inject(BULK_APPLIER_REGISTRY) private readonly bulkRegistry: BulkApplierRegistry,
    private readonly memberApplier: MemberBulkApplier,
    private readonly deskExpiry: DeskProposalsExpiryJob,
  ) {}
  onModuleInit(): void {
    // per-job env gate (KYC_EXPIRY_JOB_ENABLED), independent of the runner-wide JOBS_ENABLED kill-switch
    if (this.config.jobs.kycExpiryReminders.enabled) this.jobRegistry.register(this.kycExpiryRemindersCadenceJob);
    // PC-56 TENANT-9a (F-3): `expired` is WRITTEN — the same env gate as the reminders (one KYC clock, one switch).
    if (this.config.jobs.kycExpiryReminders.enabled) this.jobRegistry.register(this.kycDocumentExpiryCadenceJob);
    // PC-56 TENANT-1b-4: the 'members' importer W156 needs. Registered here in the module that OWNS users and roles —
    // core/bulk stays generic plumbing and never learns what a member is (the same contract catalogue's 'products'
    // applier follows). Before this line, `importType: 'members'` was a 422 and the whole screen pointed at nothing.
    this.bulkRegistry.register(this.memberApplier);
    // PC-56 TENANT-13b: a desk proposal nobody confirmed in 7 days expires (registered unconditionally, the 11b pattern).
    this.jobRegistry.register(this.deskExpiry);
  }
}
