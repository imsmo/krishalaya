// apps/web-storefront/src/app/offers/page.tsx · the buyer's offer inbox (offers I made). PROTECTED + dynamic.
// offers.list({box:'outgoing'}) is keyset-paged through the shared DataTable; the API + RLS scope to the caller.
// Money via formatMoneyMinor; dates via formatDate. Degrades to empty/error (Law 12). The listing read-model on an
// offer carries only listingId (no title/tenant), so rows link to the offer detail, not back to the listing.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { ListingOffer } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { DataTable, type Column } from '../../components/DataTable';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('offers.title'), robots: { index: false, follow: false } };
}

export default async function OffersPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession('/offers');
  const t = getTranslator();
  const lang = getLang();

  let items: ListingOffer[] = [];
  let nextCursor: string | null = null;
  let failed = false;
  try {
    const page = await serverClient().offers.list({ box: 'outgoing', cursor: searchParams.cursor, limit: 20 });
    items = page.items; nextCursor = page.nextCursor;
  } catch { failed = true; }

  if (failed) {
    return <section className="kv-offers"><h1>{t.t('offers.title')}</h1>
      <p className="kv-form__error" role="alert">{t.t('offers.loadError')}</p></section>;
  }

  const statusLabel = (s: string) => { const k = `offers.status.${s.toLowerCase()}`; const l = t.t(k); return l === k ? s : l; };
  const price = (o: ListingOffer) => formatMoneyMinor(o.counterPriceMinor ?? o.offeredPriceMinor, 'INR', lang);

  const columns: Column<ListingOffer>[] = [
    { key: 'offerId', header: t.t('offers.colRef'), render: (o) => <Link href={`/offers/${encodeURIComponent(o.offerId)}`} className="kv-link">#{o.round}</Link> },
    { key: 'price', header: t.t('offers.colPrice'), align: 'right', render: price },
    { key: 'quantity', header: t.t('offers.colQty'), render: (o) => o.quantity },
    { key: 'status', header: t.t('offers.colStatus'), render: (o) => statusLabel(o.status) },
    { key: 'createdAt', header: t.t('offers.colDate'), render: (o) => (o.createdAt ? formatDate(o.createdAt, lang) : '—') },
  ];

  return (
    <section className="kv-offers">
      <h1>{t.t('offers.title')}</h1>
      <DataTable
        columns={columns}
        rows={items}
        getRowKey={(o) => o.offerId}
        caption={t.t('offers.listCaption')}
        emptyText={t.t('offers.empty')}
        nextHref={nextCursor ? `/offers?cursor=${encodeURIComponent(nextCursor)}` : undefined}
        nextLabel={t.t('discover.nextPage')}
      />
    </section>
  );
}
