// apps/web-storefront/src/features/discovery/query.ts · pure helpers that translate the page's URL searchParams
// into a typed SDK `ListingQuery` and back into shareable query strings. No framework, no I/O — so it's trivially
// testable and safe to import from a Server Component. Money is handled as INTEGER STRINGS end-to-end (Law 2):
// the buyer types a major-unit amount (e.g. ₹123.45) and we convert to a minor-unit string ("12345") with string
// math — never a float, never `parseFloat`/`toFixed`.
import type { ListingQuery } from '@krishalaya/sdk-js';

/** Sale-type facets the buyer can pick. Mirrors the API's listing sale types (minus seller-only variants). The
 *  value is passed straight through to `listings.browse({ saleType })`; labels are localized in the UI. */
export const SALE_TYPES = ['direct', 'auction', 'preorder', 'group_lot', 'service'] as const;
export type SaleTypeFacet = (typeof SALE_TYPES)[number];

/** Sort options the SDK accepts (keyset-stable on the server). */
export const SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export type SortFacet = (typeof SORTS)[number];

/** Page size for the storefront grid. */
export const PAGE_LIMIT = 24;

/** The currency minor-unit scale we render against (INR paise = 2). Catalogue is INR; kept explicit, not magic. */
const MINOR_DIGITS = 2;

/** Raw, already-decoded searchParams as Next hands them to a page (values may be string | string[] | undefined). */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

/**
 * Major-unit decimal string → minor-unit integer string (e.g. "123.4" → "12340", "99" → "9900"). Returns
 * undefined for empty/invalid input so a bad filter is simply ignored rather than throwing. Pure string math.
 */
export function parseMajorToMinor(input: string | string[] | undefined): string | undefined {
  const s = one(input);
  if (!s) return undefined;
  if (!new RegExp(`^\\d{1,12}(\\.\\d{1,${MINOR_DIGITS}})?$`).test(s)) return undefined;
  const [intPart, fracRaw = ''] = s.split('.');
  const frac = (fracRaw + '0'.repeat(MINOR_DIGITS)).slice(0, MINOR_DIGITS);
  const joined = (intPart + frac).replace(/^0+(?=\d)/, '');
  return joined === '' ? '0' : joined;
}

/** Minor-unit integer string → major-unit display string for pre-filling the form (e.g. "12340" → "123.40"). */
export function minorToMajor(minor: string | undefined): string {
  if (!minor || !/^\d+$/.test(minor)) return '';
  const padded = minor.padStart(MINOR_DIGITS + 1, '0');
  const int = padded.slice(0, -MINOR_DIGITS).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(-MINOR_DIGITS);
  return /^0+$/.test(frac) ? int : `${int}.${frac}`;
}

/** Build the typed SDK query from the URL. Enums are validated (anything unrecognised is dropped, not trusted). */
export function toListingQuery(sp: RawSearchParams): ListingQuery {
  const saleTypeRaw = one(sp.saleType);
  const sortRaw = one(sp.sort);
  return {
    q: one(sp.q),
    // categoryId/regionId are passed through transparently from the URL (the API + RLS validate them). The
    // storefront does not yet render a *named* category/region picker because the SDK exposes no categories/
    // regions lookup resource — see the README "Discovery" note. Deep links carrying these still filter correctly.
    categoryId: one(sp.categoryId),
    regionId: one(sp.regionId),
    saleType: (SALE_TYPES as readonly string[]).includes(saleTypeRaw ?? '') ? saleTypeRaw : undefined,
    organic: one(sp.organic) === '1' ? true : undefined,
    priceMinMinor: parseMajorToMinor(sp.priceMin),
    priceMaxMinor: parseMajorToMinor(sp.priceMax),
    sort: (SORTS as readonly string[]).includes(sortRaw ?? '') ? (sortRaw as SortFacet) : undefined,
    cursor: one(sp.cursor),
    limit: PAGE_LIMIT,
  };
}

/**
 * The currently-active filter params (everything EXCEPT the paging cursor), as a flat string map. Used to (a)
 * preserve filters in the "show more" link while swapping the cursor, and (b) carry categoryId/regionId through
 * a filter-form submit. Only present values are included, so URLs stay clean and shareable.
 */
export function activeFilters(sp: RawSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['q', 'categoryId', 'regionId', 'saleType', 'organic', 'priceMin', 'priceMax', 'sort'] as const) {
    const v = one(sp[key]);
    if (v) out[key] = v;
  }
  return out;
}

/** Serialize a flat param map to a query string (stable key order, omitting empties). Returns '' when empty. */
export function buildQueryString(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/** The "show more" href: same path, all active filters preserved, cursor advanced. */
export function loadMoreHref(basePath: string, sp: RawSearchParams, nextCursor: string): string {
  return `${basePath}${buildQueryString({ ...activeFilters(sp), cursor: nextCursor })}`;
}

/** True when any discovery filter is active (drives the "clear filters" affordance). */
export function hasActiveFilters(sp: RawSearchParams): boolean {
  return Object.keys(activeFilters(sp)).length > 0;
}
