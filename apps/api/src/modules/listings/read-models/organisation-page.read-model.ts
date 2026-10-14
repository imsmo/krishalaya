// modules/listings/read-models/organisation-page.read-model.ts · PC-56 STORE-2a · B6 (survey B20, HOTFIX-4 D3, founder D1) — THE ORGANISATION'S
// SELLER PAGE (canon W280, collapsed from one farmer to the organisation that sells: seller identity = the ORGANISATION, everywhere).
//
// `GET /v1/sellers/organisation` answers, for the context organisation:
//   • `profile` — 0204's `public_tenant_profile` (display name, legal name, verified = the platform's approval, since-year, district,
//     member-farmer count, currency). No row for a trial / suspended / unknown organisation → 404 (the same rule as storefront/profile);
//   • `listingCount` — 0204's `public_tenant_listing_count`, CAPPED (cap + 1 = "1,000+");
//   • `reviews` — ONLY when the `reviews` flag is ON for the organisation (it is OFF by seed): `{ avg, count, capped }` over the PUBLISHED,
//     VERIFIED-PURCHASE reviews of the organisation's sellers (`target_type = 'seller'`, RLS-scoped to the tenant). The write side already sets
//     `is_verified_purchase` true on every review (reviews/domain/review.entity.ts `submit` — a party to a completed order), and this read
//     STILL counts only rows that say so, so a future non-purchase writer cannot inflate the figure. BOUNDED (Law 11): the latest cap + 1
//     reviews are read; `count` above the cap reads "1,000+", and `avg` is then the average of the latest 1,000 (`capped: true` — the page
//     says so). No reviewer, no city, no district, no order — no identity at all (founder D1). Null when the flag is OFF (the page then shows
//     no rating, not "no ratings yet").
// The per-user `GET sellers/:id/public` (HOTFIX-4) is unchanged; the storefront does not link to it.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { UUID_RE } from '../../../shared/pagination/us-keyset';
import { PUBLIC_LISTING_COUNT_CAP } from './listing-search.read-model';

export const REVIEWS_AGGREGATE_CAP = 1000;

export interface OrganisationPage {
  profile: {
    displayName: string; legalName: string; verified: boolean; sinceYear: number; district: string | null; memberFarmers: number; currencyCode: string;
  };
  /** capped: `listingCount > listingCountCap` means "more than the cap" */
  listingCount: number; listingCountCap: number;
  /** null = the `reviews` flag is OFF for this organisation (no rating is shown at all) */
  reviews: { avg: number; count: number; capped: boolean; cap: number } | null;
}

type Row = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any -- a pg row; every field is narrowed below

@Injectable()
export class OrganisationPageReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider, private readonly flags: FlagsService) {}

  async forTenant(tenantId: string): Promise<OrganisationPage | null> {
    if (!UUID_RE.test(tenantId)) return null;
    const db = this.replica.forTenant(tenantId);
    // one query at a time (a replica executor may be a single connection)
    const p = await db.query<Row>(`SELECT * FROM public_tenant_profile($1::uuid)`, [tenantId]);
    const x = p.rows[0];
    if (!x) return null;
    const c = await db.query<Row>(`SELECT public_tenant_listing_count($1::uuid, $2::int) AS n`, [tenantId, PUBLIC_LISTING_COUNT_CAP]);
    let reviewsOn = false;
    try { reviewsOn = await this.flags.isEnabled('reviews', { tenantId }); } catch { reviewsOn = false; }   // unknown = OFF (no figure shown)
    let reviews: OrganisationPage['reviews'] = null;
    if (reviewsOn) {
      const r = await db.query<Row>(
        `WITH latest AS (
           SELECT stars, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn
             FROM reviews
            WHERE tenant_id = $1 AND target_type = 'seller' AND status = 'published' AND is_verified_purchase AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC
            LIMIT $2::int + 1)
         SELECT count(*)::int AS n, COALESCE(avg(stars) FILTER (WHERE rn <= $2::int), 0)::numeric(3,2)::text AS avg FROM latest`,
        [tenantId, REVIEWS_AGGREGATE_CAP]);
      const n = Number(r.rows[0]?.n ?? 0);
      reviews = { avg: Number(r.rows[0]?.avg ?? 0), count: n, capped: n > REVIEWS_AGGREGATE_CAP, cap: REVIEWS_AGGREGATE_CAP };
    }
    return {
      profile: {
        displayName: String(x.display_name), legalName: String(x.legal_name), verified: x.verified === true, sinceYear: Number(x.since_year),
        district: x.district_name ?? null, memberFarmers: Number(x.member_count ?? 0), currencyCode: String(x.currency_code).trim(),
      },
      listingCount: Number(c.rows[0]?.n ?? 0), listingCountCap: PUBLIC_LISTING_COUNT_CAP,
      reviews,
    };
  }
}
