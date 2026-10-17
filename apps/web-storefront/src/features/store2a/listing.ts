// apps/web-storefront/src/features/store2a/listing.ts · PC-56 STORE-2a · C3 — THE LISTING PAGE'S PURE HALF (no React, no I/O).
//
//   • `lotFacts(view)` — the facts the page prints, each from the allow-listed public view: the CONFIRMED grade and whose staff graded it
//     (founder D2 — an AI suggestion is never in the view, so it can never be printed), the organic claim's kind, the harvest DATE (a calendar
//     day: formatted at UTC noon so no clock moves it across midnight), "traceable lot" only when a trace token exists, "Available x of y",
//     "Minimum order", the district ("Where it grew: <district>" — never finer);
//   • `buyerPanel(view, flags)` — which buying doors open: the offer form ONLY when the `offers` flag is ON for the store (survey F-16 — it
//     used to show while the flag was OFF and every submit failed as "check your entry"), the auction door only when `auctions` is ON, the
//     escrow sentence only when `online_payments` is ON (with it OFF the order is paid on delivery — escrow would be false);
//   • `tombstoneView(t, slug)` — a lot no longer on sale: why (the platform's status), its title, the organisation — and NO price;
//     "Ask the seller to relist" is a link to the organisation's page (the inquiry thread is STORE-2b/3);
//   • `parseQuantity(raw, available)` — the add-to-cart quantity as a DECIMAL STRING (numeric(14,3)): up to 7 integer and 3 decimal digits,
//     > 0 and ≤ available — string math, never a float; the server re-validates.
import type { ListingTombstone, PublicLotAttribute, StorefrontFlags } from '@krishalaya/sdk-js';
import type { PublicListingView } from '../listing/public-view';

export interface LotFacts {
  grade: { name: string; gradedBy: string | null } | null;
  /** PC-56 STORE-5b · C6: + `self_declared` (a certified claim no verified certificate covers — the API's badge rule) */
  organic: 'certified' | 'self_declared' | 'natural' | null;
  harvestDay: string | null;           // YYYY-MM-DD
  traceable: boolean;
  available: number; total: number; minOrder: number; unit: string;
  district: string | null;
  attributes: PublicLotAttribute[];
}

export function lotFacts(v: PublicListingView): LotFacts {
  return {
    grade: v.gradeConfirmed ? { name: v.gradeConfirmed.name, gradedBy: v.gradeConfirmed.gradedBy } : null,
    organic: v.organicClaim === 'certified' || v.organicClaim === 'self_declared' || v.organicClaim === 'natural' ? v.organicClaim : null,
    harvestDay: v.harvestDate && /^\d{4}-\d{2}-\d{2}/.test(v.harvestDate) ? v.harvestDate.slice(0, 10) : null,
    traceable: Boolean(v.qrToken),
    available: v.quantityAvailable, total: v.quantityTotal, minOrder: v.minOrderQty, unit: v.unitCode,
    district: v.district,
    attributes: v.attributes,
  };
}

/** A calendar day as a Date at UTC noon — formatted with timeZone 'UTC', it is the same day on every clock. */
export function dayAsDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export interface BuyerPanel { offers: boolean; auction: boolean; escrow: boolean }
export function buyerPanel(flags: StorefrontFlags | null, auctionLinked: boolean): BuyerPanel {
  return {
    offers: flags?.offers === true,
    auction: flags?.auctions === true && auctionLinked,
    escrow: flags?.online_payments === true,
  };
}

export interface TombstoneView { status: ListingTombstone['status']; title: string; organisation: string | null; relistHref: string; categoryHref: string | null }
export function tombstoneView(t: ListingTombstone, slug: string): TombstoneView {
  const base = `/${encodeURIComponent(slug)}`;
  return {
    status: t.status, title: t.title, organisation: t.organisation?.name ?? null,
    relistHref: `${base}/sellers`,
    categoryHref: t.category ? `${base}?category=${encodeURIComponent(t.category.id)}` : null,
  };
}

const QTY = /^(\d{1,7})(?:\.(\d{1,3}))?$/;
/** Thousandths as a bigint (string math): "2.5" → 2500n. */
function milli(s: string): bigint | null {
  const m = QTY.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * 1000n + BigInt(((m[2] ?? '') + '000').slice(0, 3));
}
/** The quantity as a canonical decimal string, or null when it is not a number with ≤ 3 decimals, is zero, or exceeds `available`. */
export function parseQuantity(raw: string, available: string | number): string | null {
  const s = String(raw ?? '').trim();
  const q = milli(s);
  if (q === null || q <= 0n) return null;
  const a = milli(String(available).replace(/(\.\d{3})\d+$/, '$1'));
  if (a !== null && q > a) return null;
  const int = q / 1000n; const frac = q % 1000n;
  return frac === 0n ? int.toString() : `${int}.${frac.toString().padStart(3, '0').replace(/0+$/, '')}`;
}
