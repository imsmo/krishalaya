// apps/web-tenant/src/app/twin/page.tsx · W420 · TWIN OVERVIEW — THE GROUND TRUTH, OR THE LOCKED PAGE · PC-56 TENANT-12.
//
// The canon draws five tiles (parcels mapped 3,182 of 3,900 · soil pods 31 · weather masts 5 · herd synced 2,908 · member profiles
// 1,240) and a feed-freshness table stamped "Mon 13 Jul, 14:00". Two of those tiles count devices that had no registry and can have
// no readings, one counts a link that does not exist, and every stamp was typed. This page prints only what the platform records:
//   • parcels mapped N of M (M = parcels registered in THIS tenant; mapped = a real GeoJSON polygon), the unmapped said as such;
//   • soil tests (count, latest sampled-on); seasons (open / last closed);
//   • registered soil pods / weather masts + "readings: none — ingestion not built" (registry only, founder decision);
//   • the mandi feed: platform rows and their as-of, or "no platform feed; N of your own typed observations";
//   • weather: the forecast provider if one is configured, and "alerts: no ingestion yet";
//   • herd: "not linked" (animals carry no BMC link) — refused by name; the member-profiles tile likewise.
// Every as-of is the API's computation over the real table (never typed); no figure here carries an AI badge, because none is a model
// output. States: content · Loading · LOCKED (the API's `digital_twin` flag off for this tenant — the canon's one honest pitch and
// the ONE idempotent "Ask your account desk") · "Twin access needed" (403 — no twin.view) · Couldn't load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { TwinAccess, TwinOverview } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getLang, getTranslator } from '../../lib/i18n';
import {
  ASK_HREF, PLAN_HREF, SCENARIOS_HREF, TWIN_HREF, TWIN_REFUSED_BY_NAME, asOfKey, byNameKey, feedLine, feedNameKey, seasonKey, twinState,
} from '../../features/twin/twin';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('twin.overview.title'), robots: { index: false, follow: false } };
}

export default async function TwinOverviewPage() {
  await requireSession(TWIN_HREF);
  const t = getTranslator();
  const lang = getLang();
  const fmt = (n: number) => formatNumber(n, lang);
  const day = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium' }) : '');
  const when = (iso: string | null, zone: string) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }) : '');

  let access: TwinAccess | null = null; let state: string | null = null;
  try { access = await tenantClient().twin.access(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status); }
  let o: TwinOverview | null = null;
  if (access?.enabled) {
    try { o = await tenantClient().twin.overview(); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status); }
  }
  const locked = (access && !access.enabled) || state === 'flaggedOff';

  return (
    <section>
      <nav aria-label={t.t('twin.breadcrumb.label')} className="kv-field__hint">{t.t('twin.breadcrumb.area')} › {t.t('twin.overview.crumb')}</nav>
      <h1>{t.t('twin.overview.title')}</h1>
      <p>{t.t('twin.overview.lede')}</p>

      {state && state !== 'flaggedOff' && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`twin.state.${state}.title`)}</strong><p>{t.t(`twin.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={TWIN_HREF} className="kv-btn--link">{t.t('twin.state.reload')}</Link></p>}
        </div>
      )}

      {locked && (
        <div className="kv-card" role="region" aria-label={t.t('twin.locked.title')}>
          <h2>{t.t('twin.locked.title')}</h2>
          <ul className="kv-list">
            <li>{t.t('twin.locked.pitch1')}</li><li>{t.t('twin.locked.pitch2')}</li><li>{t.t('twin.locked.pitch3')}</li><li>{t.t('twin.locked.pitch4')}</li>
          </ul>
          <p className="kv-field__hint">{t.t('twin.locked.noNag')}</p>
          {access?.request
            ? <p className="kv-card kv-card--notice" role="status">{t.t('twin.locked.asked', { when: day(access.request.requestedAt), who: access.request.requestedBy ?? t.t('twin.someone') })}</p>
            : <p><Link href={`${ASK_HREF}?step=confirm`} className="kv-btn kv-btn--primary">{t.t('twin.locked.ask')}</Link></p>}
          <p><Link href={PLAN_HREF} className="kv-btn--link">{t.t('twin.locked.planSheet')}</Link></p>
        </div>
      )}

      {o && (
        <>
          <p className="kv-field__hint">{t.t('twin.clock', { today: o.clock.today, zone: o.clock.zone })}</p>
          <p><Link href={SCENARIOS_HREF} className="kv-btn kv-btn--primary">{t.t('twin.overview.toScenarios')}</Link></p>

          <div className="kv-cards" role="list">
            <div className="kv-card" role="listitem">
              <h2>{t.t('twin.tile.parcels')}</h2>
              <p><strong>{t.t('twin.tile.parcels.value', { mapped: fmt(o.parcels.mapped), registered: fmt(o.parcels.registered) })}</strong></p>
              <p className="kv-field__hint">{t.t('twin.tile.parcels.denominator')}</p>
              {o.parcels.unmapped > 0 && <p className="kv-field__hint">{t.t('twin.tile.parcels.unmapped', { n: fmt(o.parcels.unmapped) })}</p>}
              <p className="kv-field__hint">{o.parcels.asOf ? t.t('twin.asOf.at', { when: when(o.parcels.asOf, o.clock.zone) }) : t.t('twin.asOf.none')} · <code>land_parcels</code></p>
            </div>
            <div className="kv-card" role="listitem">
              <h2>{t.t('twin.tile.soil')}</h2>
              <p><strong>{t.t('twin.tile.soil.value', { n: fmt(o.soil.tests), parcels: fmt(o.soil.parcelsTested) })}</strong></p>
              <p className="kv-field__hint">{o.soil.latestSampledOn ? t.t('twin.tile.soil.latest', { day: o.soil.latestSampledOn }) : t.t('twin.tile.soil.none')} · <code>soil_tests</code></p>
            </div>
            <div className="kv-card" role="listitem">
              <h2>{t.t('twin.tile.seasons')}</h2>
              <p><strong>{t.t('twin.tile.seasons.value', { open: fmt(o.seasons.open), harvested: fmt(o.seasons.harvested) })}</strong></p>
              <p className="kv-field__hint">{o.seasons.lastClosed
                ? t.t('twin.tile.seasons.last', { season: t.t(seasonKey(o.seasons.lastClosed.season)), year: String(o.seasons.lastClosed.year), status: t.t(`twin.seasonStatus.${o.seasons.lastClosed.status === 'harvested' ? 'harvested' : 'abandoned'}`) })
                : t.t('twin.tile.seasons.none')} · <code>crop_seasons</code></p>
            </div>
            <div className="kv-card" role="listitem">
              <h2>{t.t('twin.tile.devices')}</h2>
              <p><strong>{t.t('twin.tile.devices.value', { pods: fmt(o.devices.soilPods), masts: fmt(o.devices.weatherMasts) })}</strong></p>
              <p className="kv-field__hint">{t.t('twin.tile.devices.readings')}</p>
              <p className="kv-field__hint"><code>twin_devices</code> · {t.t('twin.tile.devices.registryOnly')}</p>
            </div>
            <div className="kv-card" role="listitem">
              <h2>{t.t('twin.tile.mandi')}</h2>
              {o.mandi.platformRows > 0
                ? <p><strong>{t.t('twin.tile.mandi.platform', { rows: fmt(o.mandi.platformRows), day: o.mandi.platformAsOf ?? '' })}</strong></p>
                : <p><strong>{t.t('twin.tile.mandi.noPlatform')}</strong></p>}
              <p className="kv-field__hint">{o.mandi.tenantObservations > 0 ? t.t('twin.tile.mandi.tenant', { n: fmt(o.mandi.tenantObservations), day: o.mandi.tenantAsOf ?? '' }) : t.t('twin.tile.mandi.tenantNone')}</p>
            </div>
            <div className="kv-card" role="listitem">
              <h2>{t.t('twin.tile.weather')}</h2>
              <p><strong>{o.weather.forecast.live ? t.t('twin.tile.weather.live', { provider: o.weather.forecast.provider ?? '' }) : t.t('twin.tile.weather.noProvider')}</strong></p>
              <p className="kv-field__hint">{o.weather.alerts.recent > 0 ? t.t('twin.tile.weather.alerts', { n: fmt(o.weather.alerts.recent), when: when(o.weather.alerts.lastIngestedAt, o.clock.zone) }) : t.t('twin.tile.weather.noIngestion')}</p>
            </div>
            <div className="kv-card" role="listitem">
              <h2>{t.t('twin.tile.herd')}</h2>
              <p><strong>{t.t('twin.tile.herd.notLinked')}</strong></p>
              <p className="kv-field__hint">{t.t('twin.byName.herdSync')}</p>
            </div>
          </div>

          <div className="kv-card">
            <h2>{t.t('twin.feeds.title')}</h2>
            <table className="kv-table">
              <caption className="kv-sr-only">{t.t('twin.feeds.title')}</caption>
              <thead><tr><th scope="col">{t.t('twin.feeds.col.feed')}</th><th scope="col">{t.t('twin.feeds.col.state')}</th><th scope="col">{t.t('twin.feeds.col.asOf')}</th><th scope="col">{t.t('twin.feeds.col.source')}</th></tr></thead>
              <tbody>{o.feeds.map((f) => { const l = feedLine(f, fmt); return (
                <tr key={f.code}>
                  <th scope="row">{t.t(feedNameKey(f.code))}</th>
                  <td>{t.t(l.key, l.vars)}</td>
                  <td>{t.t(asOfKey(f), { when: f.asOf ? (f.asOf.length === 10 ? f.asOf : when(f.asOf, o!.clock.zone)) : '' })}</td>
                  <td><code>{f.sourceTables.join(' · ')}</code></td>
                </tr>
              ); })}</tbody>
            </table>
            <p className="kv-field__hint">{t.t('twin.feeds.law')}</p>
            {o.parcels.unmapped > 0 && <p className="kv-card kv-card--notice" role="note">{t.t('twin.feeds.unmapped', { n: fmt(o.parcels.unmapped) })}</p>}
          </div>

          <div className="kv-card" role="note">
            <p><em>{t.t('twin.quote.feeds')}</em></p>
            <p>{t.t('twin.model.none')}</p>
            <h2>{t.t('twin.byName.heading')}</h2>
            <ul className="kv-list">{TWIN_REFUSED_BY_NAME.map((r) => <li key={r}>{t.t(byNameKey(r))}</li>)}</ul>
          </div>
        </>
      )}
    </section>
  );
}
