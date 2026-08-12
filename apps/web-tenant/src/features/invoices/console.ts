// apps/web-tenant/src/features/invoices/console.ts · W151's month view and W152's document, as PURE rules
// (PC-56 TENANT-3c-1). No React, no I/O, no SDK runtime — unit- and mutation-tested, and the API re-enforces each.

/** A GST period is a calendar month. The picker never offers the CURRENT month, because a return exported before the
 *  period closes changes after it is filed — and the API refuses it by name (GSTR1_PERIOD_OPEN) if asked anyway. */
export function isGstPeriod(v: string | undefined | null): boolean {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function previousPeriods(now: Date, count = 12): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function isExportablePeriod(period: string, now: Date): boolean {
  if (!isGstPeriod(period)) return false;
  const [y, m] = period.split('-').map(Number);
  return now.getTime() >= Date.UTC(y, m, 1);
}

/** W151's tax column, and the single most important distinction on the screen.
 *  **A NULL TAX IS NOT ₹0.** It means this invoice was issued before its breakdown was recorded — the figure exists
 *  on the buyer's copy and cannot be re-derived here. Rendering it as ₹0 would tell an FPO's accountant that no tax
 *  was charged on a supply where some was. */
export type TaxCell =
  | { kind: 'amount'; minor: string; rateNote: boolean }
  | { kind: 'not_recorded' };

export function taxCell(row: { taxMinor: string | null; taxableMinor: string | null }): TaxCell {
  if (row.taxMinor == null || row.taxableMinor == null) return { kind: 'not_recorded' };
  return { kind: 'amount', minor: row.taxMinor, rateNote: BigInt(row.taxableMinor) > 0n };
}

/** The i18n key for a supply type. `unknown` is its own sentence — never quietly shown as intra-state, which is what
 *  the hardcoded CGST/SGST split did to every invoice ever issued. */
export function supplyKey(supplyType: string | null): 'intra' | 'inter' | 'unknown' {
  return supplyType === 'intra' || supplyType === 'inter' ? supplyType : 'unknown';
}

/** A line's rate basis, as the phrase printed beside it. */
export function rateBasisKey(basis: string): 'resolved' | 'exemptByRule' | 'notRecorded' {
  if (basis === 'resolved') return 'resolved';
  if (basis === 'exempt_by_rule') return 'exemptByRule';
  return 'notRecorded';
}

/** Is this invoice filable in a GSTR-1 return, and if not, why? Mirrors the api's `gstr1Verdict` so the screen can
 *  say it per row BEFORE somebody exports a month and finds a partial coverage notice. */
export type FilableState = 'filable' | 'breakdown_not_recorded' | 'tax_basis_incomplete' | 'supply_type_unknown' | 'buyer_gstin_masked_only';

export function filableState(row: { taxMinor: string | null; taxableMinor: string | null; taxBasisComplete: boolean | null; supplyType: string | null; placeOfSupplyCode: string | null; buyerGstin: string | null }): FilableState {
  if (row.taxMinor == null || row.taxableMinor == null) return 'breakdown_not_recorded';
  if (row.taxBasisComplete === false) return 'tax_basis_incomplete';
  if (!row.supplyType || row.supplyType === 'unknown' || !row.placeOfSupplyCode) return 'supply_type_unknown';
  if (row.buyerGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(row.buyerGstin)) return 'buyer_gstin_masked_only';
  return 'filable';
}

/** What is left of an invoice after the credit notes against it. Shown because a corrected invoice must not read as
 *  though it still stands at its full value. */
export function remainingMinor(row: { totalMinor: string; creditedMinor: string }): string {
  const rem = BigInt(row.totalMinor) - BigInt(row.creditedMinor || '0');
  return (rem < 0n ? 0n : rem).toString();
}

export function isFullyCredited(row: { totalMinor: string; creditedMinor: string }): boolean {
  return BigInt(row.creditedMinor || '0') >= BigInt(row.totalMinor) && BigInt(row.totalMinor) > 0n;
}

/** The export's coverage word, as a key. `partial` is deliberately NOT styled as success: a file that omits rows is
 *  not a complete return, and the screen has to say which rows and why. */
export function coverageKey(coverage: string): 'complete' | 'partial' | 'empty' {
  return coverage === 'complete' || coverage === 'empty' ? coverage : 'partial';
}

/** Group the export's exclusions for display, largest first — an operator fixes the biggest cause first. */
export function exclusionRows(excluded: Record<string, number>): Array<{ reason: string; count: number }> {
  return Object.entries(excluded)
    .filter(([, n]) => n > 0)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** A credit note may only be issued where the invoice HAS a recorded breakdown and something is left to credit.
 *  Withholding the control (rather than letting the API refuse) keeps an operator from learning that the button is
 *  decorative — and the row says which precondition is missing. */
export function creditNoteBlockedBy(
  row: { taxableMinor: string | null; totalMinor: string; creditedMinor: string },
  perms: { canFinance: boolean },
): 'noBreakdown' | 'fullyCredited' | 'noPermission' | null {
  if (row.taxableMinor == null) return 'noBreakdown';
  if (isFullyCredited(row)) return 'fullyCredited';
  if (!perms.canFinance) return 'noPermission';
  return null;
}
