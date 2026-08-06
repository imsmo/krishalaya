// apps/admin-api/src/modules/billing-ops/services/billing-export.service.ts · audit-stamped EXPORTS for the platform
// billing plane (PC-56 ADMIN-1d, closes ADMIN-1-Q3).
//
// THE RECEIPT LAW (Ledger Appendix 5, W054-10): "every export any wave ships must return an audit-stamped receipt".
// An export is a READ THAT LEAVES A TRAIL. Platform billing data is the most sensitive read in the product — it is
// every tenant's commercial terms and every rupee they owe — and a CSV of it can be forwarded anywhere. So the receipt
// (who, when, which filters, how many rows) is written to the audit ledger IN THE SAME breath as the rows are
// produced, and the receipt id travels back WITH the data so the file an operator saves carries its own provenance.
// This mirrors apps/api's `GovExportService` deliberately: one law, one shape, two realms.
//
// WHAT IS NOT HERE, AND WHY:
//   • NO FILE IS GENERATED. The service returns rows + a receipt; the console renders CSV. Generating a file
//     server-side would mean storing it, which means deciding how long a snapshot of every tenant's billing lives in
//     a bucket — a retention decision with a named owner, not a side effect of a download button.
//   • THE GSTR EXPORT IS A FILING EXTRACT, NOT A FILING. It returns the invoice fields a GST return needs, exactly as
//     they were filed on each invoice, and computes NOTHING: no tax re-derivation, no bucketing by rate. An export
//     that silently recomputed GST would produce a return that disagrees with the invoices the tenants hold.
//
// Reads only. Bounded (`MAX_EXPORT_ROWS`) — an unbounded export is an availability incident waiting for a slow month.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { BillingRepository } from '../repositories/billing.repository';
import { InvalidExportError } from '../domain/billing-ops.errors';
import { EXPORT_REPORTS, isExportReport, exportColumns, type ExportReport } from '../domain/billing-export';
import { QueryExportDto } from '../dto/billing-ops.dto';

/** Hard row ceiling. Past this an export is a data-warehouse question, not a console download — and a console that
 *  streams 200k rows through a Node process to a browser is an outage with a friendly button. */
export const MAX_EXPORT_ROWS = 5000;

@Injectable()
export class BillingExportService {
  constructor(
    private readonly audit: AdminAuditWriter,
    private readonly repo: BillingRepository,
  ) {}

  async export(actor: AdminRequestContext, dto: QueryExportDto) {
    if (!isExportReport(dto.report)) {
      throw new InvalidExportError(`report must be one of ${EXPORT_REPORTS.join('|')}`);
    }
    const report: ExportReport = dto.report;
    const limit = Math.min(dto.limit ?? 1000, MAX_EXPORT_ROWS);

    const rows = await this.rowsFor(report, { ...dto, limit });
    const receiptId = randomUUID();
    const generatedAt = new Date().toISOString();

    // The receipt is written BEFORE the rows are handed back, and a failure to write it fails the whole export: an
    // export that could not be recorded must not happen at all. That is the point of the law — otherwise the one
    // export somebody wanted to hide is the one whose audit write "failed".
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'billing.report_exported', entityType: 'billing_export_receipt', entityId: receiptId,
      newValue: {
        report,
        filters: { tenantId: dto.tenantId ?? null, status: dto.status ?? null, from: dto.from ?? null, to: dto.to ?? null, limit },
        rowCount: rows.length,
        // recorded so a later reader can tell a TRUNCATED export from a complete one — a partial CSV that looks
        // complete is how a reconciliation goes wrong months later
        truncated: rows.length >= limit,
        generatedAt,
      },
      reason: `billing export: ${report}`,
      ip: actor.ip, requestId: actor.requestId || null,
    });

    return {
      receipt: {
        id: receiptId, report, generatedAt, generatedBy: actor.userId, rowCount: rows.length,
        truncated: rows.length >= limit,
        filters: { tenantId: dto.tenantId ?? null, status: dto.status ?? null, from: dto.from ?? null, to: dto.to ?? null },
      },
      columns: exportColumns(report),
      rows,
    };
  }

  private async rowsFor(report: ExportReport, q: QueryExportDto & { limit: number }): Promise<Array<Record<string, unknown>>> {
    switch (report) {
      case 'tenants':
        return this.repo.exportTenants(q.limit);
      case 'plans':
        return this.repo.exportPlans(q.limit);
      case 'invoices':
        return this.repo.exportInvoices({ tenantId: q.tenantId, status: q.status, from: q.from, to: q.to, limit: q.limit });
      case 'gstr':
        // a filing extract needs a period, not a cursor — an unbounded GST extract is meaningless
        if (!q.from || !q.to) throw new InvalidExportError('the GSTR extract needs a from and to date (the filing period)');
        return this.repo.exportGstr({ from: q.from, to: q.to, limit: q.limit });
      case 'revenue':
        return this.repo.exportRevenueByMonth(q.currency ?? 'INR', 12);
      default:
        throw new InvalidExportError(`unsupported report ${report}`);
    }
  }
}
