// apps/web-tenant/src/app/logistics/overview/page.tsx · W225 (Logistics) — the desk an FPO opens every morning
// (PC-56 TENANT-5d). Server-first, requireSession-gated, noindex. A pure READ: this screen decides nothing, which is
// why it has no confirm chain of its own (the canon's W2387–W2389 "Retry" is a page load — see the insights page).
//
// **THIS SCREEN'S NAV ENTRY POINTED AT NOTHING.** W225 is the canon's own "Overview" — the first entry of the
// sub-nav printed on every logistics screen — and 5b shipped that nav with `overview` marked unbuilt because there
// was no read model behind it. It is built now, and it is the one screen in this module that is mostly about which
// of the canon's promises are TRUE.
//
// WHAT THIS PAGE SAYS THAT W225 CANNOT:
//   • **"On-time delivery (30d) 95.1%" is not computable.** Nothing on this platform promises a delivery time — no
//     promised-by column on a shipment, no SLA on a delivery zone, none in a charge definition — so "on time" is a
//     ratio with no denominator. What IS measured takes its place: the first-attempt rate (which counts something
//     only because 5a made `delivery_attempts` real) and the median pickup→delivery transit, with its coverage;
//   • **"Transit loss (90d) ₹84,200" is not recorded, and neither is the wastage it claims 45% of.** No damage
//     record, no shortfall record, no weighbridge (5a established there is none anywhere). The nearest signal is a
//     buyer dispute reasoned "damaged in transit" — a claims figure in another module's plane, which this desk may
//     not reach into;
//   • **the philosophy block is checked against the software.** Three ticks in the canon; here, three states. The
//     pickup half of "OTP at pickup AND delivery" exists only behind 5a's flag, so with it off the platform proves
//     ONE end of a handover and the screen says `delivery_only`. The weighbridge is marked absent, because it is.
//     The Village Run has routes (5b) and no consolidation record, so it is partial;
//   • and **no ETA anywhere.** W225's reefer row prints "ETA 17:30"; there is no routing engine, no traffic feed and
//     no route geometry on this platform, and an ETA is the one number here a farmer would plan an afternoon around.
//     The row carries the live temperature, which is real, and the breach count, which is what makes it urgent.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { LogisticsOverview } from '@krishalaya/sdk-js';
import {
  attentionHref, attentionKey, attentionTone, consolidationKey, costPerQtlKmKey, daysAwayKey, deskState,
  deskStateKey, insightsHref, mechanismKey, mechanismMark, mechanismTone, missingKey, onTimeKey, rateKey, rateText,
  transitHoursText, transitKey, transitLossKey, transitPartial, wastageShareKey,
} from '../../../features/logistics/desk';
import { LOGISTICS_NAV, navLabelKey, unbuiltCount } from '../../../features/logistics/nav';
import { DEFAULT_WINDOW } from '../../../features/logistics/desk';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('logistics.overview.title'), robots: { index: false, follow: false } };
}

const TONE: Record<'bad' | 'warn' | 'ok' | 'muted', string> = {
  bad: 'kv-badge kv-badge--danger', warn: 'kv-badge kv-badge--warn', ok: 'kv-badge', muted: 'kv-badge kv-badge--muted',
};

export default async function LogisticsOverviewPage() {
  await requireSession('/logistics/overview');
  const t = getTranslator();
  const lang = getLang();

  let ov: LogisticsOverview | null = null;
  let state = 'ok' as ReturnType<typeof deskState>;
  try {
    ov = await tenantClient().logisticsDesk.overview();
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = deskState(err?.code ?? 'generic', err?.status);
  }

  return (
    <section>
      <h1>{t.t('logistics.overview.title')}</h1>

      <nav className="kv-tabs" aria-label={t.t('logistics.nav.label')}>
        {LOGISTICS_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'overview' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'overview' ? 'page' : undefined}>
            {t.t(navLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(navLabelKey(i))}</span>
        )))}
      </nav>
      <p className="kv-field__hint">{t.t('logistics.nav.unbuilt')} {formatNumber(unbuiltCount(), lang)}</p>

      {state !== 'ok' || !ov ? (
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(deskStateKey(state, 'overview'))}</p>
          {state === 'error' && <p><Link href="/logistics/overview" className="kv-btn--link">{t.t('logistics.retry')}</Link></p>}
          {/* W225's own error copy: the desk being down changes nothing about the trucks. */}
          {state === 'error' && <p className="kv-field__hint">{t.t('logistics.overview.keepsMoving')}</p>}
        </div>
      ) : (
        <>
          {/* ---- the lead line: three counted facts, and the claim that is refused ---- */}
          <p>
            <strong>{formatNumber(ov.activeShipments, lang)}</strong> {t.t('logistics.lead.active')}
            {' · '}<strong>{formatNumber(ov.pickupsToday, lang)}</strong> {t.t('logistics.lead.pickupsToday')}
            {ov.nextRun && (
              <> {' · '}{ov.nextRun.routeName}{' '}
                {t.t(daysAwayKey(ov.nextRun.daysAway))}
                {ov.nextRun.daysAway !== null && ov.nextRun.daysAway > 1 ? ` ${formatNumber(ov.nextRun.daysAway, lang)}` : ''}
              </>
            )}
          </p>
          <p className="kv-field__hint">{t.t(wastageShareKey())}</p>

          {/* ---- the tiles ---- */}
          <div className="kv-stats">
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('logistics.tile.active')}</span>
              <strong className="kv-stat__value">{formatNumber(ov.activeShipments, lang)}</strong>
              <span className="kv-field__hint">{formatNumber(ov.attention.length, lang)} {t.t('logistics.tile.needAttention')}</span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('logistics.tile.firstAttempt')}</span>
              <strong className="kv-stat__value">{rateText(ov.firstAttempt) ?? t.t('common.dash')}</strong>
              <span className="kv-field__hint">
                {t.t(rateKey(ov.firstAttempt))}
                {ov.firstAttempt.kind === 'measured' && ` (${formatNumber(ov.firstAttempt.of, lang)})`}
              </span>
              {/* The tile the canon drew, and why it is not here. */}
              <span className="kv-field__hint">
                {t.t(onTimeKey(ov.onTime))}{' '}
                {ov.onTime.missing.map((m) => t.t(missingKey(m))).join(', ')}
              </span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('logistics.tile.transit')}</span>
              <strong className="kv-stat__value">
                {transitHoursText(ov.transit) ? `${transitHoursText(ov.transit)} ${t.t('logistics.hours')}` : t.t('common.dash')}
              </strong>
              <span className="kv-field__hint">{t.t(transitKey(ov.transit))}</span>
              {transitPartial(ov.transit) && (
                <span className="kv-field__hint">
                  {t.t('logistics.transit.partial')} {formatNumber(ov.transit.missingPickupStamp, lang)}
                </span>
              )}
              <span className="kv-field__hint">
                {t.t(transitLossKey(ov.transitLoss))}{' '}
                {ov.transitLoss.missing.map((m) => t.t(missingKey(m))).join(', ')}
              </span>
            </div>

            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('logistics.tile.coldChain')}</span>
              <strong className="kv-stat__value">{formatNumber(ov.coldChain.breaches7d, lang)}</strong>
              <span className="kv-field__hint">
                {t.t('logistics.tile.breaches7d')} · {formatNumber(ov.coldChain.liveReeferShipments, lang)} {t.t('logistics.tile.liveReefers')}
              </span>
            </div>
          </div>

          {/* ---- "Needs you today" ---- */}
          <h2>{t.t('logistics.attention.heading')}</h2>
          {ov.attention.length === 0 ? (
            <p className="kv-empty-state">{t.t('logistics.attention.none')}</p>
          ) : (
            <ul>
              {ov.attention.map((i) => {
                const href = attentionHref(i);
                const key = i.kind === 'village_run' ? `run-${i.routeId}` : `${i.kind}-${i.shipmentId}`;
                return (
                  <li key={key}>
                    <span className={TONE[attentionTone(i)]}>{t.t(attentionKey(i))}</span>{' '}
                    {i.kind === 'village_run' ? (
                      <>
                        {i.routeName}
                        {i.dayKey && <> · {t.t(i.dayKey)}</>}
                        {' · '}{t.t(daysAwayKey(i.daysAway))}
                        {i.daysAway !== null && i.daysAway > 1 ? ` ${formatNumber(i.daysAway, lang)}` : ''}
                        {consolidationKey(i) && <> · <span className="kv-field__hint">{t.t(consolidationKey(i)!)}</span></>}
                      </>
                    ) : i.kind === 'cold_chain_live' ? (
                      <>
                        {i.lastTempC !== null ? `${i.lastTempC}°C` : t.t('logistics.coldChain.noReading')}
                        {i.lastAt && <> · {formatDate(i.lastAt, lang, { dateStyle: 'short', timeStyle: 'short' })}</>}
                        {i.breaches > 0 && <> · {formatNumber(i.breaches, lang)} {t.t('logistics.coldChain.breachesWord')}</>}
                        {/* No ETA: 5a refused it platform-wide, and this row is where the canon printed one. */}
                        <> · <span className="kv-field__hint">{t.t('logistics.coldChain.noEta')}</span></>
                      </>
                    ) : (
                      <>
                        {formatDate(i.at, lang, { dateStyle: 'short', timeStyle: 'short' })}
                        {i.kind === 'pickup_no_driver' && (
                          <> · {t.t(i.hasVehicle ? 'logistics.pickup.vehicleNoDriver' : 'logistics.pickup.nothingAssigned')}</>
                        )}
                      </>
                    )}
                    {href && <> · <Link href={href} className="kv-link">{t.t('logistics.attention.open')}</Link></>}
                  </li>
                );
              })}
            </ul>
          )}

          {/* ---- the philosophy block, checked ---- */}
          <div className="kv-card">
            <h2>{t.t('logistics.mech.heading')}</h2>
            <ul>
              {ov.mechanisms.map((m) => (
                <li key={m.key}>
                  <span className={TONE[mechanismTone(m) === 'ok' ? 'ok' : mechanismTone(m) === 'warn' ? 'warn' : 'muted']}>
                    {mechanismMark(m)}
                  </span>{' '}
                  {t.t(mechanismKey(m))}
                </li>
              ))}
            </ul>
            <p className="kv-field__hint">{t.t('logistics.mech.checked')}</p>
          </div>

          <p className="kv-toolbar">
            <Link href={insightsHref(DEFAULT_WINDOW)} className="kv-btn">{t.t('logistics.overview.toInsights')}</Link>{' '}
            <Link href="/logistics" className="kv-btn--link">{t.t('logistics.overview.toShipments')}</Link>
          </p>
          <p className="kv-field__hint">
            {t.t(costPerQtlKmKey({ kind: 'not_computable', missing: [] }))}{' '}
            <Link href={insightsHref(DEFAULT_WINDOW)} className="kv-link">{t.t('logistics.overview.seeInsights')}</Link>
          </p>
        </>
      )}
    </section>
  );
}
