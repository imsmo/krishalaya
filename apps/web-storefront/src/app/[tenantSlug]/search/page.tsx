// apps/web-storefront/src/app/[tenantSlug]/search/page.tsx · PC-56 STORE-2a · C2 — canon W276 SEARCH inside ONE organisation's store (the
// tenant header's search box lands here). The tenant feed (`listings.search`, the same public read as the store's catalogue): lots whose
// TITLE CONTAINS the words (ILIKE — brief B3, no new engine), with the capped count ("N listings" / "1,000+"), sorts newest / price, keyset
// "Show more". No Organisations tab here (one store = one organisation). The HONEST sentence says how matching works; multilingual / spelling
// / closest-matches / voice are refused by name. EMPTY → "Browse categories" (this store's catalogue + its category links); ERROR → "search
// is having trouble; browsing still works" + the same links + Retry (a reload); the kill-switch OFF (founder D4) → temporarily unavailable.
import type { Metadata } from 'next';
import type { CategoryNode, ListingSearchPage, StorefrontFlags } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { publicClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { loadTenantProfile } from '../../../lib/storefront-data';
import { ListingCard } from '../../../components/ListingCard';
import { DirArrow } from '../../../components/DirArrow';
import { RefusalList, BrowseOff } from '../../../components/RefusalList';
import { reloadHref } from '../../../features/home/load-result';
import { flattenCategoryNav } from '../../../features/discovery/categories';
import { SORTS, browseOff, browseHref, countOf, readBrowse, readState, showMoreHref, toSearchQuery } from '../../../features/store2a/browse';
import { currencyExponent } from '../../../features/discovery/money';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata({ searchParams }: { searchParams: SP }): Metadata {
  const t = getTranslator();
  const q = readBrowse(searchParams).q;
  return { title: q ? t.t('search.resultsFor', { q }) : t.t('search.title'), robots: { index: false } };
}

export default async function TenantSearch({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const base = `/${slug}/search`;
  const api = publicClient(slug);
  const all = readBrowse(searchParams);
  const state = { q: all.q, sort: all.sort, cursor: all.cursor };   // search narrows by the words only; the store page has the facets
  const profile = await loadTenantProfile(slug);
  const exponent = profile.ok ? currencyExponent(profile.data.currencyCode) : null;
  const org = profile.ok ? profile.data.displayName : slug;

  const flags = await readState<StorefrontFlags>(() => api.storefront.flags());
  const off = browseOff(flags);
  const [res, cats] = await Promise.all([
    !off && state.q ? readState<ListingSearchPage>(() => api.listings.search(toSearchQuery(state, exponent))) : Promise.resolve(null),
    readState<CategoryNode[]>(() => api.lookups.categories() as Promise<CategoryNode[]>),
  ]);
  const isOff = off || (res !== null && browseOff(flags, res));
  const topCats = cats.ok ? flattenCategoryNav(cats.data).filter((c) => c.depth === 0) : [];
  const view = !state.q ? 'prompt' : !res || !res.ok ? 'error' : res.data.items.length === 0 ? 'empty' : 'ok';
  const count = res && res.ok ? countOf(res.data.total, res.data.totalCap) : null;
  const n = (x: number) => formatNumber(x, lang);
  const categoryLinks = topCats.length > 0 && (
    <ul className="kv-chips" data-kv-browse-links="categories">
      {topCats.map((c) => <li key={c.id}><a href={`/${slug}?category=${encodeURIComponent(c.id)}`} className="kv-chip">{c.label}</a></li>)}
    </ul>
  );

  return (
    <section aria-labelledby="kv-search-title">
      <h1 id="kv-search-title">{state.q ? t.t('search.resultsFor', { q: state.q }) : t.t('search.inStore', { org })}</h1>
      <p className="kv-prose__lead" data-kv-honest="store">{t.t('search.honest.store')}</p>
      <form method="get" action={base} role="search" className="kv-filters" aria-label={t.t('header.search.label')}>
        <div className="kv-filters__row">
          <div className="kv-filters__field kv-filters__field--grow">
            <label htmlFor="kv-search-q" className="kv-filters__label">{t.t('discover.searchLabel')}</label>
            <input id="kv-search-q" name="q" type="search" defaultValue={state.q ?? ''} placeholder={t.t('header.search.placeholder')} className="kv-field__input" />
          </div>
          <div className="kv-filters__field">
            <label htmlFor="kv-search-sort" className="kv-filters__label">{t.t('discover.sort')}</label>
            <select id="kv-search-sort" name="sort" defaultValue={state.sort ?? ''} className="kv-field__input">
              {SORTS.map((s) => <option key={s} value={s}>{t.t(`discover.sort.${s}`)}</option>)}
            </select>
          </div>
          <div className="kv-filters__actions"><button type="submit" className="kv-btn">{t.t('header.search.submit')}</button></div>
        </div>
      </form>

      {isOff ? <BrowseOff /> : (
        <>
          {view === 'prompt' && <p className="kv-state" data-kv-state="prompt">{t.t('search.promptStore')}</p>}
          {view === 'error' && (
            <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
              <p>{t.t('search.error')}</p>
              <p><a href={`/${slug}`} className="kv-btn--link">{t.t('search.browseStore', { org })}</a></p>
              {categoryLinks}
              <a href={reloadHref(base, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
            </div>
          )}
          {view === 'empty' && (
            <div className="kv-empty" data-kv-state="empty">
              <p>{t.t('search.empty.listings', { q: state.q ?? '' })}</p>
              <p><a href={`/${slug}`} className="kv-btn" data-kv-browse="categories">{t.t('search.browseCategories')}</a></p>
              {categoryLinks}
            </div>
          )}
          {view === 'ok' && res && res.ok && (
            <>
              {count && <p className="kv-results-count" aria-live="polite" data-kv-count-line={count.capped ? 'capped' : 'exact'}>{t.t(count.capped ? 'browse.countCapped' : 'browse.count', { count: n(count.n) })}</p>}
              <p><a href={browseHref(`/${slug}`, { q: state.q }, {})} className="kv-btn--link">{t.t('search.refineInStore')}</a></p>
              <div className="kv-grid">
                {res.data.items.map((l) => (
                  <ListingCard key={l.id} listing={l} tenantSlug={slug} lang={lang} labels={{
                    organic: t.t('card.organic'), available: t.t('card.available'), certified: t.t('browse.organic.certified'), natural: t.t('browse.organic.natural'),
                    licence: t.t('lot.licenceRequired'),
                    soldBy: l.district ? t.t('browse.card.soldByIn', { org: l.organisation?.name ?? org, district: l.district }) : t.t('card.soldBy', { org: l.organisation?.name ?? org }),
                  }} />
                ))}
              </div>
              {res.data.nextCursor && (
                <p className="kv-loadmore">
                  <a href={showMoreHref(base, state, res.data.nextCursor)} className="kv-btn" rel="next">{t.t('discover.showMore')} <DirArrow /></a>
                </p>
              )}
            </>
          )}
        </>
      )}

      <RefusalList surface="search" />
    </section>
  );
}
