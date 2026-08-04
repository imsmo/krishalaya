// apps/web-storefront/src/components/ListingCard.tsx · a marketplace listing card. Money is rendered via the
// shared i18n formatter from its bigint-minor-unit STRING (never a JS number — Law 2 holds on the client too).
// Copy (organic badge, "available" suffix) arrives as already-localized labels from the server page, so the card
// stays a pure presentational component with no hardcoded strings.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { ListingCard as ListingCardData } from '@krishalaya/sdk-js';

export type ListingCardLabels = { organic: string; available: string };

export function ListingCard(
  { listing, tenantSlug, lang = 'en', labels }:
  { listing: ListingCardData; tenantSlug: string; lang?: string; labels: ListingCardLabels },
) {
  return (
    <Link href={`/${tenantSlug}/listings/${listing.id}`} className="kv-card" aria-label={listing.title}>
      <h3 className="kv-card__title">{listing.title}</h3>
      <div className="kv-card__price">{formatMoneyMinor(listing.priceMinor, listing.currencyCode, lang)} <span className="kv-card__unit">/ {listing.unitCode}</span></div>
      <div className="kv-card__meta">
        {listing.organicClaim && <span className="kv-badge kv-badge--organic">{labels.organic}</span>}
        <span className="kv-card__qty">{listing.quantityAvailable} {listing.unitCode} {labels.available}</span>
      </div>
    </Link>
  );
}
