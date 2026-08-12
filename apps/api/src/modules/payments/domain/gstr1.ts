// modules/payments/domain/gstr1.ts · W151's "Export GSTR-1 data (month)", as the sectioning rules a return needs
// (PC-56 TENANT-3c-1). Pure, no I/O.
//
// A GSTR-1 return is not a dump of invoices: every outward supply belongs to a numbered table, and which table
// depends on whether the buyer is registered, whether the supply crossed a state border, and how large it was.
// Getting the section wrong is not a display bug — it is a mis-filed return.
//
// **THIS MODULE'S CENTRAL RULE IS THAT AN UNFILABLE ROW IS EXCLUDED BY NAME, NEVER GUESSED INTO A SECTION.** Three
// things make a row unfilable on this platform today, and all three are facts about the platform rather than about
// the data:
//   • the buyer's GSTIN is a MASK (0058 stores `gstin_masked` and says "NEVER the raw value") — a B2B row cannot be
//     filed with a mask, so those supplies are excluded and counted;
//   • the supply type is UNKNOWN (neither party's state could be established — 0140 DEFECT 2);
//   • the invoice's tax basis is INCOMPLETE (a line whose rate no tax_rules row covers) or was written before 0140
//     and has no recorded breakdown at all.
// The export therefore reports COVERAGE. A file that silently omitted them would read as a complete month.
import { SupplyType, isFullGstin } from './invoice-tax';

/** The GSTR-1 tables this platform can produce from a trade invoice. */
export const GSTR1_SECTIONS = ['b2b', 'b2cl', 'b2cs'] as const;
export type Gstr1Section = (typeof GSTR1_SECTIONS)[number];

export type ExclusionReason =
  | 'buyer_gstin_masked_only'
  | 'supply_type_unknown'
  | 'tax_basis_incomplete'
  | 'breakdown_not_recorded';

/** B2CL threshold: an inter-state supply to an unregistered buyer above ₹2,50,000 is reported invoice-wise (B2CL);
 *  below it, consolidated (B2CS). In minor units, as a named constant rather than a literal in a branch. */
export const B2CL_THRESHOLD_MINOR = 25_000_000n;

export interface Gstr1InvoiceInput {
  invoiceNo: string;
  buyerGstin: string | null;
  supplyType: SupplyType | null;
  placeOfSupplyCode: string | null;
  totalMinor: bigint;
  taxableMinor: bigint | null;
  taxMinor: bigint | null;
  basisComplete: boolean | null;
}

export type Gstr1Verdict =
  | { kind: 'section'; section: Gstr1Section }
  | { kind: 'excluded'; reason: ExclusionReason };

/** Which table this invoice belongs in — or why it cannot be filed at all.
 *
 *  ORDER MATTERS. The breakdown is checked FIRST: an invoice with no recorded taxable/tax (every pre-0140 row) has
 *  no figures to file whatever else is true of it, and reporting it as "GSTIN masked" would send an operator looking
 *  for the wrong fix. */
export function gstr1Verdict(i: Gstr1InvoiceInput): Gstr1Verdict {
  if (i.taxableMinor == null || i.taxMinor == null) return { kind: 'excluded', reason: 'breakdown_not_recorded' };
  if (i.basisComplete === false) return { kind: 'excluded', reason: 'tax_basis_incomplete' };
  if (!i.supplyType || i.supplyType === 'unknown' || !i.placeOfSupplyCode) return { kind: 'excluded', reason: 'supply_type_unknown' };
  // A registered buyer whose GSTIN we hold only as a mask: B2B by nature, unfilable in fact.
  if (i.buyerGstin && !isFullGstin(i.buyerGstin)) return { kind: 'excluded', reason: 'buyer_gstin_masked_only' };
  if (i.buyerGstin) return { kind: 'section', section: 'b2b' };
  if (i.supplyType === 'inter' && i.totalMinor > B2CL_THRESHOLD_MINOR) return { kind: 'section', section: 'b2cl' };
  return { kind: 'section', section: 'b2cs' };
}

export interface Gstr1Summary {
  sections: Record<Gstr1Section, { count: number; taxableMinor: string; taxMinor: string }>;
  excluded: Record<ExclusionReason, number>;
  excludedCount: number;
  filableCount: number;
  /** 'complete' ONLY when nothing was excluded. The receipt and the screen both print this word. */
  coverage: 'complete' | 'partial' | 'empty';
}

export function gstr1Summarise(rows: Gstr1InvoiceInput[]): Gstr1Summary {
  const sections = Object.fromEntries(GSTR1_SECTIONS.map((s) => [s, { count: 0, taxableMinor: '0', taxMinor: '0' }])) as Gstr1Summary['sections'];
  const acc = Object.fromEntries(GSTR1_SECTIONS.map((s) => [s, { taxable: 0n, tax: 0n }])) as Record<Gstr1Section, { taxable: bigint; tax: bigint }>;
  const excluded: Record<ExclusionReason, number> = {
    buyer_gstin_masked_only: 0, supply_type_unknown: 0, tax_basis_incomplete: 0, breakdown_not_recorded: 0,
  };
  let filable = 0;
  for (const r of rows) {
    const v = gstr1Verdict(r);
    if (v.kind === 'excluded') { excluded[v.reason] += 1; continue; }
    filable += 1;
    sections[v.section].count += 1;
    acc[v.section].taxable += r.taxableMinor ?? 0n;
    acc[v.section].tax += r.taxMinor ?? 0n;
  }
  for (const s of GSTR1_SECTIONS) {
    sections[s].taxableMinor = acc[s].taxable.toString();
    sections[s].taxMinor = acc[s].tax.toString();
  }
  const excludedCount = Object.values(excluded).reduce((a, b) => a + b, 0);
  const coverage: Gstr1Summary['coverage'] = rows.length === 0 ? 'empty' : excludedCount === 0 ? 'complete' : 'partial';
  return { sections, excluded, excludedCount, filableCount: filable, coverage };
}

/** A GST period is a calendar month, and it must be a month that has ENDED: exporting the current month produces a
 *  return that changes after it is filed. Refused by name rather than quietly allowed. */
export function isFiledPeriod(period: string, now: Date): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return false;
  const [y, m] = period.split('-').map(Number);
  const endOfPeriod = Date.UTC(y, m, 1);          // first instant of the NEXT month
  return now.getTime() >= endOfPeriod;
}

/** The month's boundaries in UTC, as the export's own window. Returns null for a malformed period rather than
 *  silently coercing — a wrong window is a wrong return. */
export function periodWindow(period: string): { fromIso: string; toIso: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
  const [y, m] = period.split('-').map(Number);
  return { fromIso: new Date(Date.UTC(y, m - 1, 1)).toISOString(), toIso: new Date(Date.UTC(y, m, 1)).toISOString() };
}
