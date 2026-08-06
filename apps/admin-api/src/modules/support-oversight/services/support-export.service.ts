// apps/admin-api/src/modules/support-oversight/services/support-export.service.ts · audit-stamped EXPORTS for the
// support plane (PC-56 ADMIN-2c, closes ADMIN-2-Q5).
//
// THE RECEIPT LAW (Ledger Appendix 5, W054-10), implemented exactly as ADMIN-1d's BillingExportService does it: the
// receipt is written to the audit ledger BEFORE any row is handed back, and NO RECEIPT MEANS NO FILE. An export that
// could not be recorded must not happen, or the one export somebody wanted hidden is the one whose audit write
// "failed". One law, one shape, now three surfaces (apps/api's GovExportService, billing, support).
//
// WHAT THIS SERVICE ADDS BEYOND THE BILLING ONE, and why:
//   • THE RECEIPT NAMES A VERBATIM EXPORT AS SUCH. A CSV of free text farmers wrote about their own money is a
//     different act from a CSV of counts, and six months later "an export happened" is not enough to answer "did
//     anybody take the comments out of this system?". `containsVerbatim` puts that in the audit row.
//   • A DATE WINDOW IS MANDATORY on every report here. Billing could export "all tenants" sensibly; there is no sensible
//     unbounded export of support conversations, and an operator who did not choose a period did not decide anything.
//   • COACHING IS NOT EXPORTABLE. See `NOT_EXPORTABLE` in the domain — the refusal is named rather than left as a
//     missing case, so the next person to look for it finds the reason instead of adding it.
//
// Reads only. Bounded. The service returns rows + columns + receipt; the console renders the bytes (same division as
// ADMIN-1d: generating a file server-side would mean storing it, which is a retention decision with a named owner).
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SupportOversightRepository } from '../repositories/support-oversight.repository';
import { InvalidSupportPolicyError } from '../domain/support-oversight.errors';
import {
  SUPPORT_EXPORT_REPORTS, isSupportExportReport, supportExportColumns, containsVerbatim,
  type SupportExportReport,
} from '../domain/support-export';
import type { SupportExportDto } from '../dto/support-oversight.dto';

/** Hard ceiling, matching the billing plane. Past this an export is a warehouse question, not a console download. */
export const MAX_SUPPORT_EXPORT_ROWS = 5000;
const DEFAULT_ROWS = 1000;

@Injectable()
export class SupportExportService {
  constructor(
    private readonly audit: AdminAuditWriter,
    private readonly repo: SupportOversightRepository,
  ) {}

  async export(actor: AdminRequestContext, dto: SupportExportDto) {
    if (!isSupportExportReport(dto.report)) {
      throw new InvalidSupportPolicyError(`report must be one of ${SUPPORT_EXPORT_REPORTS.join('|')}`);
    }
    const report: SupportExportReport = dto.report;

    // A WINDOW IS MANDATORY. Unlike billing, there is no coherent unbounded export here: "every support conversation
    // ever" is not a report anybody asked a question with, and an operator who did not pick a period did not decide
    // what they were taking out of the system.
    if (!dto.from || !dto.to) {
      throw new InvalidSupportPolicyError('a support export needs a from and to date — there is no meaningful unbounded export of support data');
    }
    if (Date.parse(dto.from) >= Date.parse(dto.to)) {
      throw new InvalidSupportPolicyError('the export window must end after it starts');
    }

    // CLAMPED, not dropped: a page size is a request about the transfer, not a question about the data, so an
    // over-large limit becomes the maximum rather than silently reverting to the default. (ADMIN-1d's spec caught the
    // opposite bug in the billing console's regex, which is why this is stated.)
    const limit = Math.min(Math.max(dto.limit ?? DEFAULT_ROWS, 1), MAX_SUPPORT_EXPORT_ROWS);

    const rows = await this.rowsFor(report, { from: dto.from, to: dto.to, tenantId: dto.tenantId, maxScore: dto.maxScore, limit });
    const receiptId = randomUUID();
    const generatedAt = new Date().toISOString();
    const hasVerbatim = containsVerbatim(report);

    // BEFORE the rows go anywhere. If this throws, the caller gets an error and no data.
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'support.report_exported', entityType: 'support_export_receipt', entityId: receiptId,
      newValue: {
        report,
        filters: { from: dto.from, to: dto.to, tenantId: dto.tenantId ?? null, maxScore: dto.maxScore ?? null, limit },
        rowCount: rows.length,
        // a partial CSV that looks complete is how an analysis goes quietly wrong months later
        truncated: rows.length >= limit,
        // the fact that matters when somebody later asks what left the system
        containsFreeText: hasVerbatim,
        generatedAt,
      },
      reason: hasVerbatim
        ? `support export: ${report} (contains free text written by people)`
        : `support export: ${report}`,
      ip: actor.ip, requestId: actor.requestId || null,
    });

    return {
      receipt: {
        id: receiptId, report, generatedAt, generatedBy: actor.userId,
        rowCount: rows.length, truncated: rows.length >= limit,
        containsFreeText: hasVerbatim,
        filters: { from: dto.from, to: dto.to, tenantId: dto.tenantId ?? null, maxScore: dto.maxScore ?? null },
      },
      columns: supportExportColumns(report),
      rows,
    };
  }

  private async rowsFor(
    report: SupportExportReport,
    q: { from: string; to: string; tenantId?: string; maxScore?: number; limit: number },
  ): Promise<Array<Record<string, unknown>>> {
    switch (report) {
      case 'tickets':
        return this.repo.exportTickets({ from: q.from, to: q.to, tenantId: q.tenantId, limit: q.limit });
      case 'sla_breaches':
        return this.repo.exportSlaBreaches({ from: q.from, to: q.to, tenantId: q.tenantId, limit: q.limit });
      case 'csat':
        return this.repo.exportCsat({ from: q.from, to: q.to, tenantId: q.tenantId, maxScore: q.maxScore, withComment: false, limit: q.limit });
      case 'csat_verbatims':
        // only rows that HAVE words: a verbatim export padded with empty comment cells invites the reader to conclude
        // that most people said nothing, when in fact most rows simply do not belong in this report
        return this.repo.exportCsat({ from: q.from, to: q.to, tenantId: q.tenantId, maxScore: q.maxScore, withComment: true, limit: q.limit });
      case 'csat_reviews':
        return this.repo.exportCsatReviews({ from: q.from, to: q.to, tenantId: q.tenantId, limit: q.limit });
      default:
        throw new InvalidSupportPolicyError(`unsupported report ${report}`);
    }
  }
}
