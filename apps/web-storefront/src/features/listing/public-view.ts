// apps/web-storefront/src/features/listing/public-view.ts · PC-56 HOTFIX-4 · A6/C5 (survey F-7, founder D3). PURE.
//
// The listing page's view model, built from the API's ALLOW-LISTED public projection by naming each field it uses — never by spreading
// what arrived. So even if a payload ever carried the farm's coordinates, a pincode, a region id or a seller's user id again, none of it
// could reach the page: this function does not read them, and `PublicListingDetail` (the SDK type) does not have them.
// The seller is the ORGANISATION (D3): its display name and slug; the place is a district NAME.
// PC-56 STORE-2a · C3: + quantityTotal ("Available 34 of 40"), the organic claim's KIND, the CONFIRMED grade and whose staff graded it
// (founder D2 — the view has no AI field at all), the category (the breadcrumb) and the lot's measured attributes; each named, none spread.
import type { PublicListingDetail, PublicLotAttribute } from '@krishalaya/sdk-js';

export interface PublicListingView {
  id: string; title: string; description: string | null; categoryId: string | null;
  priceMinor: string; currencyCode: string; unitCode: string;
  quantityAvailable: number; quantityTotal: number; minOrderQty: number; harvestDate: string | null;
  /** PC-56 STORE-5b · C6: the API's PUBLIC claim — `certified` only while a certificate covers it, `self_declared` otherwise */
  organic: boolean; organicClaim: 'certified' | 'self_declared' | 'natural' | null; grade: string | null; saleType: string;
  gradeConfirmed: { name: string; gradedBy: string | null } | null;
  attributes: PublicLotAttribute[];
  district: string | null;
  organisation: { slug: string; name: string } | null;
  qrToken: string | null; auctionId: string | null; auctionStatus: string | null;
}

export function publicListingView(l: PublicListingDetail): PublicListingView {
  const claim = l.organicClaim === 'certified' || l.organicClaim === 'self_declared' || l.organicClaim === 'natural' ? l.organicClaim : null;
  return {
    id: l.id, title: l.title, description: l.description ?? null, categoryId: l.categoryId ?? null,
    priceMinor: l.priceMinor, currencyCode: l.currencyCode, unitCode: l.unitCode,
    quantityAvailable: Number(l.quantityAvailable), quantityTotal: Number(l.quantityTotal ?? l.quantityAvailable), minOrderQty: Number(l.minOrderQty ?? 0),
    harvestDate: l.harvestDate ?? null,
    organic: l.organic === true, organicClaim: claim, grade: l.gradeConfirmed ? l.gradeConfirmed.name : null, saleType: l.saleType,
    gradeConfirmed: l.gradeConfirmed ? { name: l.gradeConfirmed.name, gradedBy: l.gradeConfirmed.gradedBy ?? null } : null,
    attributes: Array.isArray(l.attributes)
      ? l.attributes.map((a) => ({ code: a.code, name: a.name, kind: a.kind, value: a.value, unit: a.unit ?? null }))
      : [],
    district: l.district ?? null,
    organisation: l.organisation ? { slug: l.organisation.slug, name: l.organisation.name } : null,
    qrToken: l.qrToken ?? null, auctionId: l.auctionId ?? null, auctionStatus: l.auctionStatus ?? null,
  };
}
