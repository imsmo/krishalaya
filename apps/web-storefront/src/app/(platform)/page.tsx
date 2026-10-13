// apps/web-storefront/src/app/(platform)/page.tsx · THE PLATFORM HOME (canon W273). PC-56 STORE-1b · C2, founder D1–D3.
//
// Phase-1 platform home = a platform landing: the verified-organisation directory + a READ-ONLY discovery feed of `cross_tenant` listings
// across live organisations. Every card names its ORGANISATION and links INTO that organisation's own store (/<slug>/listings/<id>), where
// cart, checkout and sign-in stay per tenant (the tenant is the merchant of record) — there is NO cross-tenant cart.
//   • hero: region-neutral copy (no "across Gujarat / India"); "Browse fresh listings" → /discover; "Scan a trace QR" → the code entry below;
//   • "Today at a glance": the PRECOMPUTED counts (storefront.stats(), refreshed by the job every 15 min — never counted on this request) with
//     an "as of" stamp (AsOf, stale > 1 h); never computed → "not counted yet", never three measured-looking zeros;
//   • GMV ("Yesterday, buyers paid farmers ₹…") and the AGMARKNET mandi pulse are rendered AS REFUSALS (founder D3);
//   • "Shop by category": master-data categories → /discover?category=<id>;
//   • "Fresh this week": the first 8 of the feed. EMPTY ("No organisation has published a listing this week" + Browse all organisations)
//     only for a real, successful, empty answer; ERROR ≠ EMPTY ("Couldn't load today's listings — nothing was lost, only this refresh
//     failed") + Retry = a link to the same URL (a read: PARITY-DECOR — the W3055–W3057 confirm/success/failure pages are recorded, the
//     confirm sentence "writes an audit-trail entry" is a DELTA, "page the on-call" is refused);
//   • "Scan a trace QR": a GET form (code → /trace?code= → /trace/<code>) — no camera scanner (refused by name); no demo lot (refused);
//   • the canon's "region-restricted" and "group lots disabled" states are RECORDED as refusals (features/home/refusals.ts), not rendered.
// Dynamic (no ISR): Retry must read again (survey F-21).
import type { Metadata } from 'next';
import type { CategoryNode, DiscoveryCard as DiscoveryCardData, StorefrontStats } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { publicClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { DiscoveryCard } from '../../components/DiscoveryCard';
import { AsOf } from '../../components/AsOf';
import { loadResult, listState, reloadHref } from '../../features/home/load-result';
import { refusalKey } from '../../features/home/refusals';
import { flattenCategoryNav } from '../../features/discovery/categories';
import { PLATFORM_BRAND } from '../../features/branding/brand-theme';

export const dynamic = 'force-dynamic';

/** "Fresh this week" shows the newest eight cards of the feed (canon W273); the rest are one click away in /discover. */
const FRESH_COUNT = 8;
const TILES_MAX = 6;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: { absolute: t.t('meta.platformTitle', { store: PLATFORM_BRAND.platformStoreName }) }, description: t.t('home.hero.lead') };
}

export default async function HomePage() {
  const t = getTranslator();
  const lang = getLang();
  const api = publicClient();
  const [stats, feed, cats] = await Promise.all([
    loadResult<StorefrontStats>(() => api.storefront.stats()),
    loadResult(() => api.storefront.discover({ limit: FRESH_COUNT })),
    loadResult(() => api.lookups.categories()),
  ]);
  const state = listState(feed);
  const cards: DiscoveryCardData[] = feed.ok ? feed.data.items.slice(0, FRESH_COUNT) : [];
  const tiles = cats.ok ? flattenCategoryNav(cats.data as CategoryNode[]).filter((c) => c.depth === 0).slice(0, TILES_MAX) : [];
  const n = (x: number) => formatNumber(x, lang);
  const asOfLabels = {
    asOf: t.t('asOf.asOf'), now: t.t('asOf.now'), minutes: t.t('asOf.minutes'), hours: t.t('asOf.hours'), days: t.t('asOf.days'),
    ago: t.t('asOf.ago'), stale: t.t('asOf.stale'), staleCell: t.t('asOf.stale'), refresh: t.t('asOf.refresh'),
  };

  return (
    <>
      <section className="kv-hero">
        <div>
          <h1>{t.t('home.hero.title')}</h1>
          <p className="kv-prose__lead">{t.t('home.hero.lead')}</p>
          <p className="kv-hero__ctas">
            <a href="/discover" className="kv-btn">{t.t('home.cta.browse')}</a>
            <a href="#trace" className="kv-btn kv-btn--ghost">{t.t('home.cta.trace')}</a>
          </p>
        </div>
        <section className="kv-glance" aria-labelledby="kv-glance-title" data-kv-region="glance">
          <h2 id="kv-glance-title">{t.t('home.glance.title')}</h2>
          {!stats.ok && <p className="kv-state kv-state--error" role="status" data-kv-state="stats-error">{t.t('home.glance.error')}</p>}
          {stats.ok && !stats.data.computedAt && <p data-kv-state="stats-not-yet">{t.t('home.glance.notYet')}</p>}
          {stats.ok && stats.data.computedAt && (
            <>
              <AsOf at={stats.data.computedAt} labels={asOfLabels} />
              <ul className="kv-glance__figures">
                <li>{t.t('home.glance.listings', { count: n(stats.data.liveListings) })}</li>
                <li>{t.t('home.glance.orgs', { count: n(stats.data.verifiedOrganisations) })}</li>
                <li>{t.t('home.glance.districts', { count: n(stats.data.districts) })}</li>
              </ul>
            </>
          )}
          {/* founder D3: the GMV figure and the mandi pulse are refused BY NAME — a tile that says why, never a number */}
          <p className="kv-refusal" data-kv-refusal="gmv_yesterday"><strong>{t.t('home.refusal.gmvTitle')}</strong> — {t.t(refusalKey('gmv_yesterday'))}</p>
          <p className="kv-refusal" data-kv-refusal="mandi_pulse"><strong>{t.t('home.refusal.mandiTitle')}</strong> — {t.t(refusalKey('mandi_pulse'))}</p>
        </section>
      </section>

      {tiles.length > 0 && (
        <section aria-labelledby="kv-cat-title">
          <h2 id="kv-cat-title">{t.t('home.categories.title')}</h2>
          <ul className="kv-tiles">
            {tiles.map((c) => <li key={c.id}><a href={`/discover?category=${encodeURIComponent(c.id)}`}>{c.label}</a></li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="kv-fresh-title">
        <h2 id="kv-fresh-title">{t.t('home.fresh.title')}</h2>
        {state === 'error' && (
          <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
            <p>{t.t('home.fresh.error')}</p>
            <a href={reloadHref('/')} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          </div>
        )}
        {state === 'empty' && (
          <div className="kv-empty" data-kv-state="empty">
            <p><strong>{t.t('home.fresh.empty')}</strong></p>
            <p>{t.t('home.fresh.emptyHint')}</p>
            <a href="/organisations" className="kv-btn">{t.t('home.orgs.cta')}</a>
          </div>
        )}
        {state === 'ok' && (
          <>
            <div className="kv-grid">
              {cards.map((c) => (
                <DiscoveryCard key={c.listingId} card={c} lang={lang}
                  labels={{ organic: t.t('card.organic'), soldBy: t.t('card.soldBy', { org: c.organisation }) }} />
              ))}
            </div>
            <p className="kv-loadmore"><a href="/discover" className="kv-btn--link">{t.t('home.fresh.seeAll')}</a></p>
          </>
        )}
        <p><a href="/organisations" className="kv-btn--link">{t.t('home.orgs.cta')}</a></p>
      </section>

      <section id="trace" className="kv-state" aria-labelledby="kv-trace-title">
        <h2 id="kv-trace-title">{t.t('home.trace.title')}</h2>
        <p>{t.t('home.trace.body')}</p>
        <form method="get" action="/trace" className="kv-trace-entry">
          <span className="kv-field">
            <label htmlFor="kv-trace-code" className="kv-field__label">{t.t('home.trace.label')}</label>
            <input id="kv-trace-code" name="code" type="text" required maxLength={128} autoComplete="off" className="kv-field__input" aria-describedby="kv-trace-hint" />
          </span>
          <button type="submit" className="kv-btn">{t.t('home.trace.submit')}</button>
        </form>
        <p id="kv-trace-hint" className="kv-field__hint" data-kv-refusal="camera_scanner">{t.t(refusalKey('camera_scanner'))}</p>
        <p className="kv-refusal" data-kv-refusal="trace_demo">{t.t(refusalKey('trace_demo'))}</p>
      </section>
    </>
  );
}
