// apps/admin-api/src/modules/billing-ops/services/dunning.service.ts · payment-failure follow-up on a SaaS
// invoice. Records a dunning touch (email/sms/call…) and bumps the invoice's attempt counter — one ACID tx per
// write (Law 4) + an append-only audit row IN THE SAME TX (§4). The invoice is locked FOR UPDATE so concurrent
// dunning touches serialise (attempt_no never collides); the domain caps total attempts (abuse/DoS guard, §4).
// Moves NO money — dunning is a workflow over an unpaid invoice.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { BillingRepository, DunningListQuery } from '../repositories/billing.repository';
import { SaasInvoiceNotFoundError } from '../domain/billing-ops.errors';
import { nextDunningAttempt } from '../domain/dunning';
import { RecordDunningDto } from '../dto/billing-ops.dto';

@Injectable()
export class DunningService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: BillingRepository) {}

  async record(actor: AdminRequestContext, invoiceId: string, dto: RecordDunningDto) {
    return this.pool.withTx(async (client) => {
      const inv = await this.repo.getInvoiceForUpdate(client, invoiceId);
      if (!inv) throw new SaasInvoiceNotFoundError(invoiceId);
      const attemptNo = nextDunningAttempt(inv.status, inv.dunningAttempts);   // throws InvalidDunningError
      await this.repo.insertDunningAttempt(client, { invoiceId, tenantId: inv.tenantId, attemptNo, channel: dto.channel, outcome: dto.outcome, note: dto.note ?? null, actorUserId: actor.userId });
      await this.repo.bumpInvoiceDunning(client, invoiceId, attemptNo);
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.invoice_dunned', entityType: 'saas_invoice', entityId: invoiceId,
        newValue: { attemptNo, channel: dto.channel, outcome: dto.outcome }, reason: dto.note ?? `dunning #${attemptNo} via ${dto.channel}`, ip: actor.ip, requestId: actor.requestId || null });
      return { invoiceId, attemptNo, channel: dto.channel, outcome: dto.outcome };
    });
  }

  /** The cross-invoice COLLECTION QUEUE (PC-56 ADMIN-1) — every invoice currently owed, worst-first. Read-only:
   *  it changes nothing and decides nothing, it just puts the debtors in front of the officer in the order that
   *  matters. Keyset is (days late, id) so the boundary between page 1 and page 2 cannot hide a debtor. */
  async queue(q: { minDaysLate?: number; cursor?: { d: number; id: string }; limit: number }) {
    const items = await this.repo.dunningQueue(q);
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last
      ? Buffer.from(`${last.daysLate}|${last.invoiceId}`).toString('base64') : null;
    return { items, nextCursor };
  }

  async list(q: DunningListQuery) {
    const items = await this.repo.listDunning(q);
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last
      ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
}
