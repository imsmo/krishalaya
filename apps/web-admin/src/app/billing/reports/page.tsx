// apps/web-admin/src/app/billing/reports/page.tsx · billing reporting + audit-stamped exports (PC-56 ADMIN-1d,
// canon W016 + the export chain W1892-93 — closes ADMIN-1-Q3 and ADMIN-1-Q7, and ADMIN-1-Q4 as visibility).
//
// THREE PANELS, EACH LABELLED WITH WHAT IT ACTUALLY IS:
//   1. BILLED PER MONTH — invoices issued and what has been received against them. The canon calls this "MRR movement";
//      it is NOT MRR, because MRR month-over-month needs subscription history and the platform keeps one current
//      subscription row per tenant. Invoices are dated facts, so invoices are what the chart is made of, and the
//      heading says "billed". A chart whose label disagrees with its contents is worse than a plainer chart.
//   2. PLAN MIX — live subscriptions per plan, annual normalised to monthly by integer division (the same arithmetic
//      the MRR rollup uses).
//   3. COHORT RETENTION — tenants per signup quarter still holding a live subscription. The canon says "net revenue by
//      signup quarter"; revenue retention swings 12× on one annual invoice on a young book, so this counts TENANTS and
//      the axis says so.
//
// THE EXPORT IS A POST that writes an audit RECEIPT before any row is handed over (the W054-10 receipt law). The
// receipt id is shown and goes into the filename, so a saved CSV can be traced back to who produced it with which
// filters. Truncation is stated: a partial file that looks complete is how a reconciliation quietly goes wrong.
//
// The renewal panel is READ-ONLY BY DESIGN. The billing cycle is the worker job in apps/api; a second generator here
// would risk double-billing, so this page previews and never triggers.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { bpsToPercent } from '../../../features/reports/report';
import { Button, Callout, EmptyState } from '@krishalaya/ui';
import {
  EXPORT_REPORTS, needsPeriod, collectionRateBps, seriesTotal, seriesMax, barPct, retentionBps,
  overduePeriods, type MonthPoint, type CohortPoint, type RenewalDueRow,
} from '../../../features/billing/reporting';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rep.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['exp_report', 'exp_from', 'exp_to', 'exp_order', 'exp_period', 'elevation', 'notFound', 'generic']);

interface SeriesView {
  currency: string; billedByMonth: MonthPoint[];
  planMix: Array<{ planId: string; planCode: string; subscriptions: number; monthlyMinor: string }>;
  cohortRetention: CohortPoint[];
}
interface RenewalView {
  through: string; dueCount: number; billableCount: number; alreadyInvoicedCount: number;
  totalsByCurrency: Array<{ currency: string; amountMinor: string }>;
  due: RenewalDueRow[]; recentActivity: Array<{ day: string; invoicesIssued: number }>;
}

export default async function BillingReportsPage({ searchParams }: {
  searchParams: { error?: string; receipt?: string; rows?: string; truncated?: string; report?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let series: SeriesView | null = null; let notice: string | undefined;
  try { series = (await adminGet<SeriesView>('billing/series', { currency: 'INR', months: 12, quarters: 8 })).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  // Independent degrade: the renewal panel failing must not blank the charts, and vice versa.
  let renewal: RenewalView | null = null;
  try { renewal = (await adminGet<RenewalView>('billing/renewal-preview', { limit: 100, days: 14 })).data ?? null; }
  catch { renewal = null; }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cur = series?.currency ?? 'INR';
  const months = series?.billedByMonth ?? [];
  const maxIssued = seriesMax(months, 'issuedMinor');
  const issuedTotal = seriesTotal(months, 'issuedMinor');
  const paidTotal = seriesTotal(months, 'paidMinor');
  const nowIso = new Date().toISOString();

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('rep.title')}</h1>

      {errKey && <p className="kv-error" role="alert">{t.t(`rep.error.${errKey}`)}</p>}

      {/* The export receipt, echoed back after a download. The id is the provenance — it is in the audit ledger and in
          the filename, so months later the file can be tied to the person and the filters that produced it. */}
      {searchParams.receipt && (
        <p className="kv-success" role="status">
          {t.t('rep.exported', { rows: searchParams.rows ?? '0', receipt: searchParams.receipt.slice(0, 8) })}
          {searchParams.truncated === '1' && <> <strong>{t.t('rep.truncated')}</strong></>}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {/* ---- 1. BILLED PER MONTH (not MRR — see the header) ---- */}
          <h2>{t.t('rep.billedTitle')}</h2>
          <p className="kv-field__hint">{t.t('rep.billedHint')}</p>
          {months.length === 0 ? <EmptyState title={t.t('rep.noMonths')} /> : (
            <>
              <table className="kv-table">
                <thead><tr>
                  <th scope="col">{t.t('rep.month')}</th>
                  <th scope="col">{t.t('rep.invoices')}</th>
                  <th scope="col">{t.t('rep.issued')}</th>
                  <th scope="col">{t.t('rep.received')}</th>
                  <th scope="col">{t.t('rep.collected')}</th>
                </tr></thead>
                <tbody>
                  {months.map((m) => {
                    const rate = collectionRateBps(m);
                    return (
                      <tr key={m.month}>
                        <td>{m.month}</td>
                        <td>{String(m.invoices ?? 0)}</td>
                        <td>
                          {formatMoneyMinor(String(m.issuedMinor ?? '0'), cur)}
                          {/* a CSS-free bar: a width percentage that can never be NaN */}
                          <span className="kv-bar" style={{ width: `${barPct(m.issuedMinor, maxIssued)}%` }} aria-hidden="true" />
                        </td>
                        <td>{formatMoneyMinor(String(m.paidMinor ?? '0'), cur)}</td>
                        {/* a month with nothing issued has NO collection rate — 0% would blame the platform */}
                        <td>{rate === null ? t.t('rep.noRate') : `${bpsToPercent(rate)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="kv-detail__muted">
                {t.t('rep.seriesTotals', {
                  issued: formatMoneyMinor(issuedTotal.totalMinor.toString(), cur),
                  received: formatMoneyMinor(paidTotal.totalMinor.toString(), cur),
                  months: String(issuedTotal.counted),
                })}
                {issuedTotal.skipped > 0 && <> <strong>{t.t('rep.seriesSkipped', { n: String(issuedTotal.skipped) })}</strong></>}
              </p>
            </>
          )}

          {/* ---- 2. PLAN MIX ---- */}
          <h2>{t.t('rep.mixTitle')}</h2>
          {(series?.planMix ?? []).length === 0 ? <EmptyState title={t.t('rep.noMix')} /> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('rep.plan')}</th>
                <th scope="col">{t.t('rep.subscriptions')}</th>
                <th scope="col">{t.t('rep.monthlyValue')}</th>
              </tr></thead>
              <tbody>
                {(series?.planMix ?? []).map((p) => (
                  <tr key={p.planId}>
                    <td><Link href={`/plans/${encodeURIComponent(p.planId)}`}>{p.planCode}</Link></td>
                    <td>{p.subscriptions.toLocaleString()}</td>
                    <td>{formatMoneyMinor(p.monthlyMinor, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="kv-field__hint">{t.t('rep.mixHint')}</p>

          {/* ---- 3. COHORT RETENTION (tenants, not revenue) ---- */}
          <h2>{t.t('rep.cohortTitle')}</h2>
          <p className="kv-field__hint">{t.t('rep.cohortHint')}</p>
          {(series?.cohortRetention ?? []).length === 0 ? <EmptyState title={t.t('rep.noCohorts')} /> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('rep.cohort')}</th>
                <th scope="col">{t.t('rep.signedUp')}</th>
                <th scope="col">{t.t('rep.stillBilling')}</th>
                <th scope="col">{t.t('rep.retained')}</th>
              </tr></thead>
              <tbody>
                {(series?.cohortRetention ?? []).map((c) => {
                  const bps = retentionBps(c);
                  return (
                    <tr key={c.cohort}>
                      <td>{c.cohort}</td>
                      <td>{String(c.tenants ?? 0)}</td>
                      <td>{String(c.stillBilling ?? 0)}</td>
                      <td>{bps === null ? t.t('rep.noRate') : `${bpsToPercent(bps)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* ---- The renewal run: what it WOULD bill, and what it has been doing ---- */}
      <h2>{t.t('rep.renewalTitle')}</h2>
      <p className="kv-field__hint">{t.t('rep.renewalHint')}</p>
      {!renewal ? <EmptyState title={t.t('rep.renewalUnavailable')} /> : (
        <>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('rep.renewalDue')}</dt><dd>{renewal.dueCount}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('rep.renewalBillable')}</dt><dd>{renewal.billableCount}</dd></div>
            {/* the idempotent skips, said out loud so the headline is not read as "this many will be billed" */}
            <div className="kv-facts__row"><dt>{t.t('rep.renewalSkipped')}</dt><dd>{renewal.alreadyInvoicedCount}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('rep.renewalValue')}</dt><dd>
              {renewal.totalsByCurrency.length === 0 ? t.t('common.dash')
                : renewal.totalsByCurrency.map((x) => formatMoneyMinor(x.amountMinor, x.currency)).join(' · ')}
            </dd></div>
          </dl>
          {/* periods already past that the run has not picked up — usually the sign the worker is not running */}
          {overduePeriods(renewal.due, nowIso) > 0 && (
            <p className="kv-error" role="alert">{t.t('rep.renewalStale', { n: String(overduePeriods(renewal.due, nowIso)) })}</p>
          )}
          {renewal.recentActivity.length > 0 && (
            <p className="kv-detail__muted">
              {t.t('rep.renewalActivity')}: {renewal.recentActivity.map((a) => `${a.day} (${a.invoicesIssued})`).join(' · ')}
            </p>
          )}
          <Callout>{t.t('rep.renewalNoTrigger')}</Callout>
        </>
      )}

      {/* ---- The audit-stamped export ---- */}
      <h2>{t.t('rep.exportTitle')}</h2>
      <p className="kv-field__hint">{t.t('rep.exportHint')}</p>
      {/* A GET form to the sibling route handler: a Server Action cannot return a file. The handler POSTs to the API
          (which writes the receipt) and streams the CSV back. Only ever reached by SUBMISSION, so Next's prefetcher
          never triggers the write. */}
      <form method="get" action="/billing/reports/export" className="kv-form">
        <label htmlFor="exp-report" className="kv-field__label">{t.t('rep.exportReport')}</label>
        <select id="exp-report" name="report" className="kv-input" defaultValue="invoices">
          {EXPORT_REPORTS.map((r) => (
            <option key={r} value={r}>
              {t.t(`rep.report.${r}`)}{needsPeriod(r) ? ` — ${t.t('rep.periodRequired')}` : ''}
            </option>
          ))}
        </select>
        <label htmlFor="exp-from" className="kv-field__label">{t.t('rep.from')}</label>
        <input id="exp-from" name="from" className="kv-input" type="date" />
        <label htmlFor="exp-to" className="kv-field__label">{t.t('rep.to')}</label>
        <input id="exp-to" name="to" className="kv-input" type="date" />
        <label htmlFor="exp-limit" className="kv-field__label">{t.t('rep.rowLimit')}</label>
        <input id="exp-limit" name="limit" className="kv-input" inputMode="numeric" defaultValue="1000" />
        <p className="kv-field__hint">{t.t('rep.limitHint')}</p>
        <Button type="submit">{t.t('rep.exportSubmit')}</Button>
      </form>
      <p className="kv-field__hint">{t.t('rep.receiptNote')}</p>
    </section>
  );
}
