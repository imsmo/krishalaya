// apps/web-storefront/src/app/[tenantSlug]/sellers/page.tsx · PC-56 STORE-2a · C4 — canon W280 "Seller profile", COLLAPSED TO THE ORGANISATION
// (HOTFIX-4 D3: seller identity = the organisation, everywhere — the per-farmer page is a recorded DELTA; `sellers` is reserved in 0207).
//   • the organisation's profile (`listings.organisationPage()` → 0204's public profile): "Verified organisation" = the PLATFORM's approval,
//     with the platform since <year>, its district, its member-farmer count;
//   • its live-listing count (CAPPED — "1,000+") and the live listings grid (the tenant feed's first page + "Show more");
//   • the REVIEWS AGGREGATE only when the `reviews` flag is ON for the store: "<avg> out of 5 from N verified-purchase reviews" — no reviewer,
//     no city, no district (founder D1); above the cap "1,000+ … average of the latest 1,000". Flag OFF → no rating at all (not "no ratings");
//   • refused by name: "Follow" (no notifier), the farmer's avatar / name / member number / landholding / "since", "KYC verified" /
//     "centre-graded seller" / completed-sales badges, "reviews translated", bulk pricing;
//   • ERROR with Retry = a reload (W3148–W3150 PARITY-DECOR); the kill-switch OFF (founder D4) → temporarily unavailable.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ListingSearchPage, OrganisationPage, StorefrontFlags } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { publicClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { ListingCard } from '../../../components/ListingCard';
import { DirArrow } from '../../../components/DirArrow';
import { RefusalList, BrowseOff } from '../../../components/RefusalList';
import { reloadHref } from '../../../features/home/load-result';
import { browseOff, countOf, readBrowse, readState, showMoreHref, toSearchQuery } from '../../../features/store2a/browse';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('sellers.title') };
}

export default async function OrganisationSellerPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const base = `/${slug}/sellers`;
  const api = publicClient(slug);
  const cursor = readBrowse(searchParams).cursor;
  const n = (x: number) => formatNumber(x, lang);

  const flags = await readState<StorefrontFlags>(() => api.storefront.flags());
  if (browseOff(flags)) return <section><BrowseOff /><RefusalList surface="sellers" /></section>;

  const [page, listings] = await Promise.all([
    readState<OrganisationPage>(() => api.listings.organisationPage()),
    readState<ListingSearchPage>(() => api.listings.search(toSearchQuery({ cursor }, null))),
  ]);
  if (browseOff(flags, page, listings)) return <section><BrowseOff /><RefusalList surface="sellers" /></section>;
  if (!page.ok && page.kind === 'not_found') notFound();
  if (!page.ok) {
    return (
      <section>
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('sellers.error')}</p>
          <a href={reloadHref(base, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="sellers" />
      </section>
    );
  }
  const p = page.data.profile;
  const count = countOf(page.data.listingCount, page.data.listingCountCap);
  const reviews = page.data.reviews;
  const org = p.displayName;

  return (
    <>
      <section className="kv-hero" aria-labelledby="kv-seller-org" data-kv-seller-page="organisation">
        <div>
          {p.verified && <span className="kv-badge kv-badge--verified" data-kv-verified="platform">{t.t('tenant.verified')}</span>}
          <h1 id="kv-seller-org">{org}</h1>
          <p className="kv-prose__lead">{t.t('sellers.lead', { org })}</p>
          <ul className="kv-profile__facts">
            <li>{t.t('tenant.since', { platform: t.t('brand.platform'), year: String(p.sinceYear) })}</li>
            {p.district && <li>{t.t('tenant.district', { district: p.district })}</li>}
            <li>{t.t('tenant.members', { count: n(p.memberFarmers) })}</li>
            {count && <li data-kv-count={count.capped ? 'capped' : 'exact'}>{t.t(count.capped ? 'sellers.liveCountCapped' : 'sellers.liveCount', { count: n(count.n) })}</li>}
          </ul>
        </div>
        <div>
          {reviews && (
            <p data-kv-reviews="verified-purchase">
              {reviews.count === 0
                ? t.t('sellers.reviews.none')
                : reviews.capped
                  ? t.t('sellers.reviews.aggregateCapped', { avg: n(Math.round(reviews.avg * 10) / 10), count: n(reviews.cap) })
                  : t.t('sellers.reviews.aggregate', { avg: n(Math.round(reviews.avg * 10) / 10), count: n(reviews.count) })}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="kv-seller-listings">
        <h2 id="kv-seller-listings">{t.t('sellers.listings.title')}</h2>
        {!listings.ok && (
          <div className="kv-state kv-state--error" role="alert" data-kv-state="listings-error">
            <p>{t.t('sellers.listings.error')}</p>
            <a href={reloadHref(base, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          </div>
        )}
        {listings.ok && listings.data.items.length === 0 && (
          <div className="kv-empty" data-kv-state="empty"><p>{t.t('sellers.listings.empty', { org })}</p></div>
        )}
        {listings.ok && listings.data.items.length > 0 && (
          <>
            <div className="kv-grid">
              {listings.data.items.map((l) => (
                <ListingCard key={l.id} listing={l} tenantSlug={slug} lang={lang} labels={{
                  organic: t.t('card.organic'), available: t.t('card.available'), certified: t.t('browse.organic.certified'), selfDeclared: t.t('browse.organic.self_declared'), natural: t.t('browse.organic.natural'),
                  licence: t.t('lot.licenceRequired'),
                  soldBy: l.district ? t.t('browse.card.soldByIn', { org, district: l.district }) : t.t('card.soldBy', { org }),
                }} />
              ))}
            </div>
            {listings.data.nextCursor && (
              <p className="kv-loadmore">
                <a href={showMoreHref(base, {}, listings.data.nextCursor)} className="kv-btn" rel="next">{t.t('discover.showMore')} <DirArrow /></a>
              </p>
            )}
          </>
        )}
        <p><a href={`/${slug}`} className="kv-btn--link">{t.t('sellers.browseAll', { org })}</a></p>
      </section>

      <RefusalList surface="sellers" />
    </>
  );
}
