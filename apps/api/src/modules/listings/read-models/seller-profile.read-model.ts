// modules/listings/read-models/seller-profile.read-model.ts
// Public seller storefront: SAFE public fields + reputation, NEVER PII. Replica-backed (Law 12), RLS re-asserts tenant isolation.
//
// PC-56 HOTFIX-4 · A7 (survey F-8 / B20, founder D3 "organisation only, everywhere") — THE READ WAS ANY USER'S NAME BY UUID. It ran
// `SELECT full_name, region_id, created_at, status FROM users WHERE id=$1` with no check that the uuid belonged to a SELLER, or to THIS
// organisation: a buyer's, a staff member's or another tenant's member's full name answered any anonymous caller holding a uuid (and uuids
// are in listing and order payloads). Now:
//   • 404 unless the uuid is a MEMBER SELLER of the resolving tenant — an active `user_tenant_roles` row of THIS tenant whose role holds the
//     listing-create permission (role_permissions — data, not a code list of role names), the user active, not under a live suspension;
//   • the answer names the ORGANISATION (display name + coarse district), the seller's live-listing count and the published-review rollup —
//     NO full_name, no user status, no join date, no region uuid. (Completed-sales count: not added — it is the ORDERS module's fact and no
//     public bounded read of it exists; owed to STORE-2a with W280's organisation page, named in the HOTFIX-4 report.)
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerNotSuspendedSql, memberSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { ListingPermissions } from '../listings.policies';

export interface SellerPublicProfile {
  sellerId: string;
  /** The ORGANISATION the seller sells through (D3) — never the person. District = the organisation's home district name. */
  organisation: { slug: string; name: string; district: string | null };
  rating: { count: number; avgStars: number }; listingsActive: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SellerProfileReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async forSeller(tenantId: string, sellerId: string): Promise<SellerPublicProfile | null> {
    if (!tenantId || !UUID_RE.test(tenantId) || !UUID_RE.test(sellerId)) return null;   // no organisation in context / not an id → 404
    const db = this.replica.forTenant(tenantId);
    // A MEMBER SELLER of THIS organisation, or nothing (404 — a buyer, a staff member, another tenant's member, a suspended seller).
    const m = await db.query<{ slug: string; display_name: string; district: string | null }>(
      `SELECT t.slug, t.display_name, r.default_name AS district
         FROM user_tenant_roles utr
         JOIN role_permissions rp ON rp.role_id = utr.role_id AND rp.permission_code = $3
         JOIN users u ON u.id = utr.user_id AND u.status = 'active'
         JOIN tenants t ON t.id = utr.tenant_id
         LEFT JOIN admin_regions r ON r.id = t.region_id
        WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.is_active AND utr.deleted_at IS NULL
          AND NOT ${memberSuspendedSql('$1', '$2')}
        LIMIT 1`, [tenantId, sellerId, ListingPermissions.Create]);
    const org = m.rows[0];
    if (!org) return null;

    // one query at a time (a replica executor may be a single connection)
    // PUBLISHED reviews only; the NULL-stars roll-up row carries count + avg (matches reviews.summaryForTarget).
    const rating = await db.query<{ n: number; avg: string }>(
      `SELECT count(*)::int AS n, COALESCE(avg(stars),0)::numeric(3,2) AS avg
         FROM reviews WHERE tenant_id=$2 AND target_type='seller' AND target_id=$1 AND status='published' AND deleted_at IS NULL`, [sellerId, tenantId]);
    // PC-56 TENANT-1b-2: the public "listings active" count must agree with the feed (the shared suspension predicate).
    const listings = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM listings
        WHERE tenant_id=$2 AND seller_user_id=$1 AND status='published' AND deleted_at IS NULL
          AND ${sellerNotSuspendedSql('listings')}`, [sellerId, tenantId]);
    return {
      sellerId,
      organisation: { slug: org.slug, name: org.display_name, district: org.district ?? null },
      rating: { count: rating.rows[0]?.n ?? 0, avgStars: Number(rating.rows[0]?.avg ?? 0) },
      listingsActive: Number(listings.rows[0]?.n ?? 0),
    };
  }
}
