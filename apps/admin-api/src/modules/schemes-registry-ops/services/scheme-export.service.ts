// apps/admin-api/src/modules/schemes-registry-ops/services/scheme-export.service.ts · audit-stamped scheme-registry
// exports (PC-56 ADMIN-4 — canon W069's "Export"/W078's "Export report", chain W2251 queued / W2252 ready).
//
// The W054-10 receipt law, FIFTH surface (apps/api gov exports, billing, support, taxonomy, now schemes). The receipt
// is written to the audit ledger BEFORE any row is handed back: NO RECEIPT MEANS NO FILE.
//
// WHAT THIS ONE DOES DIFFERENTLY:
//   • NO PERSON APPEARS IN ANY REPORT. Not an applicant, not an operator, not a reviewer — not even the maker or
//     checker of a version, which is why the version report carries `has_maker` / `has_checker` BOOLEANS instead of
//     ids. Whether a rule set went through two pairs of hands is the auditable fact; WHOSE hands is in the audit
//     ledger, behind its own permission, and does not belong in a file that gets emailed around.
//   • THE REFUSALS ARE ENUMERATED (domain/scheme-export.ts NOT_EXPORTABLE) rather than absent, because W074 and W076
//     both show an Export button and somebody will come looking for it here.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';
import {
  assertSchemeExportReport, schemeExportColumns, schemeExportFileName, isTruncated, NOT_EXPORTABLE,
  type SchemeExportReport,
} from '../domain/scheme-export';
import { ExportReportUnknownError } from '../domain/schemes-registry.errors';
import type { SchemeExportDto } from '../dto/schemes-registry.dto';

export const MAX_SCHEME_EXPORT_ROWS = 20_000;
const DEFAULT_ROWS = 5_000;

@Injectable()
export class SchemeExportService {
  constructor(private readonly audit: AdminAuditWriter, private readonly repo: SchemesRegistryRepository) {}

  async export(actor: AdminRequestContext, dto: SchemeExportDto) {
    // A named refusal BEFORE the generic one. Asking for `applications` here is a reasonable thing to try, and
    // "unknown report" would send the operator looking for a typo instead of telling them the reason.
    const refusal = NOT_EXPORTABLE[dto.report];
    if (refusal) throw new ExportReportUnknownError(`${dto.report} — ${refusal}`, ['schemes', 'authorities', 'versions', 'calendar']);
    const report = assertSchemeExportReport(dto.report);

    // CLAMPED, not rejected: a row ceiling is a statement about the transfer, not about the data.
    const limit = Math.min(Math.max(dto.limit ?? DEFAULT_ROWS, 1), MAX_SCHEME_EXPORT_ROWS);
    const rows = await this.rowsFor(report, limit);
    const receiptId = randomUUID();
    const generatedAtDate = new Date();
    const generatedAt = generatedAtDate.toISOString();
    const truncated = isTruncated(rows.length, limit);

    // BEFORE the rows go anywhere. If this throws, the caller gets an error and no data.
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'schemes.registry_exported', entityType: 'scheme_export_receipt', entityId: receiptId,
      newValue: { report, filters: { limit }, rowCount: rows.length, truncated, generatedAt },
      reason: `scheme registry export: ${report}`,
      ip: actor.ip, requestId: actor.requestId || null,
    });

    return {
      receipt: {
        id: receiptId, report, generatedAt, generatedBy: actor.userId,
        rowCount: rows.length, truncated,
        fileName: schemeExportFileName(report, receiptId, generatedAtDate),
        filters: { limit },
      },
      columns: schemeExportColumns(report),
      rows,
    };
  }

  private async rowsFor(report: SchemeExportReport, limit: number) {
    switch (report) {
      case 'schemes': return this.repo.exportSchemeRows(limit);
      case 'authorities': return this.repo.exportAuthorityRows(limit);
      case 'versions': return this.repo.exportVersionRows(limit);
      case 'calendar': return this.repo.exportCalendarRows(limit);
    }
  }
}
