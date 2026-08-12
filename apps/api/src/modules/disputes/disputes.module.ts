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

@Module({
  controllers: [DisputesController, ReturnsController, RefundApprovalsController],
  providers: [
    DisputeService, DisputeMessageService, ReturnService, RefundApprovalService,
    DisputeRepository, DisputeMessageRepository, ReturnRepository, RefundApprovalRepository,
    DisputeConsoleReadModel,
    OrderDeliveredHandler, DisputeRefundedHandler, ReturnRefundedStampHandler,
  ],
  exports: [DisputeService, ReturnService, RefundApprovalService],
})
export class DisputesModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly orderDelivered: OrderDeliveredHandler,
    private readonly disputeRefunded: DisputeRefundedHandler,
    private readonly returnRefundedStamp: ReturnRefundedStampHandler,
  ) {}
  // record dispute eligibility when an order is delivered (orders.order_delivered)
  onModuleInit(): void {
    this.registry.register(this.orderDelivered);
    this.registry.register(this.disputeRefunded);
    // payments.return_refunded → stamp returns.refund_txn_id. Registered for the first time in TENANT-3b: the
    // return money trail had neither an executor nor a stamp before it.
    this.registry.register(this.returnRefundedStamp);
  }
}
