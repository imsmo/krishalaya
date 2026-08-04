// apps/web-storefront/src/app/checkout/confirm/page.tsx · order confirmation. PROTECTED + dynamic. Reads the
// order's authoritative, server-computed totals (subtotal / delivery / discount / tax / total) and line items via
// the authed SDK and renders the receipt. All money via formatMoneyMinor (Law 2). notFound() on a missing/foreign
// order id (the API + RLS only return the caller's own order — no IDOR).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { OrderDetail } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { paymentOutcome } from '../../../features/payments/status';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.confirmTitle'), robots: { index: false, follow: false } };
}

function Row({ label, minor, cur, lang, strong }: { label: string; minor: string; cur: string; lang: string; strong?: boolean }) {
  return (
    <p className={`kv-confirm__row${strong ? ' kv-confirm__row--total' : ''}`}>
      <span>{label}</span> {strong ? <strong>{formatMoneyMinor(minor, cur, lang)}</strong> : <span>{formatMoneyMinor(minor, cur, lang)}</span>}
    </p>
  );
}

export default async function ConfirmPage({ searchParams }: { searchParams: { o?: string } }) {
  await requireSession(`/checkout/confirm?o=${encodeURIComponent(searchParams.o ?? '')}`);
  const orderId = searchParams.o;
  if (!orderId) notFound();

  const t = getTranslator();
  const lang = getLang();

  let order: OrderDetail | null = null;
  try { order = await serverClient().orders.get(orderId); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }

  if (!order) {
    return <section className="kv-confirm"><h1>{t.t('checkout.confirmTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('checkout.loadError')}</p></section>;
  }

  const paid = paymentOutcome(order.status) === 'success';
  const cur = order.currencyCode;

  return (
    <section className="kv-confirm">
      <h1>{t.t('checkout.confirmTitle')}</h1>
      <p className={paid ? 'kv-form__notice' : 'kv-form__error'} role="status">
        {paid ? t.t('checkout.confirmPaid') : t.t('checkout.confirmPending')}
      </p>
      <p className="kv-checkout__orderno">{t.t('checkout.orderNo', { no: order.orderNo })}</p>

      <ul className="kv-confirm__items">
        {order.items.map((it) => (
          <li key={it.listing_id} className="kv-confirm__item">
            <span>{it.title_snapshot} × {it.quantity} {it.unit_code}</span>
            <span>{formatMoneyMinor(it.line_total_minor, cur, lang)}</span>
          </li>
        ))}
      </ul>

      <div className="kv-confirm__totals">
        <Row label={t.t('cart.subtotal')} minor={order.subtotalMinor} cur={cur} lang={lang} />
        <Row label={t.t('checkout.delivery')} minor={order.deliveryFeeMinor} cur={cur} lang={lang} />
        {order.discountMinor !== '0' && <Row label={t.t('checkout.discount')} minor={order.discountMinor} cur={cur} lang={lang} />}
        <Row label={t.t('checkout.tax')} minor={order.taxMinor} cur={cur} lang={lang} />
        <Row label={t.t('checkout.total')} minor={order.totalMinor} cur={cur} lang={lang} strong />
      </div>

      <div className="kv-confirm__actions">
        {!paid && <Link href={`/checkout/pay?o=${encodeURIComponent(order.id)}`} className="kv-btn">{t.t('checkout.payNow')}</Link>}
        <Link href="/orders" className="kv-btn--link">{t.t('checkout.viewOrders')}</Link>
        <Link href="/" className="kv-btn--link">{t.t('cart.continueShopping')}</Link>
      </div>
    </section>
  );
}
