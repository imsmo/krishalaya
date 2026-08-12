// modules/payments/domain/invoice-tax.ts · the trade invoice's arithmetic, in ONE place (PC-56 TENANT-3c-1).
// Pure, no I/O — every rule here is unit- and mutation-tested, because these are the numbers a buyer files with.
//
// **WHAT THIS REPLACES.** `TradeInvoiceService.generateForOrder` computed the whole document as
// `applyBps(order.total_minor, countryDefaultGstRate)` — one rate, applied to the entire order, with the taxable
// value recorded as the total. On W152's own example (₹44,660 of EXEMPT groundnut + a ₹893 fee) that declares
// ₹2,285 of GST at the seeded 500 bps where ₹161 is due, and declares exempt produce taxable. See 0140 DEFECT 1.
//
// **THE INVARIANT EVERY FUNCTION HERE SERVES**, and W152 states it twice: the invoice total equals what the buyer
// paid — "one number everywhere: checkout, order screen, invoice". So the tax is EXTRACTED from the amounts that
// were charged, never added on top of them: `exempt + taxable + tax === total`, exactly, in minor units. An invoice
// for more than the buyer paid is a demand for money nobody collected.
//
// **AND THE FEE IS TREATED AS GST-INCLUSIVE, WHICH IS A NAMED CHOICE.** Checkout charges subtotal + delivery + fee
// and sets `orders.tax_minor` to 0 — the buyer is never charged tax on top. Charging it on top raises what every
// buyer pays and is a pricing decision (0140 DEFECT 3); extracting it keeps the document true to the money.

/** A line on the invoice. `goods` is the seller's supply; `delivery` and `fee` are the platform's/tenant's. */
export type InvoiceLineKey = 'goods' | 'delivery' | 'fee' | 'discount';

/** Where a line's rate came from — printed beside it, so a zero is never mistaken for a decision nobody made. */
export type RateBasis =
  /** A tax_rules row was resolved for this line (its `legalRef` cites it). */
  | 'resolved'
  /** A resolved rule says 0% — an exemption somebody recorded, with a citation. */
  | 'exempt_by_rule'
  /** **NO RULE EXISTS FOR THIS LINE.** Not exempt: unknown. The invoice still issues (the buyer paid and is owed a
   *  document) but it is excluded from the GSTR-1 export by name, never filed at a guessed rate. */
  | 'not_recorded';

export interface InvoiceLine {
  key: InvoiceLineKey;
  hsn: string | null;
  /** What the buyer paid for this line, in minor units — the gross, inclusive of any tax inside it. */
  grossMinor: bigint;
  taxableMinor: bigint;
  exemptMinor: bigint;
  rateBps: number;
  taxMinor: bigint;
  rateBasis: RateBasis;
  legalRef: string | null;
}

export interface RateInput {
  rateBps: number | null;
  legalRef?: string | null;
  hsn?: string | null;
}

export interface InvoiceMoneyInput {
  subtotalMinor: bigint;
  deliveryFeeMinor: bigint;
  discountMinor: bigint;
  platformFeeMinor: bigint;
  totalMinor: bigint;
}

export interface InvoiceTaxView {
  lines: InvoiceLine[];
  taxableMinor: bigint;
  exemptMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  /** FALSE when any line's rate is `not_recorded` — the flag 0140 stores and the GSTR-1 export reads. */
  basisComplete: boolean;
}

/**
 * Extract the tax contained in a GST-INCLUSIVE gross: tax = gross × rate / (10000 + rate).
 *
 * **BANKER'S ROUNDING AT THE PAISE, BECAUSE W152 SAYS SO** ("Rounding: line-level, banker's at paise") and because
 * half-up rounding on millions of lines drifts one direction — a systematic overstatement of collected tax across a
 * tenant's return. Ties go to the even paise.
 */
export function taxFromInclusive(grossMinor: bigint, rateBps: number): bigint {
  if (grossMinor <= 0n || rateBps <= 0) return 0n;
  const num = grossMinor * BigInt(rateBps);
  const den = BigInt(10_000 + rateBps);
  const q = num / den;
  const rem = num % den;
  const twice = rem * 2n;
  if (twice > den) return q + 1n;
  if (twice < den) return q;
  return q % 2n === 0n ? q : q + 1n;      // exact half → nearest even
}

/** Intra-state vs inter-state, from the two state codes. `unknown` where either is missing — never assumed intra,
 *  which is what the hardcoded `cgst = tax/2` did for every invoice ever issued (0140 DEFECT 2). */
export type SupplyType = 'intra' | 'inter' | 'unknown';

export function supplyTypeOf(sellerStateCode: string | null, placeOfSupplyCode: string | null): SupplyType {
  if (!sellerStateCode || !placeOfSupplyCode) return 'unknown';
  return sellerStateCode === placeOfSupplyCode ? 'intra' : 'inter';
}

/** The two-digit state code inside a GSTIN — and it works on a MASKED one (`27******3Z5`), which is all 0058 stores
 *  for a buyer. The state is the only part of a buyer's GSTIN this platform can honestly read. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const s = gstin.trim();
  return /^[0-9]{2}/.test(s) ? s.slice(0, 2) : null;
}

/** Split a line's tax into the columns the supply type requires. `unknown` keeps it UNALLOCATED rather than guessing:
 *  a buyer given CGST/SGST on an inter-state supply cannot claim the credit. */
export function splitTax(taxMinor: bigint, supply: SupplyType): { cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint; unallocatedMinor: bigint } {
  if (taxMinor <= 0n) return { cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, unallocatedMinor: 0n };
  if (supply === 'inter') return { cgstMinor: 0n, sgstMinor: 0n, igstMinor: taxMinor, unallocatedMinor: 0n };
  if (supply === 'intra') {
    const cgst = taxMinor / 2n;
    return { cgstMinor: cgst, sgstMinor: taxMinor - cgst, igstMinor: 0n, unallocatedMinor: 0n };   // remainder to SGST → sums exactly
  }
  return { cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, unallocatedMinor: taxMinor };
}

/** One line, from its gross and its resolved rate. A null rate is `not_recorded` — the whole gross sits in `exempt`
 *  arithmetically (so the bases still sum) while the BASIS says the rate is unknown, which is what the export reads. */
export function buildLine(key: InvoiceLineKey, grossMinor: bigint, rate: RateInput): InvoiceLine {
  const hsn = rate.hsn ?? null;
  if (rate.rateBps == null) {
    return { key, hsn, grossMinor, taxableMinor: 0n, exemptMinor: grossMinor, rateBps: 0, taxMinor: 0n, rateBasis: 'not_recorded', legalRef: rate.legalRef ?? null };
  }
  if (rate.rateBps === 0) {
    return { key, hsn, grossMinor, taxableMinor: 0n, exemptMinor: grossMinor, rateBps: 0, taxMinor: 0n, rateBasis: 'exempt_by_rule', legalRef: rate.legalRef ?? null };
  }
  const tax = taxFromInclusive(grossMinor, rate.rateBps);
  return { key, hsn, grossMinor, taxableMinor: grossMinor - tax, exemptMinor: 0n, rateBps: rate.rateBps, taxMinor: tax, rateBasis: 'resolved', legalRef: rate.legalRef ?? null };
}

export class InvoiceTaxIdentityError extends Error {
  constructor(readonly detail: Record<string, string>) {
    super('invoice bases do not sum to the total');
    this.name = 'InvoiceTaxIdentityError';
  }
}

/**
 * Build the whole document from the order's own money row.
 *
 * THE DISCOUNT IS SUBTRACTED FROM THE GOODS LINE rather than carried as a negative line, because a GST invoice
 * states the value actually charged for each supply — a separate "discount" row invites the reader to add the lines
 * and get a number the buyer never paid. Where the discount exceeds the goods (a full-order coupon), it is clamped
 * at the goods value and the remainder comes off delivery, then the fee: the same order the money was applied in.
 *
 * FAILS CLOSED. If the lines do not reconcile to the order total to the paise, this throws rather than persisting a
 * document that cannot be checked — the guard whose absence let 5%-of-the-order stand.
 */
export function buildInvoiceTax(money: InvoiceMoneyInput, rates: { goods: RateInput; delivery: RateInput; fee: RateInput }): InvoiceTaxView {
  let discount = money.discountMinor > 0n ? money.discountMinor : 0n;
  const take = (gross: bigint): bigint => {
    if (discount <= 0n) return gross;
    const cut = discount >= gross ? gross : discount;
    discount -= cut;
    return gross - cut;
  };
  const goodsNet = take(money.subtotalMinor);
  const deliveryNet = take(money.deliveryFeeMinor);
  const feeNet = take(money.platformFeeMinor);

  const lines = [
    buildLine('goods', goodsNet, rates.goods),
    buildLine('delivery', deliveryNet, rates.delivery),
    buildLine('fee', feeNet, rates.fee),
  ].filter((l) => l.grossMinor > 0n);

  const taxableMinor = lines.reduce((a, l) => a + l.taxableMinor, 0n);
  const exemptMinor = lines.reduce((a, l) => a + l.exemptMinor, 0n);
  const taxMinor = lines.reduce((a, l) => a + l.taxMinor, 0n);
  const view: InvoiceTaxView = {
    lines, taxableMinor, exemptMinor, taxMinor,
    totalMinor: money.totalMinor,
    basisComplete: lines.every((l) => l.rateBasis !== 'not_recorded'),
  };
  const sum = exemptMinor + taxableMinor + taxMinor;
  if (sum !== money.totalMinor) {
    throw new InvoiceTaxIdentityError({
      exemptMinor: exemptMinor.toString(), taxableMinor: taxableMinor.toString(),
      taxMinor: taxMinor.toString(), sum: sum.toString(), totalMinor: money.totalMinor.toString(),
    });
  }
  return view;
}

/** Mask a GSTIN for display: first two digits (the state, which is public and load-bearing) and the last four.
 *  W151's list shows `24AAC••••••1Z8`. Applied on the way OUT, so a full value never reaches a page that does not
 *  need it — and a value that is already masked survives unchanged. */
export function maskGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const s = gstin.trim().toUpperCase();
  if (s.length < 8) return s;
  return `${s.slice(0, 2)}${'•'.repeat(Math.max(0, s.length - 6))}${s.slice(-4)}`;
}

/** Is this GSTIN a full one, or only the mask 0058 stores? A GSTR-1 B2B row needs the full value; a mask cannot be
 *  filed, and pretending otherwise would put an unfilable row in a return (0140 DEFECT 6). */
export function isFullGstin(gstin: string | null | undefined): boolean {
  return !!gstin && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(gstin.trim().toUpperCase());
}
