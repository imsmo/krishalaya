// apps/web-tenant/src/app/logistics/insights/page.tsx · W244 (Logistics insights) — "the numbers that decide next
// quarter's routes and rates" (PC-56 TENANT-5d). Server-first, requireSession-gated, noindex. A pure read.
//
// The canon's own framing is what makes this screen dangerous: an FPO sets next quarter's freight RATES from it. So
// the discipline here is stricter than anywhere else in this module — every figure either carries its basis and its
// coverage, or is refused with its missing inputs named:
//
//   • **"Cost per qtl-km ₹2.14 ▼ 9%" cannot be computed at all.** `shipments.distance_km` has been dead since 0007
//     (nothing writes it, nothing reads it, it is not even in the repository's column list — 0154's COMMENT records
//     it), `shipments` has NO weight column, and nothing writes `shipments.charge_minor` (5c). Three missing inputs
//     for one tile;
//   • **"Busiest lane · 31% of qtl-km" is a share of SHIPMENTS here**, and labelled as such, because with no distance
//     and no weight a qtl-km share cannot exist. A share of the wrong denominator printed with the right unit is how
//     a truck gets committed to a daily run;
//   • **the failure-reason chart had no source until this wave.** `markFailed(reason)` put the reason in an outbox
//     payload, and the only writer of a status hop into `shipment_events` passed `note = NULL` — so W244's five bars
//     and the call-ahead pilot resting on them were drawn over a column that did not exist. 0154 adds the coded
//     reason; every attempt recorded before it is reported as `unclassified` and never distributed across the bars;
//   • **"Freight recovered (recon, Q) ₹11,840" is real** — 5c built exactly that, and it arrives per currency,
//     because summing minor units across currencies is a lie no format function can fix;
//   • and the export is SYNCHRONOUS and bounded, because no export producer exists on this platform (W2385/W2386
//     promise a queue position, a checksum and a signed URL; `data_export_jobs` is admin/DPDP-only and no worker
//     generates a file).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { LogisticsInsights } from '@krishalaya/sdk-js';
import {
  DECISIONS, INSIGHT_WINDOWS, callAheadKey, costPerQtlKmKey, decisionKey, decisionSupported, deskState,
  deskStateKey, exportHref, exportNoticeKey, historyBlocks, historyKey, insightsHref, laneBasisKey,
  laneCandidateKey, laneName, missingKey, rateKey, rateText, reasonKey, reasonName, shareText, transitHoursText,
  transitKey, transitLossKey, unclassifiedKey, windowOf,
} from '../../../features/logistics/desk';
import { LOGISTICS_NAV, navLabelKey } from '../../../features/logistics/nav';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('logistics.insights.title'), robots: { index: false, follow: false } };
}

export default async function LogisticsInsightsPage({ searchParams }: { searchParams: { window?: string; error?: string } }) {
  await requireSession('/logistics/insights');
  const t = getTranslator();
  const lang = getLang();
  const window = windowOf(searchParams.window);

  let ins: LogisticsInsights | null = null;
  let state = 'ok' as ReturnType<typeof deskState>;
  try {
    ins = await tenantClient().logisticsDesk.insights({ window });
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = deskState(err?.code ?? 'generic', err?.status);
  }

  const hasCandidate = !!ins?.lanes.lanes.some((l) => l.candidate);
  // The export route sends failures back HERE with the API's own code, so the reason is stated in the operator's
  // language on a page that can say which of the three states it is in — never as an English string inside a
  // downloaded file that looks like data.
  const exportErrorKey = searchParams.error ? deskStateKey(deskState(searchParams.error), 'insights') : null;

  return (
    <section>
      <h1>{t.t('logistics.insights.title')}</h1>
      <p className="kv-field__hint">{t.t('logistics.insights.lead')}</p>

      {exportErrorKey && (
        <p className="kv-error" role="alert">{t.t('logistics.export.failed')} {t.t(exportErrorKey)}</p>
      )}

      <nav className="kv-tabs" aria-label={t.t('logistics.nav.label')}>
        {LOGISTICS_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'insights' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'insights' ? 'page' : undefined}>{t.t(navLabelKey(i))}</Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(navLabelKey(i))}</span>
        )))}
      </nav>

      {state !== 'ok' || !ins ? (
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(deskStateKey(state, 'insights'))}</p>
          {state === 'error' && (
            <>
              {/* W244's own error copy: "Operational screens unaffected." */}
              <p className="kv-field__hint">{t.t('logistics.insights.opsUnaffected')}</p>
              <p><Link href={insightsHref(window)} className="kv-btn--link">{t.t('logistics.retry')}</Link></p>
            </>
          )}
        </div>
      ) : (
        <>
          <nav className="kv-filters" aria-label={t.t('logistics.insights.windowLabel')}>
            {INSIGHT_WINDOWS.map((w) => (
              <Link key={w} href={insightsHref(w)} className={w === window ? 'kv-chip is-active' : 'kv-chip'} aria-current={w === window ? 'true' : undefined}>
                {formatNumber(w, lang)} {t.t('logistics.insights.days')}
              </Link>
            ))}
          </nav>
          <p className="kv-field__hint">
            {ins.windowFrom} – {ins.windowTo}
            {' · '}<a href={exportHref(window)} className="kv-btn--link">{t.t('logistics.insights.export')}</a>
            {' · '}{t.t(exportNoticeKey())}
          </p>

          {/* ---- W244's own "not enough history" state: not an error, and it must not read like one ---- */}
          {historyBlocks(ins.history) ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t(historyKey(ins.history))}</p>
              {ins.history.kind === 'not_enough_history' && (
                <p className="kv-field__hint">
                  {formatNumber(ins.history.days, lang)} / {formatNumber(ins.history.needDays, lang)} {t.t('logistics.insights.days')}
                </p>
              )}
              <p><Link href="/logistics" className="kv-btn--link">{t.t('logistics.overview.toShipments')}</Link></p>
            </div>
          ) : (
            <>
              {/* ---- the tiles ---- */}
              <div className="kv-stats">
                <div className="kv-stat">
                  <span className="kv-stat__label">{t.t('logistics.tile.firstAttempt')}</span>
                  <strong className="kv-stat__value">{rateText(ins.firstAttempt) ?? t.t('common.dash')}</strong>
                  <span className="kv-field__hint">
                    {t.t(rateKey(ins.firstAttempt))}
                    {ins.firstAttempt.kind === 'measured' && ` (${formatNumber(ins.firstAttempt.of, lang)})`}
                  </span>
                </div>

                <div className="kv-stat">
                  <span className="kv-stat__label">{t.t('logistics.tile.transit')}</span>
                  <strong className="kv-stat__value">
                    {transitHoursText(ins.transit) ? `${transitHoursText(ins.transit)} ${t.t('logistics.hours')}` : t.t('common.dash')}
                  </strong>
                  <span className="kv-field__hint">{t.t(transitKey(ins.transit))}</span>
                </div>

                {/* The canon's headline tile, and the three reasons it is empty. */}
                <div className="kv-stat">
                  <span className="kv-stat__label">{t.t('logistics.tile.costPerQtlKm')}</span>
                  <strong className="kv-stat__value">{t.t('common.dash')}</strong>
                  <span className="kv-field__hint">
                    {t.t(costPerQtlKmKey(ins.costPerQtlKm))}{' '}
                    {ins.costPerQtlKm.missing.map((m) => t.t(missingKey(m))).join(', ')}
                  </span>
                </div>

                <div className="kv-stat">
                  <span className="kv-stat__label">{t.t('logistics.tile.freightRecovered')}</span>
                  <strong className="kv-stat__value">
                    {ins.freightRecovered.length === 0
                      ? t.t('common.dash')
                      : ins.freightRecovered.map((r) => formatMoneyMinor(r.recoveredMinor, r.currencyCode, lang)).join(' · ')}
                  </strong>
                  <span className="kv-field__hint">{t.t('logistics.tile.freightRecoveredHow')}</span>
                </div>
              </div>

              {/* ---- the chart this wave gave a source ---- */}
              <h2>
                {t.t('logistics.failures.heading')} ({formatNumber(ins.failures.total, lang)} {t.t('logistics.failures.eventsWord')})
              </h2>
              {ins.failures.total === 0 ? (
                <p className="kv-empty-state">{t.t('logistics.failures.none')}</p>
              ) : (
                <>
                  <DataTable
                    rows={ins.failures.slices}
                    empty={t.t('logistics.failures.noCoded')}
                    columns={[
                      {
                        header: t.t('logistics.failures.colReason'),
                        // The tenant's OWN vocabulary name first (Law 6 — a tenant that added "ferry missed" sees it),
                        // then this console's translation, then the raw code rather than nothing.
                        cell: (s) => reasonName(ins!.reasonNames, s.code) ?? t.t(reasonKey(s.code)),
                      },
                      { header: t.t('logistics.failures.colEvents'), cell: (s) => formatNumber(s.events, lang) },
                      { header: t.t('logistics.failures.colShare'), cell: (s) => shareText(s.shareBps) },
                    ]}
                  />
                  {unclassifiedKey(ins.failures) && (
                    <p className={ins.failures.mostlyUnclassified ? 'kv-card kv-card--notice' : 'kv-field__hint'} role={ins.failures.mostlyUnclassified ? 'status' : undefined}>
                      {t.t(unclassifiedKey(ins.failures)!)} {formatNumber(ins.failures.unclassified, lang)}
                    </p>
                  )}
                  {callAheadKey(ins) && <p className="kv-field__hint">{t.t(callAheadKey(ins)!)}</p>}
                </>
              )}

              {/* ---- the lanes, measured in what we have ---- */}
              <h2>{t.t('logistics.lane.heading')}</h2>
              <DataTable
                rows={ins.lanes.lanes}
                empty={t.t('logistics.lane.none')}
                columns={[
                  { header: t.t('logistics.lane.colLane'), cell: (l) => laneName(l) },
                  { header: t.t('logistics.lane.colShipments'), cell: (l) => formatNumber(l.shipments, lang) },
                  {
                    header: t.t('logistics.lane.colShare'),
                    cell: (l) => (
                      <>
                        {shareText(l.shareBps)}
                        {laneCandidateKey(l) && <> <span className="kv-badge">{t.t(laneCandidateKey(l)!)}</span></>}
                      </>
                    ),
                  },
                ]}
              />
              {ins.lanes.lanes.length > 0 && (
                <p className="kv-field__hint">
                  {t.t(laneBasisKey(ins.lanes.basis))} · {formatNumber(ins.lanes.totalShipments, lang)}
                </p>
              )}

              {/* ---- "What the numbers decide" — and which of the three this platform can support ---- */}
              <div className="kv-card">
                <h2>{t.t('logistics.decide.heading')}</h2>
                <ol>
                  {DECISIONS.map((d) => (
                    <li key={d}>
                      {t.t(decisionKey(d))}
                      {!decisionSupported(d, { hasCandidate }) && (
                        <> <span className="kv-badge kv-badge--muted">{t.t(d === 'tarpStandard' ? 'logistics.decide.noMeasure' : 'logistics.decide.noCandidateYet')}</span></>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="kv-field__hint">
                  <Link href="/logistics/routes" className="kv-link">{t.t('logistics.decide.toRoutes')}</Link>
                  {' · '}{t.t(transitLossKey(ins.transitLoss))}
                </p>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
