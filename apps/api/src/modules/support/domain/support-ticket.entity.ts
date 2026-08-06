// modules/support/domain/support-ticket.entity.ts · the support_tickets aggregate (helpdesk, money-free).
// Lifecycle via support-ticket.state (Law 5). SLA due dates are derived from severity at open. first_responded_at
// is stamped once (the first agent reply). CSAT (1-5) is captured only on a resolved/closed ticket. No version →
// repo locks FOR UPDATE on mutation.
import { TicketChannel, TicketSeverity, DomainEvent, SupportEventType } from './support.events';
import { TicketStatus, assertTransition, isClosable } from './support-ticket.state';
import { InvalidTicketError, TicketNotResolvedError } from './support.errors';

// First-response / resolution SLA in MINUTES, by severity (PRD §50 helpdesk).
const SLA_MINUTES: Readonly<Record<TicketSeverity, { firstResponse: number; resolution: number }>> = Object.freeze({
  P0: { firstResponse: 15, resolution: 240 }, P1: { firstResponse: 60, resolution: 480 },
  P2: { firstResponse: 240, resolution: 1440 }, P3: { firstResponse: 480, resolution: 4320 },
});

export interface SupportTicketProps {
  id: string; tenantId: string; ticketNo: string; requesterUserId: string | null; channel: TicketChannel; categoryId: string | null;
  severity: TicketSeverity; subject: string | null; status: TicketStatus; assigneeUserId: string | null; conversationId: string | null;
  slaFirstResponseDue: Date | null; slaResolutionDue: Date | null; firstRespondedAt: Date | null; resolvedAt: Date | null; csatScore: number | null; createdAt?: Date;
}
export class SupportTicket {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: SupportTicketProps) {}

  static open(input: Omit<SupportTicketProps, 'status' | 'assigneeUserId' | 'slaFirstResponseDue' | 'slaResolutionDue' | 'firstRespondedAt' | 'resolvedAt' | 'csatScore'> & { now?: Date }): SupportTicket {
    if (!input.subject && !input.categoryId) throw new InvalidTicketError('a ticket needs a subject or a category');
    const now = input.now ?? new Date();
    const sla = SLA_MINUTES[input.severity];
    const t = new SupportTicket({ ...input, status: 'open', assigneeUserId: null,
      slaFirstResponseDue: new Date(now.getTime() + sla.firstResponse * 60_000), slaResolutionDue: new Date(now.getTime() + sla.resolution * 60_000),
      firstRespondedAt: null, resolvedAt: null, csatScore: null });
    t.events.push({ type: SupportEventType.TicketOpened, payload: { ticketId: t.props.id, ticketNo: t.props.ticketNo, severity: t.props.severity, requesterUserId: t.props.requesterUserId } });
    return t;
  }
  static rehydrate(p: SupportTicketProps): SupportTicket { return new SupportTicket(p); }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get ticketNo() { return this.props.ticketNo; }
  get requesterUserId() { return this.props.requesterUserId; }
  get assigneeUserId() { return this.props.assigneeUserId; }
  get status() { return this.props.status; }
  toProps(): Readonly<SupportTicketProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  assign(assigneeUserId: string): void {
    this.props.assigneeUserId = assigneeUserId;
    this.events.push({ type: SupportEventType.TicketAssigned, payload: { ticketId: this.props.id, assigneeUserId } });
  }
  /** The first agent response stamps first_responded_at (once) for the SLA clock. */
  recordFirstResponse(): void {
    if (this.props.firstRespondedAt) return;
    this.props.firstRespondedAt = new Date();
    this.events.push({ type: SupportEventType.TicketFirstResponse, payload: { ticketId: this.props.id } });
  }
  transition(to: TicketStatus): void {
    assertTransition(this.props.status, to);
    const from = this.props.status; this.props.status = to;
    if (to === 'resolved') this.props.resolvedAt = new Date();
    if (to === 'reopened') { this.props.resolvedAt = null; this.props.csatScore = null; }
    const evt = to === 'escalated' ? SupportEventType.TicketEscalated : to === 'resolved' ? SupportEventType.TicketResolved : to === 'closed' ? SupportEventType.TicketClosed : to === 'reopened' ? SupportEventType.TicketReopened : null;
    if (evt) this.events.push({ type: evt, payload: { ticketId: this.props.id, from, to } });
  }
  /**
   * Set the DERIVED csat column from the 0099 ledger (PC-56 ADMIN-2c). Deliberately separate from `submitCsat`:
   * submitCsat is the FARMER'S ACT and enforces their rules (the ticket must be closable, the score must be 1-5); this
   * is bookkeeping that copies the ledger's latest value onto the ticket. Merging them would mean either the service
   * re-running the farmer's validation on a value that came from the database, or the entity trusting a caller to have
   * validated — and the column is allowed to be null (the ledger may be empty), which submitCsat must never accept.
   */
  setDerivedCsatScore(score: number | null): void {
    this.props.csatScore = score;
  }
  submitCsat(score: number): void {
    if (!isClosable(this.props.status)) throw new TicketNotResolvedError(this.props.status);
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new InvalidTicketError('csat_score must be an integer 1-5');
    this.props.csatScore = score;
  }
  toJSON() {
    const v = this.props;
    return { id: v.id, ticketNo: v.ticketNo, requesterUserId: v.requesterUserId, channel: v.channel, categoryId: v.categoryId, severity: v.severity, subject: v.subject,
      status: v.status, assigneeUserId: v.assigneeUserId, conversationId: v.conversationId, slaFirstResponseDue: v.slaFirstResponseDue, slaResolutionDue: v.slaResolutionDue,
      firstRespondedAt: v.firstRespondedAt, resolvedAt: v.resolvedAt, csatScore: v.csatScore, createdAt: v.createdAt };
  }
}
