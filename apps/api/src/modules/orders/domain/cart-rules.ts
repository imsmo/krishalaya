// modules/orders/domain/cart-rules.ts · PC-56 STORE-2b · B1 (survey B9 / B11 / F-13 / F-14 / F-24, founder D4) — THE CART'S ONE DOMAIN RULE. PURE
// (no I/O, no Nest): the same functions answer at cart add, cart update, the cart read, the checkout preview and placement, so the four sites
// can never disagree about what a buyer may buy.
//
//   • QUANTITIES ARE DECIMAL STRINGS (numeric(14,3)). `toMilli` turns "2.5" / 2.5 / "2.500" into thousandths as a BIGINT by string math — never
//     `Math.round(qty * 1000)` on a float (F-24: the two conversion sites, the cart read and `lineTotalMinor`, now go through here). A number
//     argument (an entity prop, a legacy client) is first written as a 3-place decimal; more than 3 places is refused at the edge (the DTO)
//     and rounded half-up here only as a last line of defence — the column itself holds 3.
//   • THE MINIMUM ORDER (D4): a quantity below `listings.min_order_qty` is refused BELOW_MIN_ORDER with the minimum and the unit named.
//   • THE PRICE A BUYER AGREED (D4): `added_price_minor` is the price the buyer saw when adding (or explicitly accepted later). When the
//     listing's current price differs, the line has DRIFTED: the cart shows BOTH numbers and the signed delta, and placement refuses
//     PRICE_CHANGED until the buyer accepts — the order is never charged a price the buyer has not seen.
//   • WHY A LINE CANNOT BE BOUGHT, BY NAME (never a bare boolean): sold_out · paused · expired · withdrawn · suspended · licence_required ·
//     not_found.
import { BelowMinOrderError, InvalidQuantityError, MixedCurrencyError } from './orders.errors';

const DECIMAL = /^(\d{1,9})(?:\.(\d+))?$/;

/** A quantity as thousandths (bigint). Accepts a decimal string or a finite number; throws ORDER_INVALID_QUANTITY for anything else. */
export function toMilli(q: string | number): bigint {
  let s: string;
  if (typeof q === 'number') {
    if (!Number.isFinite(q) || q < 0 || q > 1e9) throw new InvalidQuantityError();
    s = q.toFixed(4);                       // one guard digit for the half-up below; a ≤ 3-place value is exact here
  } else {
    s = String(q ?? '').trim();
  }
  const m = DECIMAL.exec(s);
  if (!m) throw new InvalidQuantityError();
  const frac = (m[2] ?? '').padEnd(4, '0');
  let milli = BigInt(m[1]) * 1000n + BigInt(frac.slice(0, 3));
  if (Number(frac[3]) >= 5) milli += 1n;     // half-up on the 4th place (the DTO already refused > 3 places from a client)
  return milli;
}

/** Thousandths → the canonical 3-place decimal string the column holds ("2500" → "2.500"). */
export function milliToDecimal(m: bigint): string {
  const neg = m < 0n; const a = neg ? -m : m;
  return `${neg ? '-' : ''}${(a / 1000n).toString()}.${(a % 1000n).toString().padStart(3, '0')}`;
}

/** The canonical decimal string of a quantity ("2.5" → "2.500"); a non-positive quantity is ORDER_INVALID_QUANTITY. */
export function normaliseQty(q: string | number): string {
  const m = toMilli(q);
  if (m <= 0n) throw new InvalidQuantityError();
  return milliToDecimal(m);
}

/** a < b / a = b / a > b over decimal quantities (no float). */
export function compareQty(a: string | number, b: string | number): -1 | 0 | 1 {
  const x = toMilli(a); const y = toMilli(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Line total in minor units: unit price × quantity, floored to the minor unit — bigint over thousandths (the one money formula). */
export function lineTotalFromMilli(unitPriceMinor: bigint, qtyMilli: bigint): bigint {
  return (unitPriceMinor * qtyMilli) / 1000n;
}

/** D4 · BELOW_MIN_ORDER — a quantity below the listing's minimum (a minimum of 0 means none). Names the minimum and the unit. */
export function assertMinOrder(listingId: string, qty: string | number, minOrderQty: string | number | null | undefined, unitCode: string): void {
  const min = minOrderQty === null || minOrderQty === undefined || minOrderQty === '' ? 0n : toMilli(minOrderQty);
  if (min > 0n && toMilli(qty) < min) {
    throw new BelowMinOrderError(listingId, milliToDecimal(min), unitCode, normaliseQty(qty));
  }
}

/** True when the quantity is below the minimum (the cart read's non-throwing twin of assertMinOrder). */
export function isBelowMin(qty: string | number, minOrderQty: string | number | null | undefined): boolean {
  const min = minOrderQty === null || minOrderQty === undefined || minOrderQty === '' ? 0n : toMilli(minOrderQty);
  return min > 0n && toMilli(qty) < min;
}

export interface PriceDrift { changed: boolean; addedPriceMinor: string; currentPriceMinor: string; deltaMinor: string }
/** D4 · the two numbers and the signed delta (current − added), as minor-unit strings. `changed` = they differ. */
export function priceDrift(added: bigint | string | number, current: bigint | string | number): PriceDrift {
  const a = BigInt(added); const c = BigInt(current);
  return { changed: a !== c, addedPriceMinor: a.toString(), currentPriceMinor: c.toString(), deltaMinor: (c - a).toString() };
}

/** Why a line cannot be bought — by name. */
export const LINE_REASONS = ['sold_out', 'paused', 'expired', 'withdrawn', 'suspended', 'licence_required', 'not_found'] as const;
export type LineReason = (typeof LINE_REASONS)[number];

export interface LineListingFacts {
  status: string | null;               // the listing's status; null when the listing is gone (not readable in this organisation)
  visibility?: string | null;
  quantityAvailable?: string | number | null;
  sellerSuspended: boolean;
  licenceRequired: boolean;
}
/** The reason a line is not purchasable, or null when it is. Order matters: a gone lot is not_found; a suspended seller's lot says so
 *  before its status (the seller's standing is the truth a buyer can act on); a licence lock last (the lot is otherwise on sale). */
export function lineReason(f: LineListingFacts): LineReason | null {
  if (f.status === null) return 'not_found';
  if (f.visibility && f.visibility !== 'public' && f.visibility !== 'cross_tenant') return 'not_found';
  if (f.sellerSuspended) return 'suspended';
  switch (f.status) {
    case 'published': break;
    case 'sold_out': return 'sold_out';
    case 'paused': return 'paused';
    case 'expired': return 'expired';
    case 'archived': return 'withdrawn';
    default: return 'not_found';       // draft · pending_approval · rejected · held · reserved_auction — never enumerable to a buyer
  }
  if (f.quantityAvailable !== null && f.quantityAvailable !== undefined && toMilli(f.quantityAvailable) <= 0n) return 'sold_out';
  if (f.licenceRequired) return 'licence_required';
  return null;
}

/** PC-56 STORE-2c · B4 (survey F-10, Rule Zero): the ONE currency a set of lines is priced in — the listings' own `currency_code` (upper-cased,
 *  3 letters). Several → MIXED_CURRENCY with the codes found; none / a malformed code → MIXED_CURRENCY too (a bill is never assumed rupees). */
export function oneCurrency(codes: ReadonlyArray<string | null | undefined>): string {
  const set = [...new Set(codes.map((c) => String(c ?? '').trim().toUpperCase()))].sort();
  if (set.length !== 1 || !/^[A-Z]{3}$/.test(set[0])) throw new MixedCurrencyError(set.filter((c) => c.length > 0));
  return set[0];
}
