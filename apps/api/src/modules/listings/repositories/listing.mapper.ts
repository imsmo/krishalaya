// modules/listings/repositories/listing.mapper.ts
// Row<->domain mapping in ONE place. Keeps SQL column names out of the domain
// and converts numeric/bigint/date types safely.
import { Listing, ListingProps } from '../domain/listing.entity';
import { ListingStatus } from '../domain/listing.state';

export interface ListingRow {
  id: string; tenant_id: string; seller_user_id: string; product_id: string; category_id: string;
  title: string; description: string | null; quantity_total: string; quantity_available: string;
  min_order_qty: string; unit_code: string; price_minor: string; currency_code: string;
  organic_claim: string; status: string; sale_type: string; pincode: string | null;
  region_id: string | null; lat: string | null; lng: string | null; visibility: string;
  ai_extracted: boolean; publish_at: Date | null; published_at: Date | null;
  expires_at: Date | null; version: number;
  // PC-56 TENANT-2a (0138) — present on READ_COLS selects; absent (undefined) on legacy narrow rows.
  qc_submitted_at?: Date | null; qc_reviewed_by?: string | null; qc_reviewed_at?: Date | null;
  reject_reason?: string | null; created_by?: string | null; harvest_date?: string | null;
}

export const ListingMapper = {
  toDomain(r: ListingRow): Listing {
    const props: ListingProps = {
      id: r.id, tenantId: r.tenant_id, sellerUserId: r.seller_user_id, productId: r.product_id,
      categoryId: r.category_id, title: r.title, description: r.description,
      quantityTotal: Number(r.quantity_total), quantityAvailable: Number(r.quantity_available),
      minOrderQty: Number(r.min_order_qty), unitCode: r.unit_code,
      priceMinor: BigInt(r.price_minor), currencyCode: r.currency_code,
      organicClaim: r.organic_claim as ListingProps['organicClaim'],
      status: r.status as ListingStatus, saleType: r.sale_type as ListingProps['saleType'],
      pincode: r.pincode, regionId: r.region_id, lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null, visibility: r.visibility as ListingProps['visibility'],
      aiExtracted: r.ai_extracted, publishAt: r.publish_at, publishedAt: r.published_at,
      expiresAt: r.expires_at, version: r.version,
      qcSubmittedAt: r.qc_submitted_at ?? null, qcReviewedBy: r.qc_reviewed_by ?? null,
      qcReviewedAt: r.qc_reviewed_at ?? null, rejectReason: r.reject_reason ?? null,
      createdBy: r.created_by ?? null, harvestDate: r.harvest_date ?? null,
    };
    return Listing.rehydrate(props);
  },
};
