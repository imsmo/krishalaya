// apps/web-storefront/src/app/(platform)/discover/page.tsx · PC-56 STORE-1b · C2 (founder D1) — the platform's cross-tenant discovery feed:
// `cross_tenant` listings of live organisations, newest first, read-only. Every card names its ORGANISATION and links into that
// organisation's own store, where buying happens (no cross-tenant cart). Filters ride the URL (GET): `category` (from the header strip / the
// home's tiles) and `q` (the header search box — a title-PREFIX filter, the cheap one the 0204 feed supports). "Show more" is a keyset
// link (µs cursor) with the direction-safe arrow. EMPTY and ERROR are different sentences; Retry reloads the same URL.
import type { Metadata } from 'next';
import type { DiscoveryCard as DiscoveryCardData } from '@krishalaya/sdk-js';
import { publicClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DiscoveryCard } from '../../../components/DiscoveryCard';
import { DirArrow } from '../../../components/DirArrow';
import { loadResult, listState, reloadHref } from '../../../features/home/load-result';
import { buildQueryString } from '../../../features/discovery/query';

export const dynamic = 'force-dynamic';
const PAGE = 24;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => { const s = (Array.isArray(v) ? v[0] : v)?.trim(); return s ? s : undefined; };

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('discover.title'), description: t.t('discover.lead') };
}

export default async function DiscoverPage({ searchParams }: { searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const q = one(searchParams.q); const category = one(searchParams.category); const after = one(searchParams.after);
  const feed = await loadResult(() => publicClient().storefront.discover({ q, category, after, limit: PAGE }));
  const state = listState(feed);
  const cards: DiscoveryCardData[] = feed.ok ? feed.data.items : [];
  const next = feed.ok ? feed.data.nextCursor : null;
  const narrowed = Boolean(q || category);
  return (
    <section aria-labelledby="kv-discover-title">
      <h1 id="kv-discover-title">{t.t('discover.title')}</h1>
      <p className="kv-prose__lead">{t.t('discover.lead')}</p>
      <form method="get" action="/discover" role="search" className="kv-filters" aria-label={t.t('header.search.label')}>
        {category && <input type="hidden" name="category" value={category} />}
        <div className="kv-filters__row">
          <div className="kv-filters__field kv-filters__field--grow">
            <label htmlFor="kv-discover-q" className="kv-filters__label">{t.t('discover.searchLabel')}</label>
            <input id="kv-discover-q" name="q" type="search" defaultValue={q ?? ''} placeholder={t.t('header.search.placeholder')} className="kv-field__input" />
          </div>
          <div className="kv-filters__actions"><button type="submit" className="kv-btn">{t.t('header.search.submit')}</button></div>
        </div>
      </form>
      {narrowed && <p><a href="/discover" className="kv-btn--link">{t.t('discover.clearSearch')}</a></p>}
      {state === 'error' && (
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('discover.error')}</p>
          <a href={reloadHref('/discover', searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
      )}
      {state === 'empty' && (
        <div className="kv-empty" data-kv-state="empty">
          <p>{t.t('discover.empty')}</p>
          <a href="/organisations" className="kv-btn">{t.t('home.orgs.cta')}</a>
        </div>
      )}
      {state === 'ok' && (
        <>
          <div className="kv-grid">
            {cards.map((c) => <DiscoveryCard key={c.listingId} card={c} lang={lang} labels={{ organic: t.t('card.organic'), soldBy: t.t('card.soldBy', { org: c.organisation }) }} />)}
          </div>
          {next && (
            <p className="kv-loadmore">
              <a href={`/discover${buildQueryString({ q, category, after: next })}`} className="kv-btn" rel="next">{t.t('discover.showMore')} <DirArrow /></a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
