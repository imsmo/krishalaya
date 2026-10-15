// modules/listings/domain/listing-stock.ts · PC-56 STORE-2c · B1 (founder D1) — A LOT'S STOCK IN THOUSANDTHS. PURE.
//
// `listings.quantity_available` is numeric(14,3); the entity carries it as a JS number (the mapper's `Number(...)`). Reserving 2.5 of 34.1 as
// `34.1 - 2.5` in floating point is 31.599999999999998 — written back to the column it rounds, but compared against the next buyer's request it
// can refuse a quantity that is exactly available, or allow one that is not. So the reservation and its release go through THOUSANDTHS as a
// BIGINT (string math in, string math out), the same discipline as the cart (orders/domain/cart-rules.ts) and the auction lot
// (auctions/domain/lot.ts) — each module keeps its own copy because a module never imports another module's domain (the blueprint).
const DECIMAL = /^(\d{1,12})(?:\.(\d{1,3}))?$/;

export class InvalidStockQuantityError extends Error {
  constructor(q: unknown) { super(`invalid stock quantity '${String(q)}'`); }
}

/** A non-negative quantity with at most 3 decimals → thousandths. A number is written as 3 places first (a ≤ 3-place column value is exact). */
export function stockMilli(q: string | number): bigint {
  const s = typeof q === 'number' ? (Number.isFinite(q) && q >= 0 ? q.toFixed(3) : '') : String(q ?? '').trim();
  const m = DECIMAL.exec(s);
  if (!m) throw new InvalidStockQuantityError(q);
  return BigInt(m[1]) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
}

/** Thousandths → the 3-place decimal text the column holds ("2500" → "2.500"). */
export function stockText(m: bigint): string {
  return `${(m / 1000n).toString()}.${(m % 1000n).toString().padStart(3, '0')}`;
}

/** Thousandths → the entity's number (exact: a 3-place decimal round-trips through Number). */
export function stockNumber(m: bigint): number { return Number(stockText(m)); }
