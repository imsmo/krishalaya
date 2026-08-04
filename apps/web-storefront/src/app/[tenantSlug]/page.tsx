// apps/web-storefront/src/app/[tenantSlug]/page.tsx · a tenant's public storefront with full discovery. The SDK
// is configured with the tenant slug (sent as X-Tenant-Slug) so the API + RLS scope the browse to that tenant;
// the slug only SELECTS which public catalogue to show — it is never trusted as an authorization claim. All
// facets live in the URL searchParams (shareable, bookmarkable), parsed through the pure features/discovery
// helpers into a typed SDK query. SSR + ISR. Degrades to an empty state if the API is unavailable (Law 12).
import type { Metadata } from 'next';
import type { ListingCard as ListingCardData, CategoryNode, TenantBranding } from '@krishalaya/sdk-js';
import { publicClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { ListingCard } from '../../components/ListingCard';
import { SearchFilters } from '../../components/SearchFilters';
import { TenantBrandMark } from '../../components/TenantBrandMark';
import { toListingQuery, loadMoreHref, hasActiveFilters, type RawSearchParams } from '../../features/discovery/query';
import { flattenCategoryNav } from '../../features/discovery/categories';

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { tenantSlug: string } }): Promise<Metadata> {
  const t = getTranslator();
  const title = t.t('storefront.title', { tenant: params.tenantSlug });
  return { title, description: t.t('storefront.metaDescription', { tenant: params.tenantSlug }) };
}

export default async function TenantStorefront(
  { params, searchParams }: { params: { tenantSlug: string }; searchParams: RawSearchParams },
) {
  const t = getTranslator();
  const lang = getLang();
  const basePath = `/${params.tenantSlug}`;
  const query = toListingQuery(searchParams);

  let items: ListingCardData[] = [];
  let nextCursor: string | null = null;
  let total: number | null = null;
  try {
    const page = await publicClient(params.tenantSlug).listings.browse(query);
    items = page.items;
    nextCursor = page.nextCursor;
    total = page.total ?? null;
  } catch {
    items = []; // API/search down → empty state, never a 500 (Law 12)
  }

  // P1-9: real category names for the discovery facet (lookups). Degrades to [] → the facet simply hides (Law 12).
  let categoryNav: ReturnType<typeof flattenCategoryNav> = [];
  try {
    const cats: CategoryNode[] = await publicClient(params.tenantSlug).lookups.categories();
    categoryNav = flattenCategoryNav(cats);
  } catch { categoryNav = []; }

  // DEV-26/Q20: the tenant's white-label branding (display name + logo). Degrades to null → TenantBrandMark
  // falls back to the LOGO-4 name-block (tenantSlug), never a 500 for "branding not configured" (Law 12).
  let branding: TenantBranding | null = null;
  try {
    branding = await publicClient(params.tenantSlug).lookups.tenantBranding();
  } catch { branding = null; }

  const cardLabels = { organic: t.t('card.organic'), available: t.t('card.available') };

  return (
    <section>
      <TenantBrandMark branding={branding} tenantSlug={params.tenantSlug} />

      <SearchFilters basePath={basePath} sp={searchParams} categories={categoryNav} />

      {typeof total === 'number' && items.length > 0 && (
        <p className="kv-results-count" aria-live="polite">{t.t('discover.resultsCount', { count: String(total) })}</p>
      )}

      {items.length === 0 ? (
        <div className="kv-empty">
          <p>{hasActiveFilters(searchParams) ? t.t('discover.resultsNone') : t.t('storefront.empty')}</p>
          {hasActiveFilters(searchParams) && <a href={basePath} className="kv-btn--link">{t.t('discover.clear')}</a>}
        </div>
      ) : (
        <div className="kv-grid">
          {items.map((l) => <ListingCard key={l.id} listing={l} tenantSlug={params.tenantSlug} lang={lang} labels={cardLabels} />)}
        </div>
      )}

      {nextCursor && (
        <p className="kv-loadmore">
          {/* SSR keyset pagination: a real link to the next page (works with no client JS); preserves all filters. */}
          <a href={loadMoreHref(basePath, searchParams, nextCursor)} className="kv-btn" rel="next">{t.t('discover.nextPage')}</a>
        </p>
      )}
    </section>
  );
}
