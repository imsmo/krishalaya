// apps/web-storefront/src/app/(platform)/checkout/pay/page.tsx · the pay step for a placed order. PROTECTED + dynamic. Reads
// the order's AUTHORITATIVE total via the authed SDK (never trusts the URL for an amount — the URL carries only
// the id). If the order is already paid, skip straight to confirmation. Otherwise render the order total + the
// PayButton (client), passing the PUBLISHABLE Razorpay key from env (null → PayButton fails closed). notFound()
// if the order id is missing/invalid (no IDOR — the API + RLS only return the caller's own order).
import { couponNoticeKey } from '../../../../features/checkout/preview';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { OrderDetail } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, sessionTenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { paymentStateOf, payPageRoute, confirmHref } from '../../../../features/orders/payment-state';
import { moneyText } from '../../../../features/discovery/money';
import { reloadHref } from '../../../../features/home/load-result';
import { PayButton, type PayLabels } from '../../../../components/PayButton';
import { PoweredByMark } from '../../../../components/PoweredByMark';
import { poweredByVisible, PLATFORM_BRAND } from '../../../../features/branding/brand-theme';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.payTitle'), robots: { index: false, follow: false } };
}

// PC-56 HOTFIX-4 · C1 (survey F-1, founder D2): the decision is the ORDER's own `paymentState` — only `pending` has a Pay step; `paid`,
// `none` (no online payment: the seller confirms, payment on delivery), `cancelled`, `expired`, `refunded` go to the confirmation (the
// checkout group kept via `g`). The store's `online_payments` switch is read too: OFF → no Pay button, said plainly (never a 404).
/** The store's public `online_payments` switch (founder D2). A read failure is treated as OFF — never offer a Pay step that may 404. */
async function onlinePaymentsOn(): Promise<boolean> {
  try { return (await sessionTenantClient().storefront.flags()).online_payments === true; } catch { return false; }
}

export default async function PayPage({ searchParams }: { searchParams: { o?: string; g?: string; cn?: string } }) {
  await requireSession(`/checkout/pay?o=${encodeURIComponent(searchParams.o ?? '')}`);
  const orderId = searchParams.o;
  if (!orderId) notFound();

  const t = getTranslator();
  const lang = getLang();

  let order: OrderDetail | null = null;
  try { order = await serverClient().orders.get(orderId); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }

  if (!order) {
    // PC-56 STORE-2b · C6 (survey F-19): the load error gets Retry — a reload of this URL (a read; the Pay act itself is never retried here)
    return <section className="kv-pay-page"><h1>{t.t('checkout.payTitle')}</h1>
      <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
        <p>{t.t('checkout.loadError')}</p>
        <a href={reloadHref('/checkout/pay', searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
      </div></section>;
  }

  // Not awaiting an online payment (paid, placed for payment on delivery, closed)? Go to confirmation — never offer Pay.
  const done = confirmHref(orderId, searchParams.g ?? null);
  if (payPageRoute(paymentStateOf(order)) === 'confirm') redirect(done);
  const payOn = await onlinePaymentsOn();

  const labels: PayLabels = {
    pay: t.t('checkout.payNow'), processing: t.t('checkout.processing'), unavailable: t.t('checkout.payUnavailable'),
    scriptError: t.t('checkout.scriptError'), cancelled: t.t('checkout.payCancelled'), failed: t.t('checkout.payFailed'),
    pendingMsg: t.t('checkout.payPending'), appName: env.appName,
  };

  return (
    <section className="kv-pay-page">
      <h1>{t.t('checkout.payTitle')}</h1>
      <p className="kv-checkout__orderno">{t.t('checkout.orderNo', { no: order.orderNo })}</p>
      {couponNoticeKey(searchParams.cn) && <p className="kv-form__notice" role="status">{t.t(couponNoticeKey(searchParams.cn)!)} {t.t('coupon.notice.placedAtNormalPrice')}</p>}
      <p className="kv-cart__subtotal"><span>{t.t('checkout.amountDue')}</span> <strong>{moneyText(order.totalMinor, order.currencyCode, lang) ?? t.t('money.unavailable')}</strong></p>
      {payOn
        ? <PayButton orderId={order.id} keyId={env.razorpayKeyId} labels={labels} confirmHref={done} />
        : <p className="kv-form__notice" role="status" data-kv-pay="off">{t.t('checkout.payOff')}</p>}
      <p className="kv-cart__note">{t.t('checkout.payNote')}</p>
      <Link href="/cart" className="kv-btn--link">{t.t('checkout.backToCart')}</Link>
      {/* PC-56 TENANT-13d: a TRUST surface (escrow / payment, and the order where disputes are raised) — the platform mark stays here
          whatever the tenant's brand or plan (packages/tokens TRUST_SURFACES; `poweredByVisible('escrow', …)` is always true). */}
      {poweredByVisible('escrow', null) && <PoweredByMark label={PLATFORM_BRAND.poweredByMark} />}
    </section>
  );
}
