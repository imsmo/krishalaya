// modules/auctions/auctions.module.ts
// English/sealed auctions with EMD holds + anti-snipe auto-extend. Reads listing facts and moves the auctioned listing via
// ListingService (cross-module public API, Law 11); creates the settlement's order via the orders module's public
// AuctionOrderService. EMD moves only via the wallet boundary. Gated by the `auctions` feature flag (default OFF).
//
// PC-56 TENANT-11a — what this module now registers (none of it ran before):
//   • five cadence sweeps through SCHEDULED_JOB_REGISTRY (F-1): open at starts_at, close at ends_at, the seller-decision
//     lapse (F-13), the balance default (F-2) and the EMD-release sweeper — each claiming per tenant in kv_app's unit of
//     work, never as kv_relay on a table it holds no grant on (F-9);
//   • two outbox consumers, both routed through the request-tier unit of work (F-9): `payments.payment_succeeded` (an auction
//     order's balance paid → the settlement is `paid`) and `orders.order_cancelled` (the applied EMD forfeited on a buyer
//     walk-away, returned on a seller / system cancel).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { OrdersModule } from '../orders/orders.module';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { AuctionsController } from './controllers/v1/auctions.controller';
import { BidsController } from './controllers/v1/bids.controller';
import { AuctionService } from './services/auction.service';
import { BidService } from './services/bid.service';
import { AuctionWatcherService } from './services/auction-watcher.service';
import { AuctionsPublisher } from './events/auctions.publisher';
import { AuctionPaymentSucceededHandler } from './events/handlers/payment-succeeded.handler';
import { AuctionOrderCancelledHandler } from './events/handlers/order-cancelled.handler';
import { AuctionRepository } from './repositories/auction.repository';
import { BidRepository } from './repositories/bid.repository';
import { AuctionWatcherRepository } from './repositories/auction-watcher.repository';
import { AuctionSettlementRepository } from './repositories/auction-settlement.repository';
import { AuctionLiveReadModel } from './read-models/auction-live.read-model';
import { MyBidsReadModel } from './read-models/my-bids.read-model';
import { AuctionDefaultJob, CloseEndedAuctionsJob, OpenScheduledAuctionsJob, ReleaseLosingEmdJob, SellerDecisionLapseJob } from './jobs/auctions.cadence-jobs';

const JOB_DEPS = [UNIT_OF_WORK, AuctionRepository, AuctionService];

@Module({
  imports: [ListingsModule, OrdersModule],
  controllers: [AuctionsController, BidsController],
  providers: [
    AuctionService, BidService, AuctionWatcherService, AuctionsPublisher, AuctionPaymentSucceededHandler, AuctionOrderCancelledHandler,
    AuctionRepository, BidRepository, AuctionWatcherRepository, AuctionSettlementRepository, AuctionLiveReadModel, MyBidsReadModel,
    { provide: OpenScheduledAuctionsJob, inject: JOB_DEPS, useFactory: (u: UnitOfWork, r: AuctionRepository, s: AuctionService) => new OpenScheduledAuctionsJob(60_000, u, r, s) },
    { provide: CloseEndedAuctionsJob, inject: JOB_DEPS, useFactory: (u: UnitOfWork, r: AuctionRepository, s: AuctionService) => new CloseEndedAuctionsJob(30_000, u, r, s) },
    { provide: SellerDecisionLapseJob, inject: JOB_DEPS, useFactory: (u: UnitOfWork, r: AuctionRepository, s: AuctionService) => new SellerDecisionLapseJob(5 * 60_000, u, r, s) },
    { provide: ReleaseLosingEmdJob, inject: JOB_DEPS, useFactory: (u: UnitOfWork, r: AuctionRepository, s: AuctionService) => new ReleaseLosingEmdJob(15 * 60_000, u, r, s) },
    { provide: AuctionDefaultJob, inject: [...JOB_DEPS, AuctionSettlementRepository],
      useFactory: (u: UnitOfWork, r: AuctionRepository, s: AuctionService, st: AuctionSettlementRepository) => new AuctionDefaultJob(15 * 60_000, u, r, s, st) },
  ],
  exports: [AuctionService],
})
export class AuctionsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly paymentSucceeded: AuctionPaymentSucceededHandler,
    private readonly orderCancelled: AuctionOrderCancelledHandler,
    private readonly openJob: OpenScheduledAuctionsJob,
    private readonly closeJob: CloseEndedAuctionsJob,
    private readonly lapseJob: SellerDecisionLapseJob,
    private readonly releaseJob: ReleaseLosingEmdJob,
    private readonly defaultJob: AuctionDefaultJob,
  ) {}
  onModuleInit(): void {
    this.registry.register(this.paymentSucceeded);
    this.registry.register(this.orderCancelled);
    for (const j of [this.openJob, this.closeJob, this.lapseJob, this.releaseJob, this.defaultJob]) this.jobs.register(j);
  }
}
