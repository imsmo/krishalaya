// apps/web-storefront/src/app/[tenantSlug]/page.tsx · a tenant's public storefront home (canon W274) with full discovery. The SDK is
// configured with the tenant slug (sent as X-Tenant-Slug) so the API + RLS scope every read to that tenant; the slug only SELECTS which
// public catalogue to show — it is never trusted as an authorization claim. Facets live in the URL searchParams (shareable), parsed through
// the pure features/discovery helpers into a typed SDK query.
//
// PC-56 STORE-1b · C3 — W274, built from real reads only:
//   • THE PROFILE (storefront.profile(), founder D4): "Verified organisation" ONLY when the platform's own approval says so; "with
//     <platform> since <year>"; the registered (legal) name when it differs; the district; "N member farmers". Refused by name, on the page:
//     the tenant-written description ("not written yet"), an organisation-level rating ("no organisation-level rating is kept"), the canon's
//     "98.2% orders delivered as graded", and the "Why buy from us" copy (features/home/refusals.ts);
//   • THE LISTINGS: "Live listings from our members (N published)" — the API's capped count ("1,000+"); cards name the ORGANISATION, never a
//     farmer; "Show more" with the direction-safe arrow (DirArrow); the price band parsed with the store currency's own exponent;
//   • STATES: EMPTY ("No listings from <org> yet" + "See other organisations") only for a real, successful, empty answer; ERROR ≠ EMPTY (the
//     grid failed; the profile above still shows) with Retry = a link to the same URL (a read — PARITY-DECOR, gapRetryIsMutation() false);
//     "Some lots are members-only" ONLY when the API counted at least one; "Group lots" off from storefront.flags() — and the group-lot
//     facet is then not offered;
//   • unknown / non-live / trial slug → the layout's notFound(). The hard-coded `market` slug is gone from the platform home.
// Dynamic (no ISR): a Retry must read again — a cached error render must never be served back as the "retry" (survey F-21).
//
// PC-56 STORE-2a · C1 — canon W275 BROWSE lives on this page (the store's catalogue, under its own profile):
//   • the public feed through `listings.search` (rows name the organisation, the CONFIRMED grade, the district, the regulated lock — no
//     seller or region uuid); the category is `?category=` — the whole subtree — with its BREADCRUMB from the public tree (the canon's
//     `/c/[...path]` route is a recorded DELTA);
//   • FACETS with their capped counts (grade · organic claim · district · sale type) as links, the price band in the form, the active
//     filters as remove-one CHIPS; the count line "N listings" / "1,000+ listings" — TRUE under every filter (it used to be blank when a filter
//     narrowed); sorts newest / price low–high / high–low (each with its own keyset cursor); "Show more" (the canon's "1–24 of N / Prev" =
//     DELTA);
//   • EMPTY without "Tell me when" (refused by name: no notifier reads notify_new_matches); ERROR ≠ EMPTY with Retry = the same URL, filters
//     kept (W3080–W3082 PARITY-DECOR); the catalogue's kill-switch OFF (founder D4) → "browsing is temporarily unavailable" — never "for this
//     tenant/plan", never "no listings";
//   • the refusals of brief §E for this surface printed by name (RefusalList 'browse').
import type { Metadata } from 'next';
import type { CategoryNode, ListingSearchPage, StorefrontFlags } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { publicClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { loadTenantShell, loadTenantProfile } from '../../lib/storefront-data';
import { ListingCard } from '../../components/ListingCard';
import { SearchFilters } from '../../components/SearchFilters';
import { BrowseFacets } from '../../components/BrowseFacets';
import { RefusalList, BrowseOff } from '../../components/RefusalList';
import { DirArrow } from '../../components/DirArrow';
import { type RawSearchParams } from '../../features/discovery/query';
import { currencyExponent } from '../../features/discovery/money';
import { flattenCategoryNav } from '../../features/discovery/categories';
import { publishedCount, reloadHref, showsMembersOnly } from '../../features/home/load-result';
import { refusalKey } from '../../features/home/refusals';
import {
  activeChips, browseHref, browseOff, categoryTrail, countOf, facetView, isFiltered, readBrowse, readState, showMoreHref, toSearchQuery, type BrowseState,
} from '../../features/store2a/browse';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { tenantSlug: string } }): Promise<Metadata> {
  const t = getTranslator();
  // PC-56 TENANT-13d: the tenant's own (published) name, never its slug; the layout's template adds it to every page title
  const shell = await loadTenantShell(params.tenantSlug);
  const b = shell.kind === 'ok' ? shell.branding : null;
  const name = (b?.brand?.displayName || b?.displayName || (shell.kind === 'ok' ? shell.tenant.displayName : '') || params.tenantSlug).trim();
  const title = t.t('storefront.title', { tenant: name });
  return { title: { absolute: title }, description: t.t('storefront.metaDescription', { tenant: name, platform: t.t('brand.platform') }) };
}

export default async function TenantStorefront(
  { params, searchParams }: { params: { tenantSlug: string }; searchParams: RawSearchParams },
) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const basePath = `/${slug}`;
  const api = publicClient(slug);

  const [shell, profile] = await Promise.all([loadTenantShell(slug), loadTenantProfile(slug)]);
  const org = (profile.ok ? profile.data.displayName : '')
    || (shell.kind === 'ok' ? (shell.branding?.brand?.displayName || shell.branding?.displayName || shell.tenant.displayName) : '') || slug;
  // the store's own currency exponent (survey F-15); unknown (profile not loaded) → the typed price band is not applied, never guessed
  const exponent = profile.ok ? currencyExponent(profile.data.currencyCode) : null;
  const state: BrowseState = readBrowse(searchParams);

  const flags = await readState<StorefrontFlags>(() => api.storefront.flags());
  const off = browseOff(flags);
  const [listings, cats] = await Promise.all([
    off ? Promise.resolve({ ok: false as const, kind: 'browse_off' as const }) : readState<ListingSearchPage>(() => api.listings.search(toSearchQuery(state, exponent))),
    readState<CategoryNode[]>(() => api.lookups.categories() as Promise<CategoryNode[]>),
  ]);
  const isOff = off || browseOff(flags, listings);
  // facets degrade to "hidden" (a missing facet is not a lie); the listings never degrade to empty
  const tree = cats.ok ? cats.data : [];
  const categoryNav = flattenCategoryNav(tree);
  const groupLotsOff = flags.ok && flags.data.group_lots === false;
  const trail = categoryTrail(tree, state.category);

  const listState = !listings.ok ? 'error' : listings.data.items.length === 0 ? 'empty' : 'ok';
  const items = listings.ok ? listings.data.items : [];
  const nextCursor = listings.ok ? listings.data.nextCursor : null;
  const filtered = isFiltered(state);
  // STORE-1b's "N published" — the store's whole public catalogue (only when nothing narrows); STORE-2a's count line is the count UNDER the filters
  const published = listings.ok && !filtered ? publishedCount(listings.data.total, listings.data.totalCap) : null;
  const count = listings.ok ? countOf(listings.data.total, listings.data.totalCap) : null;
  const membersOnly = listings.ok ? listings.data.membersOnlyCount ?? null : null;
  const n = (x: number) => formatNumber(x, lang);
  const cardLabels = (o: { organisation?: { name: string } | null; district?: string | null }) => ({
    organic: t.t('card.organic'), available: t.t('card.available'), certified: t.t('browse.organic.certified'), natural: t.t('browse.organic.natural'),
    licence: t.t('lot.licenceRequired'),
    soldBy: o.district ? t.t('browse.card.soldByIn', { org: o.organisation?.name ?? org, district: o.district }) : t.t('card.soldBy', { org: o.organisation?.name ?? org }),
  });
  const names: Record<string, string> = {};
  for (const c of trail) names[c.id] = c.name;
  const facets = listings.ok ? listings.data.facets : null;
  if (facets) { for (const g of facets.grade) names[g.id] = g.name; for (const d of facets.district) names[d.id] = d.name; }
  const chips = activeChips(basePath, state, (k, v) => {
    if (k === 'grade') return v === 'none' ? t.t('browse.facet.ungraded') : t.t('browse.chip.grade', { grade: names[v] ?? t.t('browse.chip.unnamed') });
    if (k === 'district') return names[v] ?? t.t('browse.chip.unnamed');
    if (k === 'category') return names[v] ?? t.t('browse.chip.unnamed');
    if (k === 'organic') return t.t(`browse.organic.${v}`);
    if (k === 'saleType') return t.t(`discover.saleType.${v}`);
    if (k === 'priceMin') return t.t('browse.chip.priceMin', { amount: v });
    if (k === 'priceMax') return t.t('browse.chip.priceMax', { amount: v });
    return t.t('browse.chip.q', { q: v });
  });
  const fv = facetView(basePath, state, facets, {
    ungraded: t.t('browse.facet.ungraded'), certified: t.t('browse.organic.certified'), natural: t.t('browse.organic.natural'),
    saleType: (id) => t.t(`discover.saleType.${id}`),
  });
  if (fv && groupLotsOff) fv.saleType = fv.saleType.filter((x) => x.id !== 'group_lot');   // a switched-off sale type is not offered as a facet either

  return (
    <>
      <section className="kv-hero" aria-labelledby="kv-org-name">
        <div>
          {profile.ok && profile.data.verified && <span className="kv-badge kv-badge--verified" data-kv-verified="platform">{t.t('tenant.verified')}</span>}
          <h1 id="kv-org-name">{org}</h1>
          {profile.ok ? (
            <ul className="kv-profile__facts">
              <li>{t.t('tenant.since', { platform: t.t('brand.platform'), year: String(profile.data.sinceYear) })}</li>
              {profile.data.legalName && profile.data.legalName !== profile.data.displayName && <li>{t.t('tenant.legalName', { name: profile.data.legalName })}</li>}
              {profile.data.district && <li>{t.t('tenant.district', { district: profile.data.district })}</li>}
              <li>{t.t('tenant.members', { count: n(profile.data.memberFarmers) })}</li>
            </ul>
          ) : (
            <p className="kv-state kv-state--error" role="status" data-kv-state="profile-error">{t.t('tenant.profileError')}</p>
          )}
          {published && listState === 'ok' && (
            <p><a href="#kv-listings" className="kv-btn--link">{t.t(published.capped ? 'tenant.listings.seeAllCapped' : 'tenant.listings.seeAll', { count: n(published.n) })}</a></p>
          )}
          <p><a href={`${basePath}/sellers`} className="kv-btn--link" data-kv-link="sellers">{t.t('sellers.link')}</a></p>
        </div>
        <div>
          {/* the canon's description, rating and "98.2%" — refused BY NAME (features/home/refusals.ts), never a figure */}
          <p className="kv-refusal" data-kv-refusal="org_description">{t.t(refusalKey('org_description'))}</p>
          <p className="kv-refusal" data-kv-refusal="org_rating">{t.t(refusalKey('org_rating'))}</p>
          <p className="kv-refusal" data-kv-refusal="graded_rate">{t.t(refusalKey('graded_rate'))}</p>
        </div>
      </section>

      <section id="kv-listings" aria-labelledby="kv-listings-title">
        {trail.length > 0 && (
          <nav aria-label={t.t('browse.crumbs')}>
            <ol className="kv-crumb" data-kv-crumbs="category">
              <li><a href={browseHref(basePath, state, { category: undefined })}>{t.t('browse.crumbs.all')}</a></li>
              {trail.map((c, i) => (
                <li key={c.id} {...(i === trail.length - 1 ? { 'aria-current': 'page' as const } : {})}>
                  {i === trail.length - 1 ? c.name : <a href={browseHref(basePath, state, { category: c.id })}>{c.name}</a>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h2 id="kv-listings-title">
          {trail.length > 0 ? trail[trail.length - 1].name : t.t('tenant.listings.title')}{' '}
          {published && <small data-kv-count={published.capped ? 'capped' : 'exact'}>{t.t(published.capped ? 'tenant.listings.countCapped' : 'tenant.listings.count', { count: n(published.n) })}</small>}
        </h2>

        {isOff ? <BrowseOff /> : (
          <>
            {showsMembersOnly(membersOnly) && <p className="kv-state" data-kv-state="members-only">{t.t('tenant.membersOnly', { org, count: n(membersOnly as number) })}</p>}
            {groupLotsOff && <p className="kv-state" data-kv-state="group-lots-off">{t.t('tenant.groupLotsOff')}</p>}

            <SearchFilters basePath={basePath} sp={searchParams} categories={categoryNav} exponent={exponent}
              hideSaleTypes={groupLotsOff ? ['group_lot'] : []} />

            {listings.ok && count && (
              <p className="kv-results-count" aria-live="polite" data-kv-count-line={count.capped ? 'capped' : 'exact'}>
                {t.t(count.capped ? 'browse.countCapped' : 'browse.count', { count: n(count.n) })}
              </p>
            )}
            {listings.ok && <BrowseFacets facets={fv} chips={chips} />}

            {listState === 'error' && (
              <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
                <p>{t.t('tenant.error')}</p>
                <p>{t.t('browse.errorKept')}</p>
                <a href={reloadHref(basePath, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
              </div>
            )}
            {listState === 'empty' && (
              <div className="kv-empty" data-kv-state="empty">
                {filtered ? (
                  <>
                    <p>{t.t('discover.resultsNone')}</p>
                    <a href={basePath} className="kv-btn--link">{t.t('discover.clear')}</a>
                  </>
                ) : (
                  <>
                    <p><strong>{t.t('tenant.empty', { org })}</strong></p>
                    <p>{t.t('tenant.emptyHint')}</p>
                    <a href="/organisations" className="kv-btn">{t.t('tenant.otherOrgs')}</a>
                  </>
                )}
              </div>
            )}
            {listState === 'ok' && (
              <>
                <div className="kv-grid">
                  {items.map((l) => <ListingCard key={l.id} listing={l} tenantSlug={slug} lang={lang} labels={cardLabels(l)} />)}
                </div>
                {nextCursor && (
                  <p className="kv-loadmore">
                    {/* SSR keyset pagination: a real link to the next page (works with no client JS); keeps the filters AND the sort the cursor belongs to. */}
                    <a href={showMoreHref(basePath, state, nextCursor)} className="kv-btn" rel="next">{t.t('discover.showMore')} <DirArrow /></a>
                  </p>
                )}
              </>
            )}
          </>
        )}
      </section>

      <RefusalList surface="browse" />

      <section aria-label={t.t('tenant.otherOrgs')}>
        <p className="kv-refusal" data-kv-refusal="why_buy_copy">{t.t(refusalKey('why_buy_copy'))}</p>
        <p><a href="/organisations" className="kv-btn--link">{t.t('tenant.otherOrgs')}</a></p>
      </section>
    </>
  );
}
