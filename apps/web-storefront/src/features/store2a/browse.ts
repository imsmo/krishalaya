// apps/web-storefront/src/features/store2a/browse.ts · PC-56 STORE-2a · C1/C2/C5 — THE BROWSE PAGE'S PURE HALF (no React, no I/O).
//
// One grammar for a store's catalogue URL, and every link the page prints is built from it — so a link can never drop a filter, carry a
// stale cursor across a sort change, or invent a parameter the API refuses:
//   • `readBrowse(sp)` — the URL's searchParams → the typed state. The category is `?category=<id>` (the WHOLE subtree of the public tree:
//     the canon's `/c/[...path]` route is a recorded DELTA); the legacy `?categoryId=` reads as the same. `organic` is the split
//     (certified · natural · any; the legacy `1` = any). `grade` is a grade option id or `none`. `district` an admin-region id.
//   • `toSearchQuery(state, exponent)` — the SDK `listings.search` query; the typed price band is parsed with the STORE currency's exponent
//     (null exponent → the band is not applied, never guessed).
//   • `browseHref(base, state, patch)` — every facet / chip / sort link. The CURSOR IS ALWAYS DROPPED unless the patch sets one: a cursor
//     belongs to its sort and its filters (the API refuses a cursor of another sort: CURSOR_SORT_MISMATCH), so changing either restarts at
//     page one. `showMoreHref` is the one link that carries a cursor — with the sort it was minted under.
//   • `activeChips` — one remove-one-param link per active filter ("Grade A ✕").
//   • `facetView` — the API's facet counts → links with counts; `null` facets (above the cap) → withheld.
//   • `categoryTrail` — the breadcrumb root → … → the chosen category, from the public tree (master-data names).
//   • `inputsRoots` — the farm-inputs subtree(s): category roots whose commerce kind is `input_regulated` (data, never a baked code).
//   • `readState` / `browseOff` — the outcome of a read, with the catalogue's kill-switch (`STOREFRONT_BROWSE_OFF`, founder D4) kept apart
//     from a plain outage, so the page says "temporarily unavailable" — never "for this tenant/plan" — and never "no listings".
import type { CategoryNode, ListingFacets, ListingSearchQuery, StorefrontFlags } from '@krishalaya/sdk-js';
import { parseMajorToMinor } from '../discovery/query';

export type RawParams = Record<string, string | string[] | undefined>;
export const SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export type Sort = (typeof SORTS)[number];
export const ORGANIC = ['certified', 'natural', 'any'] as const;
export type Organic = (typeof ORGANIC)[number];
export const SALE_TYPES = ['direct', 'auction', 'preorder', 'group_lot', 'service'] as const;
export const PAGE_LIMIT = 24;

/** The browse state a URL carries. Order of keys = the order links are written in (stable, shareable URLs). */
export interface BrowseState {
  q?: string; category?: string; district?: string; grade?: string; organic?: Organic; saleType?: string;
  priceMin?: string; priceMax?: string; sort?: Sort; cursor?: string;
}
export const STATE_KEYS: readonly (keyof BrowseState)[] = ['q', 'category', 'district', 'grade', 'organic', 'saleType', 'priceMin', 'priceMax', 'sort', 'cursor'];
/** The keys that NARROW the feed (a chip each). Sort and cursor do not narrow. */
export const FILTER_KEYS: readonly (keyof BrowseState)[] = ['q', 'category', 'district', 'grade', 'organic', 'saleType', 'priceMin', 'priceMax'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined): string | undefined => {
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s : undefined;
};

export function readBrowse(sp: RawParams): BrowseState {
  const out: BrowseState = {};
  const q = one(sp.q); if (q) out.q = q.slice(0, 120);
  const category = one(sp.category) ?? one(sp.categoryId); if (category && UUID.test(category)) out.category = category;
  const district = one(sp.district); if (district && UUID.test(district)) out.district = district;
  const grade = one(sp.grade); if (grade && (grade === 'none' || UUID.test(grade))) out.grade = grade;
  const organicRaw = one(sp.organic);
  const organic = organicRaw === '1' || organicRaw === 'true' ? 'any' : organicRaw;
  if (organic && (ORGANIC as readonly string[]).includes(organic)) out.organic = organic as Organic;
  const saleType = one(sp.saleType); if (saleType && (SALE_TYPES as readonly string[]).includes(saleType)) out.saleType = saleType;
  const priceMin = one(sp.priceMin); if (priceMin && /^\d{1,12}(\.\d{1,4})?$/.test(priceMin)) out.priceMin = priceMin;
  const priceMax = one(sp.priceMax); if (priceMax && /^\d{1,12}(\.\d{1,4})?$/.test(priceMax)) out.priceMax = priceMax;
  const sort = one(sp.sort); if (sort && (SORTS as readonly string[]).includes(sort)) out.sort = sort as Sort;
  const cursor = one(sp.cursor); if (cursor && cursor.length <= 512) out.cursor = cursor;
  return out;
}

/** The SDK query. The price band uses the store currency's exponent; an unknown currency (null) drops the band rather than guessing. */
export function toSearchQuery(s: BrowseState, exponent: number | null, limit: number = PAGE_LIMIT): ListingSearchQuery {
  return {
    q: s.q, category: s.category, district: s.district, grade: s.grade, organic: s.organic, saleType: s.saleType,
    priceMinMinor: exponent === null ? undefined : parseMajorToMinor(s.priceMin, exponent),
    priceMaxMinor: exponent === null ? undefined : parseMajorToMinor(s.priceMax, exponent),
    sort: s.sort, cursor: s.cursor, limit,
  };
}

/** Is any narrowing filter active? (Sort and cursor do not narrow.) */
export function isFiltered(s: BrowseState): boolean {
  return FILTER_KEYS.some((k) => s[k] !== undefined);
}

function qs(s: BrowseState): string {
  const usp = new URLSearchParams();
  for (const k of STATE_KEYS) { const v = s[k]; if (v) usp.set(k, v); }
  const out = usp.toString();
  return out ? `?${out}` : '';
}

/** A link to the same page with `patch` applied (`undefined` removes a key). The cursor is dropped unless the patch sets one. */
export function browseHref(base: string, s: BrowseState, patch: Partial<BrowseState>): string {
  const next: BrowseState = { ...s, cursor: undefined };
  for (const [k, v] of Object.entries(patch) as [keyof BrowseState, string | undefined][]) {
    if (v === undefined) delete next[k]; else (next as Record<string, string>)[k] = v;
  }
  return `${base}${qs(next)}`;
}

/** "Show more": the same filters AND the same sort (the cursor was minted under it), the next cursor. */
export function showMoreHref(base: string, s: BrowseState, nextCursor: string): string {
  return browseHref(base, s, { cursor: nextCursor });
}

export interface Chip { key: keyof BrowseState; label: string; href: string }
/** One remove-one-param link per active filter. `names` resolves ids to master-data names (an unresolved id still gets a chip, named by
 *  the fallback label — a filter the buyer cannot see is never left silently applied). */
export function activeChips(base: string, s: BrowseState, labelOf: (key: keyof BrowseState, value: string) => string): Chip[] {
  return FILTER_KEYS.filter((k) => s[k] !== undefined).map((k) => ({ key: k, label: labelOf(k, s[k] as string), href: browseHref(base, s, { [k]: undefined }) }));
}

export interface FacetLink { id: string; label: string; count: number; href: string; active: boolean }
export interface FacetView {
  grade: FacetLink[]; organic: FacetLink[]; district: FacetLink[]; saleType: FacetLink[];
}
/** The API's facets → links with their counts (each link sets ONE param, keeps the rest, drops the cursor). Null facets (the count is
 *  above the cap) → null: the page says the counts are withheld rather than printing a sample. */
export function facetView(base: string, s: BrowseState, f: ListingFacets | null | undefined, labels: {
  ungraded: string; certified: string; natural: string; saleType: (id: string) => string;
}): FacetView | null {
  if (!f) return null;
  const link = (key: keyof BrowseState, id: string, label: string, count: number): FacetLink =>
    ({ id, label, count, href: browseHref(base, s, { [key]: s[key] === id ? undefined : id }), active: s[key] === id });
  const grade = f.grade.map((g) => link('grade', g.id, g.name, g.count));
  if (f.ungraded > 0) grade.push(link('grade', 'none', labels.ungraded, f.ungraded));
  const organic = [
    ...(f.organic.certified > 0 ? [link('organic', 'certified', labels.certified, f.organic.certified)] : []),
    ...(f.organic.natural > 0 ? [link('organic', 'natural', labels.natural, f.organic.natural)] : []),
  ];
  const district = f.district.map((d) => link('district', d.id, d.name, d.count));
  const saleType = (f.saleType ?? []).filter((x) => (SALE_TYPES as readonly string[]).includes(x.id)).map((x) => link('saleType', x.id, labels.saleType(x.id), x.count));
  return { grade, organic, district, saleType };
}

/** The capped count line: exact up to the cap, "cap+" above it; null when the API did not say. */
export function countOf(total: number | null | undefined, cap: number | null | undefined): { n: number; capped: boolean } | null {
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) return null;
  const c = typeof cap === 'number' && cap > 0 ? cap : null;
  return c !== null && total > c ? { n: c, capped: true } : { n: total, capped: false };
}

/** The breadcrumb to a category: root → … → the category itself, from the public tree's paths (master-data names). [] when unknown. */
export function categoryTrail(nodes: ReadonlyArray<CategoryNode> | null | undefined, categoryId: string | undefined): { id: string; name: string }[] {
  if (!categoryId || !Array.isArray(nodes)) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: { id: string; name: string }[] = [];
  let cur = byId.get(categoryId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift({ id: cur.id, name: cur.defaultName });
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** The farm-inputs roots of the public tree: active ROOT categories whose commerce kind is `input_regulated` (master data). */
export function inputsRoots(nodes: ReadonlyArray<CategoryNode> | null | undefined): CategoryNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((n) => n && n.isActive && n.parentId === null && n.commerceKind === 'input_regulated');
}

// ---- the outcome of a read, with the kill-switch apart -----------------------------------------------------------------------------------
export type ReadState<T> = { ok: true; data: T } | { ok: false; kind: 'not_found' | 'browse_off' | 'unavailable' };
const BROWSE_OFF = 'STOREFRONT_BROWSE_OFF';

/** Run one read: 404 → not_found; the named 503 STOREFRONT_BROWSE_OFF → browse_off; anything else → unavailable (never an empty answer). */
export async function readState<T>(read: () => Promise<T>): Promise<ReadState<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (e) {
    const err = e as { status?: unknown; code?: unknown } | null;
    if (err?.code === BROWSE_OFF) return { ok: false, kind: 'browse_off' };
    return { ok: false, kind: Number(err?.status ?? 0) === 404 ? 'not_found' : 'unavailable' };
  }
}

/** Is the catalogue switched off? The flags read says OFF, or a read answered the named refusal. A FAILED flags read is not "off" (the
 *  API's own gate fails open — the page must not invent an outage). */
export function browseOff(flags: ReadState<StorefrontFlags> | { ok: boolean; data?: StorefrontFlags }, ...reads: ReadonlyArray<ReadState<unknown>>): boolean {
  if (flags.ok && flags.data && flags.data.storefront_browse === false) return true;
  return reads.some((r) => !r.ok && r.kind === 'browse_off');
}
