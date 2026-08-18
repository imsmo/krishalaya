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
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import { Callout, Chip, EmptyState } from '@krishalaya/ui';
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

// DEV-56 Part 5 — the front door had its own money bug and its own fix: this page hardcoded
// `` `₹${Number(BigInt(minor)/100n).toLocaleString('en-IN')}` `` in a local `rupees()` helper — a BigInt→Number cast
// that loses precision past 2^53 (this platform's own GMV target), a hardcoded ₹, and a hardcoded 2-decimal
// assumption, all on the platform owner's first screen. `Dashboard.currency` was already present in the API
// response and simply never read. Replaced every call with the canonical `formatMoneyMinor` (`@krishalaya/i18n`),
// passed the REAL `d.currency` from the response instead of assuming INR, and deleted the local helper entirely.
export default async function AdminDashboard() {
  requireAdmin();
  const t = getTranslator();

  let d: Dashboard | null = null; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<Dashboard>('reports/dashboard');
    d = res.data ?? null; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rp.restricted.dashboard' : 'rp.error.dashboard';
    // [DEV-57 2026-08-12 FIX] This catch used to turn EVERY failure — a 500 from a genuine SQL bug, a timeout, a
    // network blip — into the same opaque `rp.error.dashboard` sentence with nothing else recorded anywhere, which is
    // exactly why a `column "deleted_at" does not exist` 500 took a full debugging session to actually see (the
    // browser only ever showed "The dashboard could not be loaded."). The browser copy is unchanged (Law: never leak
    // internals to the client) — this only logs SERVER-SIDE, in the Next.js server component's own process, so an
    // operator with terminal/log access can see the upstream status/code/message/requestId without admin-api ever
    // exposing them over the wire. `console.error` because no server-side logging convention exists anywhere in this
    // app yet (grep-verified: zero prior `console.error`/`console.warn` calls under `apps/web-admin/src`) — this is
    // the first one, not a divergence from an established pattern.
    if (e instanceof AdminApiError) {
      // eslint-disable-next-line no-console
      console.error(`[dashboard] reports/dashboard failed: status=${e.status} code=${e.code} requestId=${e.requestId ?? 'none'} message=${e.message}`);
    } else {
      // eslint-disable-next-line no-console
      console.error('[dashboard] reports/dashboard failed with a non-API error:', e);
    }
  }

  let alerts: Alerts | null = null;
  // Its own read, so a failure costs the alert stack and not the figures — and the stack's own empty state distinguishes
  // "nothing is wrong" from "we are not checking".
  try {
    alerts = (await adminGet<Alerts>('reports/dashboard/alerts')).data ?? null;
  } catch (e) {
    // [DEV-57 2026-08-12 FIX] This previously swallowed EVERY failure with a bare `catch { alerts = null; }` — no
    // notice, no log, nothing: the alert stack would silently degrade and the only visible trace was the operator
    // reading `rp.alerts.clear` on a page where alerts genuinely could not be checked. Logged server-side for the
    // same reason and under the same constraint as the dashboard fetch above (never surfaced to the browser).
    alerts = null;
    if (e instanceof AdminApiError) {
      // eslint-disable-next-line no-console
      console.error(`[dashboard] reports/dashboard/alerts failed: status=${e.status} code=${e.code} requestId=${e.requestId ?? 'none'} message=${e.message}`);
    } else {
      // eslint-disable-next-line no-console
      console.error('[dashboard] reports/dashboard/alerts failed with a non-API error:', e);
    }
  }

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
            {tile('rp.tile.gmvToday', { ...d.headline.gmvToday, value: hasValue(d.headline.gmvToday) ? formatMoneyMinor(d.headline.gmvToday.value!, d.currency) : null },
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
                <div><dt>{t.t('rp.revenue.mrr')}</dt><dd>{formatMoneyMinor(d.revenue.mrrMinor, d.currency)}</dd></div>
                <div><dt>{t.t('rp.revenue.arr')}</dt><dd>{formatMoneyMinor(d.revenue.arrMinor, d.currency)}</dd></div>
                <div><dt>{t.t('rp.revenue.subs')}</dt><dd>{d.revenue.activeSubscriptions}</dd></div>
              </dl>
            ) : (
              // W001's restricted copy, made reachable: the screen works and the money is withheld, with the grant named.
              <Callout tone="warning">{t.t(revenueStateKey(false), { perm: meta?.revenueGate ?? 'metrics.revenue.read' })}</Callout>
            )}
          </section>

          {/* THE ALERT STACK — and its empty state is the important one. */}
          <section className="kv-panel" aria-labelledby="rp-alerts">
            <h2 id="rp-alerts" className="kv-panel__title">{t.t('rp.alerts.title')}</h2>
            <p className={alertStackClass(alerts?.items.length ?? 0, alerts?.unavailable.length ?? 0)}>
              {t.t(alertStackKey(alerts?.items.length ?? 0, alerts?.unavailable.length ?? 0))}
            </p>
            {alerts?.items.map((a) => (
              <Callout key={a.text} tone="danger">{a.text} <Link href={a.href}>{t.t('common.open')}</Link></Callout>
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
            <Callout tone="info">{isStreamBacked() ? t.t('rp.lifecycle.live') : t.t('rp.lifecycle.pointInTime')}</Callout>
          </section>

          {/* THE 14-DAY TREND, with its buckets labelled — W001's chart has no x-axis at all, and a chart whose axis is
              undated is a chart nobody can check. */}
          <section className="kv-panel" aria-labelledby="rp-trend">
            <h2 id="rp-trend" className="kv-panel__title">{t.t('rp.trend.title', { days: String(d.trend.days) })}</h2>
            {d.trend.series.length === 0 ? (
              <EmptyState variant="empty" title={t.t('rp.trend.empty')} />
            ) : (
              <table className="kv-table">
                <caption className="kv-table__caption">{t.t('rp.trend.caption')}</caption>
                <thead><tr><th scope="col">{t.t('rp.trend.day')}</th><th scope="col">{t.t('rp.trend.gmv')}</th></tr></thead>
                <tbody>
                  {d.trend.series.map((p) => (
                    <tr key={p.bucket}><td>{p.bucket}</td><td>{formatMoneyMinor(p.value, d.currency)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <nav className="kv-filters" aria-label={t.t('rp.nav.label')}>
            <Chip as={Link} href="/analytics/reports">{t.t('rp.nav.builder')}</Chip>
            <Chip as={Link} href="/analytics/exports">{t.t('rp.nav.exports')}</Chip>
            <Chip as={Link} href="/tenants">{t.t('rp.nav.tenants')}</Chip>
            <Chip as={Link} href="/recon">{t.t('rp.nav.recon')}</Chip>
            <Chip as={Link} href="/support">{t.t('rp.nav.support')}</Chip>
          </nav>
        </>
      ) : null}
    </section>
  );
}
