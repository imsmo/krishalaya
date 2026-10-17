// apps/web-storefront/src/app/[tenantSlug]/orders/page.tsx · PC-56 STORE-3a · C1 — canon W288 "My orders", under the ORGANISATION's chrome
// (founder D3; the platform's /orders is a door — lib/store-door.ts). PROTECTED + dynamic.
//   • five tabs — All / Active / Needs attention / Completed / Cancelled (founder D4) — from `orders.groups()`: each count as the number, or
//     past the API's cap as "<n>+" (bounded server-side, never a tenant-wide count); the current tab from `?group=`;
//   • rows from `orders.list({ role: 'buyer', group, cursor })`: the primary item ("<title> · <qty> <unit>" + "+N more"), the ORGANISATION
//     (never a person, never an id), the order number + when it was placed, the status chip (all 15 statuses labelled ×3), the money in the
//     DATA's currency (Rule Zero — no fallback currency), "awaiting your payment" and the acceptance deadline (never for an auction order);
//   • keyset Next only (DELTA keyset_pages); an empty tab says so with "Browse this store"; a load error is NOT an empty list: it says so,
//     with a Retry that reloads (W3058–W3060 are DECOR);
//   • the refused canon claims printed by name (features/store3a/refusals.ts, surface `orders`).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { OrderListItem, OrderGroupCounts } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { moneyText } from '../../../features/discovery/money';
import { reloadHref } from '../../../features/home/load-result';
import { orderStatusKey, orderStatusTone } from '../../../features/store3a/order-status';
import { readGroup, ordersHref, orderHref, orderTabs, countForm, moreItems, showsDeadline } from '../../../features/store3a/orders';
import { RefusalList } from '../../../components/RefusalList';
// PC-56 STORE-CLOSE · RTL spot-check: the keyset "Show more" arrow is the direction-safe DirArrow (it was the catalogue's "Show more →").
import { DirArrow } from '../../../components/DirArrow';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('order.listTitle'), robots: { index: false, follow: false } };
}

export default async function TenantOrdersPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  const group = readGroup(searchParams.group);
  const cursor = typeof searchParams.cursor === 'string' ? searchParams.cursor.slice(0, 512) : undefined;
  await requireSession(ordersHref(slug, group));
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(slug);

  let counts: OrderGroupCounts | null = null;
  try { counts = await api.orders.groups(); } catch { counts = null; }
  let items: OrderListItem[] = [];
  let nextCursor: string | null = null;
  let failed = false;
  try {
    const page = await api.orders.list({ role: 'buyer', group, cursor, limit: 20 });
    items = page.items; nextCursor = page.nextCursor;
  } catch { failed = true; }

  const tabs = orderTabs(slug, group, counts);
  const head = (
    <>
      <h1>{t.t('order.listTitle')}</h1>
      <nav className="kv-tabs" aria-label={t.t('store3a.tabs.label')} data-kv-tabs="orders">
        <ul className="kv-tabs__list">
          {tabs.map((tab) => {
            const c = tab.count ? countForm(tab.count) : null;
            return (
              <li key={tab.group}>
                <Link href={tab.href} className={tab.current ? 'kv-tab kv-tab--current' : 'kv-tab'} aria-current={tab.current ? 'page' : undefined} data-kv-tab={tab.group}>
                  {t.t(tab.labelKey)}
                  {c && <span className="kv-tab__count" data-kv-count={tab.group} data-kv-capped={String(tab.count!.capped)}> {t.t(c.key, { n: formatNumber(c.n, lang) })}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );

  if (failed) {
    return (
      <section className="kv-orders" data-kv-store={slug}>
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store3a.list.error')}</p>
          <a href={reloadHref(`/${encodeURIComponent(slug)}/orders`, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="orders" />
      </section>
    );
  }

  return (
    <section className="kv-orders" data-kv-store={slug} data-kv-group={group}>
      {head}
      {items.length === 0 ? (
        <div className="kv-state" role="status" data-kv-state="empty">
          <p>{t.t(group === 'all' ? 'order.empty' : 'store3a.list.emptyTab')}</p>
          <Link href={`/${encodeURIComponent(slug)}`} className="kv-btn" data-kv-cta="browse">{t.t('store3a.list.browse')}</Link>
        </div>
      ) : (
        <ul className="kv-orders__list" aria-label={t.t('order.listCaption')}>
          {items.map((o) => {
            const more = moreItems(o.itemCount);
            const money = moneyText(o.totalMinor, o.currencyCode ?? null, lang) ?? t.t('money.unavailable');
            return (
              <li key={o.id} className="kv-orders__row" data-kv-order={o.id} data-kv-status={o.status}>
                <Link href={orderHref(slug, o.id)} className="kv-link kv-orders__title">
                  {o.primaryItem
                    ? t.t('store3a.row.item', { title: o.primaryItem.title, qty: formatNumber(o.primaryItem.quantity, lang), unit: o.primaryItem.unitCode })
                    : t.t('order.orderNo', { no: o.orderNo })}
                </Link>
                {more !== null && <span className="kv-detail__muted" data-kv-more={more}> {t.t('store3a.row.more', { n: formatNumber(more, lang) })}</span>}
                {o.organisation && <p className="kv-detail__muted" data-kv-seller="organisation">{t.t('checkout.soldBy', { org: o.organisation.name })}</p>}
                <p className="kv-detail__muted">
                  <code className="kv-mono">{o.orderNo}</code>{' '}
                  {o.createdAt && t.t('store3a.row.placed', { date: formatDate(o.createdAt, lang) })}
                </p>
                <p>
                  <span className={`kv-chip kv-chip--${orderStatusTone(o.status)}`} data-kv-chip={o.status}>{t.t(orderStatusKey(o.status))}</span>{' '}
                  <strong data-kv-money={o.currencyCode ?? 'unknown'}>{money}</strong>
                </p>
                {o.paymentState === 'pending' && <p className="kv-form__error" data-kv-awaiting="payment">{t.t('store3a.row.awaitingPayment')}</p>}
                {showsDeadline(o) && <p className="kv-detail__muted" data-kv-deadline={o.id}>{t.t('store3a.row.deadline', { date: formatDate(String(o.acceptanceDeadline), lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {nextCursor && <p><Link href={ordersHref(slug, group, nextCursor)} className="kv-btn--link" rel="next">{t.t('discover.showMore')} <DirArrow /></Link></p>}
      <RefusalList surface="orders" />
    </section>
  );
}
