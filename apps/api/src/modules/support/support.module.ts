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

@Module({
  imports: [CommunicationModule],
  controllers: [TicketsController],
  providers: [SupportTicketService, SupportThreadService, SupportTicketRepository,
    // PC-56 ADMIN-2c: the CSAT ledger (0099) — a rating is appended, never overwritten
    CsatResponseRepository],
  exports: [SupportTicketService],
})
export class SupportModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly tickets: SupportTicketService,
  ) {}
  onModuleInit(): void {
    this.registry.register(new DisputeEscalatedHandler(this.tickets));   // escalated dispute → auto-open P1 ticket
  }
}
