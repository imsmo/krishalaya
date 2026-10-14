// apps/web-storefront/src/features/checkout/bill-rows.ts · PC-56 HOTFIX-4 · C3 (survey F-5, founder D4 "separate fee rows, totals that sum").
// PURE — no React, no I/O, and NO MONEY ARITHMETIC THAT PRINTS: every figure shown is the API's own; the one sum taken here is a CHECK
// (BigInt) that the rows the buyer reads add up to the total the API says, never a number put on the page.
//
// **THE DEFECT.** The checkout review printed subtotal, delivery, platform fee and discount, then "Total payable" = the API's grand total,
// which ALSO held a buyer-charged commission no row named; the confirmation page printed subtotal, delivery, discount and "Tax 0" against an
// order total that held the platform fee and the buyer commission (the order read did not even return them). Neither bill added up.
//
// **THE ROWS.** Items subtotal · delivery (or "needs your address" when a zone organisation cannot quote it yet — never "0" as if free) ·
// discount (negative) · tax (ONLY when the API recorded one — GST is extracted from what was charged, never added: the inclusive note says so)
// · platform fee (> 0 only) · buyer commission (> 0 only) · and the total, the API's. A row is never invented, never zero-padded.
export type BillRowKey = 'subtotal' | 'delivery' | 'discount' | 'tax' | 'platformFee' | 'buyerCommission';
export interface BillRow { key: BillRowKey; labelKey: string; minor: string; sign: 1 | -1; pending?: boolean }
export interface Bill { rows: BillRow[]; totalMinor: string; currencyCode: string; deliveryNeedsAddress: boolean; sums: boolean }

/** The shape both the checkout preview and the order detail carry (missing optional fields are absent, never assumed non-zero). */
export interface BillSource {
  currencyCode: string;
  subtotalMinor: string; deliveryFeeMinor: string; discountMinor: string;
  taxMinor?: string; platformFeeMinor?: string; buyerCommissionMinor?: string;
  /** the preview's name for the total … */
  grandTotalMinor?: string;
  /** … and the order's */
  totalMinor?: string;
  deliveryNeedsAddress?: boolean;
}

export const BILL_LABEL_KEYS: Readonly<Record<BillRowKey, string>> = Object.freeze({
  subtotal: 'bill.subtotal', delivery: 'bill.delivery', discount: 'bill.discount', tax: 'bill.tax',
  platformFee: 'bill.platformFee', buyerCommission: 'bill.buyerCommission',
});

const big = (s: string | undefined): bigint => { try { return s && /^-?\d+$/.test(s) ? BigInt(s) : 0n; } catch { return 0n; } };

export function billRows(src: BillSource): Bill {
  const needs = src.deliveryNeedsAddress === true;
  const rows: BillRow[] = [{ key: 'subtotal', labelKey: BILL_LABEL_KEYS.subtotal, minor: src.subtotalMinor, sign: 1 }];
  rows.push(needs
    ? { key: 'delivery', labelKey: 'bill.deliveryNeedsAddress', minor: '0', sign: 1, pending: true }
    : { key: 'delivery', labelKey: BILL_LABEL_KEYS.delivery, minor: src.deliveryFeeMinor, sign: 1 });
  if (big(src.discountMinor) > 0n) rows.push({ key: 'discount', labelKey: BILL_LABEL_KEYS.discount, minor: src.discountMinor, sign: -1 });
  if (big(src.taxMinor) > 0n) rows.push({ key: 'tax', labelKey: BILL_LABEL_KEYS.tax, minor: src.taxMinor as string, sign: 1 });
  if (big(src.platformFeeMinor) > 0n) rows.push({ key: 'platformFee', labelKey: BILL_LABEL_KEYS.platformFee, minor: src.platformFeeMinor as string, sign: 1 });
  if (big(src.buyerCommissionMinor) > 0n) rows.push({ key: 'buyerCommission', labelKey: BILL_LABEL_KEYS.buyerCommission, minor: src.buyerCommissionMinor as string, sign: 1 });
  const totalMinor = src.grandTotalMinor ?? src.totalMinor ?? '0';
  return { rows, totalMinor, currencyCode: src.currencyCode, deliveryNeedsAddress: needs, sums: rowsSum(rows) === big(totalMinor) };
}

/** The CHECK: Σ sign × minor over the rows (BigInt). Never printed. */
export function rowsSum(rows: readonly BillRow[]): bigint {
  return rows.reduce((a, r) => a + (r.pending ? 0n : BigInt(r.sign) * big(r.minor)), 0n);
}
