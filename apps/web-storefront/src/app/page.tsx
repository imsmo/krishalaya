// apps/web-storefront/src/app/page.tsx · public home. SSR-fetches a sample of published listings via the SDK
// (anonymous) and renders them. Degrades gracefully: if the API is unavailable the page still renders with an
// empty state (Law 12 — a flaky dependency never 500s the public storefront). Revalidated periodically (ISR).
// All copy via i18n.
import type { Metadata } from 'next';
import type { ListingCard as ListingCardData } from '@krishalaya/sdk-js';
import { publicClient } from '../lib/api-client';
import { getTranslator, getLang } from '../lib/i18n';
import { ListingCard } from '../components/ListingCard';

export const revalidate = 60;   // ISR: re-fetch at most once a minute

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('home.title'), description: t.t('home.lead') };
}

export default async function HomePage() {
  const t = getTranslator();
  const lang = getLang();
  let items: ListingCardData[] = [];
  try {
    const page = await publicClient().listings.browse({ limit: 12, sort: 'newest' });
    items = page.items;
  } catch { items = []; }   // search/API down → empty state, never a crash

  const cardLabels = { organic: t.t('card.organic'), available: t.t('card.available') };

  return (
    <section>
      <h1>{t.t('home.title')}</h1>
      <p className="kv-prose__lead">{t.t('home.lead')}</p>
      {items.length === 0
        ? <p className="kv-empty">{t.t('home.empty')}</p>
        : <div className="kv-grid">{items.map((l) => <ListingCard key={l.id} listing={l} tenantSlug="market" lang={lang} labels={cardLabels} />)}</div>}
    </section>
  );
}
