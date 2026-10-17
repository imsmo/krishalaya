// apps/web-storefront/src/components/sweep/AboutScreen.tsx · PC-56 STORE-SWEEP-a · C2 (canon W308; founder D5) — ABOUT, PLATFORM-ONLY (`/about`; a store
// host answers 307 to the platform's origin, and every store's "Powered by" links here).
//   • the three PRECOMPUTED counts (organisations, districts, live listings) from `storefront.stats()` with `AsOf` from `computedAt` — exactly as
//     the platform home has them (survey E7): the error sentence when the read fails, "not counted yet" when never computed; the cadence said
//     (every 15 minutes — W308's "refreshed daily" is a DELTA); the payments figure stays refused (1b `gmv_yesterday`, its own key);
//   • "From Farm to Future" printed as a VISION, never as a list of live modules (`live_modules` refused);
//   • the three principles only where code makes them true (hash-chained trace records — 5b; never a person or a rupee on a trace; escrow and
//     text disputes where an organisation switches them on; Senior Farmer Mode); the rest refused by name (RefusalList `about`);
//   • press & partnership → the press mailbox from the facts read (0223), or "not published yet".
import type { PlatformFacts, StorefrontStats } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { getLang, getTranslator } from '../../lib/i18n';
import { AsOf } from '../AsOf';
import { RefusalList } from '../RefusalList';
import { reloadHref, type LoadResult } from '../../features/home/load-result';
import { refusalKey } from '../../features/home/refusals';
import { STATS_EVERY_MINUTES } from '../../features/sweep/trust-claims';
import { factLine } from '../../features/sweep/facts';
import { FactItem, FactsError } from './Facts';

export function AboutScreen({ stats, facts }: { stats: LoadResult<StorefrontStats>; facts: LoadResult<PlatformFacts> }) {
  const t = getTranslator();
  const lang = getLang();
  const n = (x: number) => formatNumber(x, lang);
  const asOfLabels = {
    asOf: t.t('asOf.asOf'), now: t.t('asOf.now'), minutes: t.t('asOf.minutes'), hours: t.t('asOf.hours'), days: t.t('asOf.days'),
    ago: t.t('asOf.ago'), stale: t.t('asOf.stale'), staleCell: t.t('asOf.stale'), refresh: t.t('asOf.refresh'),
  };
  return (
    <article className="kv-prose" data-kv-about="">
      <h1>{t.t('about.title')}</h1>
      <section data-kv-about-section="vision" aria-labelledby="kv-about-vision">
        <h2 id="kv-about-vision" data-kv-vision="">{t.t('about.vision')}</h2>
        <p className="kv-prose__note">{t.t('about.visionNote')}</p>
        <p className="kv-prose__lead">{t.t('about.lead')}</p>
      </section>
      <p>{t.t('about.p1')}</p>
      <p>{t.t('about.p2')}</p>
      <section className="kv-glance" data-kv-region="about-counts" aria-labelledby="kv-about-counts">
        <h2 id="kv-about-counts">{t.t('about.countsTitle')}</h2>
        {!stats.ok && <p className="kv-state kv-state--error" role="status" data-kv-state="stats-error">{t.t('home.glance.error')}</p>}
        {stats.ok && !stats.data.computedAt && <p data-kv-state="stats-not-yet">{t.t('home.glance.notYet')}</p>}
        {stats.ok && stats.data.computedAt && (
          <>
            <AsOf at={stats.data.computedAt} labels={asOfLabels} />
            <ul className="kv-glance__figures">
              <li data-kv-count="orgs">{t.t('home.glance.orgs', { count: n(stats.data.verifiedOrganisations) })}</li>
              <li data-kv-count="districts">{t.t('home.glance.districts', { count: n(stats.data.districts) })}</li>
              <li data-kv-count="listings">{t.t('home.glance.listings', { count: n(stats.data.liveListings) })}</li>
            </ul>
          </>
        )}
        <p data-kv-cadence="">{t.t('about.countsCadence', { minutes: String(STATS_EVERY_MINUTES) })}</p>
        <p className="kv-refusal" data-kv-refusal="gmv_yesterday"><strong>{t.t('home.refusal.gmvTitle')}</strong> — {t.t(refusalKey('gmv_yesterday'))}</p>
      </section>
      <section data-kv-about-section="principles" aria-labelledby="kv-about-principles">
        <h2 id="kv-about-principles">{t.t('about.principlesTitle')}</h2>
        <ol>
          {(['principle1', 'principle2', 'principle3'] as const).map((p) => (
            <li key={p} data-kv-principle={p}><strong>{t.t(`about.${p}.title`)}</strong> {t.t(`about.${p}.body`)}</li>
          ))}
        </ol>
      </section>
      <section data-kv-about-section="mission" aria-labelledby="kv-about-mission">
        <h2 id="kv-about-mission">{t.t('about.missionTitle')}</h2>
        <p>{t.t('about.mission')}</p>
      </section>
      <section data-kv-about-section="press" aria-labelledby="kv-about-press">
        <h2 id="kv-about-press">{t.t('about.pressTitle')}</h2>
        {facts.ok
          ? <ul className="kv-facts"><FactItem id="mailbox.press" label={t.t('sweep.fact.mailbox.press')} line={factLine(facts.data.contact.pressEmail)} /></ul>
          : <FactsError retryHref={reloadHref('/about')} />}
      </section>
      <RefusalList surface="about" />
    </article>
  );
}
