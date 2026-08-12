// modules/payments/domain/credit-note.ts · W152's "Corrections" card, as rules (PC-56 TENANT-3c-1). Pure, no I/O.
//
// "Issued invoices are never edited. Corrections issue a credit note referencing this number — the GST trail stays
// clean for both parties' returns." Before 0140 there was no credit-note table anywhere, so the only way to change
// an issued invoice was an UPDATE on the row a buyer already holds.
//
// A CREDIT NOTE IS BOUNDED BY THE INVOICE IT CORRECTS, AND BY WHAT IS LEFT OF IT. Two notes of ₹30,000 against a
// ₹45,714 invoice is not a correction, it is a fabrication — so the remaining-credit rule is arithmetic here and a
// FOR UPDATE-serialised check in the service, because two concurrent proposals could otherwise each pass alone.
import { InvoiceLine, RateBasis, SupplyType, taxFromInclusive } from './invoice-tax';

/** The reasons a credit note can carry. Codes, not free text, because a GST return groups by reason and because a
 *  tenant should not be inventing a vocabulary the platform then has to interpret. */
export const CREDIT_NOTE_REASONS = ['goods_returned', 'quantity_short', 'quality_rejected', 'price_correction', 'order_cancelled', 'tax_correction'] as const;
export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number];
export function isCreditNoteReason(v: string | null | undefined): v is CreditNoteReason {
  return !!v && (CREDIT_NOTE_REASONS as readonly string[]).includes(v);
}

/** Same floor as 0139's notes and 0112's moderation reason: the buyer reads this on a document that changes what
 *  they owe. "Wrong" is not a reason a third party can reconcile against. */
export const MIN_REASON_CHARS = 20;

export type CreditNoteGate =
  | { kind: 'ok'; amountMinor: bigint }
  | { kind: 'exceeds_remaining'; remainingMinor: bigint }
  | { kind: 'invoice_has_no_breakdown' }
  | { kind: 'not_positive' };

/** Can a note for `amountMinor` be issued against this invoice?
 *
 *  **AN INVOICE WITH NO RECORDED BREAKDOWN CANNOT BE CREDITED HERE**, and that refusal is deliberate: a credit note
 *  must state its own taxable/exempt/tax split, and the only honest source for that split is the invoice's lines.
 *  Pre-0140 invoices carry a blended percentage of the whole order (0140 DEFECT 1) — crediting one would mean
 *  inventing the components. Those corrections belong off-platform, with the accountant who holds both documents. */
export function creditNoteGate(input: {
  amountMinor: bigint;
  invoiceTotalMinor: bigint;
  alreadyCreditedMinor: bigint;
  invoiceHasBreakdown: boolean;
}): CreditNoteGate {
  if (input.amountMinor <= 0n) return { kind: 'not_positive' };
  if (!input.invoiceHasBreakdown) return { kind: 'invoice_has_no_breakdown' };
  const remaining = input.invoiceTotalMinor - input.alreadyCreditedMinor;
  if (remaining <= 0n || input.amountMinor > remaining) return { kind: 'exceeds_remaining', remainingMinor: remaining < 0n ? 0n : remaining };
  return { kind: 'ok', amountMinor: input.amountMinor };
}

export interface CreditNoteAmounts {
  totalMinor: bigint;
  taxableMinor: bigint;
  exemptMinor: bigint;
  taxMinor: bigint;
  lines: Array<{ key: string; hsn: string | null; grossMinor: string; taxableMinor: string; exemptMinor: string; rateBps: number; taxMinor: string; rateBasis: RateBasis }>;
}

/**
 * Split a credit amount across the invoice's own lines, PROPORTIONALLY, and carry each line's rate with it.
 *
 * WHY PROPORTIONAL RATHER THAN "OFF THE GOODS FIRST": a credit note reverses part of a supply, and the supply was a
 * mix of exempt goods and a taxable fee. Taking the whole credit off the exempt goods would return money to the
 * buyer while leaving the platform's collected GST untouched — the return would then show tax collected on a fee
 * that was partly refunded. Proportional reversal keeps each line's ratio, so the tax reversed matches the tax
 * charged on the part being credited.
 *
 * The LAST line absorbs the rounding remainder, so the parts sum to the credit exactly (the same technique the
 * intra-state split uses for CGST/SGST). Tax within each part is EXTRACTED from it, never added — a credit note for
 * more than the invoice line would be its own kind of fiction.
 */
export function apportionCredit(amountMinor: bigint, invoiceLines: InvoiceLine[], invoiceTotalMinor: bigint): CreditNoteAmounts {
  const eligible = invoiceLines.filter((l) => l.grossMinor > 0n);
  if (eligible.length === 0 || invoiceTotalMinor <= 0n) {
    return { totalMinor: amountMinor, taxableMinor: 0n, exemptMinor: amountMinor, taxMinor: 0n, lines: [] };
  }
  const parts: Array<{ line: InvoiceLine; gross: bigint }> = [];
  let allocated = 0n;
  for (let i = 0; i < eligible.length; i += 1) {
    const l = eligible[i];
    const gross = i === eligible.length - 1
      ? amountMinor - allocated                               // remainder to the last line → sums exactly
      : (amountMinor * l.grossMinor) / invoiceTotalMinor;
    allocated += gross;
    parts.push({ line: l, gross });
  }

  let taxable = 0n; let exempt = 0n; let tax = 0n;
  const lines = parts.map(({ line, gross }) => {
    const t = line.rateBps > 0 && line.rateBasis === 'resolved' ? taxFromInclusive(gross, line.rateBps) : 0n;
    const base = gross - t;
    if (line.rateBps > 0 && line.rateBasis === 'resolved') { taxable += base; tax += t; } else { exempt += gross; }
    return {
      key: line.key, hsn: line.hsn, grossMinor: gross.toString(),
      taxableMinor: (line.rateBps > 0 && line.rateBasis === 'resolved' ? base : 0n).toString(),
      exemptMinor: (line.rateBps > 0 && line.rateBasis === 'resolved' ? 0n : gross).toString(),
      rateBps: line.rateBps, taxMinor: t.toString(), rateBasis: line.rateBasis,
    };
  });
  return { totalMinor: amountMinor, taxableMinor: taxable, exemptMinor: exempt, taxMinor: tax, lines };
}

/** A credit note inherits the invoice's place of supply and supply type — it corrects THAT supply, and a correction
 *  filed against a different place of supply lands in the wrong table of the return. */
export function inheritSupply(invoice: { placeOfSupplyCode: string | null; supplyType: SupplyType | null }): { placeOfSupplyCode: string | null; supplyType: SupplyType } {
  return { placeOfSupplyCode: invoice.placeOfSupplyCode, supplyType: invoice.supplyType ?? 'unknown' };
}
