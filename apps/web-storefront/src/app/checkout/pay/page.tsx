// apps/web-storefront/src/app/checkout/pay/page.tsx · the pay step for a placed order. PROTECTED + dynamic. Reads
// the order's AUTHORITATIVE total via the authed SDK (never trusts the URL for an amount — the URL carries only
// the id). If the order is already paid, skip straight to confirmation. Otherwise render the order total + the
// PayButton (client), passing the PUBLISHABLE Razorpay key from env (null → PayButton fails closed). notFound()
// if the order id is missing/invalid (no IDOR — the API + RLS only return the caller's own order).
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { OrderDetail } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import { paymentOutcome } from '../../../features/payments/status';
import { PayButton, type PayLabels } from '../../../components/PayButton';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.payTitle'), robots: { index: false, follow: false } };
}

export default async function PayPage({ searchParams }: { searchParams: { o?: string } }) {
  await requireSession(`/checkout/pay?o=${encodeURIComponent(searchParams.o ?? '')}`);
  const orderId = searchParams.o;
  if (!orderId) notFound();

  const t = getTranslator();
  const lang = getLang();

  let order: OrderDetail | null = null;
  try { order = await serverClient().orders.get(orderId); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }

  if (!order) {
    return <section className="kv-pay-page"><h1>{t.t('checkout.payTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('checkout.loadError')}</p></section>;
  }

  // Already settled? Go to confirmation rather than offering to pay again.
  if (paymentOutcome(order.status) === 'success') redirect(`/checkout/confirm?o=${encodeURIComponent(orderId)}`);

  const labels: PayLabels = {
    pay: t.t('checkout.payNow'), processing: t.t('checkout.processing'), unavailable: t.t('checkout.payUnavailable'),
    scriptError: t.t('checkout.scriptError'), cancelled: t.t('checkout.payCancelled'), failed: t.t('checkout.payFailed'),
    pendingMsg: t.t('checkout.payPending'), appName: env.appName,
  };

  return (
    <section className="kv-pay-page">
      <h1>{t.t('checkout.payTitle')}</h1>
      <p className="kv-checkout__orderno">{t.t('checkout.orderNo', { no: order.orderNo })}</p>
      <p className="kv-cart__subtotal"><span>{t.t('checkout.amountDue')}</span> <strong>{formatMoneyMinor(order.totalMinor, order.currencyCode, lang)}</strong></p>
      <PayButton orderId={order.id} keyId={env.razorpayKeyId} labels={labels} />
      <p className="kv-cart__note">{t.t('checkout.payNote')}</p>
      <Link href="/cart" className="kv-btn--link">{t.t('checkout.backToCart')}</Link>
    </section>
  );
}
