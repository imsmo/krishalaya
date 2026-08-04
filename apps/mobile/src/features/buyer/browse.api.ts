// apps/mobile/src/features/buyer/browse.api.ts · data layer for the buyer browse/search/detail surface (P-08).
// Keeps screens thin (guide §3). The public catalogue is ANONYMOUS (SDK browse/get send no token), keyset-paged,
// and read through the SWR cache so a repeat search is instant + usable on 3G/offline (DoD: results <2s via cache).
// Degrade-never-die: a hard failure → an empty page / null, never a crash. Money stays bigint-minor (Law 2) — the
// screen formats via MoneyText. Cache is scoped (anon-safe): the public catalogue is the same for everyone, so we
// scope it under a fixed 'public' bucket rather than the user, and never cache another tenant's private data.
import type { ListingCard, ListingQuery, ReviewSummary, CategoryNode, SellerPublicProfile, PublicReview } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { POLICY } from '../../core/offline/cache-policies';

export interface BrowsePage { items: ListingCard[]; nextCursor: string | null; total: number | null }

const PUBLIC_SCOPE = 'public';

/** Browse/search published listings (anonymous, keyset). Read-through SWR cache keyed by the full query, so the
 * same search serves instantly then revalidates. Degrades to an empty page. */
export async function browseListings(query: ListingQuery): Promise<BrowsePage> {
  try {
    const { value } = await cache.read<BrowsePage>({
      scope: PUBLIC_SCOPE, ns: 'browse', parts: [JSON.stringify(query)], policy: POLICY.shortList,
      fetcher: async () => {
        const page = await apiClient().listings.browse(query);
        return { items: page.items, nextCursor: page.nextCursor, total: page.total ?? null };
      },
    });
    return value;
  } catch { return { items: [], nextCursor: null, total: null }; }
}

/** A single published listing by id (anonymous, public/visibility-gated). Cached; null on not-found/failure. */
export async function getPublicListing(id: string): Promise<ListingCard | null> {
  try {
    const { value } = await cache.read<ListingCard>({
      scope: PUBLIC_SCOPE, ns: 'browse.detail', parts: [id], policy: POLICY.shortList,
      fetcher: () => apiClient().listings.get(id),
    });
    return value;
  } catch { return null; }
}

/** Top-level product categories for the filter sheet (screen 68), from the real global taxonomy (lookups tree,
 * locale-resolved names). Cached under the public bucket; degrades to [] so the section simply shows nothing
 * rather than crashing. Only roots (parentId === null) — the buyer feed filters by a single categoryId. */
export async function topCategories(): Promise<CategoryNode[]> {
  try {
    const { value } = await cache.read<CategoryNode[]>({
      scope: PUBLIC_SCOPE, ns: 'browse.categories', parts: ['root'], policy: POLICY.shortList,
      fetcher: async () => (await apiClient().lookups.categories({ activeOnly: true })).filter((c) => c.parentId === null),
    });
    return value ?? [];
  } catch { return []; }
}

/** Current (live) prices for a set of saved listings, id → priceMinor (bigint string, Law 2). Used by the Saved
 * screen (126) to detect a "since saved" price drop against the stored snapshot price. Each id reads through the
 * cached public-listing fetcher and degrades independently — a listing that can't be fetched (deleted/hidden/
 * offline) is simply omitted, never faked. */
export async function livePriceMap(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(ids.map(async (id) => {
    const card = await getPublicListing(id);
    if (card) out[id] = card.priceMinor;
  }));
  return out;
}

/** A seller's aggregate rating (real). Degrades to a zero summary. */
export async function sellerSummary(sellerUserId: string): Promise<ReviewSummary> {
  try { return await apiClient().reviews.summary({ targetUserId: sellerUserId }); }
  catch { return { averageStars: 0, count: 0 }; }
}

/** The public seller profile (screen 100 hero + stats): displayName, regionId, memberSince, aggregate rating and
 * active-listing COUNT — anonymous/public read (GET sellers/:id/public). Cached under the public bucket; degrades
 * to null so the screen falls back to the rating-only view rather than crashing. NOTE the contract is deliberately
 * lean: no bio/farm-size/crops/languages/response-time/on-time-% and no seller-scoped listing feed — the screen
 * §13-degrades those (renders only what the contract carries; never fabricates a bio or a "98% on-time"). */
export async function sellerProfile(sellerUserId: string): Promise<SellerPublicProfile | null> {
  try {
    const { value } = await cache.read<SellerPublicProfile>({
      scope: PUBLIC_SCOPE, ns: 'seller.public', parts: [sellerUserId], policy: POLICY.shortList,
      fetcher: () => apiClient().listings.sellerPublic(sellerUserId),
    });
    return value ?? null;
  } catch { return null; }
}

/** Public profiles for a set of saved sellers (screen 127), id → SellerPublicProfile. Each id reads through the
 * cached `sellerProfile` and degrades independently — a seller that can't be fetched is simply omitted (the screen
 * shows a minimal fallback card for it), never faked. */
export async function savedSellerProfiles(ids: string[]): Promise<Record<string, SellerPublicProfile>> {
  const out: Record<string, SellerPublicProfile> = {};
  await Promise.all(ids.map(async (id) => {
    const p = await sellerProfile(id);
    if (p) out[id] = p;
  }));
  return out;
}

/** A seller's most-recent PUBLIC reviews (screen 100 "Recent reviews"): stars, body, verified-purchase flag and
 * date — anonymous/public. The contract is PII-free (no reviewer name), so the screen labels each review by its
 * verified-purchase status, never an invented author. Cached; degrades to []. */
export async function sellerReviews(sellerUserId: string, limit = 3): Promise<PublicReview[]> {
  try {
    const { value } = await cache.read<PublicReview[]>({
      scope: PUBLIC_SCOPE, ns: 'seller.reviews', parts: [sellerUserId, String(limit)], policy: POLICY.shortList,
      fetcher: async () => (await apiClient().reviews.publicReviews({ targetUserId: sellerUserId, targetType: 'seller', limit })).items,
    });
    return value ?? [];
  } catch { return []; }
}
