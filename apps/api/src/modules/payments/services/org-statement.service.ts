// modules/payments/services/org-statement.service.ts · W148's "Download org statement — June"
// (PC-56 TENANT-4c). The organisation's monthly wallet statement — "what the bank manager and the auditor
// both accept" — DERIVED from the tenant's own append-only ledger every time it is asked for, with
// TENANT-3c-1's export receipt over the data.
//
// WHY DERIVED AND NOT STORED. Nothing on this platform stored an org statement, and the obvious move would
// be a table of generated copies with their own number series. But the ledger is append-only and
// hash-chained (TENANT-4a made a tenant able to verify its own chain), so a statement recomputed from it is
// reproducible by anybody with the same rows — while a stored PDF is a claim the book can later contradict.
// That is the same reasoning that stopped TENANT-3b storing a frozen amount. The screen says plainly that
// this document is derived and carries no number, rather than implying a series that does not exist.
import { Injectable } from '@nestjs/common';
import { SettlementCycleRepository } from '../repositories/settlement-cycle.repository';
import { buildReceipt, type ExportReceipt } from '../domain/export-receipt';
import {
  assertOrgStatement, buildOrgStatement, isClosedMonth, isMonthPeriod, SettlementCycleError,
  type OrgStatementView,
} from '../domain/settlement-cycle';

export interface OrgStatementResult {
  statement: OrgStatementView;
  receipt: ExportReceipt;
  header: readonly string[];
  rows: string[][];
}

const HEADER = ['txn_type', 'credit_minor', 'debit_minor', 'entries'] as const;

@Injectable()
export class OrgStatementService {
  constructor(private readonly repo: SettlementCycleRepository) {}

  async forMonth(tenantId: string, requestedBy: string, period: string, now = new Date()): Promise<OrgStatementResult> {
    if (!isMonthPeriod(period)) {
      throw new SettlementCycleError('ORG_STATEMENT_PERIOD_INVALID', 'period must be YYYY-MM', 400, { period });
    }
    // A month still in progress changes after it is handed to a bank manager. Refused by name, exactly as
    // 3c-1's GSTR-1 export refuses an open period.
    if (!isClosedMonth(period, now)) {
      throw new SettlementCycleError('ORG_STATEMENT_PERIOD_OPEN', 'this month has not ended yet', 400, { period });
    }

    const m = await this.repo.orgMonthMovements(tenantId, period);
    // Assemble-or-refuse: if opening + credits − debits ≠ closing, no document is issued.
    const statement = assertOrgStatement(buildOrgStatement({
      period, openingMinor: m.openingMinor, closingMinor: m.closingMinor, lines: m.lines,
    }));

    const rows = statement.lines.map((l) => [l.txnType, l.creditMinor, l.debitMinor, String(l.count)]);
    return {
      statement,
      receipt: buildReceipt({
        fileName: `org-statement_${period}.csv`,
        payload: { header: HEADER, rows, opening: statement.openingMinor, closing: statement.closingMinor, period },
        rowCount: rows.length,
        requestedBy,
        generatedAt: now,
        coverage: rows.length === 0 ? 'empty' : 'complete',
        // A derived statement has no omissions to report: it either reconciles against the book and is
        // issued, or it is refused. That is the whole point of not storing a copy.
        omissions: [],
      }),
      header: HEADER,
      rows,
    };
  }
}
