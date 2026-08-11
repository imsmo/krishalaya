// modules/listings/read-models/listing-links.read-model.ts
// The PUBLIC cross-aggregate "links" for a listing detail page: its farm-to-fork trace QR token and its auction.
// Both are NON-PII public identifiers (qr_token is the consumer-facing scan token by design; an auction id is a
// public resource). Replica-backed (Law 12, CQRS). AUTHORIZATION: links are only returned for a PUBLISHED +
// publicly-visible listing — a draft/private/cross-tenant-hidden listing yields all-null (never leaks that an
// unpublished seller has a trace lot or a scheduled auction). Tenant-scoped (tenant_id in every query + RLS).
// Kept OUT of the cached listing entity (listing.service.getById is cached 300s) so auction status — which moves
// over the auction's life (scheduled→live→ended→settled) — is read fresh per request, not frozen in an entity cache.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerSuspendedExpr, isPubliclyVisible } from '../../../shared/sql/member-suspension.sql';

export interface ListingLinks {
  /** Farm-to-fork QR scan token for this listing's trace lot, or null if none. NON-PII (public by design). */
  qrToken: string | null;
  /** The auction id linked 1:1 to this listing (auctions.listing_id is UNIQUE), or null if not auctioned. */
  auctionId: string | null;
  /** Auction lifecycle status (scheduled|live|extended|ended|awaiting_approval|settled|cancelled|failed_reserve). */
  auctionStatus: string | null;
  /** Auction end time (ISO) — lets the client show a live countdown / "ended" without a second round-trip. */
  auctionEndsAt: string | null;
}

const EMPTY: ListingLinks = { qrToken: null, auctionId: null, auctionStatus: null, auctionEndsAt: null };

@Injectable()
export class ListingLinksReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Public trace/auction links for a listing. All-null if the listing isn't publicly visible or has neither. */
  async forListing(tenantId: string, listingId: string): Promise<ListingLinks> {
    const db = this.replica.forTenant(tenantId);

    // PC-56 TENANT-1b-2: a suspended seller's trace QR and auction link stop resolving publicly, for the same reason
    // their listing leaves the feed. The rule is SELECTED from the shared predicate, never re-expressed.
    const l = await db.query<{ status: string; visibility: string; seller_suspended: boolean }>(
      `SELECT status, visibility, ${sellerSuspendedExpr('$2', 'seller_user_id')} AS seller_suspended
         FROM listings WHERE id=$1`, [listingId, tenantId]);
    const listing = l.rows[0];
    const publiclyVisible = !!listing
      && isPubliclyVisible({ ...listing, sellerSuspended: listing.seller_suspended === true });
    if (!publiclyVisible) return { ...EMPTY };

    // qr_token: present once the seller declares provenance (trace_lots.listing_id). Soft-deleted lots excluded.
    const tr = await db.query<{ qr_token: string }>(
      `SELECT qr_token FROM trace_lots
        WHERE tenant_id=$1 AND listing_id=$2 AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`, [tenantId, listingId]);

    // auction: 1:1 with the listing (auctions.listing_id UNIQUE). Status drives the storefront CTA (live vs ended).
    const au = await db.query<{ id: string; status: string; ends_at: Date }>(
      `SELECT id, status, ends_at FROM auctions
        WHERE tenant_id=$1 AND listing_id=$2 AND deleted_at IS NULL
        LIMIT 1`, [tenantId, listingId]);

    const auction = au.rows[0];
    return {
      qrToken: tr.rows[0]?.qr_token ?? null,
      auctionId: auction?.id ?? null,
      auctionStatus: auction?.status ?? null,
      auctionEndsAt: auction ? new Date(auction.ends_at).toISOString() : null,
    };
  }
}
