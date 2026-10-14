// apps/web-storefront/src/app/(platform)/search/page.tsx · PC-56 STORE-2a · C2 — canon W276 SEARCH on the PLATFORM (the header's search box
// lands here; it used to land on /discover). Two tabs, both public reads (no new search engine — brief B3):
//   • LISTINGS — the cross-tenant discovery feed (0204 `public_discovery_feed`): `cross_tenant` lots of live organisations whose TITLE STARTS
//     WITH the words (≥ 2 letters), newest first, keyset "Show more" (W276's "1–24 of 126" is the recorded keyset DELTA). Every card names its
//     ORGANISATION and links into that organisation's store; no grade is printed (0204 cannot tell a confirmed grade — founder D2);
//   • ORGANISATIONS — verified live organisations whose NAME STARTS WITH the words (0207 `public_organisation_search`, at most 24).
//   The HONEST sentence says exactly that ("we match the start of a title, in the language it was listed in"); "three languages at once",
//   spelling tolerance, "closest matches" and voice search are refused by name (RefusalList 'search'). No count is printed here: the
//   platform feed has no count read (named in the wave report) — never an invented one.
// STATES: a query shorter than two letters asks for more (nothing is searched); EMPTY → "Browse categories"; ERROR → "search is having
// trouble; browsing still works" + the category links + Retry (a reload); the catalogue's kill-switch OFF (founder D4) → temporarily
// unavailable. Dynamic: a Retry must read again.
import type { Metadata } from 'next';
import type { CategoryNode, DiscoveryCard as DiscoveryCardData, OrganisationCard, StorefrontFlags } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { publicClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DiscoveryCard } from '../../../components/DiscoveryCard';
import { DirArrow } from '../../../components/DirArrow';
import { RefusalList, BrowseOff } from '../../../components/RefusalList';
import { reloadHref } from '../../../features/home/load-result';
import { buildQueryString } from '../../../features/discovery/query';
import { flattenCategoryNav } from '../../../features/discovery/categories';
import { browseOff, readState } from '../../../features/store2a/browse';

export const dynamic = 'force-dynamic';
const PAGE = 24;
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => { const s = (Array.isArray(v) ? v[0] : v)?.trim(); return s ? s.slice(0, 80) : undefined; };

export function generateMetadata({ searchParams }: { searchParams: SP }): Metadata {
  const t = getTranslator();
  const q = one(searchParams.q);
  return { title: q ? t.t('search.resultsFor', { q }) : t.t('search.title'), robots: { index: false } };
}

export default async function PlatformSearch({ searchParams }: { searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const q = one(searchParams.q);
  const tab = one(searchParams.tab) === 'organisations' ? 'organisations' : 'listings';
  const after = one(searchParams.after);
  const searchable = Boolean(q && q.length >= 2);
  const api = publicClient();

  const flags = await readState<StorefrontFlags>(() => api.storefront.flags());
  const off = browseOff(flags);
  const [feed, orgs, cats] = await Promise.all([
    !off && searchable && tab === 'listings' ? readState(() => api.storefront.discover({ q, after, limit: PAGE })) : Promise.resolve(null),
    !off && searchable && tab === 'organisations' ? readState(() => api.storefront.organisations({ q })) : Promise.resolve(null),
    readState<CategoryNode[]>(() => api.lookups.categories() as Promise<CategoryNode[]>),
  ]);
  const topCats = cats.ok ? flattenCategoryNav(cats.data).filter((c) => c.depth === 0) : [];
  const read = tab === 'listings' ? feed : orgs;
  const state = !searchable ? 'prompt' : !read ? 'prompt' : !read.ok ? 'error' : read.data.items.length === 0 ? 'empty' : 'ok';
  const cards: DiscoveryCardData[] = feed && feed.ok ? feed.data.items : [];
  const next = feed && feed.ok ? feed.data.nextCursor : null;
  const orgCards: OrganisationCard[] = orgs && orgs.ok ? orgs.data.items : [];
  const tabHref = (to: 'listings' | 'organisations') => `/search${buildQueryString({ q, tab: to === 'organisations' ? 'organisations' : undefined })}`;
  const categoryLinks = topCats.length > 0 && (
    <ul className="kv-chips" data-kv-browse-links="categories">
      {topCats.map((c) => <li key={c.id}><a href={`/discover?category=${encodeURIComponent(c.id)}`} className="kv-chip">{c.label}</a></li>)}
    </ul>
  );

  return (
    <section aria-labelledby="kv-search-title">
      <h1 id="kv-search-title">{q ? t.t('search.resultsFor', { q }) : t.t('search.title')}</h1>
      <p className="kv-prose__lead" data-kv-honest="platform">{t.t('search.honest.platform')}</p>
      <form method="get" action="/search" role="search" className="kv-filters" aria-label={t.t('header.search.label')}>
        {tab === 'organisations' && <input type="hidden" name="tab" value="organisations" />}
        <div className="kv-filters__row">
          <div className="kv-filters__field kv-filters__field--grow">
            <label htmlFor="kv-search-q" className="kv-filters__label">{t.t('discover.searchLabel')}</label>
            <input id="kv-search-q" name="q" type="search" defaultValue={q ?? ''} placeholder={t.t('header.search.placeholder')} className="kv-field__input" />
          </div>
          <div className="kv-filters__actions"><button type="submit" className="kv-btn">{t.t('header.search.submit')}</button></div>
        </div>
      </form>

      {off ? <BrowseOff /> : (
        <>
          <nav aria-label={t.t('search.tabs')} className="kv-tabs">
            <a href={tabHref('listings')} className="kv-tab" data-kv-tab="listings" {...(tab === 'listings' ? { 'aria-current': 'page' as const } : {})}>{t.t('search.tab.listings')}</a>
            <a href={tabHref('organisations')} className="kv-tab" data-kv-tab="organisations" {...(tab === 'organisations' ? { 'aria-current': 'page' as const } : {})}>{t.t('search.tab.organisations')}</a>
          </nav>

          {state === 'prompt' && <p className="kv-state" data-kv-state="prompt">{t.t('search.prompt')}</p>}
          {state === 'error' && (
            <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
              <p>{t.t('search.error')}</p>
              {categoryLinks}
              <a href={reloadHref('/search', searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
            </div>
          )}
          {state === 'empty' && (
            <div className="kv-empty" data-kv-state="empty">
              <p>{t.t(tab === 'listings' ? 'search.empty.listings' : 'search.empty.organisations', { q: q ?? '' })}</p>
              <p><a href="/discover" className="kv-btn" data-kv-browse="categories">{t.t('search.browseCategories')}</a></p>
              {categoryLinks}
            </div>
          )}
          {state === 'ok' && tab === 'listings' && (
            <>
              <div className="kv-grid">
                {cards.map((c) => <DiscoveryCard key={c.listingId} card={c} lang={lang} labels={{ organic: t.t('card.organic'), soldBy: t.t('card.soldBy', { org: c.organisation }) }} />)}
              </div>
              {next && (
                <p className="kv-loadmore">
                  <a href={`/search${buildQueryString({ q, after: next })}`} className="kv-btn" rel="next">{t.t('discover.showMore')} <DirArrow /></a>
                </p>
              )}
            </>
          )}
          {state === 'ok' && tab === 'organisations' && (
            <>
              <div className="kv-grid">
                {orgCards.map((o) => (
                  <a key={o.slug} href={`/${o.slug}`} className="kv-card" data-kv-card="organisation">
                    <h2 className="kv-card__title">{o.displayName}</h2>
                    {o.district && <p className="kv-card__org">{o.district}</p>}
                    <p className="kv-card__meta">{t.t('orgs.members', { count: formatNumber(o.memberFarmers, lang) })}</p>
                  </a>
                ))}
              </div>
              {orgCards.length >= PAGE && <p className="kv-state" data-kv-state="refine">{t.t('search.refine')}</p>}
            </>
          )}
        </>
      )}

      <RefusalList surface="search" />
    </section>
  );
}
