// apps/mobile/src/features/buyer/saved-listings.ts · PURE logic for the buyer Saved-Listings screen (126). No
// React/native deps (SDK types are `import type` → erased) → unit-tested. Money is bigint minor-unit strings
// (Law 2) — the price-drop delta is computed with BigInt, never a float.
//
// §13 — the design's category chips (Wheat/Spices/Vegetables) and the "seller · region · ⭐rating" card line are
// NOT derivable here: the public ListingCard read-model carries no categoryId, seller display name, region name or
// rating. So this module only computes the chips the contract can back honestly — "All" and "Price dropped" — and
// the screen degrades the category chips + seller line rather than inventing a categorisation or a name.
import type { ListingCard } from '@krishalaya/sdk-js';

export const SAVED_ALL = 'all';
export const SAVED_DROPPED = 'dropped';
export type SavedFilter = typeof SAVED_ALL | typeof SAVED_DROPPED;

/** Price drop (minor) = savedPrice − currentPrice, when the listing got CHEAPER since it was saved; null otherwise
 * (unchanged or dearer, or bad input → no "since saved" badge). Both are bigint minor strings. Pure. */
export function priceDropMinor(savedMinor: string, currentMinor: string): string | null {
  try {
    const saved = BigInt(savedMinor); const current = BigInt(currentMinor);
    return current < saved ? (saved - current).toString() : null;
  } catch { return null; }
}

/** How many saved listings have dropped in price since saving (drives the "Price dropped · N" chip / its hiding). */
export function droppedCount(items: ListingCard[], drops: Record<string, string | null>): number {
  return items.reduce((n, it) => n + (drops[it.id] ? 1 : 0), 0);
}

/** Apply the active saved-filter. 'all' → everything; 'dropped' → only those with a real price drop. Pure. */
export function filterSaved(items: ListingCard[], filter: SavedFilter, drops: Record<string, string | null>): ListingCard[] {
  return filter === SAVED_DROPPED ? items.filter((it) => drops[it.id]) : items;
}
