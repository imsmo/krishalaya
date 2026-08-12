// apps/web-tenant/src/app/invoices/page.tsx · W151, the trade-invoice month view (PC-56 TENANT-3c-1).
// Server-first, requireSession-gated. Three KPI cards, a month picker, a keyset list, and the GSTR-1 export — every
// read degrades independently (Law 12), all copy via i18n, noindex.
//
// WHAT THIS PAGE REFUSES TO DRAW:
//   • the canon's "‹ 1 2 … 49 ›" pager and its rows-per-page select — a page number over a table that grows by a row
//     per order is a COUNT(*) per keystroke (the roster rule, fifth application);
//   • a ₹0 tax where none was recorded — a pre-0140 invoice's breakdown cannot be re-derived, and the cell says so;
//   • the current month in the export picker, because a return exported before the period closes changes after it is
//     filed (the API refuses it by name too).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { isGstPeriod, previousPeriods, taxCell, supplyKey, filableState, remainingMinor, isFullyCredited } from '../../features/invoices/console';
import { exportGstr1Action } from './actions';
import type { TradeInvoiceRow, InvoiceMonthKpis } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('inv.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['period', 'periodOpen', 'tooLarge', 'forbidden', 'generic']);

export default async function InvoicesPage({ searchParams }: { searchParams: { period?: string; cursor?: string; ok?: string; error?: string } }) {
  await requireSession('/invoices');
  const t = getTranslator();
  const lang = getLang();
  const now = new Date();
  const period = isGstPeriod(searchParams.period) ? searchParams.period : undefined;
  const canFinance = tenantHasPerm('report.view');

  let rows: TradeInvoiceRow[] = [];
  let kpis: InvoiceMonthKpis | null = null;
  let nextCursor: string | null = null;
  let failed = false;
  try {
    const page = await tenantClient().payments.invoices.list({ period, cursor: searchParams.cursor, limit: 25 });
    rows = page.items; kpis = page.kpis; nextCursor = page.nextCursor;
  } catch { failed = true; }

  const money = (minor: string | null | undefined) => (minor ? formatMoneyMinor(minor, 'INR', lang) : t.t('common.dash'));
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const periods = previousPeriods(now, 12);
  const href = (p?: string) => (p ? `/invoices?period=${p}` : '/invoices');

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('inv.title')}</h1>
        <Link href="/billing" className="kv-btn--link">{t.t('inv.saasLink')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('inv.sub')}</p>

      {!canFinance && <p className="kv-notice" role="note">{t.t('inv.needsFinance')}</p>}
      {searchParams.ok === 'exported' && <p className="kv-success" role="status">{t.t('inv.exportDone')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`inv.error.${errKey}`)}</p>}

      <div className="kv-kpis">
        <div className="kv-kpi">
          <span className="kv-kpi__label">{t.t('inv.kpiCount')}</span>
          <span className="kv-kpi__value">{kpis ? kpis.count : t.t('common.dash')}</span>
          <span className="kv-kpi__delta">{t.t('inv.kpiCountNote')}</span>
        </div>
        <div className="kv-kpi">
          <span className="kv-kpi__label">{t.t('inv.kpiTaxable')}</span>
          <span className="kv-kpi__value">{kpis ? money(kpis.taxableMinor) : t.t('common.dash')}</span>
          <span className="kv-kpi__delta">{t.t('inv.kpiTaxableNote')}</span>
        </div>
        <div className="kv-kpi">
          <span className="kv-kpi__label">{t.t('inv.kpiTax')}</span>
          <span className="kv-kpi__value">{kpis ? money(kpis.taxMinor) : t.t('common.dash')}</span>
          <span className="kv-kpi__delta">{t.t('inv.kpiTaxNote')}</span>
        </div>
      </div>

      {/* THE SUMS' OWN BASIS. Invoices with no recorded breakdown are NOT in the figures above, and saying so is the
          difference between a total and a total somebody can rely on. */}
      {kpis && kpis.withoutBreakdown > 0 && (
        <p className="kv-notice" role="note">{t.t('inv.withoutBreakdown', { n: String(kpis.withoutBreakdown) })}</p>
      )}
      {kpis && kpis.incompleteBasis > 0 && (
        <p className="kv-notice" role="note">{t.t('inv.incompleteBasis', { n: String(kpis.incompleteBasis) })}</p>
      )}

      <nav className="kv-tabs" aria-label={t.t('inv.periodFilter')}>
        <a href={href()} className={`kv-tab${!period ? ' kv-tab--active' : ''}`} aria-current={!period ? 'page' : undefined}>{t.t('inv.allMonths')}</a>
        {periods.slice(0, 6).map((p) => (
          <a key={p} href={href(p)} className={`kv-tab${p === period ? ' kv-tab--active' : ''}`} aria-current={p === period ? 'page' : undefined}>{p}</a>
        ))}
      </nav>

      {canFinance && (
        <form action={exportGstr1Action} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('inv.exportTitle')}</h2>
          <label className="kv-field__label" htmlFor="gstr1Period">{t.t('inv.exportPeriod')}</label>
          <select id="gstr1Period" name="period" className="kv-select" defaultValue={period ?? periods[0]}>
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('inv.exportHint')}</p>
          <button type="submit" className="kv-btn">{t.t('inv.exportCta')}</button>
        </form>
      )}

      {failed ? <p className="kv-error" role="alert">{t.t('inv.loadError')}</p> : (
        <DataTable
          rows={rows}
          empty={t.t('inv.empty')}
          columns={[
            { header: t.t('inv.colDate'), cell: (r) => formatDate(String(r.issuedAt ?? r.createdAt), lang) },
            { header: t.t('inv.colNo'), cell: (r) => <Link href={`/invoices/${r.id}`} className="kv-link kv-mono">{r.invoiceNo}</Link> },
            { header: t.t('inv.colOrder'), cell: (r) => <Link href={`/orders/${r.orderId}`} className="kv-link">{r.orderNo ?? r.orderId.slice(0, 8)}</Link> },
            {
              header: t.t('inv.colBuyerGstin'),
              cell: (r) => (r.buyerGstin
                ? <span className="kv-mono">{r.buyerGstin}</span>
                : <span className="kv-muted">{t.t('inv.gstinNotRecorded')}</span>),
            },
            { header: t.t('inv.colTotal'), cell: (r) => <>{money(r.totalMinor)}{isFullyCredited(r) ? <span className="kv-detail__muted"> {t.t('inv.fullyCredited')}</span> : BigInt(r.creditedMinor || '0') > 0n ? <span className="kv-detail__muted"> {t.t('inv.remaining', { amount: money(remainingMinor(r)) })}</span> : null}</>,
            },
            {
              header: t.t('inv.colTax'),
              cell: (r) => {
                const c = taxCell(r);
                // A NULL tax is not ₹0 — see features/invoices/console.ts. This is the cell that would otherwise
                // tell an accountant no tax was charged on a supply that carried some.
                return c.kind === 'not_recorded'
                  ? <span className="kv-muted">{t.t('inv.taxNotRecorded')}</span>
                  : <span>{money(c.minor)}</span>;
              },
            },
            {
              header: t.t('inv.colSupply'),
              cell: (r) => (
                <>
                  <span className="kv-badge">{t.t(`inv.supply.${supplyKey(r.supplyType)}`)}</span>
                  {filableState(r) !== 'filable' && (
                    <span className="kv-detail__muted"> {t.t(`inv.notFilable.${filableState(r)}`)}</span>
                  )}
                </>
              ),
            },
          ]}
        />
      )}

      {nextCursor && (
        <p className="kv-pager">
          <a href={`/invoices?${period ? `period=${period}&` : ''}cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a>
        </p>
      )}
      <p className="kv-field__hint kv-note">{t.t('inv.pagerNote')}</p>
    </section>
  );
}
