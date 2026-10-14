// apps/web-storefront/src/components/DiscoveryCard.tsx · PC-56 STORE-1b · D1 — one card of the platform's cross-tenant feed (W273 "Fresh this
// week", /discover). It names the ORGANISATION that sells the lot (founder D4: never a farmer's name or member number) and links INTO that
// organisation's own store (/<slug>/listings/<id>), where cart, checkout and sign-in stay per tenant — there is no cross-tenant cart.
// Money: the bigint-minor STRING through the one canonical formatter, in the listing's own currency (Law 2). The district is a master-data
// name as the API returned it; organic is a badge, never colour alone.
// PC-56 STORE-2a (founder D2 "confirmed grade only, source named"): the GRADE IS NO LONGER PRINTED here. 0204's feed returns
// `grade_option_id`'s name whether or not a person confirmed it, and 0204 is applied (never edited) — so this card cannot tell a confirmed
// grade from an unconfirmed one, and prints neither. The confirmed grade is on the lot's own page (and on the tenant store's cards).
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { DiscoveryCard as DiscoveryCardData } from '@krishalaya/sdk-js';

export function DiscoveryCard({ card, lang, labels }: { card: DiscoveryCardData; lang: string; labels: { organic: string; soldBy: string } }) {
  return (
    <Link href={`/${card.tenantSlug}/listings/${card.listingId}`} className="kv-card" aria-label={card.title} data-kv-card="discovery">
      <h3 className="kv-card__title">{card.title}</h3>
      <div className="kv-card__price">{formatMoneyMinor(card.priceMinor, card.currencyCode, lang)} <span className="kv-card__unit">/ {card.unitCode}</span></div>
      <div className="kv-card__meta">
        {card.organic && <span className="kv-badge kv-badge--organic">{labels.organic}</span>}
      </div>
      <p className="kv-card__org">{labels.soldBy}{card.district ? ` · ${card.district}` : ''}</p>
    </Link>
  );
}
