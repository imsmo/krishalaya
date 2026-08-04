// apps/web-admin/src/app/billing/invoices/page.tsx · SaaS-invoice list. Server component: requireAdmin gates,
// adminGet hits GET /v1/billing/invoices (status filter + keyset). Money via formatMoneyMinor. Degrade-never-die.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { INVOICE_STATUSES, invoiceStatusKey, type InvoiceRow } from '../../../features/billing/billing';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.invoicesTitle'), robots: { index: false, follow: false } };
}

const STATUS_CLASS: Record<string, string> = { draft: 'kv-status--muted', issued: '', partially_paid: 'kv-status--warn', overdue: 'kv-status--danger', paid: 'kv-status--ok', void: 'kv-status--muted' };

export default async function InvoicesPage({ searchParams }: { searchParams: { cursor?: string; status?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = (INVOICE_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;

  let rows: InvoiceRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<InvoiceRow[]>('billing/invoices', { cursor: searchParams.cursor, status, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<InvoiceRow>[] = [
    { header: t.t('billing.invoiceNo'), cell: (r) => <Link href={`/billing/invoices/${r.id}`}>{r.invoiceNo}</Link> },
    { header: t.t('billing.invStatus'), cell: (r) => { const s = invoiceStatusKey(r.status); return <span className={`kv-status ${STATUS_CLASS[s] ?? ''}`}>{t.t(`billing.status.${s}`)}</span>; } },
    { header: t.t('billing.total'), cell: (r) => formatMoneyMinor(r.totalMinor, r.currency) },
    { header: t.t('billing.dunningAttempts'), cell: (r) => r.dunningAttempts.toLocaleString() },
  ];
  const filterHref = (s?: string) => `/billing/invoices${s ? `?status=${encodeURIComponent(s)}` : ''}`;

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('billing.invoicesTitle')}</h1>
      <nav className="kv-filters" aria-label={t.t('billing.filterLabel')}>
        <Link href={filterHref()} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('billing.filterAll')}</Link>
        {INVOICE_STATUSES.map((s) => (
          <Link key={s} href={filterHref(s)} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined}>{t.t(`billing.status.${s}`)}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('billing.noInvoices')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={`/billing/invoices?cursor=${encodeURIComponent(nextCursor)}${status ? `&status=${status}` : ''}`}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
