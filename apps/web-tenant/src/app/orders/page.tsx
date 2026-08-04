// apps/web-tenant/src/app/orders/page.tsx · the tenant's orders as SELLER (authed, tenant-scoped by the API
// token). Uses the typed SDK resource orders.list({ role: 'seller' }) — no request() escape hatch. Keyset "next
// page" (never OFFSET). Money via formatMoneyMinor from the bigint-string; dates via formatDate. All copy via
// i18n; degrades to an empty/error state (Law 12); noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { OrderListItem } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('orders.title'), robots: { index: false, follow: false } };
}

export default async function OrdersPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession('/orders');
  const t = getTranslator();
  const lang = getLang();
  let items: OrderListItem[] = []; let nextCursor: string | null = null; let failed = false;
  try { const p = await tenantClient().orders.list({ role: 'seller', cursor: searchParams.cursor, limit: 50 }); items = p.items; nextCursor = p.nextCursor; }
  catch { failed = true; }

  return (
    <section>
      <h1>{t.t('orders.title')}</h1>
      {failed ? <p className="kv-error" role="alert">{t.t('orders.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t('orders.empty')}
          columns={[
            { header: t.t('orders.colOrder'), cell: (o) => <Link href={`/orders/${o.id}`} className="kv-link">{o.orderNo}</Link> },
            { header: t.t('orders.colStatus'), cell: (o) => <span className="kv-badge">{o.status}</span> },
            { header: t.t('orders.colCounterparty'), cell: (o) => o.counterparty ?? t.t('common.dash') },
            { header: t.t('orders.colTotal'), cell: (o) => formatMoneyMinor(o.totalMinor, 'INR', lang) },
            { header: t.t('orders.colDate'), cell: (o) => (o.createdAt ? formatDate(o.createdAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/orders?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
