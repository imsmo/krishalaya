// modules/education/domain/instructor-earnings-export.ts · W418's statement as the ROWS of a file (PC-56 TENANT-7d-money). Pure.
//
// ONE ROW PER ROYALTY LINE — the same rows the statement pages through, every money cell the line's MINOR units rendered
// at THAT LINE's own `minor_units` (the currency's scale at the purchase — 6e-1), as a plain decimal with no grouping,
// the ISO code in its own column. Nothing is totalled in the file: a total across currencies is a lie and a total within
// one is a cell a spreadsheet can make itself from honest rows. What the file cannot say goes in the receipt's NOTES,
// which is where W2554 prints them (TENANT-5d's rule: a refused figure is never a row).
import type { StatementLine } from '../services/instructor-earnings.service';

export const EARNINGS_EXPORT_HEADER = ['occurred_at_utc', 'course', 'course_id', 'enrollment_id', 'currency', 'gross', 'your_share', 'tenant_share', 'platform_share', 'your_share_bps', 'state', 'ledger_txn_id', 'released_at_utc'] as const;
export type EarningsExportRow = [string, string, string, string, string, string, string, string, string, string, string, string, string];

/** Minor units → plain major decimal at the given scale. `14900` at 2 → `149.00`; `5160` at 0 → `5160`. */
export function minorText(minor: string, minorUnits: number): string {
  if (!/^\d+$/.test(minor)) throw new Error(`minorText: not a minor amount (${JSON.stringify(minor)})`);
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 6) throw new Error(`minorText: minor_units out of range (${minorUnits})`);
  const v = BigInt(minor);
  const scale = 10n ** BigInt(minorUnits);
  return minorUnits === 0 ? v.toString() : `${v / scale}.${(v % scale).toString().padStart(minorUnits, '0')}`;
}

export function earningsExportRow(l: StatementLine): EarningsExportRow {
  return [
    l.occurredAt.toISOString(), l.courseTitle ?? '', l.courseId, l.enrollmentId, l.currencyCode,
    minorText(l.gross, l.minorUnits), minorText(l.instructor, l.minorUnits), minorText(l.tenant, l.minorUnits), minorText(l.platform, l.minorUnits),
    String(l.instructorShareBps), l.state, l.ledgerTxnId, l.releasedAt ? l.releasedAt.toISOString() : '',
  ];
}

/** The receipt's notes — what the file admits. Fixed sentences (the receipt is English-keyed data the page translates). */
export function earningsExportNotes(input: { timezone: string; currencies: readonly string[]; heldLines: number }): string[] {
  const notes = [
    'one row per paid enrollment (instructor_royalty_lines); money cells are plain decimals at each line\'s own currency scale, the ISO code in its own column',
    'no totals are in the file: a sum across currencies is not a figure, and a sum within one is yours to make from the rows',
    `instants are UTC (occurred_at_utc); the page\'s month-to-date is the cooperative\'s month in ${input.timezone}`,
    'payouts are not rows here: they are the payment plane\'s rows (purpose course_royalty) and appear on the page',
    'refunds are not rows: no course refund path exists on this platform, so no line is ever reversed',
  ];
  if (input.currencies.length === 0) notes.push('no paid enrollment yet: the file has a header and no rows');
  if (input.heldLines > 0) notes.push(`${input.heldLines} line(s) are held_pending_agreement: their your_share has not reached your wallet`);
  return notes;
}
