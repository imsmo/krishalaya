// modules/tenancy/tenancy.module.ts
// Tenancy (PRD §5 — the SaaS plans/subscriptions/quota foundation). Owns the GLOBAL plan catalogue
// (plans + plan_limits; platform-admin only — Law 11) and tenant SUBSCRIPTIONS: an ACTIVE subscription is
// exactly what core QuotaService resolves a tenant's plan_limits from, so building this makes quota
// enforcement real. GET /subscriptions/current is the quota dashboard (limits + current usage). Gated by
// the `tenancy` feature flag (default OFF).
//
// SCOPE: plans + subscriptions spine (quota foundation), the in-tenant SELF-SERVE plane (API-W3-05: profile/
// domains/settings + read-only features/usage), AND SaaS INVOICING (API-W3-06): the renewal billing run raises +
// issues saas_invoices, payments.payment_succeeded marks them paid, and dunning/usage worker jobs nudge tenants.
// COLLECTION / void / manual adjustment / dunning ESCALATION are god-mode and live in apps/admin-api billing-ops
// (which READS these invoices) — Law 11. Tenant LIFECYCLE (status) + feature GRANTS likewise live in tenant-ops.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { PlanUsageController } from './controllers/v1/plan-usage.controller';
import { PlanUsageRepository } from './repositories/plan-usage.repository';
import { PlanUsageService } from './services/plan-usage.service';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { PlansController } from './controllers/v1/plans.controller';
import { TenantApplicationsController } from './controllers/v1/tenant-applications.controller';
import { TenantSignupController } from './controllers/v1/tenant-signup.controller';
import { TenantSignupService } from './services/tenant-signup.service';
import { TenantSignupRepository } from './repositories/tenant-signup.repository';
import { forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { TenantApplicationService } from './services/tenant-application.service';
import { TenantApplicationRepository } from './repositories/tenant-application.repository';
import { SubscriptionsController } from './controllers/v1/subscriptions.controller';
import { TenantsController } from './controllers/v1/tenants.controller';
import { TenantSettingsController } from './controllers/v1/tenant-settings.controller';
import { AnalyticsController } from './controllers/v1/analytics.controller';
import { TenantAnalyticsService } from './services/tenant-analytics.service';
import { TenantAnalyticsReadModel } from './read-models/tenant-analytics.read-model';
import { TenantDashboardReadModel } from './read-models/tenant-dashboard.read-model';
import { GoLiveReadModel } from './read-models/go-live.read-model';
import { ConsoleHomeController } from './controllers/v1/console-home.controller';
import { PlanService } from './services/plan.service';
import { SubscriptionService } from './services/subscription.service';
import { TenantService } from './services/tenant.service';
import { TenantDomainService } from './services/tenant-domain.service';
import { SaasInvoiceService } from './services/saas-invoice.service';
import { BillingConsoleReadModel } from './read-models/billing-console.read-model';
import { SaasInvoicesController } from './controllers/v1/saas-invoices.controller';
import { PlanChangeService } from './services/plan-change.service';
import { PlanChangeRepository } from './repositories/plan-change.repository';
import { PlanCompareReadModel } from './read-models/plan-compare.read-model';
import { BillingTaxRate } from './read-models/billing-tax-rate';
import { PlanRepository } from './repositories/plan.repository';
import { SubscriptionRepository } from './repositories/subscription.repository';
import { TenantRepository } from './repositories/tenant.repository';
import { TenantDomainRepository } from './repositories/tenant-domain.repository';
import { TenantSettingsRepository } from './repositories/tenant-settings.repository';
import { TenantFeatureRepository } from './repositories/tenant-feature.repository';
import { UsageCounterRepository } from './repositories/usage-counter.repository';
import { SaasInvoiceRepository } from './repositories/saas-invoice.repository';
import { SaasInvoicePaymentHandler } from './events/handlers/payment-succeeded.handler';
import { SaasInvoicePaidHandler } from './events/handlers/saas-invoice-paid.handler';
import { SaasBillingCycleJob } from './jobs/saas-billing-cycle.job';
import { SaasBillingCycleCadenceJob } from './jobs/saas-billing-cycle.cadence-job';
// PC-56 TENANT-4d-5 · the notice plane: the enrichment service, its recipient reader, and the two producers
// 0148 named and refused to schedule until this plane existed.
import { BillingNoticeService } from './services/billing-notice.service';
import { BillingRecipientsRepository } from './repositories/billing-recipients.repository';
import { TrialExpiryJob } from './jobs/trial-expiry.job';
import { UsageLimitAlertsJob } from './jobs/usage-limit-alerts.job';
import { TrialExpiryCadenceJob, UsageLimitAlertsCadenceJob } from './jobs/tenant-notices.cadence-job';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { FlagsService } from '../../core/feature-flags/flags.service';
import { AppConfig } from '../../core/config/app-config';

// Worker jobs (grace-period, renewal-invoices, trial-expiry, usage-limit-alerts) are instantiated by apps/worker
// with the privileged kv_relay Pool — not DI providers (they take a Pool / DI service), mirroring the other jobs.
@Module({
  // IdentityModule for AuthService only: self-serve signup must open the first session through the SAME path a
  // login uses (one place mints credentials).
  // PC-56 TENANT-4d-1: identity now also asks THIS module's PlanUsageService whether a member seat is free
  // (W118's pause), so the two modules are mutually dependent and both sides use forwardRef. That is the
  // module blueprint's allowance — public service, never a repository — not an exception to it.
  imports: [forwardRef(() => IdentityModule)],
  controllers: [SaasInvoicesController, PlanUsageController, PlansController, SubscriptionsController, TenantsController, TenantSettingsController, AnalyticsController, TenantApplicationsController, ConsoleHomeController, TenantSignupController],
  providers: [
    PlanService, SubscriptionService, PlanRepository, SubscriptionRepository,
    TenantService, TenantDomainService, TenantAnalyticsService, TenantAnalyticsReadModel,
    TenantDashboardReadModel, GoLiveReadModel,
    // PC-56 TENANT-1d-2: the plane 0126 and domain/proration.ts were built for, and which nothing called.
    PlanChangeService, PlanChangeRepository, PlanCompareReadModel, BillingTaxRate,
    // PC-56 TENANT-1d-3a: the door W113 promises and the platform did not have.
    TenantSignupService, TenantSignupRepository,
    TenantRepository, TenantDomainRepository, TenantSettingsRepository, TenantFeatureRepository, UsageCounterRepository, PlanUsageRepository, PlanUsageService,
    // PC-56 TENANT-4d-2: W120 finally has a route. The read service and its repository shipped in TENANT-1
    // with no controller anywhere in apps/api — a tenant could not see a bill we raised to it.
    SaasInvoiceService, SaasInvoiceRepository, SaasInvoicePaymentHandler, BillingConsoleReadModel,
    // PC-56 TENANT-4d-4: the paid event finally has a subscriber (it rolls the billing period), and the
    // billing cycle finally has a clock.
    SaasInvoicePaidHandler,
    // PC-56 TENANT-4d-5: the seven billing events finally have a recipient, so the notification spine finally
    // has something to fan out. Plain providers — `BillingNoticeService` is injected into both event-emitting
    // services and into both producer jobs, which is the point of it being one class.
    BillingNoticeService, BillingRecipientsRepository,
    {
      provide: TrialExpiryJob,
      useFactory: (subs: SubscriptionRepository, notice: BillingNoticeService) => new TrialExpiryJob(subs, notice),
      inject: [SubscriptionRepository, BillingNoticeService],
    },
    {
      provide: UsageLimitAlertsJob,
      useFactory: (notice: BillingNoticeService) => new UsageLimitAlertsJob(notice),
      inject: [BillingNoticeService],
    },
    {
      provide: TrialExpiryCadenceJob,
      useFactory: (config: AppConfig, job: TrialExpiryJob) =>
        new TrialExpiryCadenceJob(config.jobs.tenantNotices.intervalMs, job, config.jobs.tenantNotices.batchSize, config.jobs.tenantNotices.trialNoticeDays),
      inject: [AppConfig, TrialExpiryJob],
    },
    {
      provide: UsageLimitAlertsCadenceJob,
      useFactory: (config: AppConfig, job: UsageLimitAlertsJob) =>
        new UsageLimitAlertsCadenceJob(config.jobs.tenantNotices.intervalMs, job, config.jobs.tenantNotices.usageBatchSize),
      inject: [AppConfig, UsageLimitAlertsJob],
    },
    {
      provide: SaasBillingCycleJob,
      useFactory: (subs: SubscriptionRepository, invoices: SaasInvoiceRepository, subscriptions: SubscriptionService,
                   invoiceService: SaasInvoiceService, taxRate: BillingTaxRate, flags: FlagsService,
                   settings: TenantSettingsRepository) =>
        new SaasBillingCycleJob(subs, invoices, subscriptions, invoiceService, taxRate, flags,
          // The job never touches a settings table itself — it is handed a reader for the ONE key it needs.
          (tenantId: string) => settings.effectiveValue(tenantId, 'billing.grace_days')),
      inject: [SubscriptionRepository, SaasInvoiceRepository, SubscriptionService, SaasInvoiceService,
               BillingTaxRate, FlagsService, TenantSettingsRepository],
    },
    {
      provide: SaasBillingCycleCadenceJob,
      useFactory: (config: AppConfig, job: SaasBillingCycleJob) =>
        new SaasBillingCycleCadenceJob(config.jobs.saasBillingCycle.intervalMs, job, config.jobs.saasBillingCycle.batchSize),
      inject: [AppConfig, SaasBillingCycleJob],
    }, TenantApplicationService, TenantApplicationRepository],
  exports: [PlanUsageService, PlanService, SubscriptionService, TenantService, TenantDomainService, SaasInvoiceService],
})
export class TenancyModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobRegistry: ScheduledJobRegistry,
    private readonly config: AppConfig,
    private readonly saasInvoicePaid: SaasInvoicePaidHandler,
    private readonly saasBillingCycleCadenceJob: SaasBillingCycleCadenceJob,
    private readonly saasInvoicePayment: SaasInvoicePaymentHandler,
    private readonly trialExpiryCadenceJob: TrialExpiryCadenceJob,
    private readonly usageLimitAlertsCadenceJob: UsageLimitAlertsCadenceJob,
  ) {}
  // payments.payment_succeeded (referenceType='saas_invoice') → mark the SaaS invoice paid
  onModuleInit(): void {
    this.registry.register(this.saasInvoicePayment);
    // PC-56 TENANT-4d-4: `tenancy.saas_invoice_paid` had NO subscriber — it was emitted, relayed and dropped,
    // so the one event that should advance a subscription's billing period did nothing. This is the join.
    this.registry.register(this.saasInvoicePaid);
    // …and the clock, on the api-side cadence host S4 built (per-job env gate, independent of the
    // runner-wide JOBS_ENABLED kill switch — the same convention payments and identity use).
    if (this.config.jobs.saasBillingCycle.enabled) this.jobRegistry.register(this.saasBillingCycleCadenceJob);
    // PC-56 TENANT-4d-5 · the two producers 0148 named. Registering them is also what makes them TYPECHECKED:
    // `apps/api/tsconfig.json` includes only main/app.module/core/shared/listings plus whatever those
    // transitively import, so an unregistered job class is invisible to `tsc` — which is how
    // `usage-limit-alerts.job.ts` shipped referencing an identifier it never imported. Wiring it is the fix and
    // the detector at once.
    if (this.config.jobs.tenantNotices.enabled) {
      this.jobRegistry.register(this.trialExpiryCadenceJob);
      this.jobRegistry.register(this.usageLimitAlertsCadenceJob);
    }
  }
}
