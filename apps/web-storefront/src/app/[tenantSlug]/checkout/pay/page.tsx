// apps/web-storefront/src/app/[tenantSlug]/checkout/pay/page.tsx · PC-56 STORE-2c · C5 — canon W286 (payment processing) and its "Send again" chain
// W3061–W3063, under the ORGANISATION's chrome (the platform's /checkout/pay redirects here; its logic moved, no second copy). PROTECTED + dynamic.
//
// The order's authoritative total is read server-side (the URL carries only the id); a non-pending order goes to its confirmation (HOTFIX-4).
// The page then reads the order's payment ATTEMPTS (B3) and shows the REAL state of the newest one (`processingView`):
//   none        → "Pay now" (attempt 1);
//   live        → "a payment attempt is open until <expiresAt>" + continue it (the SAME attempt — its key replays its gateway order);
//   failed      → the gateway's reason, LOCALIZED BY CODE; "nothing was charged" only when the failure happened before any debit; "Send again"
//                 (attempt N + 1 — W3061 is DECOR: re-requesting payment charges nothing; W3062 is the new attempt's state);
//   expired     → "the request lapsed" + "Send again";
//   authorized  → "your bank authorised it; the capture completes on the server";
//   success     → the confirmation (or "confirming" while the order catches up);
//   W3063       → the named failures: "an attempt is still open until <time>" / "this order is no longer awaiting payment".
// The sheet names the ORGANISATION and "Order <order_no>" (D8). Pay from wallet (D6) when the buyer chose it and the balance covers. Online
// payments OFF → the honest OFF line (the OFF regime never reaches this page from checkout — said in the refusal list). Refusals printed by name.
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { OrderDetail, OrderPaymentAttempts, StorefrontFlags, WalletBalance } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient, serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { loadTenantShell } from '../../../../lib/storefront-data';
import { paymentStateOf, payPageRoute } from '../../../../features/orders/payment-state';
import { moneyText } from '../../../../features/discovery/money';
import { reloadHref } from '../../../../features/home/load-result';
import { couponNoticeKey } from '../../../../features/checkout/preview';
import { attemptToOpen, canSendAgain, confirmHref, failureReasonKey, moneyRefusalKey, payHref, processingView, readMoneyRefusal, walletCovers } from '../../../../features/store2c/checkout';
// PC-56 STORE-3c · C4 (founder D2): the pay step charges what is DUE — an auction order's balance (total − the deposit applied)
import { payableMinor, showsDepositRows } from '../../../../features/store3c/auctions';
import { PayButton, type PayLabels } from '../../../../components/PayButton';
import { SubmitButton } from '../../../../components/SubmitButton';
import { RefusalList } from '../../../../components/RefusalList';
import { PoweredByMark } from '../../../../components/PoweredByMark';
import { poweredByVisible, PLATFORM_BRAND } from '../../../../features/branding/brand-theme';
import { payFromWalletAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('checkout.payTitle'), robots: { index: false, follow: false } };
}

const timeText = (iso: string | null | undefined, lang: string) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(d) : null;
};

export default async function TenantPayPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  const orderId = searchParams.o;
  await requireSession(payHref(slug, orderId ?? ''));
  if (!orderId || !/^[0-9a-fA-F-]{36}$/.test(orderId)) notFound();
  const t = getTranslator();
  const lang = getLang();
  const groupId = searchParams.g && /^[0-9a-fA-F-]{36}$/.test(searchParams.g) ? searchParams.g : null;
  const api = serverClient(slug);
  const shell = await loadTenantShell(slug);
  const org = (shell.kind === 'ok' ? shell.tenant.displayName : '') || slug;

  let order: OrderDetail | null = null;
  try { order = await api.orders.get(orderId); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }
  if (!order) {
    return <section className="kv-pay-page"><h1>{t.t('checkout.payTitle')}</h1>
      <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
        <p>{t.t('checkout.loadError')}</p>
        <a href={reloadHref(`/${encodeURIComponent(slug)}/checkout/pay`, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
      </div></section>;
  }
  const done = confirmHref(slug, orderId, groupId);
  if (payPageRoute(paymentStateOf(order)) === 'confirm') redirect(done);

  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  const payOn = flags?.online_payments === true;
  const due = payableMinor(order);   // STORE-3c · C4: the order's amountDueMinor (3a's field); the total only when absent
  const amount = moneyText(due, order.currencyCode, lang) ?? t.t('money.unavailable');
  const status = readMoneyRefusal(searchParams.status);

  let attempts: OrderPaymentAttempts | null = null;
  if (payOn) { try { attempts = await api.payments.orderAttempts(orderId); } catch { attempts = null; } }
  const view = processingView(attempts?.latest ?? null, new Date());
  if (view === 'success' || view === 'refunded' || view === 'refunding') redirect(done);

  // D6: the wallet, when the buyer chose it at checkout and the balance covers the order
  const viaWallet = searchParams.via === 'wallet';
  let balance: WalletBalance | null = null;
  if (payOn && viaWallet) { try { balance = await api.wallet.balance(order.currencyCode); } catch { balance = null; } }
  const walletOk = walletCovers(balance, { totalMinor: due, currencyCode: order.currencyCode });   // D2: wallet pay when the BALANCE is covered

  const labels: PayLabels = {
    pay: t.t(canSendAgain(view) ? 'store2c.pay.sendAgain' : view === 'live' ? 'store2c.pay.continue' : 'checkout.payNow'),
    processing: t.t('checkout.processing'), unavailable: t.t('checkout.payUnavailable'), scriptError: t.t('checkout.scriptError'),
    cancelled: t.t('checkout.payCancelled'), failed: t.t('store2c.pay.failedGeneric'), pendingMsg: t.t('store2c.pay.pending'),
    attemptLive: t.t('store2c.pay.attemptLiveNoTime'), notAwaiting: t.t(moneyRefusalKey('not_awaiting')), amountMismatch: t.t(moneyRefusalKey('amount_mismatch')),
    sheetName: org, sheetDescription: t.t('store2c.pay.sheetDescription', { no: order.orderNo }),
  };
  const expiresAt = timeText(attempts?.latest?.expiresAt, lang);
  const latest = attempts?.latest ?? null;

  return (
    <section className="kv-pay-page" data-kv-processing={view}>
      <h1>{t.t('checkout.payTitle')}</h1>
      <p className="kv-checkout__orderno">{t.t('checkout.orderNo', { no: order.orderNo })} · {t.t('checkout.soldBy', { org })}</p>
      {couponNoticeKey(searchParams.cn) && <p className="kv-form__notice" role="status">{t.t(couponNoticeKey(searchParams.cn)!)} {t.t('coupon.notice.placedAtNormalPrice')}</p>}
      {showsDepositRows(order) && (
        <p className="kv-cart__note" data-kv-deposit-rows="">{t.t('store3c.pay.depositRows', {
          deposit: moneyText(order.depositAppliedMinor ?? null, order.currencyCode, lang) ?? t.t('money.unavailable'), balance: amount })}</p>
      )}
      <p className="kv-cart__subtotal" data-kv-due={due}><span>{t.t('checkout.amountDue')}</span> <strong>{amount}</strong></p>
      {status === 'attempt_live' && <p className="kv-form__error" role="alert" data-kv-refused="attempt_live">{expiresAt ? t.t('store2c.pay.attemptLive', { time: expiresAt }) : t.t('store2c.pay.attemptLiveNoTime')}</p>}
      {status && status !== 'attempt_live' && <p className="kv-form__error" role="alert" data-kv-refused={status}>{t.t(moneyRefusalKey(status))}</p>}

      {!payOn ? (
        <p className="kv-form__notice" role="status" data-kv-pay="off">{t.t('checkout.payOff')}</p>
      ) : viaWallet && walletOk ? (
        <form action={payFromWalletAction} data-kv-act-class="money" data-kv-needs-signal-reason="payFromWallet" className="kv-checkout__form" data-kv-form="wallet-pay">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="orderId" value={orderId} />
          {groupId && <input type="hidden" name="groupId" value={groupId} />}
          <p>{t.t('store2c.pay.wallet', { balance: moneyText(balance!.availableMinor, balance!.currencyCode, lang) ?? t.t('money.unavailable') })}</p>
          <SubmitButton idle={t.t('store2c.pay.walletNow', { amount })} busy={t.t('checkout.processing')} className="kv-btn kv-btn--money" />
          <p className="kv-field__hint"><a href={payHref(slug, orderId, groupId)} className="kv-btn--link">{t.t('store2c.pay.useOnlineInstead')}</a></p>
        </form>
      ) : (
        <div className="kv-pay__state" data-kv-attempt-state={view}>
          {viaWallet && !walletOk && <p className="kv-form__notice" role="status" data-kv-wallet="short">{t.t(moneyRefusalKey('wallet_short'))}</p>}
          {view === 'live' && <p className="kv-form__notice" role="status">{expiresAt ? t.t('store2c.pay.attemptLive', { time: expiresAt }) : t.t('store2c.pay.attemptLiveNoTime')}</p>}
          {view === 'failed' && latest && (
            <div className="kv-form__error" role="alert" data-kv-failure={latest.failureReason ?? 'unknown'}>
              <p>{t.t(failureReasonKey(latest.failureReason))}</p>
              <p>{t.t(latest.chargedNothing ? 'store2c.pay.notCharged' : 'store2c.pay.mayReverse')}</p>
            </div>
          )}
          {view === 'expired' && <p className="kv-form__notice" role="status" data-kv-lapsed="">{t.t('store2c.pay.lapsed')}</p>}
          {view === 'authorized' && <p className="kv-form__notice" role="status">{t.t('store2c.pay.authorized')}</p>}
          {view !== 'authorized' && (
            <PayButton slug={slug} orderId={orderId} attempt={attemptToOpen(view, attempts ?? { attempts: 0, nextAttempt: 1 })} keyId={env.razorpayKeyId}
              labels={labels} confirmHref={done} timeoutSec={attempts?.ttlSeconds ?? null} />
          )}
          {canSendAgain(view) && <p className="kv-field__hint">{t.t('store2c.pay.sendAgainNote')}</p>}
        </div>
      )}

      {payOn && <p className="kv-cart__note">{t.t('store2c.pay.closeSafe')}</p>}
      {payOn && <p className="kv-cart__note">{t.t('store2c.pay.messageOnConfirm')}</p>}
      <p className="kv-cart__note">{t.t('store2c.escrow')}</p>
      <p className="kv-cart__note">{t.t('store2c.refund.true')}</p>
      <p className="kv-cart__note">{t.t('store2c.pay.sessionOnly')}</p>
      <p><Link href={done} className="kv-btn--link">{t.t('store2c.pay.seeOrder')}</Link></p>
      <RefusalList surface="processing" />
      {/* PC-56 TENANT-13d: a TRUST surface (escrow / payment) — the platform mark stays here whatever the tenant's brand or plan */}
      {poweredByVisible('escrow', null) && <PoweredByMark label={PLATFORM_BRAND.poweredByMark} />}
    </section>
  );
}
