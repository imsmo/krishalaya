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
import {
  INVOICE_STATUSES, invoiceStatusKey, invoiceChipCounts, invoiceTotalCount, invoiceSavedViews, invoiceListHref,
  type InvoiceRow, type RevenueOverview,
} from '../../../features/billing/billing';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.invoicesTitle'), robots: { index: false, follow: false } };
}

const STATUS_CLASS: Record<string, string> = { draft: 'kv-status--muted', issued: '', partially_paid: 'kv-status--warn', overdue: 'kv-status--danger', paid: 'kv-status--ok', void: 'kv-status--muted' };

export default async function InvoicesPage({ searchParams }: {
  searchParams: { cursor?: string; status?: string; tenantId?: string };
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

  const cols: Column<InvoiceRow>[] = [
    { header: t.t('billing.invoiceNo'), cell: (r) => <Link href={`/billing/invoices/${r.id}`}>{r.invoiceNo}</Link> },
    { header: t.t('billing.invStatus'), cell: (r) => { const s = invoiceStatusKey(r.status); return <span className={`kv-status ${STATUS_CLASS[s] ?? ''}`}>{t.t(`billing.status.${s}`)}</span>; } },
    { header: t.t('billing.total'), cell: (r) => formatMoneyMinor(r.totalMinor, r.currency) },
    { header: t.t('billing.dunningAttempts'), cell: (r) => r.dunningAttempts.toLocaleString() },
  ];
  const tenantId = searchParams.tenantId;

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('billing.invoicesTitle')}</h1>
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
          <DataTable columns={cols} rows={rows} empty={t.t('billing.noInvoices')} />
          {/* the tenant filter travels with the cursor too — the same bug class as the tenant directory's pager */}
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={invoiceListHref({ status, tenantId, cursor: nextCursor })}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
