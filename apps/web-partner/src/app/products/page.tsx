// apps/web-partner/src/app/products/page.tsx · the lender's loan-product catalogue (GET fintech/loan-products).
// Read-only; server-gated; the API scopes to this partner's context. activeOnly toggle + optional ?partnerId filter
// mirror the controller (no keyset — the API returns a filtered list). Money via formatMoneyMinor; APR is integer
// basis points rendered float-free. Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { formatAprBps, parseActiveOnly, type ProductRow } from '../../features/lending/product';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('prod.title'), robots: { index: false, follow: false } };
}

export default async function ProductsPage({ searchParams }: { searchParams: { active?: string; partnerId?: string } }) {
  await requirePartner();
  const t = getTranslator();
  const activeOnly = parseActiveOnly(searchParams.active);
  const partnerId = (searchParams.partnerId ?? '').trim() || undefined;

  let rows: ProductRow[] = [];
  let notice: string | undefined;
  try {
    rows = (await partnerClient().request<ProductRow[]>('GET', 'fintech/loan-products', { query: { activeOnly, partnerId } })).data ?? [];
  } catch { notice = t.t('dash.unavailable'); }

  const columns: Column<ProductRow>[] = [
    { header: t.t('prod.colName'), cell: (r) => <Link href={`/products/${r.id}`}>{r.name}</Link> },
    { header: t.t('prod.colApr'), cell: (r) => formatAprBps(r.interestAprBps) ?? t.t('common.dash') },
    { header: t.t('prod.colAmount'), cell: (r) => `${formatMoneyMinor(r.minAmountMinor, r.currencyCode, 'en')} – ${formatMoneyMinor(r.maxAmountMinor, r.currencyCode, 'en')}` },
    { header: t.t('prod.colActive'), cell: (r) => <span className={`kv-status kv-status--${r.isActive ? 'ok' : 'muted'}`}>{t.t(r.isActive ? 'common.active' : 'common.inactive')}</span> },
  ];
  const base = (active: boolean) => `/products?active=${active}${partnerId ? `&partnerId=${encodeURIComponent(partnerId)}` : ''}`;

  return (
    <section>
      <h1>{t.t('prod.title')}</h1>
      <p className="kv-muted">{t.t('prod.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('common.filter')}>
        <Link href={base(true)} className={`kv-chip${activeOnly ? ' is-active' : ''}`} aria-current={activeOnly ? 'true' : undefined}>{t.t('prod.filterActive')}</Link>
        <Link href={base(false)} className={`kv-chip${!activeOnly ? ' is-active' : ''}`} aria-current={!activeOnly ? 'true' : undefined}>{t.t('prod.filterAll')}</Link>
      </nav>
      {notice ? <p className="kv-error" role="alert">{notice}</p> : <DataTable columns={columns} rows={rows} empty={t.t('prod.empty')} />}
    </section>
  );
}
