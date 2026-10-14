// modules/listings/domain/listing-public.view.ts · PC-56 HOTFIX-4 · A6 (survey F-7 / B3 / C-1, founder D3) — THE PUBLIC LISTING, AN ALLOW-LIST.
// Pure, no I/O.
//
// **THE DEFECT THIS ANSWERS.** The anonymous detail read (`GET /v1/listings/:id`) returned the cached entity's props with five QC keys
// deleted — so every OTHER prop reached any anonymous caller: the farm's `lat`/`lng` (numeric(9,6), about 10 cm), `pincode`, the region
// uuid, `tenantId`, `version`, `aiExtracted`, the seller's user id. A deny-list leaks whatever the next wave adds to the entity; this is an
// ALLOW-list: a key reaches a buyer only because it is written below.
//
// **WHO SELLS (D3, 2026-10-14): THE ORGANISATION.** No seller user id, no person: the organisation's slug + display name, and the place as a
// coarse NAME (the district — never finer, never a uuid, never coordinates).
import type { ListingProps } from './listing.entity';

/** Facts the entity does not carry, read beside it (ListingPublicFactsReadModel): who sells, where (coarse), the grade's name. */
export interface PublicListingFacts {
  organisation: { slug: string; name: string } | null;
  /** The listing's region as a DISTRICT-level name (or the state's, when only a state is recorded) — never finer, never an id. */
  district: string | null;
  /** The recorded grade's display name (attribute_options), or null when no grade is recorded. */
  grade: string | null;
}
export const NO_PUBLIC_FACTS: PublicListingFacts = Object.freeze({ organisation: null, district: null, grade: null });

/** What an anonymous (or any non-owner) caller may read about a published listing. Money = a bigint minor-unit STRING + its currency. */
export interface PublicListing {
  id: string; title: string; description: string | null; categoryId: string; productId: string;
  grade: string | null; unitCode: string; priceMinor: string; currencyCode: string;
  quantityAvailable: number; minOrderQty: number; harvestDate: string | null;
  organicClaim: string | null; organic: boolean; saleType: string; status: string;
  district: string | null; organisation: { slug: string; name: string } | null;
  publishedAt: string | null;
}

/** The ONLY keys a public listing has. The unit spec and the live spec compare against this list. */
export const PUBLIC_LISTING_KEYS: readonly (keyof PublicListing)[] = Object.freeze([
  'id', 'title', 'description', 'categoryId', 'productId', 'grade', 'unitCode', 'priceMinor', 'currencyCode', 'quantityAvailable',
  'minOrderQty', 'harvestDate', 'organicClaim', 'organic', 'saleType', 'status', 'district', 'organisation', 'publishedAt',
] as const);

const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

export function toPublicListing(p: Readonly<ListingProps>, facts: PublicListingFacts = NO_PUBLIC_FACTS): PublicListing {
  const claim = (p.organicClaim as string | null | undefined) ?? null;
  return {
    id: p.id, title: p.title, description: p.description ?? null, categoryId: p.categoryId, productId: p.productId,
    grade: facts.grade, unitCode: p.unitCode, priceMinor: String(p.priceMinor), currencyCode: p.currencyCode,
    quantityAvailable: Number(p.quantityAvailable), minOrderQty: Number(p.minOrderQty), harvestDate: p.harvestDate ?? null,
    organicClaim: claim, organic: claim !== null && claim !== 'none', saleType: p.saleType, status: p.status,
    district: facts.district, organisation: facts.organisation ? { slug: facts.organisation.slug, name: facts.organisation.name } : null,
    publishedAt: iso(p.publishedAt),
  };
}
