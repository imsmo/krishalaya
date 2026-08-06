// apps/admin-api/src/modules/support-oversight/services/sla-breach-monitor.service.ts · READ-ONLY cross-tenant
// ticket + SLA-breach views for the platform NOC: the general ticket queue (filterable), the SLA-breach queue
// (most-urgent first), and a single ticket detail with its computed SLA state. Keyset, bounded; no writes.
import { Injectable } from '@nestjs/common';
import { SupportOversightRepository, TicketListQuery, BreachListQuery } from '../repositories/support-oversight.repository';
import { TicketNotFoundError } from '../domain/support-oversight.errors';

@Injectable()
export class SlaBreachMonitorService {
  constructor(private readonly repo: SupportOversightRepository) {}

  async listTickets(q: TicketListQuery) {
    const items = (await this.repo.listTickets(q)).map((t) => t.toJSON());
    return { items, nextCursor: this.cursor(items, q.limit) };
  }

  async listBreaches(q: BreachListQuery) {
    const items = (await this.repo.listBreaches(q)).map((t) => t.toJSON());
    // breach queue is severity-then-age ordered (not created_at keyset) — cursor by the last (created_at,id) is
    // still monotonic within a severity band; expose it for continuation.
    return { items, nextCursor: this.cursor(items, q.limit) };
  }

  async getTicket(id: string) {
    const t = await this.repo.getTicket(id);
    if (!t) throw new TicketNotFoundError(id);
    return t.toJSON();
  }

  private cursor(items: any[], limit: number): string | null {
    const last = items[items.length - 1];
    return items.length === limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
  }

  /** Counts per status for the queue's filter chips (PC-56 ADMIN-2b, canon W005). A chip with no number is honest; a
   *  chip with a WRONG number sends somebody to a list that does not match it, so this is the real cross-tenant count
   *  rather than a count of the page in front of them. */
  async ticketCounts() {
    return { counts: await this.repo.ticketCountsByStatus() };
  }
}
