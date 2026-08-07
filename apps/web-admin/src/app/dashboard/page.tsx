// apps/web-admin/src/app/dashboard/page.tsx · W001 (PC-56 ADMIN-10).
//
// **THIS PAGE HAD NO NUMBERS ON IT.** Until this wave it was twenty-six lines — a title, a lead paragraph, and one card
// linking to `/ai-models`. W001 promises GMV today, active tenants, orders per minute, payout success, a 14-day GMV
// trend, an alert stack and the tenant lifecycle band; and `platform-reports` has computed MRR, ARR, lifecycle counts,
// GMV, platform take and active users since PC-54. Nine waves of this programme built deep planes behind a front door
// with nothing on it.
//
// THREE OF W001'S FIGURES DO NOT EXIST AND ARE RENDERED AS ABSENT RATHER THAN APPROXIMATED:
//   • the per-minute PEAK (no minute-granularity history — ADMIN-10-Q2),
//   • the payout RETRY count (`payouts` has no attempt column at all — ADMIN-10-Q5),
//   • the week-over-week change in ACTIVE tenants (`tenants.status` is current-state and nothing snapshots it; the
//     new-tenant count is a different figure and saying otherwise would be the defect this programme keeps finding).
//
// AND THE REVENUE BLOCK IS GATED SEPARATELY, which is why the whole screen is not. W001's restricted state describes an
// operator who sees the dashboard and not the money — a 403 for the page would make that state unreachable.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import {
  alertStackClass, alertStackKey, bpsToPercent, deltaClass, deltaKey, figureClass, figureKey, freshnessClass,
  freshnessKey, hasValue, isStreamBacked, revenueStateKey,
  type Delta, type Figure, type Freshness,
} from '../../features/reports/dashboard';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dashboard.title'), robots: { index: false, follow: false } };
}

interface Dashboard {
  asOf: Freshness;
  currency: string;
  headline: {
    gmvToday: Figure & { delta: Delta };
    activeTenants: Figure & { delta: Delta };
    ordersPerMinute: Figure & { windowMinutes: number; peak: Figure };
    payoutSuccess: Figure & {
      windowHours: number;
      counts: { succeeded: number; failed: number; pending: number; reversed: number; cancelled: number };
      retries: Figure;
    };
  };
  revenue: { mrrMinor: string; arrMinor: string; activeSubscriptions: number; gate: string } | null;
  lifecycle: { byStatus: Record<string, number>; total: number; activeTotal: number; basisNote: string };
  trend: { metric: string; bucket: string; days: number; series: { bucket: string; value: string }[] };
  commerce: { avgOrderValueMinor: string; ordersLastHour: number };
}
interface Meta { revenueVisible: boolean; revenueGate: string }
interface Alerts {
  items: { kind: string; text: string; href: string }[];
  unavailable: { alert: string; reason: string }[];
}

const rupees = (minor: string) => `₹${(Number(BigInt(minor) / 100n)).toLocaleString('en-IN')}`;

export default async function AdminDashboard() {
  requireAdmin();
  const t = getTranslator();

  let d: Dashboard | null = null; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<Dashboard>('reports/dashboard');
    d = res.data ?? null; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rp.restricted.dashboard' : 'rp.error.dashboard';
  }

  let alerts: Alerts | null = null;
  // Its own read, so a failure costs the alert stack and not the figures — and the stack's own empty state distinguishes
  // "nothing is wrong" from "we are not checking".
  try { alerts = (await adminGet<Alerts>('reports/dashboard/alerts')).data ?? null; } catch { alerts = null; }

  const tile = (label: string, f: Figure, extra?: React.ReactNode) => (
    <div className={figureClass(f)}>
      <dt>{t.t(label)}</dt>
      <dd>
        {hasValue(f) ? f.value : t.t(figureKey(f))}
        {f.note ? <><br /><small>{f.note}</small></> : null}
        {extra}
      </dd>
    </div>
  );

  return (
    <section>
      <h1>{t.t('dashboard.title')}</h1>
      <p className="kv-muted">{t.t('dashboard.lead')}</p>

      {notice ? <p className="kv-error" role="alert">{t.t(notice)}</p> : null}

      {d ? (
        <>
          {/* WHEN THESE NUMBERS WERE TRUE. A screen that prints a figure without saying when is a screen an operator
              reads at 18:20 and believes about 18:20. */}
          <p className={freshnessClass(d.asOf)}>
            {t.t(freshnessKey(d.asOf), {
              at: (d.asOf.asOf ?? '').slice(11, 16),
              reason: d.asOf.reason ?? '',
            })}
          </p>

          <dl className="kv-stat-row">
            {tile('rp.tile.gmvToday', { ...d.headline.gmvToday, value: hasValue(d.headline.gmvToday) ? rupees(d.headline.gmvToday.value!) : null },
              <><br /><span className={deltaClass(d.headline.gmvToday.delta)}>
                {t.t(deltaKey(d.headline.gmvToday.delta), {
                  pct: d.headline.gmvToday.delta.bps ? bpsToPercent(d.headline.gmvToday.delta.bps) : '0',
                  window: d.headline.gmvToday.delta.comparedWith,
                  reason: d.headline.gmvToday.delta.unavailableReason ?? '',
                })}
              </span></>)}

            {tile('rp.tile.activeTenants', d.headline.activeTenants,
              <><br /><span className={deltaClass(d.headline.activeTenants.delta)}>
                {/* THE DELTA W001 SHOWS AND THIS PLATFORM CANNOT COMPUTE — with the reason on the tile. */}
                {t.t(deltaKey(d.headline.activeTenants.delta), {
                  pct: '0', window: d.headline.activeTenants.delta.comparedWith,
                  reason: d.headline.activeTenants.delta.unavailableReason ?? '',
                })}
              </span></>)}

            {tile('rp.tile.ordersPerMinute', d.headline.ordersPerMinute,
              <>
                <br /><small>{t.t('rp.tile.overLastMinutes', { n: String(d.headline.ordersPerMinute.windowMinutes) })}</small>
                <br /><small className="is-muted">{t.t('rp.tile.peakUnavailable', { reason: d.headline.ordersPerMinute.peak.note ?? '' })}</small>
              </>)}

            {tile('rp.tile.payoutSuccess',
              { ...d.headline.payoutSuccess, value: hasValue(d.headline.payoutSuccess) ? `${bpsToPercent(Number(d.headline.payoutSuccess.value))}%` : null },
              <>
                <br /><small>{t.t('rp.tile.payoutCounts', {
                  ok: String(d.headline.payoutSuccess.counts.succeeded),
                  failed: String(d.headline.payoutSuccess.counts.failed),
                  pending: String(d.headline.payoutSuccess.counts.pending),
                  reversed: String(d.headline.payoutSuccess.counts.reversed),
                })}</small>
                <br /><small className="is-muted">{t.t('rp.tile.retriesUnavailable')}</small>
              </>)}
          </dl>

          {/* THE MONEY, GATED ON ITS OWN PERMISSION. */}
          <section className="kv-panel" aria-labelledby="rp-rev">
            <h2 id="rp-rev" className="kv-panel__title">{t.t('rp.revenue.title')}</h2>
            {d.revenue ? (
              <dl className="kv-stat-row">
                <div><dt>{t.t('rp.revenue.mrr')}</dt><dd>{rupees(d.revenue.mrrMinor)}</dd></div>
                <div><dt>{t.t('rp.revenue.arr')}</dt><dd>{rupees(d.revenue.arrMinor)}</dd></div>
                <div><dt>{t.t('rp.revenue.subs')}</dt><dd>{d.revenue.activeSubscriptions}</dd></div>
              </dl>
            ) : (
              // W001's restricted copy, made reachable: the screen works and the money is withheld, with the grant named.
              <p className="kv-note is-warn">{t.t(revenueStateKey(false), { perm: meta?.revenueGate ?? 'metrics.revenue.read' })}</p>
            )}
          </section>

          {/* THE ALERT STACK — and its empty state is the important one. */}
          <section className="kv-panel" aria-labelledby="rp-alerts">
            <h2 id="rp-alerts" className="kv-panel__title">{t.t('rp.alerts.title')}</h2>
            <p className={alertStackClass(alerts?.items.length ?? 0, alerts?.unavailable.length ?? 0)}>
              {t.t(alertStackKey(alerts?.items.length ?? 0, alerts?.unavailable.length ?? 0))}
            </p>
            {alerts?.items.map((a) => (
              <p key={a.text} className="kv-note is-danger">{a.text} <Link href={a.href}>{t.t('common.open')}</Link></p>
            ))}
            {alerts?.unavailable.length ? (
              <ul className="kv-list">
                {alerts.unavailable.map((u) => (
                  <li key={u.alert}><strong>{u.alert}</strong> — <small>{u.reason}</small></li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* THE LIFECYCLE BAND. W001 labels it "(live)"; it is a point-in-time count and says so. */}
          <section className="kv-panel" aria-labelledby="rp-life">
            <h2 id="rp-life" className="kv-panel__title">{t.t('rp.lifecycle.title')}</h2>
            <dl className="kv-stat-row">
              {Object.entries(d.lifecycle.byStatus).map(([status, n]) => (
                <div key={status}><dt>{status}</dt><dd>{n.toLocaleString('en-IN')}</dd></div>
              ))}
              <div><dt>{t.t('rp.lifecycle.total')}</dt><dd>{d.lifecycle.total.toLocaleString('en-IN')}</dd></div>
            </dl>
            <p className="kv-note">{isStreamBacked() ? t.t('rp.lifecycle.live') : t.t('rp.lifecycle.pointInTime')}</p>
          </section>

          {/* THE 14-DAY TREND, with its buckets labelled — W001's chart has no x-axis at all, and a chart whose axis is
              undated is a chart nobody can check. */}
          <section className="kv-panel" aria-labelledby="rp-trend">
            <h2 id="rp-trend" className="kv-panel__title">{t.t('rp.trend.title', { days: String(d.trend.days) })}</h2>
            {d.trend.series.length === 0 ? (
              <p className="kv-note">{t.t('rp.trend.empty')}</p>
            ) : (
              <table className="kv-table">
                <caption className="kv-table__caption">{t.t('rp.trend.caption')}</caption>
                <thead><tr><th scope="col">{t.t('rp.trend.day')}</th><th scope="col">{t.t('rp.trend.gmv')}</th></tr></thead>
                <tbody>
                  {d.trend.series.map((p) => (
                    <tr key={p.bucket}><td>{p.bucket}</td><td>{rupees(p.value)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <nav className="kv-filters" aria-label={t.t('rp.nav.label')}>
            <Link href="/analytics/reports" className="kv-chip">{t.t('rp.nav.builder')}</Link>
            <Link href="/analytics/exports" className="kv-chip">{t.t('rp.nav.exports')}</Link>
            <Link href="/tenants" className="kv-chip">{t.t('rp.nav.tenants')}</Link>
            <Link href="/recon" className="kv-chip">{t.t('rp.nav.recon')}</Link>
            <Link href="/support" className="kv-chip">{t.t('rp.nav.support')}</Link>
          </nav>
        </>
      ) : null}
    </section>
  );
}
