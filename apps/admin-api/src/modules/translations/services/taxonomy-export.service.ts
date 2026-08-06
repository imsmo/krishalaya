// apps/admin-api/src/modules/translations/services/taxonomy-export.service.ts · audit-stamped TAXONOMY exports
// (PC-56 ADMIN-3b, closes ADMIN-3-Q2 — canon W019's "Export tree", W028's "Export missing").
//
// The W054-10 receipt law, third surface: the receipt is written to the audit ledger BEFORE any row is handed back, and
// NO RECEIPT MEANS NO FILE. One law, one shape, now four planes (apps/api's gov exports, billing, support, taxonomy).
//
// WHAT THIS ONE DOES DIFFERENTLY, AND WHY:
//   • NO DATE WINDOW. A taxonomy is a current state rather than a stream of events; "the categories as they are now" is
//     the useful export and demanding a window would be ceremony borrowed from a different kind of data.
//   • THE MISSING-TRANSLATIONS REPORT REQUIRES A LANGUAGE, and the refusal says why: "missing" is meaningless without
//     naming what it is missing FROM.
//   • A HIGHER ROW CEILING than the other planes (20,000 vs 5,000). A category tree is 214 rows and a missing-translation
//     list is legitimately thousands — the ceiling exists to stop an accident, not to stop the job.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { TranslationsRepository } from '../repositories/translations.repository';
import { InvalidTranslationError } from '../domain/translations.errors';
import {
  TAXONOMY_EXPORT_REPORTS, isTaxonomyExportReport, taxonomyExportColumns, needsLanguage,
  type TaxonomyExportReport,
} from '../domain/taxonomy-export';
import type { TaxonomyExportDto } from '../dto/translations.dto';

export const MAX_TAXONOMY_EXPORT_ROWS = 20_000;
const DEFAULT_ROWS = 5_000;

@Injectable()
export class TaxonomyExportService {
  constructor(
    private readonly audit: AdminAuditWriter,
    private readonly repo: TranslationsRepository,
  ) {}

  async export(actor: AdminRequestContext, dto: TaxonomyExportDto) {
    if (!isTaxonomyExportReport(dto.report)) {
      throw new InvalidTranslationError(`report must be one of ${TAXONOMY_EXPORT_REPORTS.join('|')}`);
    }
    const report: TaxonomyExportReport = dto.report;
    const languageCode = dto.languageCode?.trim().toLowerCase();

    if (needsLanguage(report) && !languageCode) {
      throw new InvalidTranslationError('the missing-translations export needs a language — "missing" means nothing without saying missing from what');
    }
    if (languageCode) {
      const languages = await this.repo.activeLanguages();
      if (!languages.some((l) => l.code === languageCode)) {
        throw new InvalidTranslationError(`${languageCode} is not an active platform language`);
      }
    }

    // CLAMPED, not dropped: a row ceiling is a request about the transfer, not a question about the data
    const limit = Math.min(Math.max(dto.limit ?? DEFAULT_ROWS, 1), MAX_TAXONOMY_EXPORT_ROWS);
    const rows = await this.rowsFor(report, languageCode, limit);
    const receiptId = randomUUID();
    const generatedAt = new Date().toISOString();

    // BEFORE the rows go anywhere. If this throws, the caller gets an error and no data.
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'catalogue.taxonomy_exported', entityType: 'taxonomy_export_receipt', entityId: receiptId,
      newValue: {
        report, filters: { languageCode: languageCode ?? null, limit },
        rowCount: rows.length,
        // a partial file that looks complete is how a translation project silently misses a thousand keys
        truncated: rows.length >= limit,
        generatedAt,
      },
      reason: languageCode ? `taxonomy export: ${report} (${languageCode})` : `taxonomy export: ${report}`,
      ip: actor.ip, requestId: actor.requestId || null,
    });

    return {
      receipt: {
        id: receiptId, report, generatedAt, generatedBy: actor.userId,
        rowCount: rows.length, truncated: rows.length >= limit,
        filters: { languageCode: languageCode ?? null },
      },
      columns: taxonomyExportColumns(report),
      rows,
    };
  }

  private async rowsFor(report: TaxonomyExportReport, languageCode: string | undefined, limit: number) {
    switch (report) {
      case 'category_tree': return this.repo.exportCategoryTree(limit);
      case 'attributes': return this.repo.exportAttributes(limit);
      case 'lookup_values': return this.repo.exportLookupValues(limit);
      case 'missing_translations': return this.repo.exportMissingTranslations(languageCode as string, limit);
      default: throw new InvalidTranslationError(`unsupported report ${report}`);
    }
  }
}
