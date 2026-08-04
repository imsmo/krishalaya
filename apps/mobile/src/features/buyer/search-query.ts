// apps/mobile/src/features/buyer/search-query.ts · PURE helpers that turn the buyer's filter-form state into a
// typed ListingQuery for the SDK (and back into a human summary). No React/native imports (the SDK type is
// `import type` → erased), so it's unit-tested under ts-jest. Money is bigint minor-unit strings (Law 2): rupee
// inputs become paise via BigInt, never a float. Empty/invalid fields are dropped so the server gets a clean,
// minimal query (and the cache key stays stable).
import type { ListingQuery } from '@krishalaya/sdk-js';

export type SortKey = 'newest' | 'price_asc' | 'price_desc';

/** The buyer's filter-form state (all strings, as typed in the UI). */
export interface FilterForm {
  q?: string;
  categoryId?: string;        // single real category (from the lookups tree) — the feed filters by one categoryId
  saleType?: string;          // '' | 'direct' | 'auction' | ...
  organic?: boolean;
  priceMinRupees?: string;
  priceMaxRupees?: string;
  sort?: SortKey;
}

/** Whole-rupees string → paise minor-unit string for a price FILTER. Unlike the payment helper this allows large
 * caps and is lenient (empty/invalid → undefined, i.e. "no bound") since a filter is not a charge. */
export function rupeesToPaiseFilter(rupees: string | undefined): string | undefined {
  const clean = (rupees ?? '').trim();
  if (!/^\d{1,12}$/.test(clean)) return undefined;
  try { return (BigInt(clean) * 100n).toString(); } catch { return undefined; }
}

/** Build a minimal ListingQuery from the form: trims, drops empties, converts rupee bounds → paise. `cursor` is
 * threaded separately by the pager. */
export function buildListingQuery(form: FilterForm, cursor?: string, limit = 20): ListingQuery {
  const q: ListingQuery = { limit };
  const text = (form.q ?? '').trim();
  if (text) q.q = text;
  if (form.categoryId) q.categoryId = form.categoryId;
  if (form.saleType) q.saleType = form.saleType;
  if (form.organic) q.organic = true;
  const min = rupeesToPaiseFilter(form.priceMinRupees);
  const max = rupeesToPaiseFilter(form.priceMaxRupees);
  if (min) q.priceMinMinor = min;
  if (max) q.priceMaxMinor = max;
  if (form.sort && form.sort !== 'newest') q.sort = form.sort;
  if (cursor) q.cursor = cursor;
  return q;
}

/** How many filters (excluding the free-text query + default sort) are active — drives the "Filters (N)" badge. */
export function activeFilterCount(form: FilterForm): number {
  let n = 0;
  if (form.categoryId) n++;
  if (form.saleType) n++;
  if (form.organic) n++;
  if (rupeesToPaiseFilter(form.priceMinRupees)) n++;
  if (rupeesToPaiseFilter(form.priceMaxRupees)) n++;
  if (form.sort && form.sort !== 'newest') n++;
  return n;
}

/** One removable "active filter" chip in the search-results header (screen 67). `key` identifies the filter to
 * clear; `value` carries the displayable datum (the term, sale-type code, or the whole-rupee bound) so the screen
 * can render + localise it. Text query is the first chip; then organic, sale-type, and the two price bounds. */
export type FilterChipKey = 'q' | 'organic' | 'saleType' | 'priceMin' | 'priceMax';
export interface FilterChip { key: FilterChipKey; value?: string; }

export function activeFilterChips(form: FilterForm): FilterChip[] {
  const chips: FilterChip[] = [];
  const q = (form.q ?? '').trim();
  if (q) chips.push({ key: 'q', value: q });
  if (form.organic) chips.push({ key: 'organic' });
  if (form.saleType) chips.push({ key: 'saleType', value: form.saleType });
  const min = rupeesToPaiseFilter(form.priceMinRupees);
  const max = rupeesToPaiseFilter(form.priceMaxRupees);
  if (min) chips.push({ key: 'priceMin', value: (form.priceMinRupees ?? '').trim() });
  if (max) chips.push({ key: 'priceMax', value: (form.priceMaxRupees ?? '').trim() });
  return chips;
}

/** Return the form with a single active filter cleared (tapping a chip's ✕). Pure — never mutates the input. */
export function removeFilterChip(form: FilterForm, key: FilterChipKey): FilterForm {
  switch (key) {
    case 'q': return { ...form, q: '' };
    case 'organic': return { ...form, organic: false };
    case 'saleType': return { ...form, saleType: undefined };
    case 'priceMin': return { ...form, priceMinRupees: undefined };
    case 'priceMax': return { ...form, priceMaxRupees: undefined };
    default: return form;
  }
}

/** The sorts the server actually supports, in the order shown by the sort selector. (The design also lists
 * "Distance" and "Best Rated"; those need geo/rating read-models the public listing feed doesn't expose yet —
 * §13: omitted rather than faked.) */
export const SORT_KEYS: SortKey[] = ['newest', 'price_asc', 'price_desc'];
export function cycleSort(current: SortKey | undefined): SortKey {
  const i = SORT_KEYS.indexOf(current ?? 'newest');
  return SORT_KEYS[(i + 1) % SORT_KEYS.length];
}

/** A stable, human-readable label for a SAVED search (so the saved list shows what it was). */
export function describeSearch(form: FilterForm): string {
  const parts: string[] = [];
  if ((form.q ?? '').trim()) parts.push(`"${form.q!.trim()}"`);
  if (form.organic) parts.push('organic');
  if (form.saleType) parts.push(form.saleType);
  const n = activeFilterCount(form) - (form.organic ? 1 : 0) - (form.saleType ? 1 : 0);
  if (n > 0) parts.push(`+${n}`);
  return parts.join(' · ') || 'All produce';
}
