// apps/web-admin/src/app/billing/invoices/page.tsx · SaaS-invoice list. Server component: requireAdmin gates,
// adminGet hits GET /v1/billing/invoices (status filter + keyset). Money via formatMoneyMinor. Degrade-never-die.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import {
  INVOICE_STATUSES, invoiceStatusKey, invoiceChipCounts, invoiceTotalCount, invoiceSavedViews, invoiceListHref,
  type InvoiceRow, type RevenueOverview,
} from '../../../features/billing/billing';
import { BULK_ACTIONS, MAX_BULK_INVOICES, bulkAppliesTo } from '../../../features/billing/reporting';
import { bulkInvoiceAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.invoicesTitle'), robots: { index: false, follow: false } };
}

const STATUS_CLASS: Record<string, string> = { draft: 'kv-status--muted', issued: '', partially_paid: 'kv-status--warn', overdue: 'kv-status--danger', paid: 'kv-status--ok', void: 'kv-status--muted' };

const BULK_ERR = new Set(['bulk_action', 'bulk_empty', 'bulk_tooMany', 'bulk_reason', 'bulk_noneApplicable',
  'elevation', 'notFound', 'generic']);

export default async function InvoicesPage({ searchParams }: {
  searchParams: {
    cursor?: string; status?: string; tenantId?: string; ok?: string; error?: string;
    moved?: string; skipped?: string; illegal?: string; notfound?: string; failed?: string;
  };
}) {
  requireAdmin();
  const t = getTranslator();
  const status = (INVOICE_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;

  let rows: InvoiceRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<InvoiceRow[]>('billing/invoices', {
      cursor: searchParams.cursor, status, tenantId: searchParams.tenantId, limit: 50,
    });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  // PC-56 ADMIN-1c (canon W012): the chip counts. These come from the revenue rollup — the same numbers the billing
  // dashboard shows — and NOT from counting the current page, which would say "overdue 12" while meaning "12 of the
  // 50 rows you can see". The read degrades independently: with no rollup the chips simply carry no numbers, which is
  // honest, whereas a zero would say "there are none" and send someone away.
  let counts: Record<string, number> | null = null;
  try { counts = (await adminGet<RevenueOverview>('billing/revenue')).data?.invoiceStatusCounts ?? null; }
  catch { counts = null; }
  const chips = invoiceChipCounts(counts);
  const total = invoiceTotalCount(counts);

  // The table is rendered inline rather than through <DataTable> because every row now carries a selection
  // checkbox whose value encodes `<id>:<status>` — the bulk bar needs that, and a generic column renderer cannot
  // express a form control that belongs to the surrounding <form>.

  const tenantId = searchParams.tenantId;

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('billing.invoicesTitle')}</h1>

      {/* The batch outcome, stated per category. "42 of 50 succeeded" without saying which eight forces somebody to
          re-check all fifty, so every number is here — including the rows the console skipped before submitting. */}
      {searchParams.ok === 'bulk' && (
        <p className={Number(searchParams.illegal ?? 0) + Number(searchParams.failed ?? 0) + Number(searchParams.notfound ?? 0) > 0 ? 'kv-notice' : 'kv-success'}
          role="status">
          {t.t('bulk.outcome', { moved: searchParams.moved ?? '0' })}
          {Number(searchParams.skipped ?? 0) > 0 ? ` · ${t.t('bulk.skippedLocally', { n: searchParams.skipped ?? '0' })}` : ''}
          {Number(searchParams.illegal ?? 0) > 0 ? ` · ${t.t('bulk.illegal', { n: searchParams.illegal ?? '0' })}` : ''}
          {Number(searchParams.notfound ?? 0) > 0 ? ` · ${t.t('bulk.notFound', { n: searchParams.notfound ?? '0' })}` : ''}
          {Number(searchParams.failed ?? 0) > 0 ? ` · ${t.t('bulk.failed', { n: searchParams.failed ?? '0' })}` : ''}
        </p>
      )}
      {searchParams.error && BULK_ERR.has(searchParams.error) && (
        <p className="kv-error" role="alert">{t.t(`bulk.error.${searchParams.error}`)}</p>
      )}
      {/* This list is reachable filtered to ONE tenant (the tenant tab strip links here that way), so it says so —
          otherwise an operator reads a filtered book as the whole platform's. */}
      {tenantId && (
        <p className="kv-notice" role="note">
          {t.t('billing.filteredToTenant')} <code>{tenantId.slice(0, 8)}</code>{' '}
          <Link href={invoiceListHref({ status })} className="kv-btn--link">{t.t('billing.clearTenantFilter')}</Link>
        </p>
      )}

      <nav className="kv-filters" aria-label={t.t('billing.filterLabel')}>
        <Link href={invoiceListHref({ tenantId })} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>
          {t.t('billing.filterAll')}{total !== undefined ? ` ${total.toLocaleString()}` : ''}
        </Link>
        {chips.map((c) => (
          <Link key={c.status} href={invoiceListHref({ status: c.status, tenantId })}
            className={`kv-chip${status === c.status ? ' is-active' : ''}`} aria-current={status === c.status ? 'true' : undefined}>
            {t.t(`billing.status.${c.status}`)}{c.n !== undefined ? ` ${c.n.toLocaleString()}` : ''}
          </Link>
        ))}
      </nav>
      {/* The canon's saved views, as bookmarkable links. "Needs chasing" points at the collection queue rather than
          faking a due-date filter this endpoint does not have. */}
      <p className="kv-detail__muted">
        {invoiceSavedViews().map((v) => (
          <Link key={v.key} href={v.href} className="kv-btn--link">{t.t(`billing.view.${v.key}`)}{' '}</Link>
        ))}
      </p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {/* THE BULK BAR (ADMIN-1-Q11). One server call per batch, one audit row per invoice plus one for the batch —
              never a browser loop, which would leave half a batch applied with no record that a batch was attempted.
              The checkbox VALUE carries `<id>:<status>` so the action can drop rows the action cannot touch and report
              how many, without a second read. */}
          <form action={bulkInvoiceAction} className="kv-form">
            <input type="hidden" name="listStatus" value={status ?? ''} />
            <table className="kv-table">
              <thead><tr>
                <th scope="col"><span className="kv-visually-hidden">{t.t('bulk.select')}</span></th>
                <th scope="col">{t.t('billing.invoiceNo')}</th>
                <th scope="col">{t.t('billing.invStatus')}</th>
                <th scope="col">{t.t('billing.total')}</th>
                <th scope="col">{t.t('billing.dunningAttempts')}</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5}>{t.t('billing.noInvoices')}</td></tr>
                ) : rows.map((r) => {
                  const st = invoiceStatusKey(r.status);
                  return (
                    <tr key={r.id}>
                      <td>
                        <label className="kv-visually-hidden" htmlFor={`sel-${r.id}`}>{t.t('bulk.select')}</label>
                        <input id={`sel-${r.id}`} type="checkbox" name="selected" value={`${r.id}:${st}`} />
                      </td>
                      <td><Link href={`/billing/invoices/${r.id}`}>{r.invoiceNo}</Link></td>
                      <td><span className={`kv-status ${STATUS_CLASS[st] ?? ''}`}>{t.t(`billing.status.${st}`)}</span></td>
                      <td>{formatMoneyMinor(r.totalMinor, r.currency)}</td>
                      <td>{r.dunningAttempts.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {rows.length > 0 && (
              <details className="kv-card kv-limit-form">
                <summary className="kv-card__title">{t.t('bulk.title')}</summary>
                <p className="kv-field__hint">{t.t('bulk.hint', { max: String(MAX_BULK_INVOICES) })}</p>
                <label htmlFor="bulk-action" className="kv-field__label">{t.t('bulk.action')}</label>
                <select id="bulk-action" name="action" className="kv-input" defaultValue="mark_overdue">
                  {BULK_ACTIONS.map((a) => <option key={a} value={a}>{t.t(`bulk.act.${a}`)}</option>)}
                </select>
                {/* what each action can touch, so a selection can be corrected before it becomes an audit row */}
                <p className="kv-field__hint">
                  {BULK_ACTIONS.map((a) => `${t.t(`bulk.act.${a}`)}: ${INVOICE_STATUSES.filter((s2) => bulkAppliesTo(a, s2)).map((s2) => t.t(`billing.status.${s2}`)).join(', ')}`).join(' · ')}
                </p>
                <label htmlFor="bulk-reason" className="kv-field__label">{t.t('billing.reason')}</label>
                <input id="bulk-reason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
                <p className="kv-field__hint">{t.t('bulk.reasonHint')}</p>
                <button type="submit" className="kv-btn kv-btn--danger">{t.t('bulk.submit')}</button>
              </details>
            )}
          </form>
          {/* the tenant filter travels with the cursor too — the same bug class as the tenant directory's pager */}
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={invoiceListHref({ status, tenantId, cursor: nextCursor })}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
