// modules/payments/services/org-wallet-export.service.ts · W144's "Export CSV", through the audit-receipt
// law (PC-56 TENANT-4a). Reuses TENANT-3c-1's receipt helper rather than growing a second dialect of the
// same promise, and refuses BY NAME instead of truncating.
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/app-error';
import { OrgWalletReadModel, type OrgLedgerRow } from '../read-models/org-wallet.read-model';
import { buildReceipt, type ExportReceipt } from '../domain/export-receipt';
import { entryDirection, type TenantAccountCode } from '../domain/org-wallet';

/** A money export is a document somebody files. Beyond this many rows the honest answer is "narrow the
 *  window", not a file that stops mid-month — the same rule 3c-1's GSTR-1 export applies to a return. */
export const ORG_LEDGER_EXPORT_CAP = 20_000;

export class OrgLedgerExportTooLargeError extends DomainError {
  constructor(cap: number) {
    super('WALLET_EXPORT_TOO_LARGE', `More than ${cap} entries in this window — narrow the date range`, 400, { cap });
  }
}

export interface OrgLedgerExport {
  receipt: ExportReceipt;
  header: readonly string[];
  rows: string[][];
  window: { fromIso: string; toIso: string; days: number; clamped: boolean };
}

const HEADER = [
  'entry_id', 'created_at', 'account', 'txn_type', 'direction',
  'amount_minor', 'balance_after_minor', 'currency', 'reference_type', 'reference_id', 'txn_id', 'description',
] as const;

/** One row, as strings. Amounts stay in MINOR UNITS with the currency in its own column — a spreadsheet
 *  that reads "1,842.50" cannot tell you whether the source was paise or rupees, and a farmer's payout is
 *  not a place to find out later. */
function toCells(r: OrgLedgerRow): string[] {
  return [
    r.entryId, r.createdAt, r.accountCode, r.txnType ?? '', entryDirection(r.amountMinor),
    r.amountMinor, r.balanceAfterMinor, r.currencyCode, r.referenceType ?? '', r.referenceId ?? '', r.txnId, r.description ?? '',
  ];
}

@Injectable()
export class OrgWalletExportService {
  constructor(private readonly read: OrgWalletReadModel) {}

  async export(
    tenantId: string,
    requestedBy: string,
    opts: { from?: string; to?: string; accountCode?: TenantAccountCode; txnType?: string; currencyCode?: string; now?: Date },
  ): Promise<OrgLedgerExport> {
    const now = opts.now ?? new Date();
    // Ask for ONE more than the cap: that is how the refusal can be certain rather than probable.
    const { rows, truncated, window } = await this.read.exportRows(tenantId, { ...opts, now, cap: ORG_LEDGER_EXPORT_CAP + 1 });
    if (truncated || rows.length > ORG_LEDGER_EXPORT_CAP) throw new OrgLedgerExportTooLargeError(ORG_LEDGER_EXPORT_CAP);

    const cells = rows.map(toCells);
    const stamp = `${window.fromIso.slice(0, 10)}_${window.toIso.slice(0, 10)}`;
    return {
      receipt: buildReceipt({
        fileName: `wallet-ledger_${stamp}.csv`,
        // The digest covers the DATA, and the receipt says so (digestBasis) — the console writes the file.
        payload: { header: HEADER, rows: cells, window, accountCode: opts.accountCode ?? 'all', txnType: opts.txnType ?? 'all' },
        rowCount: cells.length,
        requestedBy,
        generatedAt: now,
        coverage: cells.length === 0 ? 'empty' : 'complete',
        // The window itself is the only thing that can narrow this export, and a clamped window is an
        // omission the reader must see rather than a detail in a tooltip.
        omissions: window.clamped ? [{ reason: 'window_clamped_to_366_days', count: 1 }] : [],
      }),
      header: HEADER,
      rows: cells,
      window,
    };
  }
}
