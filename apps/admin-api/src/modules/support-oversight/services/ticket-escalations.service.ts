// apps/admin-api/src/modules/support-oversight/services/ticket-escalations.service.ts · the ONE consequential
// write: a platform operator ESCALATES a tenant's ticket (raise severity / move to 'escalated' / reassign to a
// platform lead) when the tenant's support is failing its SLA. One ACID tx: lock the ticket FOR UPDATE → domain
// escalate (raise-only severity, state machine, recomputed SLA clock, must-change) → UPDATE support_tickets →
// audit_log row, atomic (§4). Escalation goes through the ticket state machine (Law 5); a resolved/closed ticket
// can't be escalated; a reassign target must be a real user (404). Cross-tenant by design (kv_admin); audited.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SupportOversightRepository } from '../repositories/support-oversight.repository';
import { TicketNotFoundError, AssigneeNotFoundError } from '../domain/support-oversight.errors';
import { EscalateTicketDto, ResolveTicketDto } from '../dto/support-oversight.dto';
import { assertTransition } from '../domain/ticket.state';

@Injectable()
export class TicketEscalationsService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: SupportOversightRepository) {}

  async escalate(actor: AdminRequestContext, id: string, dto: EscalateTicketDto) {
    // Validate the reassign target up-front (outside the row lock) — 404 if it isn't a real user.
    if (dto.reassignToUserId && !(await this.repo.userExists(dto.reassignToUserId))) throw new AssigneeNotFoundError(dto.reassignToUserId);

    return this.pool.withTx(async (client) => {
      const ticket = await this.repo.getTicketForUpdate(client, id);
      if (!ticket) throw new TicketNotFoundError(id);
      const beforeJson = ticket.toJSON();
      const change = ticket.escalate(dto.severity ?? null, dto.reassignToUserId ?? null);   // throws on illegal/no-op/downgrade
      const after = ticket.toJSON();
      await this.repo.updateEscalation(client, id, {
        severity: after.severity as any, status: after.status as any, assigneeUserId: after.assigneeUserId,
        slaFirstResponseDue: change.slaFirstResponseDue, slaResolutionDue: change.slaResolutionDue,
      }, actor.userId);
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'support.ticket_escalated', entityType: 'support_ticket', entityId: id,
        oldValue: { tenantId: beforeJson.tenantId, severity: beforeJson.severity, status: beforeJson.status, assigneeUserId: beforeJson.assigneeUserId },
        newValue: { severity: after.severity, status: after.status, assigneeUserId: after.assigneeUserId, severityChange: change.severityChange, statusChange: change.statusChange },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null });
      return after;
    });
  }

  /**
   * RESOLVE a ticket from the oversight plane (PC-56 ADMIN-2b, part of ADMIN-2-Q3; canon W049's "Resolve — requires
   * outcome").
   *
   * THE OUTCOME IS MANDATORY, and that is the whole point of the endpoint. A ticket closed with no recorded outcome is
   * a farmer's problem marked "done" with nothing saying what was done — unanswerable when they come back, and
   * useless to the next agent who sees the same issue. The state machine decides legality (a closed ticket cannot be
   * re-resolved); the outcome is what makes the resolution a record.
   *
   * NOTE ON WHAT THIS DELIBERATELY DOES NOT DO: it does not send the farmer a reply. A reply is a message in the
   * ticket's CONVERSATION, and that rail (fan-out to the farmer's channel, attachments, read receipts) belongs to
   * apps/api. Writing a message straight into the table from here would bypass the notification fan-out — the ticket
   * would look answered and the farmer would never be told. That remains ADMIN-2-Q3's open half.
   */
  async resolve(actor: AdminRequestContext, id: string, dto: ResolveTicketDto) {
    return this.pool.withTx(async (client) => {
      const ticket = await this.repo.getTicketForUpdate(client, id);
      if (!ticket) throw new TicketNotFoundError(id);
      const before = ticket.status;
      // the mirrored machine refuses resolved→resolved and closed→resolved
      assertTransition(before, 'resolved');
      await this.repo.resolveTicket(client, id, 'resolved', actor.userId);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'support.ticket_resolved', entityType: 'support_ticket', entityId: id,
        oldValue: { status: before },
        newValue: { status: 'resolved', outcome: dto.outcome },
        reason: dto.outcome, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: 'resolved', from: before, outcome: dto.outcome };
    });
  }
}
