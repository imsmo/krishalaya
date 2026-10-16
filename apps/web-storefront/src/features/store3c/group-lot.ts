// apps/web-storefront/src/features/store3c/group-lot.ts · PC-56 STORE-3c · C5 — THE GROUP LOT PAGE'S PURE HALF (canon W279). No React, no I/O.
//
//   • the SIX statuses (apps/api group-lot.state.ts GROUP_LOT_STATUSES) each with a catalogue key in en / hi / gu (unknown → "status unknown");
//   • the page's state from the PUBLIC read (`GET /v1/storefront/group-lots/:id`): pledging · ready · listed (a listing to buy as one purchase)
//     · sold / settled · cancelled (the reason's code → its sentence);
//   • basis points → a percentage TEXT (a RATE, not money — string math, up to two decimals, never a float): the coordination fee and the
//     pledged progress are printed from the server's bps, never computed from quantities here;
//   • the routes: the lot (`/<slug>/g/<id>`), "See similar lots" (the 2a browse facet `saleType=group_lot` on THIS store's search) and the
//     listing once listed (`/<slug>/listings/<id>`).
import type { StorefrontGroupLot } from '@krishalaya/sdk-js';

const slugPath = (slug: string) => `/${encodeURIComponent(slug)}`;

export const GROUP_LOT_STATUS_LIST = ['pledging', 'ready', 'listed', 'sold', 'settled', 'cancelled'] as const;
export type StoreGroupLotStatus = (typeof GROUP_LOT_STATUS_LIST)[number];
export function groupLotStatusKey(status: unknown): string {
  return typeof status === 'string' && (GROUP_LOT_STATUS_LIST as readonly string[]).includes(status) ? `store3c.gl.status.${status}` : 'store3c.gl.status.unknown';
}

/** The 0188 cancel vocabulary (`group_lot_cancel_reason`); `other` never prints the coordinator's words on a public page. */
export const GROUP_LOT_CANCEL_REASONS = ['target_missed', 'coordinator_withdrew', 'quality', 'other'] as const;
export function cancelReasonKey(code: unknown): string {
  return typeof code === 'string' && (GROUP_LOT_CANCEL_REASONS as readonly string[]).includes(code) ? `store3c.gl.reason.${code}` : 'store3c.gl.reason.unknown';
}

export type GroupLotState = 'pledging' | 'ready' | 'listed' | 'sold' | 'cancelled';
export function groupLotState(l: Pick<StorefrontGroupLot, 'status' | 'listingId'>): GroupLotState {
  if (l.status === 'cancelled') return 'cancelled';
  if (l.status === 'listed') return l.listingId ? 'listed' : 'ready';
  if (l.status === 'sold' || l.status === 'settled') return 'sold';
  if (l.status === 'ready') return 'ready';
  return 'pledging';
}

/** Basis points → a percentage TEXT with at most two decimals ("150" → "1.5", "7400" → "74", "5" → "0.05"). String math; null for anything
 *  that is not a whole number of basis points in 0…10000 (never a guessed rate). */
export function bpsPercent(bps: unknown): string | null {
  if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 10000) return null;
  const s = String(bps).padStart(3, '0');
  const whole = s.slice(0, -2).replace(/^0+(?=\d)/, '');
  const frac = s.slice(-2).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

export function groupLotHref(slug: string, id: string): string { return `${slugPath(slug)}/g/${encodeURIComponent(id)}`; }
export function similarLotsHref(slug: string): string { return `${slugPath(slug)}/search?saleType=group_lot`; }
export function lotListingHref(slug: string, listingId: string): string { return `${slugPath(slug)}/listings/${encodeURIComponent(listingId)}`; }
