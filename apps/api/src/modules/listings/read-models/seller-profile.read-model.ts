// modules/listings/read-models/seller-profile.read-model.ts
// Public seller storefront: SAFE public fields + reputation, NEVER PII. Replica-backed (Law 12), RLS
// re-asserts tenant isolation. Returns ONLY: display name (full_name), home region, member-since, the
// PUBLISHED-review rating rollup, and the count of the seller's currently-published listings. NO phone,
// NO email, NO KYC. A non-existent / non-active seller → null (404 in the controller, no enumeration).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerNotSuspendedSql } from '../../../shared/sql/member-suspension.sql';

export interface SellerPublicProfile {
  sellerId: string; displayName: string | null; regionId: string | null; memberSince: string | null;
  rating: { count: number; avgStars: number }; listingsActive: number;
}

@Injectable()
export class SellerProfileReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async forSeller(tenantId: string, sellerId: string): Promise<SellerPublicProfile | null> {
    const db = this.replica.forTenant(tenantId);
    const u = await db.query<{ full_name: string | null; region_id: string | null; created_at: Date; status: string }>(
      `SELECT full_name, region_id, created_at, status FROM users WHERE id=$1`, [sellerId]);
    const user = u.rows[0];
    if (!user || user.status !== 'active') return null;     // unknown / suspended → 404 (no PII, no enumeration)

    const [rating, listings] = await Promise.all([
      // PUBLISHED reviews only; the NULL-stars roll-up row carries count + avg (matches reviews.summaryForTarget).
      db.query<{ n: number; avg: string }>(
        `SELECT count(*)::int AS n, COALESCE(avg(stars),0)::numeric(3,2) AS avg
           FROM reviews WHERE target_type='seller' AND target_id=$1 AND status='published' AND deleted_at IS NULL`, [sellerId]),
      db.query<{ n: string }>(
        // PC-56 TENANT-1b-2: the public "listings active" count must agree with the feed. Leaving it unfiltered would
        // advertise 14 live listings on a suspended seller's profile and show a buyer none of them.
        `SELECT count(*)::text AS n FROM listings
          WHERE seller_user_id=$1 AND status='published' AND deleted_at IS NULL
            AND ${sellerNotSuspendedSql('listings')}`, [sellerId]),
    ]);
    return {
      sellerId, displayName: user.full_name, regionId: user.region_id,
      memberSince: user.created_at ? user.created_at.toISOString() : null,
      rating: { count: rating.rows[0]?.n ?? 0, avgStars: Number(rating.rows[0]?.avg ?? 0) },
      listingsActive: Number(listings.rows[0]?.n ?? 0),
    };
  }
}
