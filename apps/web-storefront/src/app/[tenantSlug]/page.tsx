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
import type { Metadata } from 'next';
import type { ListingCard as ListingCardData, CategoryNode, StorefrontFlags } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { publicClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { loadTenantShell, loadTenantProfile } from '../../lib/storefront-data';
import { ListingCard } from '../../components/ListingCard';
import { SearchFilters } from '../../components/SearchFilters';
import { DirArrow } from '../../components/DirArrow';
import { toListingQuery, loadMoreHref, hasActiveFilters, type RawSearchParams } from '../../features/discovery/query';
import { currencyExponent } from '../../features/discovery/money';
import { flattenCategoryNav } from '../../features/discovery/categories';
import { flattenRegionNav } from '../../features/discovery/regions';
import { loadResult, listState, publishedCount, reloadHref, showsMembersOnly } from '../../features/home/load-result';
import { refusalKey } from '../../features/home/refusals';

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
  const query = toListingQuery(searchParams, exponent);

  const [listings, cats, regions, flags] = await Promise.all([
    loadResult(() => api.listings.browse(query)),
    loadResult(() => api.lookups.categories()),
    loadResult(() => api.lookups.regions()),
    loadResult<StorefrontFlags>(() => api.storefront.flags()),
  ]);
  // facets degrade to "hidden" (a missing facet is not a lie); the listings never degrade to empty
  const categoryNav = cats.ok ? flattenCategoryNav(cats.data as CategoryNode[]) : [];
  const regionNav = regions.ok ? flattenRegionNav(regions.data) : [];
  const groupLotsOff = flags.ok && flags.data.group_lots === false;

  const state = listState(listings);
  const items: ListingCardData[] = listings.ok ? listings.data.items : [];
  const nextCursor = listings.ok ? listings.data.nextCursor : null;
  const count = listings.ok ? publishedCount(listings.data.total, listings.data.totalCap) : null;
  const membersOnly = listings.ok ? listings.data.membersOnlyCount ?? null : null;
  const filtered = hasActiveFilters(searchParams);
  const cardLabels = { organic: t.t('card.organic'), available: t.t('card.available'), soldBy: t.t('card.soldBy', { org }) };
  const n = (x: number) => formatNumber(x, lang);

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
          {count && !filtered && state === 'ok' && (
            <p><a href="#kv-listings" className="kv-btn--link">{t.t(count.capped ? 'tenant.listings.seeAllCapped' : 'tenant.listings.seeAll', { count: n(count.n) })}</a></p>
          )}
        </div>
        <div>
          {/* the canon's description, rating and "98.2%" — refused BY NAME (features/home/refusals.ts), never a figure */}
          <p className="kv-refusal" data-kv-refusal="org_description">{t.t(refusalKey('org_description'))}</p>
          <p className="kv-refusal" data-kv-refusal="org_rating">{t.t(refusalKey('org_rating'))}</p>
          <p className="kv-refusal" data-kv-refusal="graded_rate">{t.t(refusalKey('graded_rate'))}</p>
        </div>
      </section>

      <section id="kv-listings" aria-labelledby="kv-listings-title">
        <h2 id="kv-listings-title">
          {t.t('tenant.listings.title')}{' '}
          {count && !filtered && <small data-kv-count={count.capped ? 'capped' : 'exact'}>{t.t(count.capped ? 'tenant.listings.countCapped' : 'tenant.listings.count', { count: n(count.n) })}</small>}
        </h2>

        {showsMembersOnly(membersOnly) && <p className="kv-state" data-kv-state="members-only">{t.t('tenant.membersOnly', { org, count: n(membersOnly as number) })}</p>}
        {groupLotsOff && <p className="kv-state" data-kv-state="group-lots-off">{t.t('tenant.groupLotsOff')}</p>}

        <SearchFilters basePath={basePath} sp={searchParams} categories={categoryNav} regions={regionNav} exponent={exponent}
          hideSaleTypes={groupLotsOff ? ['group_lot'] : []} />

        {listings.ok && filtered && typeof listings.data.total === 'number' && items.length > 0 && (
          <p className="kv-results-count" aria-live="polite">{t.t('discover.resultsCount', { count: String(listings.data.total) })}</p>
        )}

        {state === 'error' && (
          <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
            <p>{t.t('tenant.error')}</p>
            <a href={reloadHref(basePath, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          </div>
        )}
        {state === 'empty' && (
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
        {state === 'ok' && (
          <>
            <div className="kv-grid">
              {items.map((l) => <ListingCard key={l.id} listing={l} tenantSlug={slug} lang={lang} labels={cardLabels} />)}
            </div>
            {nextCursor && (
              <p className="kv-loadmore">
                {/* SSR keyset pagination: a real link to the next page (works with no client JS); preserves all filters. */}
                <a href={loadMoreHref(basePath, searchParams, nextCursor)} className="kv-btn" rel="next">{t.t('discover.showMore')} <DirArrow /></a>
              </p>
            )}
          </>
        )}
      </section>

      <section aria-label={t.t('tenant.otherOrgs')}>
        <p className="kv-refusal" data-kv-refusal="why_buy_copy">{t.t(refusalKey('why_buy_copy'))}</p>
        <p><a href="/organisations" className="kv-btn--link">{t.t('tenant.otherOrgs')}</a></p>
      </section>
    </>
  );
}
