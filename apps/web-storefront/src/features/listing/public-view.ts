// apps/web-storefront/src/features/listing/public-view.ts · PC-56 HOTFIX-4 · A6/C5 (survey F-7, founder D3). PURE.
//
// The listing page's view model, built from the API's ALLOW-LISTED public projection by naming each field it uses — never by spreading
// what arrived. So even if a payload ever carried the farm's coordinates, a pincode, a region id or a seller's user id again, none of it
// could reach the page: this function does not read them, and `PublicListingDetail` (the SDK type) does not have them.
// The seller is the ORGANISATION (D3): its display name and slug; the place is a district NAME.
import type { PublicListingDetail } from '@krishalaya/sdk-js';

export interface PublicListingView {
  id: string; title: string; description: string | null;
  priceMinor: string; currencyCode: string; unitCode: string;
  quantityAvailable: number; minOrderQty: number; harvestDate: string | null;
  organic: boolean; grade: string | null; saleType: string;
  district: string | null;
  organisation: { slug: string; name: string } | null;
  qrToken: string | null; auctionId: string | null; auctionStatus: string | null;
}

export function publicListingView(l: PublicListingDetail): PublicListingView {
  return {
    id: l.id, title: l.title, description: l.description ?? null,
    priceMinor: l.priceMinor, currencyCode: l.currencyCode, unitCode: l.unitCode,
    quantityAvailable: Number(l.quantityAvailable), minOrderQty: Number(l.minOrderQty ?? 0), harvestDate: l.harvestDate ?? null,
    organic: l.organic === true, grade: l.grade ?? null, saleType: l.saleType,
    district: l.district ?? null,
    organisation: l.organisation ? { slug: l.organisation.slug, name: l.organisation.name } : null,
    qrToken: l.qrToken ?? null, auctionId: l.auctionId ?? null, auctionStatus: l.auctionStatus ?? null,
  };
}
