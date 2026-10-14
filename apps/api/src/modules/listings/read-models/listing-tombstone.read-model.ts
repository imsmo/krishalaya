// modules/listings/read-models/listing-tombstone.read-model.ts · PC-56 STORE-2a · B2 / B16 (survey F-18) — A LOT THAT IS NO LONGER ON SALE.
//
// `getPublicById` 404s anything not published, so canon W277's sold_out / paused / expired states ("no dead end") could never be shown — a
// buyer following a shared link met "not found" for a lot that sold out an hour ago. `GET /v1/listings/:id/tombstone` (a SEPARATE route, so
// the detail's contract is unchanged for every existing caller) answers what a buyer may know about such a lot: its id, WHY it is not on sale
// (sold_out · paused · expired · withdrawn — the platform's status, not a guess), its title, the organisation and the category. NO price,
// NO quantity, NO date: "no price while it is not on sale". Everything else 404s:
//   • a PUBLISHED lot (it is on sale — read the detail);
//   • draft / pending_approval / rejected / hidden / held / reserved_auction (unpublished or platform-held inventory is never enumerable);
//   • a members-only (`visibility = tenant`) lot, another organisation's lot (RLS + the bound tenant), a soft-deleted one;
//   • a lot whose seller is under a live suspension (the same predicate as every public path — TENANT-1b-2).
// One bounded single-row read on the replica (Law 12).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerNotSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { UUID_RE } from '../../../shared/pagination/us-keyset';
import { ListingTombstone, TOMBSTONE_STATUS, toListingTombstone } from '../domain/listing-public.view';

@Injectable()
export class ListingTombstoneReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async forListing(tenantId: string, listingId: string): Promise<ListingTombstone | null> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(listingId)) return null;
    const r = await this.replica.forTenant(tenantId).query<{ id: string; status: string; title: string; slug: string | null; display_name: string | null; category_id: string | null; category_name: string | null }>(
      `SELECT l.id, l.status::text AS status, l.title, t.slug, t.display_name, c.id AS category_id, c.default_name AS category_name
         FROM listings l
         LEFT JOIN tenants t ON t.id = l.tenant_id
         LEFT JOIN categories c ON c.id = l.category_id
        WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL
          AND l.visibility IN ('public','cross_tenant')
          AND l.status::text = ANY($3::text[])
          AND ${sellerNotSuspendedSql('l')}`,
      [listingId, tenantId, Object.keys(TOMBSTONE_STATUS)]);
    const x = r.rows[0];
    if (!x) return null;
    return toListingTombstone({ id: x.id, status: x.status, title: x.title, orgSlug: x.slug, orgName: x.display_name, categoryId: x.category_id, categoryName: x.category_name });
  }
}
