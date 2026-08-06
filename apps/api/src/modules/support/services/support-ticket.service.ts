// modules/support/services/support-ticket.service.ts · the helpdesk use-cases (money-free).
// open: any user files a ticket (SLA due derived from severity). Agent actions (assign/respond/transition/
// resolve/close/escalate) need support.handle + write an audit row in the same tx; the first agent response
// stamps first_responded_at. Reads are owner-or-agent (404 for a stranger — no IDOR). One ACID tx per write,
// outbox in-tx (Law 4), authz THROWS (Law 6). Auto-open (from a dispute escalation) is idempotent by ticket_no.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { SupportTicket } from '../domain/support-ticket.entity';
import { DomainEvent, TicketChannel, TicketSeverity } from '../domain/support.events';
import { TicketStatus, isWorking } from '../domain/support-ticket.state';
import { SupportTicketRepository } from '../repositories/support-ticket.repository';
import { CsatResponseRepository } from '../repositories/csat-response.repository';
import { OpenTicketDto } from '../dto/create-support-ticket.dto';
import { TransitionTicketDto } from '../dto/update-support-ticket.dto';
import { TicketNotFoundError, SupportForbiddenError } from '../domain/support.errors';

export interface SupportActor { userId: string; isAgent: boolean; }
const ticketNo = () => `KV-T-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

@Injectable()
export class SupportTicketService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: SupportTicketRepository,
    // PC-56 ADMIN-2c: the append-only rating ledger (0099)
    private readonly csat: CsatResponseRepository,
  ) {}

  async open(tenantId: string, actor: SupportActor, idemKey: string, dto: OpenTicketDto) {
    return this.idem.remember(idemKey, actor.userId, 'support.ticket.open', () =>
      timed(this.metrics, 'support.ticket.open', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const t = SupportTicket.open({ id: uuidv7(), tenantId, ticketNo: ticketNo(), requesterUserId: actor.userId, channel: dto.channel as TicketChannel,
            categoryId: dto.categoryId ?? null, severity: dto.severity as TicketSeverity, subject: dto.subject ?? null, conversationId: null });
          await this.repo.insert(tx, t);
          await this.flush(tx, tenantId, t.id, t.pullEvents());
          return t.toJSON();
        }, { userId: actor.userId })));
  }

  /** Idempotent auto-open from another module (e.g. dispute escalation). Keyed on a deterministic ticket_no. */
  async autoOpen(tx: TxContext, input: { tenantId: string; ticketNo: string; requesterUserId: string | null; channel: TicketChannel; severity: TicketSeverity; subject: string; categoryId: string | null }): Promise<void> {
    if (await this.repo.existsByTicketNo(tx, input.ticketNo)) return;   // already opened — idempotent
    const t = SupportTicket.open({ id: uuidv7(), tenantId: input.tenantId, ticketNo: input.ticketNo, requesterUserId: input.requesterUserId, channel: input.channel,
      categoryId: input.categoryId, severity: input.severity, subject: input.subject, conversationId: null });
    await this.repo.insert(tx, t);
    await this.flush(tx, input.tenantId, t.id, t.pullEvents());
  }

  async assign(tenantId: string, actor: SupportActor, id: string, assigneeUserId: string, ip: string | null) {
    return this.agentMutate(tenantId, actor, id, (t) => t.assign(assigneeUserId), 'support.ticket_assigned', ip);
  }
  async transition(tenantId: string, actor: SupportActor, id: string, dto: TransitionTicketDto, ip: string | null) {
    return this.agentMutate(tenantId, actor, id, (t) => { t.recordFirstResponse(); t.transition(dto.to as TicketStatus); }, `support.ticket_${dto.to}`, ip, dto.note ?? null);
  }
  async respond(tenantId: string, actor: SupportActor, id: string, ip: string | null) {
    return this.agentMutate(tenantId, actor, id, (t) => t.recordFirstResponse(), 'support.ticket_responded', ip);
  }
  /**
   * Rate a ticket. PC-56 ADMIN-2c changed what this method WRITES, not who may call it.
   *
   * Before: the score went into `support_tickets.csat_score`, a single overwritable column that the entity CLEARS on
   * reopen — so a rating a farmer had given was destroyed the moment the desk reopened their ticket, and the ratings
   * most likely to be followed by a reopen are the bad ones. The desk was systematically losing exactly the feedback it
   * needed.
   *
   * Now: every rating is APPENDED to `support_csat_responses` (0099), optionally with the farmer's own words and the
   * language they wrote them in, and the ticket's column is re-derived from the ledger to mean "the latest rating".
   * Both writes happen in ONE transaction (Law 4) — a ledger row without its derived column, or a column without its
   * row, is a disagreement between two representations of the same fact.
   *
   * The ledger insert is deduped per rating OCCASION (ticket, respondent, current status), so a double-tap on a flaky
   * connection records one rating while a genuine re-rating after the ticket moves on records a second. `recorded`
   * tells the caller which happened, because reporting "thank you for your rating" twice for one tap is a small lie.
   */
  async submitCsat(tenantId: string, actor: SupportActor, id: string, dto: { score: number; comment?: string | null; commentLanguage?: string | null }) {
    return this.uow.run(tenantId, async (tx) => {
      const t = await this.repo.getForUpdate(tx, tenantId, id);
      if (!t || (t.requesterUserId !== actor.userId && !actor.isAgent)) throw new TicketNotFoundError(id);   // requester-owned, 404 IDOR
      if (t.requesterUserId !== actor.userId) throw new SupportForbiddenError('only the requester may rate the ticket');

      // The entity still owns the RULES (closable status, integer 1-5) — this method must not re-implement them.
      t.submitCsat(dto.score);

      const before = t.toProps();
      const comment = dto.comment?.trim() || null;
      const appended = await this.csat.append(tx, {
        tenantId, ticketId: id, respondentUserId: actor.userId, score: dto.score,
        comment,
        // null when there is no comment: 0099 CHECKs the pair, and a language recorded against no text is noise
        commentLanguage: comment ? (dto.commentLanguage ?? null) : null,
        // copied so a later reassignment cannot silently re-attribute this rating to a different agent, and so a 5 given
        // on a resolved ticket stays distinguishable from a 5 given on a reopened one
        ticketStatus: before.status,
        ratedAgentUserId: before.assigneeUserId ?? null,
      });

      // The column means "the latest rating". Read back inside the same transaction rather than assuming this insert
      // won: if the ledger deduped, the latest rating is whatever was already there, and writing `score` regardless
      // would let the column drift away from the ledger it is supposed to summarise.
      const latest = await this.csat.latestScoreFor(tx, tenantId, id);
      t.setDerivedCsatScore(latest);
      await this.repo.update(tx, t);
      return { ...t.toJSON(), csatRecorded: appended !== null, csatResponseId: appended?.id ?? null };
    }, { userId: actor.userId });
  }

  /** Every rating this ticket has ever had — impossible before 0099, because a reopen deleted the previous one. */
  async csatHistory(tenantId: string, actor: SupportActor, id: string) {
    const t = await this.repo.getById(tenantId, id);
    if (!t || (t.requesterUserId !== actor.userId && !actor.isAgent)) throw new TicketNotFoundError(id);   // 404, no IDOR
    return this.csat.historyFor(tenantId, id);
  }
  async getById(tenantId: string, actor: SupportActor, id: string) {
    const t = await this.repo.getById(tenantId, id);
    if (!t || (t.requesterUserId !== actor.userId && !actor.isAgent)) throw new TicketNotFoundError(id);   // 404, no IDOR
    return t.toJSON();
  }
  async list(tenantId: string, actor: SupportActor, q: { box: 'mine' | 'assigned' | 'queue'; status?: string; severity?: string; cursor?: { c: string; id: string }; limit: number }) {
    if ((q.box === 'queue' || q.box === 'assigned') && !actor.isAgent) throw new SupportForbiddenError('requires support.handle');
    const rows = await this.repo.listFor(tenantId, { box: q.box, requesterUserId: q.box === 'mine' ? actor.userId : undefined, assigneeUserId: q.box === 'assigned' ? actor.userId : undefined, status: q.status, severity: q.severity, cursor: q.cursor, limit: q.limit });
    const items = rows.map((t) => t.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  /** System SLA escalation (the worker job). No agent gate; idempotent — skips non-working/already-escalated. */
  async escalateOverdue(tenantId: string, id: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const t = await this.repo.getForUpdate(tx, tenantId, id);
      if (!t || t.status === 'escalated' || !isWorking(t.status)) return false;
      t.transition('escalated');
      await this.repo.update(tx, t);
      await this.flush(tx, tenantId, id, t.pullEvents());
      return true;
    }, { userId: 'system' });
  }

  private async agentMutate(tenantId: string, actor: SupportActor, id: string, fn: (t: SupportTicket) => void, action: string, ip: string | null, note: string | null = null) {
    if (!actor.isAgent) throw new SupportForbiddenError('requires support.handle');
    return this.uow.run(tenantId, async (tx) => {
      const t = await this.repo.getForUpdate(tx, tenantId, id);
      if (!t) throw new TicketNotFoundError(id);
      fn(t);
      await this.repo.update(tx, t);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'support_ticket', entityId: id, newValue: { status: t.status, assignee: t.assigneeUserId }, reason: note, ip });
      await this.flush(tx, tenantId, id, t.pullEvents());
      return t.toJSON();
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'support_ticket', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
