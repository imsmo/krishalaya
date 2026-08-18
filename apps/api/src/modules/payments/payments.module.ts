// modules/payments/payments.module.ts
import { AppConfig } from '../../core/config/app-config';
// Money-IN vertical: payment intents + signed gateway webhooks → wallet ledger (via WALLET_SERVICE)
// + refunds. The gateway registry wires the deterministic sandbox (always) and Razorpay (when
// RAZORPAY_* env is configured); the default provider is config-driven so swapping PSP is config.
// Money movement itself lives in core/wallet (Law 2); this module never INSERTs ledger rows.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
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
import { gatewayRegistryProvider, payoutGatewayProvider, mandateGatewayProvider } from './gateway/payment-gateways.provider';
import { OrderCompletedHandler } from './events/handlers/order-completed.handler';
import { DisputeResolvedHandler } from './events/handlers/dispute-resolved.handler';
import { ReturnRefundedHandler } from './events/handlers/return-refunded.handler';
import { OrderConfirmedInvoiceHandler } from './events/handlers/order-confirmed-invoice.handler';
import { InvoiceConsoleReadModel } from './read-models/invoice-console.read-model';
import { CreditNoteRepository } from './repositories/credit-note.repository';
import { CreditNoteService } from './services/credit-note.service';
import { Gstr1ExportService } from './services/gstr1-export.service';
import { ChargesController } from './controllers/v1/charges.controller';
import { ChargeChangeRepository } from './repositories/charge-change.repository';
import { ChargeChangeService } from './services/charge-change.service';
import { ChargeConsoleReadModel } from './read-models/charge-console.read-model';
// PC-56 TENANT-4a: the ORGANISATION's wallet (W143/W144) — the tenant's own three accounts, read for the
// first time. Separate from WalletController, which is the caller's personal wallet.
import { OrgWalletController } from './controllers/v1/org-wallet.controller';
import { OrgWalletReadModel } from './read-models/org-wallet.read-model';
import { OrgWalletExportService } from './services/org-wallet-export.service';
// PC-56 TENANT-4b: W145/W146 — the payout queue and the maker-checker gate over a run.
import { PayoutApprovalService } from './services/payout-approval.service';
import { PayoutConsoleReadModel } from './read-models/payout-console.read-model';
// PC-56 TENANT-4c: W147/W148 — the settlement cycle that did not exist, and the statements it produces.
import { SettlementCyclesController } from './controllers/v1/settlement-cycles.controller';
import { SettlementCycleRepository } from './repositories/settlement-cycle.repository';
import { SettlementCycleService } from './services/settlement-cycle.service';
import { OrgStatementService } from './services/org-statement.service';
import { SettlementConsoleReadModel } from './read-models/settlement-console.read-model';
import { DisputesModule } from '../disputes/disputes.module';
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
import { AutopayController } from './controllers/v1/autopay.controller';

@Module({
  // DisputesModule for RefundApprovalService — 0139's maker-checker plane, which 0140 widened to cover credit notes
  // (its PUBLIC service, never its repository; DisputesModule imports nothing, so there is no cycle).
  imports: [MediaModule, TenancyModule, DisputesModule],   // MediaService for rendered statement/invoice PDFs; TenancyModule for TenantService (DEV-27 Q23 badge)
  controllers: [PaymentsController, PaymentWebhooksController, PayoutsController, SettlementStatementsController, InvoicesController, ChargesController, CommissionRulesController, WalletController, OrgWalletController, SettlementCyclesController, AutopayController],
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
    ReturnRefundedHandler,
    OrderConfirmedInvoiceHandler,
    InvoiceConsoleReadModel,
    CreditNoteRepository,
    CreditNoteService,
    Gstr1ExportService,
    ChargeChangeRepository,
    ChargeChangeService,
    ChargeConsoleReadModel,
    OrgWalletReadModel,
    OrgWalletExportService,
    PayoutApprovalService,
    PayoutConsoleReadModel,
    SettlementCycleRepository,
    SettlementCycleService,
    OrgStatementService,
    SettlementConsoleReadModel,
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
    // [DEV-31] the three PSP-selection factories (mandate/gateway-registry/payout) were extracted verbatim into
    // gateway/payment-gateways.provider.ts so config-driven driver selection is independently unit-testable
    // (see __tests__/payment-gateways.provider.spec.ts) — no behavior change from the prior inline objects.
    mandateGatewayProvider,
    gatewayRegistryProvider,
    payoutGatewayProvider,
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
    private readonly returnRefunded: ReturnRefundedHandler,
    private readonly orderConfirmedInvoice: OrderConfirmedInvoiceHandler,
    private readonly bookingClockedOut: BookingClockedOutHandler,
    private readonly config: AppConfig,
    private readonly settlementStatementsCadenceJob: SettlementStatementsCadenceJob,
    private readonly payoutExecutionCadenceJob: PayoutExecutionCadenceJob,
  ) {}
  onModuleInit(): void {
    this.registry.register(this.orderCompleted);   // settlement split + settlement line
    this.registry.register(this.tradeInvoice);     // buyer GST invoice (fan-out to the same event)
    this.registry.register(this.disputeResolved);  // dispute refund: escrow → buyer wallet (flag dispute_refunds)
    // PC-56 TENANT-3b: return refund: escrow → buyer wallet (flag dispute_refunds). `disputes.return_refunded` had
    // NO subscriber in any app before this line — a return reached 'refunded' and no money moved.
    this.registry.register(this.returnRefunded);
    // PC-56 TENANT-3c-1: the trade invoice is raised at CONFIRM (W151's own words, and the law's timing for goods).
    // `tradeInvoice` below stays registered on order_completed as the idempotent backstop.
    this.registry.register(this.orderConfirmedInvoice);
    this.registry.register(this.bookingClockedOut); // labour.wages_paid → promote wage payouts (flag wage_priority_payout)
    // per-job env gate (SETTLEMENT_STATEMENTS_JOB_ENABLED), independent of the runner-wide JOBS_ENABLED kill-switch
    if (this.config.jobs.settlementStatements.enabled) this.jobRegistry.register(this.settlementStatementsCadenceJob);
    // S5 REVIEW P0: PAYOUT_EXECUTION_JOB_ENABLED (default true) — without this, POST /v1/payouts queues
    // a payout that never disburses (PayoutExecutionJob existed but was registered nowhere).
    if (this.config.jobs.payoutExecution.enabled) this.jobRegistry.register(this.payoutExecutionCadenceJob);
  }
}
