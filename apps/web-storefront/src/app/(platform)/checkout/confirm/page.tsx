// apps/web-storefront/src/app/(platform)/checkout/confirm/page.tsx · order confirmation. PROTECTED + dynamic.
//
// PC-56 HOTFIX-4 · C1/C3/C5/A9 (survey F-1, F-5, F-6; founder D2/D3/D4):
//   • the state of each order comes from the ORDER's own `paymentState` (features/orders/payment-state.ts) — a paid order says paid (and that
//     the money is held until the order completes, which is what capture → escrow → release-at-completion does in code); a `none` order
//     says "placed — the seller confirms; you pay on delivery" and has NO Pay link; only a `pending` order has one;
//   • `?g=<checkout group>` names EVERY order the checkout created (each with its own Pay link when it awaits payment) — nothing orphaned;
//   • the seller is the ORGANISATION (the session tenant's public profile name) — never a person;
//   • the bill rows are the API's and sum to the total (platform fee and buyer commission as their own rows when > 0);
//   • the canon claims this build does not make are printed as refusals (features/store2/refusals.ts).
// notFound() on a missing/foreign order id (the API + RLS only return the caller's own order — no IDOR).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { OrderDetail } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, sessionTenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { moneyText } from '../../../../features/discovery/money';
import { paymentStateOf, confirmStateKey, showsPayStep, isSettledGood, payHref } from '../../../../features/orders/payment-state';
import { billRows } from '../../../../features/checkout/bill-rows';
import { CONFIRM_REFUSAL_KEYS } from '../../../../features/store2/refusals';
import { couponNoticeKey } from '../../../../features/checkout/preview';
import { BillRowsView } from '../../../../components/BillRowsView';

/** A checkout group is at most one order per seller of one cart — bounded; the page never reads more than this. */
const MAX_GROUP_ORDERS = 20;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.confirmTitle'), robots: { index: false, follow: false } };
}

async function organisationName(): Promise<string | null> {
  try { return (await sessionTenantClient().storefront.profile()).displayName || null; } catch { return null; }
}

export default async function ConfirmPage({ searchParams }: { searchParams: { o?: string; g?: string; cn?: string } }) {
  const back = searchParams.g ? `/checkout/confirm?g=${encodeURIComponent(searchParams.g)}` : `/checkout/confirm?o=${encodeURIComponent(searchParams.o ?? '')}`;
  await requireSession(back);
  if (!searchParams.o && !searchParams.g) notFound();
  const t = getTranslator();
  const lang = getLang();

  let orders: OrderDetail[] | null = null;
  try {
    const ids = searchParams.g
      ? (await serverClient().orders.checkoutGroup(searchParams.g)).orders.map((o) => o.id).slice(0, MAX_GROUP_ORDERS)
      : [searchParams.o as string];
    orders = await Promise.all(ids.map((id) => serverClient().orders.get(id)));
  } catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); orders = null; }

  if (!orders || orders.length === 0) {
    return <section className="kv-confirm"><h1>{t.t('checkout.confirmTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('checkout.loadError')}</p></section>;
  }
  const org = await organisationName();
  const groupId = searchParams.g ?? null;
  const cn = couponNoticeKey(searchParams.cn);

  return (
    <section className="kv-confirm" data-kv-orders={orders.length}>
      <h1>{t.t('checkout.confirmTitle')}</h1>
      {cn && <p className="kv-form__notice" role="status">{t.t(cn)} {t.t('coupon.notice.placedAtNormalPrice')}</p>}
      {orders.length > 1 && <p className="kv-checkout__orderno">{t.t('checkout.groupHeading', { count: String(orders.length) })}</p>}

      {orders.map((order, i) => {
        const state = paymentStateOf(order);
        return (
          <article key={order.id} className="kv-confirm__order" data-kv-order={order.id} data-kv-payment-state={state}>
            <h2 className="kv-checkout__orderno">
              {orders!.length > 1 ? t.t('checkout.groupOrder', { n: String(i + 1), count: String(orders!.length), no: order.orderNo }) : t.t('checkout.orderNo', { no: order.orderNo })}
            </h2>
            {org && <p className="kv-detail__muted" data-kv-seller="organisation">{t.t('checkout.soldBy', { org })}</p>}
            <p className={isSettledGood(state) ? 'kv-form__notice' : 'kv-form__error'} role="status">{t.t(confirmStateKey(state))}</p>

            <ul className="kv-confirm__items">
              {order.items.map((it) => (
                <li key={it.listing_id} className="kv-confirm__item">
                  <span>{it.title_snapshot} × {it.quantity} {it.unit_code}</span>
                  <span>{moneyText(it.line_total_minor, order.currencyCode, lang) ?? t.t('money.unavailable')}</span>
                </li>
              ))}
            </ul>

            <BillRowsView bill={billRows(order)} />

            {showsPayStep(state) && <Link href={payHref(order.id, groupId)} className="kv-btn" data-kv-pay={order.id}>{t.t('checkout.payThis')}</Link>}
          </article>
        );
      })}

      <section className="kv-detail__section" aria-labelledby="refusals-h" data-kv-refusals="store2">
        <h2 id="refusals-h">{t.t('store2.refusal.title')}</h2>
        <ul>{CONFIRM_REFUSAL_KEYS.map((k) => <li key={k} data-kv-refusal={k}>{t.t(k)}</li>)}</ul>
      </section>

      <div className="kv-confirm__actions">
        <Link href="/orders" className="kv-btn--link">{t.t('checkout.viewOrders')}</Link>
        <Link href="/" className="kv-btn--link">{t.t('cart.continueShopping')}</Link>
      </div>
    </section>
  );
}
