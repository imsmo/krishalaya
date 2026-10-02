// modules/requirements/requirements.module.ts
// Reverse marketplace (M12): buyers POST demand (requirements); sellers QUOTE (requirement_responses);
// the buyer accepts → the order is created downstream (orders) via the outbox (requirements.quote_accepted → orders
// QuoteAcceptedHandler). Reads listing/seller via ListingService (Law 11). NO money here. Gated by the `requirements`
// feature flag (default OFF).
//
// PC-56 TENANT-11d (founder decision: LINKED RESPONSES, ONE ORDER PER MEMBER, PER-MEMBER CONSENT BEFORE SEND):
//   • the buyer desk (`requirement.desk`) posts for a named buyer with the buyer's consent and responds with MEMBER STOCK —
//     a pooled quote (ResponseGroupService) whose lines each carry their member's consent before it can be sent, and which sends
//     as one linked response per member; the buyer accepts by quantity (or the pooled quote whole), and each accepted response
//     becomes ONE order (orders asks RequirementOrderService, exported here);
//   • F-1 / F-9 — the expiry and need-by reminder jobs are REGISTERED in SCHEDULED_JOB_REGISTRY (they were instantiated nowhere)
//     and claim per tenant in kv_app's unit of work — never as kv_relay on requirement_responses, which kv_relay holds no grant on.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { ListingsModule } from '../listings/listings.module';
import { RequirementsController } from './controllers/v1/requirements.controller';
import { ResponsesController } from './controllers/v1/responses.controller';
import { RequirementService } from './services/requirement.service';
import { RequirementResponseService } from './services/requirement-response.service';
import { ResponseGroupService } from './services/response-group.service';
import { RequirementOrderService } from './services/requirement-order.service';
import { RequirementRepository } from './repositories/requirement.repository';
import { RequirementResponseRepository } from './repositories/requirement-response.repository';
import { ResponseGroupRepository } from './repositories/response-group.repository';
import { ListingPublishedHandler } from './events/handlers/listing-published.handler';
import { ExpireRequirementsJob } from './jobs/expire-requirements.job';
import { MatchNotificationsJob } from './jobs/match-notifications.job';

@Module({
  imports: [ListingsModule],
  controllers: [RequirementsController, ResponsesController],
  providers: [
    RequirementService, RequirementResponseService, ResponseGroupService, RequirementOrderService,
    RequirementRepository, RequirementResponseRepository, ResponseGroupRepository, ListingPublishedHandler,
    { provide: ExpireRequirementsJob, inject: [UNIT_OF_WORK, RequirementRepository, RequirementResponseRepository, RequirementService, RequirementResponseService],
      useFactory: (u: UnitOfWork, rr: RequirementRepository, sr: RequirementResponseRepository, rs: RequirementService, ss: RequirementResponseService) => new ExpireRequirementsJob(15 * 60_000, u, rr, sr, rs, ss) },
    { provide: MatchNotificationsJob, inject: [RequirementRepository, RequirementService],
      useFactory: (rr: RequirementRepository, rs: RequirementService) => new MatchNotificationsJob(6 * 3600_000, rr, rs) },
  ],
  exports: [RequirementService, RequirementResponseService, RequirementOrderService],
})
export class RequirementsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly listingPublished: ListingPublishedHandler,
    private readonly expire: ExpireRequirementsJob,
    private readonly remind: MatchNotificationsJob,
  ) {}
  // nudge buyers with matching OPEN requirements when a listing is published (listing.published); schedule the two sweeps
  onModuleInit(): void {
    this.registry.register(this.listingPublished);
    this.jobs.register(this.expire);
    this.jobs.register(this.remind);
  }
}
