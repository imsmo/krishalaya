// modules/disputes/disputes.module.ts
// Order disputes (M-disputes): a party to a DELIVERED order raises a dispute against the counterparty
// (eligibility recorded from orders.order_delivered); parties exchange threaded evidence; a moderator
// reviews/escalates/resolves. Opening pauses the order (orders sets it 'disputed'); resolving emits
// disputes.dispute_resolved so orders applies the refund/release. NO money moves here (the wallet
// reversal is a flagged downstream step). Gated by the `disputes` feature flag (default OFF).
//
// SCOPE: ships the dispute-resolution spine + threaded messages (DisputeMessageService) + the
// returns/RMA sub-domain (ReturnService/ReturnsController) + the SLA worker jobs (API-W3-09).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { DisputesController } from './controllers/v1/disputes.controller';
import { ReturnsController } from './controllers/v1/returns.controller';
import { DisputeService } from './services/dispute.service';
import { DisputeMessageService } from './services/dispute-message.service';
import { ReturnService } from './services/return.service';
import { DisputeRepository } from './repositories/dispute.repository';
import { DisputeMessageRepository } from './repositories/dispute-message.repository';
import { ReturnRepository } from './repositories/return.repository';
import { OrderDeliveredHandler } from './events/handlers/order-delivered.handler';
import { DisputeRefundedHandler } from './events/handlers/dispute-refunded.handler';
import { ReturnRefundedStampHandler } from './events/handlers/return-refunded-stamp.handler';
import { RefundApprovalService } from './services/refund-approval.service';
import { RefundApprovalRepository } from './repositories/refund-approval.repository';
import { DisputeConsoleReadModel } from './read-models/dispute-console.read-model';
import { RefundApprovalsController } from './controllers/v1/refund-approvals.controller';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { cadenceOf } from '../../core/jobs/clock-cadence';
import { DisputeSellerResponseTimeoutClock, DisputeSlaEscalationClock } from './jobs/disputes.cadence-jobs';

@Module({
  controllers: [DisputesController, ReturnsController, RefundApprovalsController],
  providers: [
    DisputeService, DisputeMessageService, ReturnService, RefundApprovalService,
    DisputeRepository, DisputeMessageRepository, ReturnRepository, RefundApprovalRepository,
    DisputeConsoleReadModel,
    OrderDeliveredHandler, DisputeRefundedHandler, ReturnRefundedStampHandler,
    // PC-56 HOTFIX-7 · B23: the two dispute clocks, at the registry table's cadence (core/jobs/clock-cadence.ts)
    { provide: DisputeSellerResponseTimeoutClock, useFactory: () => new DisputeSellerResponseTimeoutClock(cadenceOf('dispute-seller-response-timeout')) },
    { provide: DisputeSlaEscalationClock, useFactory: () => new DisputeSlaEscalationClock(cadenceOf('dispute-sla-escalation')) },
  ],
  exports: [DisputeService, ReturnService, RefundApprovalService],
})
export class DisputesModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly orderDelivered: OrderDeliveredHandler,
    private readonly disputeRefunded: DisputeRefundedHandler,
    private readonly returnRefundedStamp: ReturnRefundedStampHandler,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly sellerResponseClock: DisputeSellerResponseTimeoutClock,
    private readonly slaClock: DisputeSlaEscalationClock,
  ) {}
  // record dispute eligibility when an order is delivered (orders.order_delivered)
  onModuleInit(): void {
    this.registry.register(this.orderDelivered);
    this.registry.register(this.disputeRefunded);
    // payments.return_refunded → stamp returns.refund_txn_id. Registered for the first time in TENANT-3b: the
    // return money trail had neither an executor nor a stamp before it.
    this.registry.register(this.returnRefundedStamp);
    // PC-56 HOTFIX-7 · B23 (survey C-6 / F-10): the respondent's 48 h and the 7-day SLA are acted on at last (no money, no notice — the header of
    // jobs/disputes.cadence-jobs.ts). CertificateExpiryAlertsJob and runAnchorHashes stay unregistered (5b decides them); ReviewPromptsJob is
    // registered by reviews.module.ts since STORE-5a (the `review-prompts` clock).
    this.jobs.register(this.sellerResponseClock);
    this.jobs.register(this.slaClock);
  }
}
