// modules/requirements/domain/quantity.ts · PC-56 TENANT-11d · QUANTITIES AS INTEGER THOUSANDTHS, MONEY AS BIGINT. PURE.
//
// Every quantity on a requirement, a line and a response is `numeric(14,3)`; here it is a ≤ 3-decimal string, held as integer
// milli-units (12.5 → 12500n). Never a float: "17 + 23 = 40 qtl" must be 40 exactly, and the fulfilled quantity decides
// whether a buyer's need is met.
//
// THE BLENDED PRICE (canon W132 "Blended ₹6,403/qtl — under the ₹6,500 ceiling"):
//   value_i   = floor(qtyMilli_i × price_i ÷ 1000)            — each line's order total, the SAME floor orders' lineTotalMinor
//                                                              takes, so the quote total equals the orders it becomes;
//   total     = Σ value_i;
//   blended   = floor(Σ (qtyMilli_i × price_i) ÷ Σ qtyMilli_i) — per unit, floor;
//   remainder = total − floor(blended × Σ qtyMilli_i ÷ 1000)   — what the floor left over, printed beside the blended price
//                                                              so the two numbers on the screen always add up.
const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const K = 1000n;

export function isQty(s: unknown): s is string { return typeof s === 'string' && QTY_RE.test(s); }
export function parseQtyMilli(s: string): bigint {
  const [int, frac = ''] = s.split('.');
  return BigInt(int) * K + BigInt((frac + '000').slice(0, 3));
}
export function formatQtyMilli(milli: bigint): string {
  const neg = milli < 0n; const v = neg ? -milli : milli;
  return `${neg ? '-' : ''}${v / K}.${(v % K).toString().padStart(3, '0')}`;
}
/** A line's money: floor(qty × price), the orders module's own rounding (`lineTotalMinor`). */
export function lineValueMinor(qtyMilli: bigint, priceMinor: bigint): bigint { return (qtyMilli * priceMinor) / K; }

export interface Figures { lineCount: number; totalQtyMilli: bigint; totalValueMinor: bigint; blendedPriceMinor: bigint | null; blendedRemainderMinor: bigint }
export function blend(lines: ReadonlyArray<{ qtyMilli: bigint; priceMinor: bigint }>): Figures {
  const live = lines.filter((l) => l.qtyMilli > 0n && l.priceMinor > 0n);
  if (live.length === 0) return { lineCount: 0, totalQtyMilli: 0n, totalValueMinor: 0n, blendedPriceMinor: null, blendedRemainderMinor: 0n };
  const totalQtyMilli = live.reduce((a, l) => a + l.qtyMilli, 0n);
  const totalValueMinor = live.reduce((a, l) => a + lineValueMinor(l.qtyMilli, l.priceMinor), 0n);
  const weighted = live.reduce((a, l) => a + l.qtyMilli * l.priceMinor, 0n);
  const blendedPriceMinor = weighted / totalQtyMilli;
  const blendedRemainderMinor = totalValueMinor - (blendedPriceMinor * totalQtyMilli) / K;
  return { lineCount: live.length, totalQtyMilli, totalValueMinor, blendedPriceMinor, blendedRemainderMinor: blendedRemainderMinor < 0n ? 0n : blendedRemainderMinor };
}

/** Canon W131: "Budgets are the buyer's ceiling, not the price". A line above the ceiling is allowed; the review says so. */
export function aboveCeiling(priceMinor: bigint | null, budgetMaxMinor: bigint | null): boolean {
  return priceMinor !== null && budgetMaxMinor !== null && priceMinor > budgetMaxMinor;
}

/** The requirement's lifecycle by QUANTITY (A2): 0 → open, 0 < f < q → partially_matched, f ≥ q → fulfilled. */
export function stateForFulfilled(fulfilledMilli: bigint, quantityMilli: bigint): 'open' | 'partially_matched' | 'fulfilled' {
  if (fulfilledMilli <= 0n) return 'open';
  return fulfilledMilli >= quantityMilli ? 'fulfilled' : 'partially_matched';
}

/** An OrderItem carries a JS number (as every order line does). A ≤ 3-dp string with ≤ 11 integer digits round-trips exactly;
 *  this proves it for the value in hand and refuses one that would not (never a silently different quantity on an order). */
export function exactQtyNumber(s: string): number {
  const milli = parseQtyMilli(s);
  const n = Number(formatQtyMilli(milli));
  if (BigInt(Math.round(n * 1000)) !== milli) throw new Error(`quantity ${s} does not round-trip exactly`);
  return n;
}
