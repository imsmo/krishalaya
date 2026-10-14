// apps/web-storefront/src/features/store2b/cart.ts · PC-56 STORE-2b · C1–C4 — THE CART'S PURE HALF (no React, no I/O; unit-tested in
// test/store2b-cart.spec.ts).
//
//   • `refusalOf(code, details)` — every API refusal the cart, the add-to-cart form and checkout can meet, mapped to ONE named refusal with
//     its catalogue key (`refusalKey`), exhaustively: below the minimum, above what is available, not a number, LICENCE_REQUIRED, WRONG_STORE,
//     the line's reason (suspended · sold out · paused · expired · withdrawn · gone), PRICE_CHANGED, BANNED_IN_REGION, buying paused, and a
//     named failure for anything else — never "check your entry";
//   • `checkQuantity(raw, {min, available})` — the typed quantity as a DECIMAL STRING to 3 places (string math, never a float): not a number /
//     below the minimum / above what is available, before the server is asked (it re-validates);
//   • `driftView(line, lang)` — BOTH prices and the delta, formatted in the line's OWN currency (its exponent); the delta is the SERVER's
//     (`priceDeltaMinor`) — the storefront formats money, it never subtracts it;
//   • `lineProblems(line)` / `resolveState(cart)` — what blocks checkout (a line that cannot be bought, below the minimum, above what is
//     available, a price not yet re-agreed) and the anchor of the first problem line ("Resolve N items to continue" is navigation);
//   • `cartChain(searchParams)` — the chain's state in the URL (no client JS): confirm (Remove / Accept price), error (the quantity form,
//     the typed value kept), failure (named), success (done) — the W3041–W3047 states as one page.
import type { Cart, CartItem } from '@krishalaya/sdk-js';
import { moneyText } from '../discovery/money';

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE NAMED REFUSALS                                                                                                                  */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

export const CART_REFUSALS = [
  'not_a_number', 'below_min', 'above_available', 'licence', 'wrong_store', 'suspended', 'sold_out', 'paused', 'expired', 'withdrawn',
  'not_found', 'price_changed', 'banned', 'cart_off', 'failed',
] as const;
export type CartRefusal = (typeof CART_REFUSALS)[number];

/** The catalogue key of a refusal (the page interpolates {min} {unit} {available} {store} {org} {region} as the refusal needs). */
export function refusalKey(r: CartRefusal): string { return `cart.refused.${r}`; }

const REASON_TO_REFUSAL: Readonly<Record<string, CartRefusal>> = Object.freeze({
  suspended: 'suspended', sold_out: 'sold_out', paused: 'paused', expired: 'expired', withdrawn: 'withdrawn', not_found: 'not_found',
  licence_required: 'licence',
});

/** An API error code (+ its details) → the one named refusal. Unknown codes are a named FAILURE, never blamed on the buyer's entry. */
export function refusalOf(code: string | null | undefined, details?: Record<string, unknown> | null): CartRefusal {
  switch (code) {
    case 'BELOW_MIN_ORDER': return 'below_min';
    case 'LISTING_INSUFFICIENT_STOCK': return 'above_available';
    case 'LICENCE_REQUIRED': return 'licence';
    case 'WRONG_STORE': return 'wrong_store';
    case 'PRICE_CHANGED': return 'price_changed';
    case 'BANNED_IN_REGION': return 'banned';
    case 'STOREFRONT_CART_OFF': return 'cart_off';
    case 'VALIDATION_FAILED': case 'ORDER_INVALID_QUANTITY': return 'not_a_number';
    case 'LISTING_NOT_PURCHASABLE': return REASON_TO_REFUSAL[String(details?.reason ?? 'not_found')] ?? 'not_found';
    default: return 'failed';
  }
}
/** A refusal read back from the URL (a hand-edited value falls back to the named failure). */
export function readRefusal(raw: unknown): CartRefusal | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string' || s === '') return null;
  return (CART_REFUSALS as readonly string[]).includes(s) ? (s as CartRefusal) : 'failed';
}

/** Where a checkout refusal sends the buyer: a line problem → back to the cart (which shows the line with both numbers / the minimum / the
 *  reason), a region ban / buying paused → the checkout page itself, anything else → null (the generic placeError). */
export function checkoutRefusalHref(r: CartRefusal, extra: { region?: string | null } = {}): string | null {
  if (['price_changed', 'below_min', 'above_available', 'licence', 'suspended', 'sold_out', 'paused', 'expired', 'withdrawn', 'not_found'].includes(r)) {
    return `/cart?status=${r}`;
  }
  if (r === 'banned') return `/checkout?status=banned${extra.region ? `&region=${encodeURIComponent(extra.region.slice(0, 80))}` : ''}`;
  if (r === 'cart_off') return '/checkout?status=cart_off';
  return null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* DECIMAL QUANTITIES                                                                                                                  */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

const QTY = /^(\d{1,7})(?:\.(\d{1,3}))?$/;
/** Thousandths as a bigint ("2.5" → 2500n), or null when it is not a decimal with ≤ 3 places. */
export function milli(s: string | number | null | undefined): bigint | null {
  const m = QTY.exec(String(s ?? '').trim());
  if (!m) return null;
  return BigInt(m[1]) * 1000n + BigInt(((m[2] ?? '') + '000').slice(0, 3));
}
/** A decimal for a person to read: "5.000" → "5", "2.500" → "2.5", "0.125" → "0.125". */
export function qtyText(s: string | number | null | undefined): string {
  const m = milli(s);
  if (m === null) return String(s ?? '');
  const int = m / 1000n; const frac = m % 1000n;
  return frac === 0n ? int.toString() : `${int}.${frac.toString().padStart(3, '0').replace(/0+$/, '')}`;
}

export type QtyCheck = { ok: true; qty: string } | { ok: false; refusal: 'not_a_number' | 'below_min' | 'above_available' };
/** The typed quantity checked BEFORE the server is asked (it re-validates): a positive decimal with ≤ 3 places, ≥ the minimum, ≤ available. */
export function checkQuantity(raw: unknown, limits: { min?: string | number | null; available?: string | number | null } = {}): QtyCheck {
  const q = milli(typeof raw === 'string' || typeof raw === 'number' ? raw : '');
  if (q === null || q <= 0n) return { ok: false, refusal: 'not_a_number' };
  const min = milli(limits.min ?? null);
  if (min !== null && min > 0n && q < min) return { ok: false, refusal: 'below_min' };
  const avail = limits.available === null || limits.available === undefined ? null : milli(String(limits.available).replace(/(\.\d{3})\d+$/, '$1'));
  if (avail !== null && q > avail) return { ok: false, refusal: 'above_available' };
  return { ok: true, qty: qtyText(String(raw).trim()) };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* BOTH PRICES                                                                                                                         */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

export interface DriftView { added: string; current: string; delta: string; up: boolean }
/** The two numbers and the signed delta in the line's own currency, or null when the price has not changed (or cannot be printed). */
export function driftView(line: Pick<CartItem, 'priceChanged' | 'addedPriceMinor' | 'currentPriceMinor' | 'priceDeltaMinor' | 'currencyCode'>, lang: string): DriftView | null {
  if (!line.priceChanged || !line.addedPriceMinor || !line.currentPriceMinor || !line.priceDeltaMinor) return null;
  const neg = line.priceDeltaMinor.startsWith('-');
  const abs = neg ? line.priceDeltaMinor.slice(1) : line.priceDeltaMinor;
  const added = moneyText(line.addedPriceMinor, line.currencyCode, lang);
  const current = moneyText(line.currentPriceMinor, line.currencyCode, lang);
  const delta = moneyText(abs, line.currencyCode, lang);
  if (!added || !current || !delta) return null;
  return { added, current, delta: `${neg ? '−' : '+'}${delta}`, up: !neg };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* WHAT BLOCKS CHECKOUT                                                                                                                */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

export type LineProblem = 'reason' | 'below_min' | 'over_available' | 'drift';
export function lineProblems(l: CartItem): LineProblem[] {
  const out: LineProblem[] = [];
  const reason = l.reason !== undefined ? l.reason : (l.purchasable ? null : 'not_found');
  if (reason) return ['reason'];                        // a line that cannot be bought: its reason is the whole story
  if (l.belowMin) out.push('below_min');
  if (l.overAvailable) out.push('over_available');
  if (l.priceChanged) out.push('drift');
  return out;
}
export const lineAnchor = (listingId: string) => `line-${listingId}`;
export interface ResolveState { blocked: number; first: string | null }
/** How many lines block checkout, and the first one's anchor ("Resolve N items to continue" → #line-<id>). */
export function resolveState(cart: Pick<Cart, 'items'>): ResolveState {
  const bad = cart.items.filter((l) => lineProblems(l).length > 0);
  return { blocked: bad.length, first: bad[0] ? lineAnchor(bad[0].listingId) : null };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE CHAIN IN THE URL                                                                                                                */
/* ---------------------------------------------------------------------------------------------------------------------------------- */

export type CartAct = 'remove' | 'accept';
export interface CartChain {
  step: 'confirm' | 'error' | 'failure' | null; act: CartAct | null; line: string | null; err: CartRefusal | null; qty: string | null;
  done: 'updated' | 'removed' | 'accepted' | 'added' | null; status: CartRefusal | null;
}
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const UUIDISH = /^[0-9a-fA-F-]{8,64}$/;
export function cartChain(sp: SP): CartChain {
  const step = one(sp.step);
  const act = one(sp.act);
  const line = one(sp.line);
  const done = one(sp.done);
  const qty = one(sp.qty);
  return {
    step: step === 'confirm' || step === 'error' || step === 'failure' ? step : null,
    act: act === 'remove' || act === 'accept' ? act : null,
    line: line && UUIDISH.test(line) ? line : null,
    err: readRefusal(sp.err),
    qty: qty && qty.length <= 20 ? qty : null,
    done: done === 'updated' || done === 'removed' || done === 'accepted' || done === 'added' ? done : null,
    status: readRefusal(sp.status),
  };
}
/** The cart's own URL with the chain state (the anchor of the line it is about). */
export function cartHref(slug: string, q: Record<string, string | null | undefined> = {}, anchor?: string | null): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string' && v.length > 0) usp.set(k, v);
  const qs = usp.toString();
  return `/${encodeURIComponent(slug)}/cart${qs ? `?${qs}` : ''}${anchor ? `#${anchor}` : ''}`;
}
