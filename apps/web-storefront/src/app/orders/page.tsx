// apps/web-storefront/src/app/orders/page.tsx · the buyer's order history. PROTECTED + dynamic (requireSession →
// anon to /login?next=/orders). Reads the caller's orders as BUYER via the authed SDK (the API + RLS scope to the
// owner — never another user's orders), keyset-paged through the shared accessible DataTable. Money via
// formatMoneyMinor; dates via formatDate. Degrades to an empty/error state, never 500 (Law 12).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { OrderListItem } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { DataTable, type Column } from '../../components/DataTable';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('order.listTitle'), robots: { index: false, follow: false } };
}

export default async function OrdersPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession('/orders');
  const t = getTranslator();
  const lang = getLang();

  let items: OrderListItem[] = [];
  let nextCursor: string | null = null;
  let failed = false;
  try {
    const page = await serverClient().orders.list({ role: 'buyer', cursor: searchParams.cursor, limit: 20 });
    items = page.items; nextCursor = page.nextCursor;
  } catch { failed = true; }

  if (failed) {
    return <section className="kv-orders"><h1>{t.t('order.listTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('order.loadError')}</p></section>;
  }

  const statusLabel = (s: string) => {
    const k = `order.status.${s.toLowerCase()}`;
    const label = t.t(k);
    return label === k ? s : label; // fall back to the raw status if we have no localized label
  };

  const columns: Column<OrderListItem>[] = [
    { key: 'orderNo', header: t.t('order.colOrderNo'), render: (o) => <Link href={`/orders/${encodeURIComponent(o.id)}`} className="kv-link">{o.orderNo}</Link> },
    { key: 'status', header: t.t('order.colStatus'), render: (o) => statusLabel(o.status) },
    { key: 'counterparty', header: t.t('order.colSeller'), render: (o) => o.counterparty ?? '—' },
    { key: 'total', header: t.t('order.colTotal'), align: 'right', render: (o) => formatMoneyMinor(o.totalMinor, 'INR', lang) },
    { key: 'createdAt', header: t.t('order.colDate'), render: (o) => (o.createdAt ? formatDate(o.createdAt, lang) : '—') },
  ];

  return (
    <section className="kv-orders">
      <h1>{t.t('order.listTitle')}</h1>
      <DataTable
        columns={columns}
        rows={items}
        getRowKey={(o) => o.id}
        caption={t.t('order.listCaption')}
        emptyText={t.t('order.empty')}
        nextHref={nextCursor ? `/orders?cursor=${encodeURIComponent(nextCursor)}` : undefined}
        nextLabel={t.t('discover.nextPage')}
      />
    </section>
  );
}
