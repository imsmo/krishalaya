// modules/support/support.module.ts
// Support / Helpdesk (PRD §50). A requester opens a ticket (severity-derived SLA due dates); an agent
// (support.handle) assigns, responds (stamping first_responded_at), drives the status machine
// (open↔pending_*↔escalated→resolved→closed, +reopened), and the requester rates it (CSAT 1-5). An escalated
// dispute auto-opens a P1 ticket (DisputeEscalatedHandler, idempotent). An SLA-breach worker job escalates
// overdue tickets. Money-free. Gated by the `support` flag (default OFF).
//
// SCOPE: tickets (open/assign/respond/transition/resolve/close/reopen/CSAT) + SLA due + dispute auto-open +
// SLA-breach escalation job + the ticket→conversation thread bridge (03_API_CONTRACT_DELTA.md §520,
// SupportThreadService — glue onto communication's already-built conversations engine, not a new chat system).
// DEFERRED: CSAT-survey dispatch (via the notification spine) + auto-routing/round-robin assignment +
// knowledge-base deflection.
import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { CommunicationModule } from '../communication/communication.module'; // ConversationService for :id/thread (§520)
import { TicketsController } from './controllers/v1/tickets.controller';
import { SupportTicketService } from './services/support-ticket.service';
import { SupportThreadService } from './services/support-thread.service';
import { SupportTicketRepository } from './repositories/support-ticket.repository';
import { CsatResponseRepository } from './repositories/csat-response.repository';
import { DisputeEscalatedHandler } from './events/handlers/dispute-escalated.handler';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { PlatformReplyDeliveryCadenceJob } from './jobs/platform-reply-delivery.cadence-job';

@Module({
  imports: [CommunicationModule],
  controllers: [TicketsController],
  providers: [SupportTicketService, SupportThreadService, SupportTicketRepository,
    // PC-56 ADMIN-2c: the CSAT ledger (0099) — a rating is appended, never overwritten
    CsatResponseRepository,
    // PC-56 ADMIN-2d: delivers a PLATFORM reply to the farmer through the notification spine. It lives in this module
    // rather than apps/worker because the spine is module business logic the pg-only worker cannot import, and it is a
    // cadence job rather than an outbox handler because a reply an operator has just written has not HAPPENED yet.
    PlatformReplyDeliveryCadenceJob],
  exports: [SupportTicketService],
})
export class SupportModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    private readonly tickets: SupportTicketService,
    private readonly platformReplies: PlatformReplyDeliveryCadenceJob,
  ) {}
  onModuleInit(): void {
    this.registry.register(new DisputeEscalatedHandler(this.tickets));   // escalated dispute → auto-open P1 ticket
    // PC-56 ADMIN-2d. NOT behind a per-job env gate, unlike the settlement/payout jobs: those move money and a founder
    // may legitimately want them off in an environment. This one is the ONLY path by which a reply an operator has
    // already written reaches the farmer, so a disabled tick means a queue of answers nobody receives — which is the
    // silent failure the whole wave exists to remove. The runner-wide JOBS_ENABLED kill-switch still applies.
    this.jobs.register(this.platformReplies);
  }
}
