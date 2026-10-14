// apps/web-storefront/src/components/ListingCard.tsx · a marketplace listing card. Money is rendered via the
// shared i18n formatter from its bigint-minor-unit STRING (never a JS number — Law 2 holds on the client too).
// Copy (organic badge, "available" suffix) arrives as already-localized labels from the server page, so the card
// stays a pure presentational component with no hardcoded strings.
//
// PC-56 STORE-2a · C1 (canon W275 cards) — from the PUBLIC feed row (`listings.search`): the CONFIRMED grade as a badge (founder D2 — the
// row carries no other), the organic claim's KIND (certified / natural), "Sold by <organisation> · <district>" (the page builds the line;
// never a farmer — HOTFIX-4 D3), and the regulated lock ("Licence required to buy") SHOWN, never used to hide the lot (B5). No distance,
// no vernacular line (no such column), no farmer name.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PublicListingCard } from '@krishalaya/sdk-js';

// PC-56 STORE-1b (founder D4): `soldBy` names the ORGANISATION on the card ("Sold by Anand FPO") — never a farmer or a member number.
export type ListingCardLabels = { organic: string; available: string; soldBy?: string; certified?: string; natural?: string; licence?: string };

/** The card's row: the public feed's (STORE-2a). Older fixtures without the new keys still render (each new key is optional at runtime). */
export type ListingCardRow = Pick<PublicListingCard, 'id' | 'title' | 'priceMinor' | 'currencyCode' | 'unitCode' | 'quantityAvailable' | 'organicClaim'>
  & Partial<Pick<PublicListingCard, 'organic' | 'grade' | 'licenceRequired'>>;

export function ListingCard(
  { listing, tenantSlug, lang = 'en', labels }:
  { listing: ListingCardRow; tenantSlug: string; lang?: string; labels: ListingCardLabels },
) {
  const kind = listing.organic === 'certified' ? labels.certified : listing.organic === 'natural' ? labels.natural : undefined;
  return (
    <Link href={`/${tenantSlug}/listings/${listing.id}`} className="kv-card" aria-label={listing.title}>
      <h3 className="kv-card__title">{listing.title}</h3>
      <div className="kv-card__price">{formatMoneyMinor(listing.priceMinor, listing.currencyCode, lang)} <span className="kv-card__unit">/ {listing.unitCode}</span></div>
      <div className="kv-card__meta">
        {listing.grade && <span className="kv-badge" data-kv-grade="confirmed">{listing.grade}</span>}
        {listing.organicClaim && <span className="kv-badge kv-badge--organic">{kind ?? labels.organic}</span>}
        {listing.licenceRequired === true && labels.licence && <span className="kv-badge kv-badge--lock" data-kv-lock="licence">{labels.licence}</span>}
        <span className="kv-card__qty">{listing.quantityAvailable} {listing.unitCode} {labels.available}</span>
      </div>
      {labels.soldBy && <p className="kv-card__org">{labels.soldBy}</p>}
    </Link>
  );
}
