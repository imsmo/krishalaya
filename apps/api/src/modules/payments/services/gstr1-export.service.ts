// modules/payments/services/gstr1-export.service.ts · W151's "Export GSTR-1 data (month)" (PC-56 TENANT-3c-1).
//
// **THERE WAS NO GSTR-1 EXPORT ANYWHERE IN THE PLATFORM.** W151 draws the button; no route, no service, no query
// existed. This is that export, and it is deliberately synchronous with a receipt rather than a fake queue: apps/api
// has no async export-job infrastructure (admin-api's reports are a different realm), and W2434's "queued · position
// · ETA" over a call that returns in one round trip would be a progress bar for work that already finished.
//
// THREE REFUSALS, EACH BY NAME, BECAUSE A GST RETURN IS NOT A REPORT:
//   • the CURRENT month is refused — a return exported before the period closes changes after it is filed;
//   • a period beyond the row cap is refused rather than truncated — half a return that looks whole is the worst
//     artefact this wave could produce (the no-silent-caps rule);
//   • individual invoices that cannot be filed are EXCLUDED AND COUNTED BY REASON (domain/gstr1.ts), and the receipt
//     carries the coverage word: a file that quietly omitted a third of the month would read as complete.
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { AppError } from '../../../shared/errors/app-error';
import { InvoiceConsoleReadModel } from '../read-models/invoice-console.read-model';
import { CreditNoteRepository } from '../repositories/credit-note.repository';
import { gstr1Summarise, gstr1Verdict, isFiledPeriod, periodWindow, Gstr1Section } from '../domain/gstr1';
import { buildReceipt, ExportReceipt } from '../domain/export-receipt';

/** 50,000 invoices in one month is a very large tenant; beyond it the export refuses and asks for a narrower ask
 *  rather than silently returning the first 50,000 of a statutory return. */
export const GSTR1_ROW_CAP = 50_000;

export class Gstr1RefusedError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) { super(code, message, 409, details); }
}
export class Gstr1ForbiddenError extends AppError {
  constructor() { super('GSTR1_FORBIDDEN', 'Requires report.view (finance scope)', 403); }
}

export interface Gstr1Export {
  period: string;
  sections: Record<Gstr1Section, Array<{ invoiceNo: string; buyerGstin: string | null; placeOfSupplyCode: string | null; totalMinor: string; taxableMinor: string; taxMinor: string }>>;
  creditNotes: Array<{ creditNoteNo: string; invoiceId: string; totalMinor: string; taxableMinor: string; taxMinor: string; reasonCode: string; placeOfSupplyCode: string | null }>;
  excluded: Array<{ invoiceNo: string; reason: string }>;
  summary: ReturnType<typeof gstr1Summarise>;
  receipt: ExportReceipt;
}

@Injectable()
export class Gstr1ExportService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly console: InvoiceConsoleReadModel,
    private readonly creditNotes: CreditNoteRepository,
  ) {}

  async export(tenantId: string, actor: { userId: string; canFinance: boolean }, period: string, now: Date = new Date()): Promise<Gstr1Export> {
    if (!actor.canFinance) throw new Gstr1ForbiddenError();
    const window = periodWindow(period);
    if (!window) throw new Gstr1RefusedError('GSTR1_PERIOD_INVALID', 'period must be YYYY-MM');
    if (!isFiledPeriod(period, now)) {
      throw new Gstr1RefusedError('GSTR1_PERIOD_OPEN', 'this period has not closed yet — a return exported now would change after it is filed', { period });
    }

    const { rows, capped } = await this.console.gstr1Rows(tenantId, window, GSTR1_ROW_CAP);
    if (capped) {
      throw new Gstr1RefusedError('GSTR1_TOO_LARGE', `this period holds more than ${GSTR1_ROW_CAP} invoices; the export refuses rather than returning part of a return`, { cap: GSTR1_ROW_CAP });
    }

    const sections = { b2b: [], b2cl: [], b2cs: [] } as Gstr1Export['sections'];
    const excluded: Gstr1Export['excluded'] = [];
    for (const r of rows) {
      const v = gstr1Verdict(r);
      if (v.kind === 'excluded') { excluded.push({ invoiceNo: r.invoiceNo, reason: v.reason }); continue; }
      sections[v.section].push({
        invoiceNo: r.invoiceNo, buyerGstin: r.buyerGstin, placeOfSupplyCode: r.placeOfSupplyCode,
        totalMinor: r.totalMinor.toString(), taxableMinor: (r.taxableMinor ?? 0n).toString(), taxMinor: (r.taxMinor ?? 0n).toString(),
      });
    }
    const notes = await this.creditNotes.listForWindow(tenantId, window);
    const creditNotes = notes.map((n) => ({
      creditNoteNo: n.creditNoteNo, invoiceId: n.invoiceId, totalMinor: n.totalMinor,
      taxableMinor: n.taxableMinor, taxMinor: n.taxMinor, reasonCode: n.reasonCode, placeOfSupplyCode: n.placeOfSupplyCode,
    }));

    const summary = gstr1Summarise(rows);
    const payload = { period, sections, creditNotes };
    const generatedAt = now;
    const receipt = buildReceipt({
      fileName: `gstr1-${period}.json`,
      payload,
      rowCount: summary.filableCount + creditNotes.length,
      requestedBy: actor.userId,
      generatedAt,
      coverage: summary.coverage,
      omissions: Object.entries(summary.excluded).map(([reason, count]) => ({ reason, count })),
    });

    // THE AUDIT-RECEIPT LAW: an export of a tenant's tax data is recorded with what it covered and what it left out,
    // in the same transaction as nothing else — the read already happened, and this row is the evidence it happened.
    await this.uow.run(tenantId, async (tx) => {
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'invoice.gstr1_exported', entityType: 'gstr1', entityId: period,
        newValue: { period, sha256: receipt.sha256, rowCount: receipt.rowCount, coverage: receipt.coverage, excluded: summary.excludedCount },
      });
    }, { userId: actor.userId });
    this.metrics.inc('payments.gstr1_export', { tenant: tenantId, coverage: summary.coverage });

    return { period, sections, creditNotes, excluded, summary, receipt };
  }
}
