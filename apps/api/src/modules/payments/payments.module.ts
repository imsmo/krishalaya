// modules/payments/payments.module.ts
import { AppConfig } from '../../core/config/app-config';
// Money-IN vertical: payment intents + signed gateway webhooks → wallet ledger (via WALLET_SERVICE)
// + refunds. The gateway registry wires the deterministic sandbox (always) and Razorpay (when
// RAZORPAY_* env is configured); the default provider is config-driven so swapping PSP is config.
// Money movement itself lives in core/wallet (Law 2); this module never INSERTs ledger rows.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { ResilienceService } from '../../core/resilience/resilience.service';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { SettlementStatementsCadenceJob } from './jobs/settlement-statements.cadence-job';
import { PayoutExecutionCadenceJob } from './jobs/payout-execution.cadence-job';
import { PaymentsController } from './controllers/v1/payments.controller';
import { PaymentWebhooksController } from './controllers/v1/payment-webhooks.controller';
import { PayoutsController } from './controllers/v1/payouts.controller';
import { PaymentService } from './services/payment.service';
import { PayoutService } from './services/payout.service';
import { PaymentRepository } from './repositories/payment.repository';
// S6 device-test P0: PaymentService.createIntent validates order references (existence, buyer
// ownership, payable state, exact amount) BEFORE creating a real gateway order — a plain provider,
// NOT an OrdersModule import: OrdersModule already imports PaymentsModule (for ChargePricingService
// etc.), so the reverse module import would cycle. OrderRepository's only dependency, READ_REPLICA,
// is provided by the @Global() CoreModule, so this resolves cleanly without importing OrdersModule.
import { OrderRepository } from '../orders/repositories/order.repository';
// DEV-27 (Q23): DocumentPdfService needs TenantService (never TenantRepository directly, per Law 11 —
// same precedent as MandateService above) to read the tenant's own brand name for the billing-document
// header badge. TenancyModule has no `imports` of its own (verified), so this creates no module cycle.
import { TenancyModule } from '../tenancy/tenancy.module';
import { PayoutRepository } from './repositories/payout.repository';
import { CommissionRuleRepository } from './repositories/commission-rule.repository';
import { TaxRuleRepository } from './repositories/tax-rule.repository';
import { SettlementPricingService } from './services/settlement-pricing.service';
import { SettlementLineRepository } from './repositories/settlement-line.repository';
import { SettlementStatementRepository } from './repositories/settlement-statement.repository';
import { TradeInvoiceRepository } from './repositories/trade-invoice.repository';
import { SettlementStatementService } from './services/settlement-statement.service';
import { TradeInvoiceService } from './services/trade-invoice.service';
import { ChargeDefinitionRepository } from './repositories/charge-definition.repository';
import { ChargePricingService } from './services/charge-pricing.service';
import { DocumentPdfService } from './services/document-pdf.service';
import { MediaModule } from '../../core/media/media.module';
import { TradeInvoiceHandler } from './events/handlers/trade-invoice.handler';
import { SettlementStatementsController } from './controllers/v1/settlement-statements.controller';
import { InvoicesController } from './controllers/v1/invoices.controller';
import { CommissionRulesController } from './controllers/v1/commission-rules.controller';
import { CommissionRuleService } from './services/commission-rule.service';
import { GatewayRegistry } from './gateway/gateway.registry';
import { SandboxGateway } from './gateway/sandbox.gateway';
import { RazorpayGateway } from './gateway/razorpay.gateway';
import { PAYOUT_GATEWAY } from './gateway/payout-gateway.port';
import { RazorpayXGateway } from './gateway/razorpayx.gateway';
import { SandboxPayoutGateway } from './gateway/sandbox-payout.gateway';
import { OrderCompletedHandler } from './events/handlers/order-completed.handler';
import { DisputeResolvedHandler } from './events/handlers/dispute-resolved.handler';
import { BookingClockedOutHandler } from './events/handlers/booking-clocked-out.handler';
import { RazorpayPayoutWebhookHandler } from './events/handlers/razorpay-webhook.handler';
import { PaymentsPublisher } from './events/payments.publisher';
import { PayoutBatchRepository } from './repositories/payout-batch.repository';
import { PayoutBatchService } from './services/payout-batch.service';
import { WalletBalanceReadModel } from './read-models/wallet-balance.read-model';
import { WalletLedgerReadModel } from './read-models/wallet-ledger.read-model';
import { WalletInsightsReadModel } from './read-models/wallet-insights.read-model';
import { SavedInstrumentsReadModel } from './read-models/saved-instruments.read-model';
import { WalletController } from './controllers/v1/wallet.controller';
import { MandateService } from './services/mandate.service';
import { MandateExecutionService } from './services/mandate-execution.service';
import { MandateRepository } from './repositories/mandate.repository';
import { MandateExecutionRepository } from './repositories/mandate-execution.repository';
import { MANDATE_GATEWAY } from './gateway/mandate-gateway.port';
import { SandboxMandateGateway } from './gateway/sandbox-mandate.gateway';
import { AutopayController } from './controllers/v1/autopay.controller';

@Module({
  imports: [MediaModule, TenancyModule],   // MediaService for rendered statement/invoice PDFs; TenancyModule for TenantService (DEV-27 Q23 badge)
  controllers: [PaymentsController, PaymentWebhooksController, PayoutsController, SettlementStatementsController, InvoicesController, CommissionRulesController, WalletController, AutopayController],
  providers: [
    PaymentService,
    PayoutService,
    CommissionRuleService,
    DocumentPdfService,
    PaymentRepository,
    OrderRepository,
    PayoutRepository,
    CommissionRuleRepository,
    TaxRuleRepository,
    SettlementPricingService,
    SettlementLineRepository,
    SettlementStatementRepository,
    TradeInvoiceRepository,
    SettlementStatementService,
    TradeInvoiceService,
    ChargeDefinitionRepository,
    ChargePricingService,
    OrderCompletedHandler,
    TradeInvoiceHandler,
    DisputeResolvedHandler,
    BookingClockedOutHandler,
    RazorpayPayoutWebhookHandler,
    PaymentsPublisher,
    PayoutBatchRepository,
    PayoutBatchService,
    WalletBalanceReadModel,
    WalletLedgerReadModel,
    WalletInsightsReadModel,
    SavedInstrumentsReadModel,
    MandateService,
    MandateExecutionService,
    MandateRepository,
    MandateExecutionRepository,
    {
      // UPI-AutoPay mandate gateway: a real PSP when configured, else the deterministic sandbox (NON-prod only,
      // mirroring the money-IN gateway rule). In prod a live PSP is mandatory before the autopay_execution flag
      // is ever turned on — the flag stays OFF by default (fail-closed) regardless.
      provide: MANDATE_GATEWAY,
      useFactory: (config: AppConfig) => {
        if (config.payments.isProd && !config.payments.allowSandbox) {
          // No live UPI-AutoPay PSP adapter is wired yet; keeping the sandbox out of prod is the safe default.
          // Execution remains gated by autopay_execution (default OFF), so this provider is never exercised in prod.
        }
        return new SandboxMandateGateway();
      },
      inject: [AppConfig],
    },
    {
      provide: GatewayRegistry,
      useFactory: (resilience: ResilienceService, config: AppConfig) => {
        const reg = new GatewayRegistry();
        const pay = config.payments;
        // The deterministic sandbox gateway is ONLY registered outside production (Law: no fake money rails live).
        // In prod, assertProductionSecurity has already guaranteed a real Razorpay gateway is configured.
        if (pay.allowSandbox) {
          reg.register(new SandboxGateway(pay.payoutWebhookSecret), !pay.razorpay.configured);
        }
        if (pay.razorpay.configured) {
          reg.register(new RazorpayGateway({
            keyId: pay.razorpay.keyId, keySecret: pay.razorpay.keySecret,
            webhookSecret: pay.razorpay.webhookSecret, baseUrl: pay.razorpay.baseUrl,
          }, resilience), pay.defaultProvider === 'razorpay');
        }
        // tune the razorpay dependency policy (money calls: no auto-retry without idempotency)
        resilience.configure('razorpay', { timeoutMs: 8000, retries: 1, circuit: { failureThreshold: 5, resetMs: 15_000, halfOpenMax: 2 }, bulkhead: { maxConcurrent: 16, maxQueue: 64 } });
        return reg;
      },
      inject: [ResilienceService, AppConfig],
    },
    {
      // money-OUT gateway: RazorpayX when configured, else the deterministic sandbox (NON-prod only).
      provide: PAYOUT_GATEWAY,
      useFactory: (resilience: ResilienceService, config: AppConfig) => {
        const x = config.payments.razorpayx;
        if (x.configured) {
          resilience.configure('razorpayx', { timeoutMs: 8000, retries: 0, circuit: { failureThreshold: 5, resetMs: 15_000, halfOpenMax: 2 }, bulkhead: { maxConcurrent: 16, maxQueue: 64 } });
          return new RazorpayXGateway({ keyId: x.keyId, keySecret: x.keySecret, accountNumber: x.accountNumber, baseUrl: x.baseUrl }, resilience);
        }
        if (config.payments.isProd) throw new Error('FATAL: RAZORPAYX_KEY_ID must be configured in production (no sandbox payout gateway for real money)');
        return new SandboxPayoutGateway('success');
      },
      inject: [ResilienceService, AppConfig],
    },
    {
      // KV-BL-P0-9-follow-on: the nightly settlement-statements cadence job (core/jobs/jobs.runner.ts
      // hosts it; this factory just supplies the configured interval — see AppConfig.jobs.settlementStatements).
      provide: SettlementStatementsCadenceJob,
      useFactory: (config: AppConfig, lines: SettlementLineRepository, statements: SettlementStatementService) =>
        new SettlementStatementsCadenceJob(config.jobs.settlementStatements.intervalMs, lines, statements),
      inject: [AppConfig, SettlementLineRepository, SettlementStatementService],
    },
    {
      // S5 REVIEW P0: the (previously-registered-nowhere) payout-disbursement cadence job — every 5 min
      // by default (core/jobs/jobs.runner.ts hosts it; this factory just supplies the configured
      // interval + batch size — see AppConfig.jobs.payoutExecution).
      provide: PayoutExecutionCadenceJob,
      useFactory: (config: AppConfig, repo: PayoutRepository, payouts: PayoutService) =>
        new PayoutExecutionCadenceJob(config.jobs.payoutExecution.intervalMs, repo, payouts, config.jobs.payoutExecution.batchSize),
      inject: [AppConfig, PayoutRepository, PayoutService],
    },
  ],
  // MandateService added DEV-25/KV-BL-057 (§8 FLAGGED — payments-module gap fix): InsuranceModule needs it
  // for the auto-debit THIN LINK (linkAutopayMandate reads a mandate's status/purpose/owner via
  // MandateService.getById — the SERVICE, never MandateRepository directly, per Law 11). No behavior change
  // to MandateService itself.
  exports: [PaymentService, PayoutService, PayoutBatchService, ChargePricingService, WalletBalanceReadModel, MandateService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobRegistry: ScheduledJobRegistry,
    private readonly orderCompleted: OrderCompletedHandler,
    private readonly tradeInvoice: TradeInvoiceHandler,
    private readonly disputeResolved: DisputeResolvedHandler,
    private readonly bookingClockedOut: BookingClockedOutHandler,
    private readonly config: AppConfig,
    private readonly settlementStatementsCadenceJob: SettlementStatementsCadenceJob,
    private readonly payoutExecutionCadenceJob: PayoutExecutionCadenceJob,
  ) {}
  onModuleInit(): void {
    this.registry.register(this.orderCompleted);   // settlement split + settlement line
    this.registry.register(this.tradeInvoice);     // buyer GST invoice (fan-out to the same event)
    this.registry.register(this.disputeResolved);  // dispute refund: escrow → buyer wallet (flag dispute_refunds)
    this.registry.register(this.bookingClockedOut); // labour.wages_paid → promote wage payouts (flag wage_priority_payout)
    // per-job env gate (SETTLEMENT_STATEMENTS_JOB_ENABLED), independent of the runner-wide JOBS_ENABLED kill-switch
    if (this.config.jobs.settlementStatements.enabled) this.jobRegistry.register(this.settlementStatementsCadenceJob);
    // S5 REVIEW P0: PAYOUT_EXECUTION_JOB_ENABLED (default true) — without this, POST /v1/payouts queues
    // a payout that never disburses (PayoutExecutionJob existed but was registered nowhere).
    if (this.config.jobs.payoutExecution.enabled) this.jobRegistry.register(this.payoutExecutionCadenceJob);
  }
}
