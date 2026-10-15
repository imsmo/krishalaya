// apps/web-storefront/src/app/[tenantSlug]/checkout/confirm/page.tsx · order confirmation, under the ORGANISATION's chrome (PC-56 STORE-2c · C1 — the
// platform's /checkout/confirm redirects here; HOTFIX-4's logic moved with it, no second copy). PROTECTED + dynamic.
//   • the state of each order is the ORDER's own `paymentState` (features/orders/payment-state.ts); a pending order has its own Pay link (to THIS
//     store's pay step); `?g=` names EVERY order of the checkout — each paid on its own (founder D2);
//   • PC-56 STORE-2c · D3: a CANCELLED order that had been paid says what happened to the money, from the payment read: refunded to the source,
//     or the refund requested at the gateway (pending its confirmation) — never "refunded" before the gateway says so;
//   • the seller is the ORGANISATION; the bill rows are the API's and sum to the total; the canon claims refused by name.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { OrderDetail, OrderPaymentAttempts } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { loadTenantShell } from '../../../../lib/storefront-data';
import { moneyText } from '../../../../features/discovery/money';
import { paymentStateOf, confirmStateKey, showsPayStep, isSettledGood } from '../../../../features/orders/payment-state';
import { billRows } from '../../../../features/checkout/bill-rows';
import { CONFIRM_REFUSAL_KEYS } from '../../../../features/store2/refusals';
import { couponNoticeKey } from '../../../../features/checkout/preview';
import { confirmHref, payHref, processingView } from '../../../../features/store2c/checkout';
import { BillRowsView } from '../../../../components/BillRowsView';

/** A checkout group is at most one order per seller of one cart — bounded; the page never reads more than this. */
const MAX_GROUP_ORDERS = 20;
type SP = Record<string, string | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.confirmTitle'), robots: { index: false, follow: false } };
}

export default async function TenantConfirmPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  await requireSession(confirmHref(slug, searchParams.o ?? '', searchParams.g ?? null));
  if (!searchParams.o && !searchParams.g) notFound();
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(slug);
  const shell = await loadTenantShell(slug);
  const org = shell.kind === 'ok' ? shell.tenant.displayName || null : null;

  let orders: OrderDetail[] | null = null;
  try {
    const ids = searchParams.g
      ? (await api.orders.checkoutGroup(searchParams.g)).orders.map((o) => o.id).slice(0, MAX_GROUP_ORDERS)
      : [searchParams.o as string];
    orders = await Promise.all(ids.map((id) => api.orders.get(id)));
  } catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); orders = null; }

  if (!orders || orders.length === 0) {
    return <section className="kv-confirm"><h1>{t.t('checkout.confirmTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('checkout.loadError')}</p></section>;
  }
  const groupId = searchParams.g ?? null;
  const cn = couponNoticeKey(searchParams.cn);
  // D3: what happened to a cancelled order's money — the payment read (only for cancelled orders; bounded by the group size)
  const refunds = new Map<string, string>();
  for (const o of orders) {
    if (paymentStateOf(o) !== 'cancelled') continue;
    let a: OrderPaymentAttempts | null = null;
    try { a = await api.payments.orderAttempts(o.id); } catch { a = null; }
    const v = processingView(a?.latest ?? null, new Date());
    if (v === 'refunded') refunds.set(o.id, 'store2c.confirm.refunded');
    else if (v === 'refunding') refunds.set(o.id, 'store2c.confirm.refunding');
  }

  return (
    <section className="kv-confirm" data-kv-orders={orders.length}>
      <h1>{t.t('checkout.confirmTitle')}</h1>
      {cn && <p className="kv-form__notice" role="status">{t.t(cn)} {t.t('coupon.notice.placedAtNormalPrice')}</p>}
      {orders.length > 1 && <p className="kv-checkout__orderno">{t.t('checkout.groupHeading', { count: String(orders.length) })}</p>}

      {orders.map((order, i) => {
        const state = paymentStateOf(order);
        const refund = refunds.get(order.id);
        return (
          <article key={order.id} className="kv-confirm__order" data-kv-order={order.id} data-kv-payment-state={state}>
            <h2 className="kv-checkout__orderno">
              {orders!.length > 1 ? t.t('checkout.groupOrder', { n: String(i + 1), count: String(orders!.length), no: order.orderNo }) : t.t('checkout.orderNo', { no: order.orderNo })}
            </h2>
            {org && <p className="kv-detail__muted" data-kv-seller="organisation">{t.t('checkout.soldBy', { org })}</p>}
            <p className={isSettledGood(state) ? 'kv-form__notice' : 'kv-form__error'} role="status">{t.t(confirmStateKey(state))}</p>
            {refund && <p className="kv-form__notice" role="status" data-kv-refund={refund}>{t.t(refund)}</p>}
            <ul className="kv-confirm__items">
              {order.items.map((it) => (
                <li key={it.listing_id} className="kv-confirm__item">
                  <span>{it.title_snapshot} × {it.quantity} {it.unit_code}</span>
                  <span>{moneyText(it.line_total_minor, order.currencyCode, lang) ?? t.t('money.unavailable')}</span>
                </li>
              ))}
            </ul>
            <BillRowsView bill={billRows(order)} />
            {showsPayStep(state) && <Link href={payHref(slug, order.id, groupId)} className="kv-btn" data-kv-pay={order.id}>{t.t('checkout.payThis')}</Link>}
          </article>
        );
      })}

      <p className="kv-cart__note">{t.t('store2c.escrow')}</p>
      <p className="kv-cart__note">{t.t('store2c.refund.true')}</p>
      <section className="kv-detail__section" aria-labelledby="refusals-h" data-kv-refusals="store2">
        <h2 id="refusals-h">{t.t('store2.refusal.title')}</h2>
        <ul>{CONFIRM_REFUSAL_KEYS.map((k) => <li key={k} data-kv-refusal={k}>{t.t(k)}</li>)}</ul>
      </section>

      <div className="kv-confirm__actions">
        <Link href="/orders" className="kv-btn--link">{t.t('checkout.viewOrders')}</Link>
        <Link href={`/${encodeURIComponent(slug)}`} className="kv-btn--link">{t.t('cart.continueShopping')}</Link>
      </div>
    </section>
  );
}
