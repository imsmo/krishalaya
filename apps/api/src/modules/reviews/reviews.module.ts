// modules/reviews/reviews.module.ts
// Verified-purchase ratings (M-reviews): a party to a COMPLETED order reviews the counterparty
// (buyer↔seller). Eligibility is recorded from orders.order_completed (OrderCompletedHandler); the
// service resolves the target server-side and enforces one-review-per-order. Moderation + cached
// aggregate (avg/count/histogram). NO money. Gated by the `reviews` feature flag (default OFF).
// PC-56 STORE-5a · B3 (founder D3, survey C-4): the review-prompts clock is REGISTERED — a provider built from the module's own ReviewRepository
// at the registry table's cadence (`cadenceOf('review-prompts')`), registered in SCHEDULED_JOB_REGISTRY at init (the disputes clocks' pattern).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { cadenceOf } from '../../core/jobs/clock-cadence';
import { ReviewPromptsClock } from './jobs/review-prompts.job';
import { FlagsService } from '../../core/feature-flags/flags.service';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { ReviewsController } from './controllers/v1/reviews.controller';
import { ReviewService } from './services/review.service';
import { ReviewRepository } from './repositories/review.repository';
import { OrderCompletedHandler } from './events/handlers/order-completed.handler';
import { BookingCompletedHandler } from './events/handlers/booking-completed.handler';

@Module({
  controllers: [ReviewsController],
  providers: [ReviewService, ReviewRepository, OrderCompletedHandler, BookingCompletedHandler,
    // F-11: the clock works only in tenants whose `reviews` flag is ON (the FlagsService — the API guard's own rule)
    { provide: ReviewPromptsClock, useFactory: (repo: ReviewRepository, flags: FlagsService) => new ReviewPromptsClock(cadenceOf('review-prompts'), repo, (t) => flags.isEnabled('reviews', { tenantId: t })),
      inject: [ReviewRepository, FlagsService] }],
  exports: [ReviewService],
})
export class ReviewsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly orderCompleted: OrderCompletedHandler,
    private readonly bookingCompleted: BookingCompletedHandler,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly promptsClock: ReviewPromptsClock,
  ) {}
  // record verified-transaction eligibility when an order (orders.order_completed) OR a service booking
  // (services.booking_completed) completes → authorizes the counterparty review.
  onModuleInit(): void {
    this.registry.register(this.orderCompleted);
    this.registry.register(this.bookingCompleted);
    this.jobs.register(this.promptsClock);   // STORE-5a · B3: one invite, one reminder — every hour
  }
}
