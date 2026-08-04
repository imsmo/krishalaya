// apps/web-tenant/src/app/offers/page.tsx · the seller's incoming offers. The API scopes incoming offers PER
// LISTING (offers.list({box:'incoming'}) requires a listingId — it 400s otherwise), so this page has two modes:
//   - no ?listingId → a picker of the seller's own listings (listings.browse); each links to its offer inbox.
//   - ?listingId=…  → that listing's incoming offers (offers.list incoming), each row linking to /offers/[id].
// This faithfully reflects the API contract (no faked cross-listing inbox). Server-first, requireSession-gated,
// money via formatMoneyMinor, degrades on read failure, noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { effectivePriceMinor } from '../../features/offers/negotiation';
import type { ListingCard, ListingOffer } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('offers.title'), robots: { index: false, follow: false } };
}

export default async function OffersPage({ searchParams }: { searchParams: { listingId?: string; cursor?: string } }) {
  await requireSession('/offers');
  const t = getTranslator();
  const lang = getLang();
  const listingId = (searchParams.listingId ?? '').trim();

  // Mode A: no listing chosen → pick one of the seller's listings.
  if (!listingId) {
    let listings: ListingCard[] = []; let failed = false;
    try { listings = (await tenantClient().listings.browse({ limit: 50 })).items; }
    catch { failed = true; }
    return (
      <section>
        <h1>{t.t('offers.title')}</h1>
        <p className="kv-muted">{t.t('offers.pickHint')}</p>
        {failed ? <p className="kv-error" role="alert">{t.t('offers.loadError')}</p> : (
          <DataTable
            rows={listings}
            empty={t.t('offers.noListings')}
            columns={[
              { header: t.t('listings.colTitle'), cell: (l) => <Link href={`/offers?listingId=${encodeURIComponent(l.id)}`} className="kv-link">{l.title}</Link> },
              { header: t.t('listings.colPrice'), cell: (l) => `${formatMoneyMinor(l.priceMinor, l.currencyCode, lang)} / ${l.unitCode}` },
            ]}
          />
        )}
      </section>
    );
  }

  // Mode B: a listing is chosen → its incoming offers.
  let offers: ListingOffer[] = []; let nextCursor: string | null = null; let failed = false;
  try { const p = await tenantClient().offers.list({ box: 'incoming', listingId, cursor: searchParams.cursor, limit: 50 }); offers = p.items; nextCursor = p.nextCursor; }
  catch { failed = true; }

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('offers.inboxTitle')}</h1>
        <Link href="/offers" className="kv-btn--link">← {t.t('offers.allListings')}</Link>
      </div>
      {failed ? <p className="kv-error" role="alert">{t.t('offers.loadError')}</p> : (
        <DataTable
          rows={offers}
          empty={t.t('offers.empty')}
          columns={[
            { header: t.t('offers.colOffer'), cell: (o) => <Link href={`/offers/${o.offerId}`} className="kv-link">{o.offerId.slice(0, 8)}</Link> },
            { header: t.t('offers.colQty'), cell: (o) => o.quantity },
            { header: t.t('offers.colPrice'), cell: (o) => formatMoneyMinor(effectivePriceMinor(o), 'INR', lang) },
            { header: t.t('offers.colRound'), cell: (o) => String(o.round) },
            { header: t.t('offers.colStatus'), cell: (o) => <span className="kv-badge">{o.status}</span> },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/offers?listingId=${encodeURIComponent(listingId)}&cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
