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
//
// PC-56 STORE-2a · B2 (founder D2, survey B10 / B16 / B30) — three keys more, each named:
//   • `quantityTotal` — "Available 34 of 40 qtl" (the lot's size, the entity's own column);
//   • `gradeConfirmed` — the grade a PERSON confirmed (QC review of the current window — read-models/public-listing.sql.ts), as its name and
//     the organisation whose staff graded it ("Grade A · graded by Anand FPO staff"); NULL when no confirmation exists. An AI suggestion is
//     never read, never shown, and there is no confidence number (D2). `grade` is now that SAME confirmed name (it used to print the column
//     whatever wrote it);
//   • `attributes` — the lot's own measured attributes (listing_attribute_values: moisture, foreign matter …) as code / name / value / unit.
// And the TOMBSTONE (B16): what a buyer may know about a lot that is no longer on sale — `toListingTombstone` below, with NO price and NO
// quantity.
import type { ListingProps } from './listing.entity';
import { organicWire } from './organic-claim';

/** One measured attribute of THIS lot, as master data names it. `value` is the DB's own text of the value (numbers trimmed of trailing
 *  zeros, dates YYYY-MM-DD, an option's display name); `kind` lets a page localise a yes/no. */
export interface PublicLotAttribute { code: string; name: string; kind: 'text' | 'number' | 'bool' | 'date' | 'option'; value: string; unit: string | null }

/** Facts the entity does not carry, read beside it (ListingPublicFactsReadModel): who sells, where (coarse), the CONFIRMED grade's name. */
export interface PublicListingFacts {
  organisation: { slug: string; name: string } | null;
  /** The listing's region as a DISTRICT-level name (or the state's, when only a state is recorded) — never finer, never an id. */
  district: string | null;
  /** The CONFIRMED grade's display name (attribute_options) — null when no person confirmed one (founder D2). */
  grade: string | null;
  /** STORE-2a (B10): is the seller under a live suspension in this organisation? A suspended seller's lot is not public (404). */
  sellerSuspended?: boolean;
  /** STORE-2a (B30): the lot's measured attributes. */
  attributes?: PublicLotAttribute[];
  /** PC-56 STORE-5b · D1 / B18: does a verified, organic, valid-today certificate cover the lot (read-models/certified.sql.ts)? Absent / a
   *  failed read = false — a `certified` claim then reads `self_declared` (fail closed: never the badge on a read that could not check). */
  organicCovered?: boolean;
}
export const NO_PUBLIC_FACTS: PublicListingFacts = Object.freeze({ organisation: null, district: null, grade: null, sellerSuspended: false, attributes: [] });

/** What an anonymous (or any non-owner) caller may read about a published listing. Money = a bigint minor-unit STRING + its currency. */
export interface PublicListing {
  id: string; title: string; description: string | null; categoryId: string; productId: string;
  grade: string | null; unitCode: string; priceMinor: string; currencyCode: string;
  quantityAvailable: number; quantityTotal: number; minOrderQty: number; harvestDate: string | null;
  /** PC-56 STORE-5b · D1 / B18: the PUBLIC claim — `certified` only while a certificate covers it, `self_declared` for a certified claim
   *  without one, `natural`, or `none` (it used to be the seller's raw word) */
  organicClaim: string | null; organic: boolean; saleType: string; status: string;
  district: string | null; organisation: { slug: string; name: string } | null;
  publishedAt: string | null;
  gradeConfirmed: { name: string; gradedBy: string | null } | null;
  attributes: PublicLotAttribute[];
}

/** The ONLY keys a public listing has. The unit spec and the live spec compare against this list. */
export const PUBLIC_LISTING_KEYS: readonly (keyof PublicListing)[] = Object.freeze([
  'id', 'title', 'description', 'categoryId', 'productId', 'grade', 'unitCode', 'priceMinor', 'currencyCode', 'quantityAvailable',
  'quantityTotal', 'minOrderQty', 'harvestDate', 'organicClaim', 'organic', 'saleType', 'status', 'district', 'organisation', 'publishedAt',
  'gradeConfirmed', 'attributes',
] as const);

const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

export function toPublicListing(p: Readonly<ListingProps>, facts: PublicListingFacts = NO_PUBLIC_FACTS): PublicListing {
  const claim = (p.organicClaim as string | null | undefined) ?? null;
  const org = facts.organisation ? { slug: facts.organisation.slug, name: facts.organisation.name } : null;
  return {
    id: p.id, title: p.title, description: p.description ?? null, categoryId: p.categoryId, productId: p.productId,
    grade: facts.grade, unitCode: p.unitCode, priceMinor: String(p.priceMinor), currencyCode: p.currencyCode,
    quantityAvailable: Number(p.quantityAvailable), quantityTotal: Number(p.quantityTotal), minOrderQty: Number(p.minOrderQty),
    harvestDate: p.harvestDate ?? null,
    organicClaim: claim === null ? null : claim === 'certified' || claim === 'natural' ? organicWire(claim, facts.organicCovered === true) : claim,
    organic: claim !== null && claim !== 'none', saleType: p.saleType, status: p.status,
    district: facts.district, organisation: org,
    publishedAt: iso(p.publishedAt),
    gradeConfirmed: facts.grade ? { name: facts.grade, gradedBy: org ? org.name : null } : null,
    attributes: (facts.attributes ?? []).map((a) => ({ code: a.code, name: a.name, kind: a.kind, value: a.value, unit: a.unit })),
  };
}

// ---- the TOMBSTONE (B16) -----------------------------------------------------------------------------------------------------------------

/** The lot statuses a buyer is TOLD about (with no price): the platform's word for why it is not on sale. Every other non-published status
 *  (draft, pending_approval, rejected, hidden, held, reserved_auction) stays a plain 404 — unpublished inventory is never enumerable. */
export const TOMBSTONE_STATUS: Readonly<Record<string, 'sold_out' | 'paused' | 'expired' | 'withdrawn'>> = Object.freeze({
  sold_out: 'sold_out', paused: 'paused', expired: 'expired', archived: 'withdrawn',
});
export type TombstoneStatus = 'sold_out' | 'paused' | 'expired' | 'withdrawn';

/** What a buyer may know about a lot that is no longer on sale: its id, why (status), its title, who sells, its category. NO price, NO
 *  quantity, NO date — "no price while it is not on sale". */
export interface ListingTombstone {
  id: string; tombstone: true; status: TombstoneStatus; title: string;
  organisation: { slug: string; name: string } | null;
  category: { id: string; name: string } | null;
}
export const TOMBSTONE_KEYS: readonly (keyof ListingTombstone)[] = Object.freeze(['id', 'tombstone', 'status', 'title', 'organisation', 'category'] as const);

export function toListingTombstone(row: { id: string; status: string; title: string; orgSlug: string | null; orgName: string | null; categoryId: string | null; categoryName: string | null }): ListingTombstone | null {
  const status = TOMBSTONE_STATUS[row.status];
  if (!status) return null;
  return {
    id: row.id, tombstone: true, status, title: row.title,
    organisation: row.orgSlug && row.orgName ? { slug: row.orgSlug, name: row.orgName } : null,
    category: row.categoryId && row.categoryName ? { id: row.categoryId, name: row.categoryName } : null,
  };
}
