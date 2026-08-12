// apps/web-tenant/src/app/orders/page.tsx · W133, orders (PC-56 TENANT-3a over the DEV-18 seller list).
//
// TWO VIEWS, ONE PAGE, DECIDED BY THE REAL GRANT (the listings-console precedent): staff who may moderate orders
// (`dispute.resolve` — the permission the API's own scope=tenant rule already uses) get W133's WORKLIST: every
// party's orders folded into the canon's five working views over the 15-state machine, with real counts. Everyone
// else keeps the seller list this page always was. Display-side only — the API re-checks on every console read.
//
// THE FIVE VIEWS COME FROM ONE MAPPING (apps/api domain/order-money.ts) and the counts include `unmapped`: a
// status no tab claims is an order nobody works, so it is COUNTED and SAID rather than silently absent. Keyset
// pagination, no page numbers — the canon's "1 2 3 … 176" needs the COUNT(*) that takes a 4,459-row list down.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantHasPerm } from '../../lib/auth';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate, formatRelative } from '@krishalaya/i18n';
import { DataTable } from '../../components/DataTable';   // the local wrapper this page always used
import type { ConsoleOrderRow, OrderViewCounts, OrderListItem } from '@krishalaya/sdk-js';
import { ORDER_VIEW_TABS, isOrderViewTab, viewHref, acceptanceClock, orderStatusClass } from '../../features/orders/console';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('orders.title'), robots: { index: false, follow: false } };
}

export default async function OrdersPage({ searchParams }: { searchParams: { cursor?: string; view?: string } }) {
  await requireSession('/orders');
  const t = getTranslator();
  const lang = getLang();
  const isStaff = tenantHasPerm('dispute.resolve');

  // ---------- seller view (the path this page always had) ----------
  if (!isStaff) {
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

  // ---------- staff worklist (W133) ----------
  const tab = isOrderViewTab(searchParams.view) ? searchParams.view : 'all';
  let counts: OrderViewCounts | undefined; let rows: ConsoleOrderRow[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    const [c, l] = await Promise.all([
      tenantClient().orders.consoleViews(),
      tenantClient().orders.consoleList({ view: tab === 'all' ? undefined : tab, cursor: searchParams.cursor, limit: 50 }),
    ]);
    counts = c; rows = l.items; nextCursor = l.nextCursor;
  } catch { failed = true; }

  const now = new Date();

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('orders.title')}</h1>
        <p className="kv-muted">{t.t('oc.sub')}</p>
      </div>

      {failed && <p className="kv-error" role="alert">{t.t('oc.loadError')}</p>}

      {counts && (
        <>
          <nav className="kv-pager" aria-label={t.t('oc.tabsAria')}>
            {ORDER_VIEW_TABS.map((v) => (
              <Link key={v} href={viewHref(v)} className={`kv-btn--link${tab === v ? ' is-active' : ''}`}
                aria-current={tab === v ? 'page' : undefined}>
                {t.t(`oc.view.${v}` as never)} {v === 'all' ? counts.all : counts[v] ?? 0}
              </Link>
            ))}
          </nav>
          {/* An order in no tab is an order nobody works — counted, and said out loud. */}
          {counts.unmapped > 0 && <p className="kv-error" role="alert">{t.t('oc.unmapped', { n: String(counts.unmapped) })}</p>}
        </>
      )}

      {!failed && rows.length === 0 && <p className="kv-empty-state">{tab === 'all' ? t.t('oc.emptyNone') : t.t('oc.emptyTab')}</p>}

      {rows.length > 0 && (
        <table className="kv-table">
          <caption className="kv-visually-hidden">{t.t('orders.title')}</caption>
          <thead><tr>
            <th>{t.t('oc.col.updated')}</th><th>{t.t('oc.col.order')}</th><th>{t.t('oc.col.buyer')}</th>
            <th>{t.t('oc.col.seller')}</th><th>{t.t('oc.col.total')}</th><th>{t.t('oc.col.status')}</th>
          </tr></thead>
          <tbody>
            {rows.map((o) => {
              const clock = acceptanceClock(o.status, o.acceptanceDeadline, now);
              return (
                <tr key={o.id}>
                  <td>{formatRelative(o.updatedAt, lang)}</td>
                  <td>
                    <Link href={`/orders/${encodeURIComponent(o.id)}`} className="kv-link">{o.orderNo}</Link>
                    {o.itemSummary && <span className="kv-fine"> · {o.itemSummary}</span>}
                  </td>
                  <td>{o.buyerName ?? t.t('common.dash')}</td>
                  <td>{o.sellerName ?? t.t('common.dash')}</td>
                  <td>{formatMoneyMinor(o.totalMinor, o.currencyCode, lang)}</td>
                  <td>
                    <span className={orderStatusClass(o.status)}>{o.status}</span>
                    {clock?.kind === 'live' && <span className="kv-fine"> · {t.t('oc.acceptIn', { m: String(clock.minutesLeft) })}</span>}
                    {clock?.kind === 'expired' && <span className="kv-fine"> · {t.t('oc.acceptExpired')}</span>}
                    {o.disputeId && <> <Link href={`/disputes/${encodeURIComponent(o.disputeId)}`} className="kv-link">{t.t('oc.respondDispute')}</Link></>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <nav className="kv-pager" aria-label={t.t('oc.pager')}>
        {searchParams.cursor && <Link href={viewHref(tab)} className="kv-btn--link">{t.t('oc.first')}</Link>}
        {nextCursor && <Link href={`${viewHref(tab)}${tab === 'all' ? '?' : '&'}cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</Link>}
      </nav>
      <p className="kv-fine kv-note">{t.t('oc.pagerNote')}</p>
    </section>
  );
}
