// modules/promotions/promotions.module.ts
// Promotions & coupons (PRD §9.5): tenant-admin campaigns (budgeted) + redeemable coupon codes with global/per-user caps.
// Gated by the `promotions` feature flag (default OFF); coupons ride the same flag.
//
// PC-56 TENANT-10b — FOUNDER DECISION F-2: THE TENANT WALLET FUNDS THE DISCOUNT. A redemption reserves the discount from
// the tenant's Main into its Hold in the checkout's own transaction (CouponMoneyService.tryHold); settlement pays it from
// the Hold to the seller in the relay transaction that settles the order (exported to payments' OrderCompletedHandler);
// a cancel / refund before settlement returns it to Main (OrderClosedHandler). A decline (no funds, spent budget, per-user
// limit, …) never aborts a checkout — the order proceeds at full price with a kind notice, and the attempt is recorded.
//
// What this module registers: the order-created backstop recorder, the cancel + refund release handlers, and the two
// cadence sweeps (budget watch, festival scheduler) through SCHEDULED_JOB_REGISTRY — none of which ran before (F-9).
// The cashback / recharge-bonus / listing-boost engines do not exist and are refused at creation by name (F-24).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { PromotionsController } from './controllers/v1/promotions.controller';
import { CouponsController } from './controllers/v1/coupons.controller';
import { PromotionService } from './services/promotion.service';
import { CouponService } from './services/coupon.service';
import { CouponRedemptionService } from './services/coupon-redemption.service';
import { CouponMoneyService } from './services/coupon-money.service';
import { PromotionRepository } from './repositories/promotion.repository';
import { CouponRepository } from './repositories/coupon.repository';
import { CouponRedemptionRepository } from './repositories/coupon-redemption.repository';
import { CouponAttemptRepository } from './repositories/coupon-attempt.repository';
import { OffersReadModel } from './read-models/offers.read-model';
import { OrderCreatedHandler } from './events/handlers/order-created.handler';
import { OrderClosedHandler } from './events/handlers/order-closed.handler';
import { PromoBudgetWatchCadenceJob, FestivalSchedulerCadenceJob } from './jobs/promotions.cadence-jobs';

@Module({
  controllers: [PromotionsController, CouponsController],
  providers: [
    PromotionService, CouponService, CouponRedemptionService, CouponMoneyService,
    PromotionRepository, CouponRepository, CouponRedemptionRepository, CouponAttemptRepository, OffersReadModel, OrderCreatedHandler,
    { provide: PromoBudgetWatchCadenceJob, inject: [PromotionRepository, PromotionService],
      useFactory: (repo: PromotionRepository, svc: PromotionService) => new PromoBudgetWatchCadenceJob(15 * 60_000, repo, svc) },
    { provide: FestivalSchedulerCadenceJob, inject: [PromotionRepository, PromotionService],
      useFactory: (repo: PromotionRepository, svc: PromotionService) => new FestivalSchedulerCadenceJob(5 * 60_000, repo, svc) },
  ],
  exports: [PromotionService, CouponService, CouponRedemptionService, CouponMoneyService],
})
export class PromotionsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly orderCreated: OrderCreatedHandler,
    private readonly redemptions: CouponRedemptionService,
    private readonly budgetWatch: PromoBudgetWatchCadenceJob,
    private readonly festival: FestivalSchedulerCadenceJob,
  ) {}
  onModuleInit(): void {
    // record the coupon redemption when an order carrying a coupon is created (orders.order_created) — the backstop
    this.registry.register(this.orderCreated);
    // A3 — a cancelled / refunded order gives its reservation back (before settlement)
    this.registry.register(new OrderClosedHandler('orders.order_cancelled', this.redemptions));
    this.registry.register(new OrderClosedHandler('orders.order_refunded', this.redemptions));
    // B4 / F-9 — the two sweeps, finally scheduled
    this.jobs.register(this.budgetWatch);
    this.jobs.register(this.festival);
  }
}
