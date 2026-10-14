// modules/listings/read-models/listing-purchase.read-model.ts · PC-56 STORE-2b · B1 / B3 / B4 / B10 (founder D1, D3) — WHAT BUYING A LOT DEPENDS
// ON, for the orders module (read through ListingService.purchaseFacts — Law 11: orders never touches a listings repository).
//
// For each listing id of ONE organisation (the RLS-forced `listings` row in that tenant's own context, bound tenant_id), in ONE bounded query:
//   • `sellerSuspended` — the seller under a live suspension in this organisation (shared/sql/member-suspension.sql.ts — the one predicate);
//     a suspended seller's line is refused at add AND at placement (survey F-15, cart half);
//   • `licenceRequired` — a NATIONAL `license_required` rule in force today on the product or its category branch: the SAME fragment the
//     2a lock prints (public-listing.sql.ts `licenceRequiredSql`), so the lock a buyer sees and the refusal they meet can never disagree;
//   • `bannedRegion` — when a delivery region is given: the NAME of a `banned_state` rule's region whose subtree CONTAINS that region
//     (`admin_regions.path @> address path` — a district or a village inside a banned state is inside it), else null;
//   • the organisation (slug + display name) and the district NAME — what a cart line says about who sells (never a person) — and the
//     listing's visibility (a members-only lot is not on sale to the storefront).
// Rules are GLOBAL master data (no tenant_id, no RLS — written by the admin realm). The window is checked on the DATABASE's calendar day
// (`CURRENT_DATE` — the same clock that stamps `effective_from DEFAULT CURRENT_DATE`; PC-56 STORE-2b lead fix-forward: a JS UTC day was one
// day behind the DB between 00:00 and 05:30 IST, so a rule effective "today" was not enforced until 05:30). (The 2a comment continued: the day the 2a
// marker and catalogue's RegulatedRuleRepository use). This read does NOT degrade: if it fails, the caller fails (a buy is never allowed on
// an unanswered safety question). Bounded: at most MAX_IDS ids (a cart holds at most 200 lines).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerSuspendedExpr } from '../../../shared/sql/member-suspension.sql';
import { UUID_RE } from '../../../shared/pagination/us-keyset';
import { districtNameSql, licenceRequiredSql } from './public-listing.sql';

export const MAX_PURCHASE_FACT_IDS = 200;

export interface ListingPurchaseFacts {
  listingId: string;
  visibility: string;
  sellerSuspended: boolean;
  licenceRequired: boolean;
  bannedRegion: string | null;
  organisation: { slug: string; name: string } | null;
  district: string | null;
}

/** The banned region (by name) a `banned_state` rule of listing alias `l`'s product / category branch holds over region param `regionParam`. */
export const bannedRegionSql = (l: string, todayParam: string, regionParam: string): string =>
  `(SELECT kvbr.default_name FROM regulated_product_rules kvb JOIN admin_regions kvbr ON kvbr.id = kvb.region_id
     WHERE kvb.rule_type = 'banned_state' AND kvb.deleted_at IS NULL AND kvb.region_id IS NOT NULL
       AND kvb.effective_from <= ${todayParam}::date AND (kvb.effective_to IS NULL OR kvb.effective_to >= ${todayParam}::date)
       AND kvbr.path @> (SELECT kva.path FROM admin_regions kva WHERE kva.id = ${regionParam}::uuid)
       AND (kvb.product_id = ${l}.product_id
            OR kvb.category_id IN (SELECT kvc.id FROM categories kvc
                                    WHERE kvc.path @> (SELECT kvcc.path FROM categories kvcc WHERE kvcc.id = ${l}.category_id)
                                      AND kvc.deleted_at IS NULL))
     ORDER BY kvbr.level, kvb.id LIMIT 1)`;

@Injectable()
export class ListingPurchaseReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Facts for each id that is a listing of `tenantId` (ids of other organisations, or gone, are simply absent from the map). */
  async forListings(tenantId: string, listingIds: readonly string[], deliveryRegionId?: string | null): Promise<Map<string, ListingPurchaseFacts>> {
    const out = new Map<string, ListingPurchaseFacts>();
    const ids = [...new Set(listingIds.filter((x) => UUID_RE.test(x)))].slice(0, MAX_PURCHASE_FACT_IDS);
    if (!UUID_RE.test(tenantId) || ids.length === 0) return out;
    const region = deliveryRegionId && UUID_RE.test(deliveryRegionId) ? deliveryRegionId : null;
    const r = await this.replica.forTenant(tenantId).query<{ id: string; visibility: string; suspended: boolean; licence_required: boolean;
      banned_region: string | null; slug: string | null; display_name: string | null; district: string | null }>(
      `SELECT l.id, l.visibility::text AS visibility,
              ${sellerSuspendedExpr('l.tenant_id', 'l.seller_user_id')} AS suspended,
              ${licenceRequiredSql('l', 'CURRENT_DATE')} AS licence_required,
              CASE WHEN $3::uuid IS NULL THEN NULL ELSE ${bannedRegionSql('l', 'CURRENT_DATE', '$3')} END AS banned_region,
              t.slug, t.display_name,
              ${districtNameSql('l')} AS district
         FROM listings l
         LEFT JOIN tenants t ON t.id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.id = ANY($2::uuid[]) AND l.deleted_at IS NULL`,
      [tenantId, ids, region]);
    for (const x of r.rows) {
      out.set(x.id, {
        listingId: x.id, visibility: x.visibility, sellerSuspended: x.suspended === true, licenceRequired: x.licence_required === true,
        bannedRegion: x.banned_region ?? null,
        organisation: x.slug && x.display_name ? { slug: x.slug, name: x.display_name } : null,
        district: x.district ?? null,
      });
    }
    return out;
  }
}
