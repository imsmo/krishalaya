// modules/listings/dto/query-listing.dto.ts · cursor pagination + filters (read path).
//
// PC-56 STORE-2a · B1 (survey F-17 / B18 / B19, founder D3):
//   • `organic` was `z.coerce.boolean()` — JavaScript's Boolean("false") is TRUE, so `?organic=false` filtered TO organic lots. It is now the
//     organic SPLIT: `certified` | `natural` | `any` (either claim); the legacy truthy spellings (`true`, `1`) mean `any`, and `false` / `0` /
//     empty mean NO filter. Anything else is refused by the schema (422 VALIDATION_ERROR), never guessed. `mine` had the same coercion bug and is fixed the same way.
//   • `grade` — a grade option id (attribute_options), or `none` (no CONFIRMED grade). Founder D2: only a grade a person confirmed counts.
//   • `category` — a category id whose WHOLE SUBTREE is browsed (the public category tree's path); `categoryId` stays the exact match it was.
//   • `district` — an admin-region id whose subtree is browsed (a listing's region may be finer than a district); `regionId` stays exact.
//   • `sort=distance`, `sort=relevance`, `lat`, `lng`, `pincode` are still ACCEPTED BY THE SCHEMA so the read model can REFUSE them by name
//     (400 DISTANCE_SORT_REFUSED / RELEVANCE_SORT_REFUSED / LOCATION_FILTER_REFUSED) — they used to be silently ignored (founder D3: no buyer
//     location is asked for in 2a; no relevance ranking exists on the SQL path).
import { z } from 'zod';

const UUID = z.string().uuid();

/** A query-string boolean that means what it says: "true"/"1" → true, "false"/"0"/"" → false. (z.coerce.boolean read "false" as true.) */
export const queryBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return v;
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0' || s === '') return false;
  return v;   // anything else fails z.boolean() below — refused, never guessed
}, z.boolean());

export const ORGANIC_SPLITS = ['certified', 'natural', 'any'] as const;
export type OrganicSplit = (typeof ORGANIC_SPLITS)[number];

/** `organic`: the split, or no filter. Legacy truthy spellings → `any`; falsy → undefined (no filter). */
export const organicSplit = z.preprocess((v) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v ? 'any' : undefined;
  if (typeof v !== 'string') return v;
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === '1') return 'any';
  if (s === 'false' || s === '0' || s === '') return undefined;
  return s;
}, z.enum(ORGANIC_SPLITS).optional());

export const LISTING_SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export const QueryListingSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(120).optional(),                 // free-text: the title, ILIKE, in the language it was listed in (no vernacular synonyms — B31)
  categoryId: UUID.optional(),
  category: UUID.optional(),
  pincode: z.string().regex(/^\d{4,10}$/).optional(),
  regionId: UUID.optional(),
  district: UUID.optional(),
  grade: z.union([UUID, z.literal('none')]).optional(),
  organic: organicSplit,
  saleType: z.enum(['direct', 'auction', 'both', 'preorder', 'service', 'group_lot']).optional(),
  priceMinMinor: z.string().regex(/^\d+$/).optional(),
  priceMaxMinor: z.string().regex(/^\d+$/).optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'distance']).default('newest'),
  lat: z.coerce.number().optional(), lng: z.coerce.number().optional(),
  // Owner view ("my listings"): the caller's OWN listings across every status (draft/paused/etc — see
  // ListingSearchReadModel), not just the public `published` feed. Requires auth — the controller 401s a
  // `mine=true` call with no authenticated caller (the route itself stays @Public for the anonymous browse case).
  mine: queryBoolean.optional(),
}).strict();
export type QueryListingDto = z.infer<typeof QueryListingSchema>;
