// apps/admin-api/src/modules/billing-ops/services/invoice-bulk.service.ts · BULK invoice transitions
// (PC-56 ADMIN-1d, closes ADMIN-1-Q11 — the gap ADMIN-1c refused to fake with a browser loop).
//
// WHY THIS IS A SERVER ENDPOINT AND NOT A LOOP IN THE CONSOLE. A bulk bar that fired N single requests from a browser
// would give an operator no idea what actually happened: a closed laptop halfway through leaves half the batch moved,
// and there is no record anywhere that a BATCH was even attempted. Here the batch itself is a first-class fact.
//
// THE THREE RULES THAT MAKE IT SAFE:
//   1. PER-INVOICE TRANSACTION, NOT ONE BIG ONE. Each invoice moves in its own tx with its own audit row. A single
//      transaction over 100 invoices would mean one illegal transition rolls back 99 legal ones — and it would hold
//      locks across the whole batch. So a partial success is a real, reported outcome rather than an accident.
//   2. EVERY OUTCOME IS RETURNED, NAMED. The response lists each invoice as moved / skipped-illegal / not-found /
//      failed. "42 of 50 succeeded" without saying WHICH eight is a message that forces someone to re-check all 50.
//   3. ONE AUDIT ROW PER INVOICE, PLUS ONE FOR THE BATCH. The per-invoice rows are what an auditor follows; the batch
//      row is what explains why forty invoices changed within the same second, which otherwise looks like a runaway.
//
// `void` is the destructive one, so the batch is capped and the reason is mandatory — the same reason string is
// recorded against every invoice in the batch, which is honest: it IS one decision applied to many.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { BillingRepository } from '../repositories/billing.repository';
import { IllegalInvoiceTransitionError } from '../domain/invoice.state';
import { InvalidBulkActionError } from '../domain/billing-ops.errors';
import { BULK_ACTIONS, isBulkAction, MAX_BULK_INVOICES, type BulkAction } from '../domain/invoice-bulk';
import { BulkInvoiceDto } from '../dto/billing-ops.dto';

export type BulkOutcome = 'moved' | 'illegal' | 'not_found' | 'failed';

@Injectable()
export class InvoiceBulkService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: BillingRepository,
  ) {}

  async run(actor: AdminRequestContext, dto: BulkInvoiceDto) {
    if (!isBulkAction(dto.action)) throw new InvalidBulkActionError(`action must be one of ${BULK_ACTIONS.join('|')}`);
    const ids = [...new Set(dto.invoiceIds)];          // a duplicated id is one invoice, not two attempts
    if (ids.length === 0) throw new InvalidBulkActionError('no invoices selected');
    if (ids.length > MAX_BULK_INVOICES) {
      throw new InvalidBulkActionError(`a batch may contain at most ${MAX_BULK_INVOICES} invoices; split it`);
    }
    const action: BulkAction = dto.action;
    const batchId = randomUUID();

    const results: Array<{ invoiceId: string; outcome: BulkOutcome; from?: string; to?: string; detail?: string }> = [];

    for (const invoiceId of ids) {
      try {
        // One tx per invoice: an illegal transition on #7 must not roll back #1–#6.
        const moved = await this.pool.withTx(async (client) => {
          const inv = await this.repo.getInvoiceForUpdate(client, invoiceId);
          if (!inv) return null;
          const from = inv.status;
          // the aggregate's own machine decides — the bulk path gets no special dispensation
          if (action === 'issue') inv.issue();
          else if (action === 'mark_overdue') inv.markOverdue();
          else inv.void();
          await this.repo.updateInvoiceStatus(client, invoiceId, inv.status, actor.userId);
          await this.audit.write(client, {
            actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
            action: `billing.invoice_${action === 'mark_overdue' ? 'overdue' : action === 'issue' ? 'issued' : 'voided'}`,
            entityType: 'saas_invoice', entityId: invoiceId,
            oldValue: { status: from },
            // the batch id on every row is what ties forty simultaneous changes together for whoever reads this later
            newValue: { status: inv.status, bulkBatchId: batchId },
            reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
          });
          return { from, to: inv.status };
        });

        if (!moved) results.push({ invoiceId, outcome: 'not_found' });
        else results.push({ invoiceId, outcome: 'moved', from: moved.from, to: moved.to });
      } catch (e: unknown) {
        if (e instanceof IllegalInvoiceTransitionError) {
          // NOT an error for the batch: this invoice was simply not in a state the action applies to. Reported per
          // invoice so the operator can see which ones they mis-selected.
          results.push({ invoiceId, outcome: 'illegal', detail: `${e.from} → ${e.to}` });
        } else {
          results.push({ invoiceId, outcome: 'failed', detail: e instanceof Error ? e.message : 'unknown error' });
        }
      }
    }

    const summary = {
      moved: results.filter((r) => r.outcome === 'moved').length,
      illegal: results.filter((r) => r.outcome === 'illegal').length,
      notFound: results.filter((r) => r.outcome === 'not_found').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
    };

    // The batch row. Written AFTER the work, with the real counts — a batch row written first would claim an intention
    // as an outcome, and the audit ledger is for what happened.
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'billing.invoices_bulk_transition', entityType: 'billing_bulk_batch', entityId: batchId,
      newValue: { action, requested: ids.length, ...summary },
      reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
    });

    return { batchId, action, requested: ids.length, ...summary, results };
  }
}
