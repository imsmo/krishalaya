// modules/listings/read-models/listing-gallery.read-model.ts
// The photo gallery for a listing: media attached via media_links (entity_type='listing'), joined
// to media_assets, CLEAN scan only, ordered. Each clean asset's s3_key is turned into a short-lived
// presigned GET url. Replica-backed (Law 12). AUTHORIZATION: a non-owner only ever sees a PUBLISHED +
// publicly-visible listing's gallery — a draft/private/cross-tenant-hidden listing yields an empty
// gallery to strangers (never leaks an unpublished seller's photos). Infected/pending assets are never
// presigned.
//
// KV-MF-14 FIX (founder video review): the OWNER'S OWN listing-detail screen (screen 112) reuses this
// SAME endpoint (GET /listings/:id/media) for its "Listing health → N photos" count/gallery. Before this
// fix the gate above applied unconditionally, so a farmer's own DRAFT (not yet published) or
// tenant-only-visibility listing always showed photoCount=0 on their OWN screen even with clean photos
// attached — mirroring getPublicById's existing owner/moderator bypass (listing.service.ts) so the
// owner (or an admin, mirroring every other owner-only read here) always sees their own clean media
// regardless of publish/visibility state. Strangers still only ever see a published+public gallery.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerSuspendedExpr, isPubliclyVisible } from '../../../shared/sql/member-suspension.sql';
import { OBJECT_STORE, ObjectStore } from '../../../core/media/s3-presign.service';

export interface GalleryItem { mediaId: string; url: string; sortOrder: number; }
export interface GalleryViewer { userId: string; canModerate: boolean; }
const URL_TTL_SEC = 600;   // short-lived signed GET (10 min) — re-fetch the gallery to refresh

@Injectable()
export class ListingGalleryReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {}

  /** Signed gallery. `viewer` (from the request context — empty userId for an anonymous caller since
   *  GET :id/media stays @Public) lets the OWNER (or a moderator) see their own clean media regardless
   *  of publish/visibility state; everyone else only sees a published+public listing's gallery. Returns
   *  [] if neither condition holds, or the listing has no clean media. */
  async forListing(tenantId: string, listingId: string, viewer?: GalleryViewer): Promise<{ items: GalleryItem[]; expiresInSec: number }> {
    const db = this.replica.forTenant(tenantId);
    // The suspension is SELECTED rather than recomputed here: the rule lives in one place (shared/sql), and expressing
    // it once in SQL and once in TypeScript would be the same drift in a different costume. PC-56 TENANT-1b-2.
    const l = await db.query<{ status: string; visibility: string; seller_user_id: string; seller_suspended: boolean }>(
      `SELECT status, visibility, seller_user_id,
              ${sellerSuspendedExpr('$2', 'seller_user_id')} AS seller_suspended
         FROM listings WHERE id=$1`, [listingId, tenantId]);
    const listing = l.rows[0];
    if (!listing) return { items: [], expiresInSec: URL_TTL_SEC };
    const publiclyVisible = isPubliclyVisible({ ...listing, sellerSuspended: listing.seller_suspended === true });
    const isOwnerOrAdmin = !!viewer && (viewer.canModerate || (!!viewer.userId && listing.seller_user_id === viewer.userId));
    if (!publiclyVisible && !isOwnerOrAdmin) return { items: [], expiresInSec: URL_TTL_SEC };

    const r = await db.query<{ media_id: string; s3_key: string; sort_order: number }>(
      `SELECT ml.media_id, ma.s3_key, ml.sort_order
         FROM media_links ml JOIN media_assets ma ON ma.id = ml.media_id
        WHERE ml.entity_type='listing' AND ml.entity_id=$1 AND ma.scan_status='clean'
        ORDER BY ml.sort_order, ml.created_at`, [listingId]);
    const items = r.rows.map((x) => ({ mediaId: x.media_id, url: this.store.presignDownload(x.s3_key, URL_TTL_SEC), sortOrder: x.sort_order }));
    return { items, expiresInSec: URL_TTL_SEC };
  }
}
