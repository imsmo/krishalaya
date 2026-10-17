// apps/web-storefront/src/app/[tenantSlug]/orders/[id]/page.tsx · PC-56 STORE-3a · C2 — canon W289 "Order", under the ORGANISATION's chrome
// (founder D3; the platform's /orders/[id] is a door). PROTECTED + dynamic. A stranger's id → notFound() (the API + RLS answer 404).
//   • H1 = the primary item + the status chip; the order number (mono) and the checkout it belongs to;
//   • "Where it stands" = the buyer's events read (role labels and times — never a person) on the progress bar;
//   • the money: paid into escrow (the payment read's figure) / awaiting your payment + the Pay link ONLY for an order awaiting the buyer's
//     payment that is NOT an auction order (its balance payment is STORE-3c — refused by name) / pay on delivery; the bill rows (the API's,
//     they sum); "Deposit applied · Balance due" ONLY when the API says a deposit was applied (server figures, no client arithmetic);
//   • "I received it" — PC-56 STORE-5a · D1 (HOTFIX-7 Q1): for EVERY delivered order, with an inline confirm whose sentence differs by funding
//     (escrow: "this releases the payment to the organisation"; pay on delivery: "you paid in cash; nothing is released — this closes the
//     order") and the key minted here; the old "the organisation completes it" line is removed (false since 0217); the quality-window sentence
//     from the API's `qualityWindowEnds`, for paid orders only;
//   • PC-56 STORE-5a · C1 (F-11): the W290 review door on a completed order reads THIS store's `reviews` flag — ON: "Write a review" →
//     /<slug>/orders/[id]/review (the organisation's chrome); OFF: the honest sentence; `?status=reviewed` (W3146) says where it published;
//   • "Need to cancel?" → the cancel page while the API's `isCancellable` holds (through `ready`); a cancelled order says WHO ended it (from the
//     events) and what happened to the money (the refund read: nothing was paid / starting / requested / refunded with its reference);
//   • the dispute door only when the store's `disputes` flag is ON (founder D2) — else "not available in this store"; the returns form is gone;
//   • a load error is not a 404: said, with a Retry (a reload) and Back to the list; the refusals by name; the platform's trust mark.
//   • PC-56 STORE-3b · C4: an OFFER order links back to its thread ("from your offer") and prints the offer regime (founder D2: collection or
//     delivery arranged with the organisation; no delivery charge in this order). Nothing else changes here.
//   • PC-56 STORE-4b · C4 (founder D1): "Message the organisation about this order" (signed in — this page requires it — AND this store's
//     `communication` flag ON) → the buyer's ONE order thread with the organisation (keyed at render); 3a's `get_help` refusal is removed.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { randomUUID } from 'crypto';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { OrderDetail, OrderPaymentAttempts, OrderTimelineEvent, StorefrontFlags, InvoiceDownload } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { moneyText } from '../../../../features/discovery/money';
import { billRows } from '../../../../features/checkout/bill-rows';
import { reloadHref } from '../../../../features/home/load-result';
import { invoiceFileName } from '../../../../features/orders/invoice';
import { DISPUTE_REASONS } from '../../../../features/orders/buyer-actions';
import { payHref, confirmHref } from '../../../../features/store2c/checkout';
import { orderStatusKey, orderStatusTone } from '../../../../features/store3a/order-status';
import {
  ordersHref, orderHref, cancelHref, showsPayLink, showsReceivedAct, receivedConfirmKey, canCancel, showsDeadline,
  showsDepositRows, refundView, refundKey, cancelledBy, readOk, readCompleteOutcome, readDisputeError, canDispute, actKey, cancelReasonKey,
} from '../../../../features/store3a/orders';
import { poweredByVisible, PLATFORM_BRAND } from '../../../../features/branding/brand-theme';
import { BillRowsView } from '../../../../components/BillRowsView';
import { OrderTimeline, when } from '../../../../components/OrderTimeline';
import { RefusalList } from '../../../../components/RefusalList';
import { MessageOrgButton } from '../../../../components/MessageOrgButton';
import { showsMessageOrg } from '../../../../features/store4b/messages';
import { SubmitButton } from '../../../../components/SubmitButton';
import { PoweredByMark } from '../../../../components/PoweredByMark';
import { completeOrderAction, raiseDisputeAction } from './actions';
import { reviewHref } from '../../../../features/store5a/review';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('order.detailTitle'), robots: { index: false, follow: false } };
}

export default async function TenantOrderPage({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  await requireSession(orderHref(slug, params.id));
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(slug);

  let order: OrderDetail | null = null;
  try { order = await api.orders.get(params.id); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }
  if (!order) {
    return (
      <section className="kv-order" data-kv-store={slug}>
        <h1>{t.t('order.detailTitle')}</h1>
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store3a.detail.error')}</p>
          <a href={reloadHref(orderHref(slug, params.id), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          <Link href={ordersHref(slug)} className="kv-btn--link">{t.t('order.backToList')}</Link>
        </div>
        <RefusalList surface="order" />
      </section>
    );
  }

  // best-effort reads: a missing one degrades its section, never the page (Law 12)
  let events: OrderTimelineEvent[] | null = null;
  try { events = await api.orders.events(order.id); } catch { events = null; }
  let attempts: OrderPaymentAttempts | null = null;
  try { attempts = await api.payments.orderAttempts(order.id); } catch { attempts = null; }
  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  let invoice: InvoiceDownload | null = null;
  if (order.status === 'completed') { try { invoice = await api.payments.invoices.downloadUrl(order.id); } catch { invoice = null; } }

  const cur = order.currencyCode;
  const money = (minor: string | null | undefined, c: string | null = cur) => moneyText(minor ?? null, c, lang) ?? t.t('money.unavailable');
  const first = order.items[0];
  const ok = readOk(searchParams.ok);
  const received = readCompleteOutcome(searchParams.received);
  const disputeError = readDisputeError(searchParams.error);
  const confirming = searchParams.confirm === 'received';
  const paid = order.paymentState === 'paid';
  const refund = order.status === 'cancelled' ? refundView(attempts) : null;
  const by = order.status === 'cancelled' ? cancelledBy(events) : null;
  const paidAmount = attempts?.latest && ['success', 'refund_initiated', 'refunded', 'partially_refunded'].includes(String(attempts.latest.status)) ? attempts.latest.amountMinor : null;
  const disputesOn = flags?.disputes === true;
  const reviewed = searchParams.status === 'reviewed';   // STORE-5a · W3146
  /** A reason's label: the catalogue's (`order.cancelReason.<code>`), else the code itself (an organisation's own value has no catalogue entry). */
  const reasonLabel = (code: string) => { const k = cancelReasonKey(code); const v = t.t(k); return v === k ? code : v; };

  return (
    <section className="kv-order" data-kv-store={slug} data-kv-order={order.id} data-kv-status={order.status} data-kv-payment-state={order.paymentState}>
      <h1>
        {first ? t.t('store3a.row.item', { title: first.title_snapshot, qty: formatNumber(Number(first.quantity), lang), unit: first.unit_code }) : t.t('order.orderNo', { no: order.orderNo })}{' '}
        <span className={`kv-chip kv-chip--${orderStatusTone(order.status)}`} data-kv-chip={order.status}>{t.t(orderStatusKey(order.status))}</span>
      </h1>
      <p className="kv-detail__muted">
        <code className="kv-mono">{order.orderNo}</code>
        {order.createdAt && <> · {t.t('store3a.row.placed', { date: formatDate(order.createdAt, lang) })}</>}
        {order.checkoutGroupId && <> · <Link href={confirmHref(slug, order.id, order.checkoutGroupId)} className="kv-link" data-kv-group-link="checkout">{t.t('store3a.detail.checkoutGroup')}</Link></>}
      </p>
      {order.organisation && <p className="kv-detail__muted" data-kv-seller="organisation">{t.t('checkout.soldBy', { org: order.organisation.name })}</p>}
      {/* PC-56 STORE-3b · C4 (founder D2): an order made from an accepted offer says where it came from and the regime it runs under */}
      {order.source === 'offer' && (
        <div className="kv-detail__muted" data-kv-from-offer={order.offerId ?? 'unknown'}>
          {order.offerId && <p><Link href={`/${encodeURIComponent(slug)}/offers/${encodeURIComponent(order.offerId)}`} className="kv-link" data-kv-offer-link={order.offerId}>{t.t('store3b.order.fromOffer')}</Link></p>}
          <p data-kv-regime="offer">{t.t('store3b.regime')}</p>
        </div>
      )}

      {ok && <p className="kv-form__notice" role="status" data-kv-ok={ok}>{t.t(`store3a.ok.${ok}`)}</p>}
      {reviewed && <p className="kv-form__notice" role="status" data-kv-ok="reviewed">{t.t('store5a.published', { org: order.organisation?.name ?? t.t('store5a.theOrganisation') })}</p>}
      {received && <p className="kv-form__error" role="alert" data-kv-received-error={received}>{t.t(`store3a.received.err.${received}`)}</p>}
      {disputeError && <p className="kv-form__error" role="alert">{t.t(`order.error.${disputeError}`)}</p>}

      <section className="kv-order__section" aria-labelledby="where-h">
        <h2 id="where-h">{t.t('store3a.detail.where')}</h2>
        <OrderTimeline status={order.status} events={events} />
        {events === null && <p className="kv-detail__muted" data-kv-events="unavailable">{t.t('store3a.detail.eventsUnavailable')}</p>}
        {order.status === 'disputed' && <p className="kv-form__notice" data-kv-disputed="review">{t.t('store3a.detail.underReview')}</p>}
      </section>

      {order.status === 'cancelled' && (
        <section className="kv-order__section" aria-labelledby="cancel-h" data-kv-cancelled={by ?? 'unknown'}>
          <h2 id="cancel-h">{t.t('store3a.detail.cancelledTitle')}</h2>
          <p>{t.t(by ? `store3a.cancelledBy.${by}` : 'order.terminal.cancelled')}</p>
          {order.cancelReasonCode && <p className="kv-detail__muted" data-kv-reason={order.cancelReasonCode}>{t.t('store3a.detail.reason', { reason: reasonLabel(order.cancelReasonCode) })}</p>}
          {refund && (
            <p className={refund.kind === 'refunded' ? 'kv-form__notice' : 'kv-detail__muted'} data-kv-refund={refund.kind}>
              {t.t(refundKey(refund.kind), { amount: money(refund.amountMinor, refund.currencyCode ?? cur) })}
              {refund.reference && <> {t.t('store3a.refund.reference', { ref: refund.reference })}</>}
              {refund.completedAt && <> · <time dateTime={refund.completedAt}>{when(refund.completedAt, lang)}</time></>}
            </p>
          )}
        </section>
      )}

      <section className="kv-order__section" aria-labelledby="money-h">
        <h2 id="money-h">{t.t('store3a.detail.money')}</h2>
        {paid && <p data-kv-paid="escrow">{paidAmount ? t.t('store3a.pay.paid', { amount: money(paidAmount, attempts?.latest?.currencyCode ?? cur) }) : t.t('store3a.pay.paidNoAmount')}</p>}
        {order.paymentState === 'pending' && <p className="kv-form__error" data-kv-awaiting="payment">{t.t('store3a.row.awaitingPayment')}</p>}
        {showsPayLink(order) && <p><Link href={payHref(slug, order.id, order.checkoutGroupId ?? null)} className="kv-btn kv-btn--money" data-kv-pay={order.id}>{t.t('checkout.payThis')}</Link></p>}
        {order.paymentState === 'none' && order.status !== 'cancelled' && <p className="kv-detail__muted" data-kv-pay="on-delivery">{t.t('store3a.pay.onDelivery')}</p>}
        {showsDeadline(order) && <p className="kv-detail__muted" data-kv-deadline={order.id}>{t.t('store3a.row.deadline', { date: when(String(order.acceptanceDeadline), lang) })}</p>}
        <ul className="kv-confirm__items">
          {order.items.map((it) => (
            <li key={it.listing_id} className="kv-confirm__item">
              <span>{t.t('store3a.row.item', { title: it.title_snapshot, qty: formatNumber(Number(it.quantity), lang), unit: it.unit_code })}</span>
              <span>{money(it.line_total_minor)}</span>
              {order!.status === 'partially_fulfilled' && it.delivered_quantity != null && (
                <span className="kv-detail__muted" data-kv-delivered={it.listing_id}> {t.t('store3a.detail.deliveredQty', { qty: formatNumber(Number(it.delivered_quantity), lang), unit: it.unit_code })}</span>
              )}
            </li>
          ))}
        </ul>
        <BillRowsView bill={billRows(order)} />
        {showsDepositRows(order) && (
          <div className="kv-confirm__totals" data-kv-deposit="applied">
            <p className="kv-confirm__row" data-kv-row="deposit"><span>{t.t('store3a.bill.deposit')}</span> <span><span aria-hidden="true">−</span>{money(order.depositAppliedMinor)}</span></p>
            <p className="kv-confirm__row kv-confirm__row--total" data-kv-row="due"><span>{t.t('store3a.bill.due')}</span> <strong>{money(order.amountDueMinor)}</strong></p>
          </div>
        )}
        {(paid || order.paymentState === 'pending') && <p className="kv-cart__note">{t.t('store2c.escrow')}</p>}
        {invoice && (
          <p className="kv-order__invoice">
            <a href={invoice.url} className="kv-link" download={invoiceFileName(invoice.invoiceNo)} target="_blank" rel="noopener noreferrer">{t.t('order.downloadInvoice', { no: invoice.invoiceNo })}</a>
          </p>
        )}
      </section>

      {showsReceivedAct(order) && (
        <section className="kv-order__section" aria-labelledby="received-h" data-kv-act="received">
          <h2 id="received-h">{t.t('store3a.received.title')}</h2>
          {paid && order.qualityWindowEnds && <p className="kv-detail__muted" data-kv-window="quality">{t.t('store3a.received.window', { date: when(order.qualityWindowEnds, lang) })}</p>}
          {confirming ? (
            <form action={completeOrderAction} className="kv-form" data-kv-confirm="received" data-kv-funding={paid ? 'escrow' : 'cash'}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="key" value={actKey('complete', order.id, randomUUID())} />
              <p><strong>{t.t(receivedConfirmKey(order))}</strong></p>
              <SubmitButton idle={t.t('store3a.received.yes')} busy={t.t('store3a.received.busy')} className="kv-btn kv-btn--money" />{' '}
              <Link href={orderHref(slug, order.id)} className="kv-btn--link">{t.t('store3a.received.notYet')}</Link>
            </form>
          ) : (
            <Link href={orderHref(slug, order.id, { confirm: 'received' })} className="kv-btn" data-kv-received="start">{t.t('store3a.received.cta')}</Link>
          )}
        </section>
      )}

      <div className="kv-cart__actions">
        {order.status === 'completed' && flags?.reviews === true && <Link href={reviewHref(slug, order.id)} className="kv-btn" data-kv-review="w290">{t.t('review.writeCta')}</Link>}
        {order.status === 'completed' && flags !== null && flags.reviews !== true && <span className="kv-detail__muted" data-kv-review="off">{t.t('store5a.ctaOff')}</span>}
        {canCancel(order.status) && <Link href={cancelHref(slug, order.id)} className="kv-btn kv-btn--muted" data-kv-cancel-door={order.id}>{t.t('store3a.detail.needCancel')}</Link>}
        {showsMessageOrg(true, flags) && <MessageOrgButton slug={slug} contextType="order" contextId={order.id} labelKey="store4b.entry.order" />}
        <Link href={ordersHref(slug)} className="kv-btn--link">{t.t('order.backToList')}</Link>
      </div>

      <section className="kv-order__section" aria-labelledby="problem-h" id="problem" data-kv-dispute={disputesOn ? 'on' : 'off'}>
        <h2 id="problem-h">{t.t('order.reportProblem')}</h2>
        {!disputesOn ? (
          <p className="kv-detail__muted">{t.t('store3a.dispute.off')}</p>
        ) : canDispute(order.status) ? (
          <form action={raiseDisputeAction} className="kv-form">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="key" value={`dispute:${order.id}:${randomUUID()}`} />
            <label htmlFor="d-reason" className="kv-form__label">{t.t('order.disputeReason')}</label>
            <select id="d-reason" name="reasonCode" className="kv-field__input" defaultValue="" required>
              <option value="" disabled>{t.t('order.disputeReasonChoose')}</option>
              {DISPUTE_REASONS.map((r) => <option key={r} value={r}>{t.t(`order.disputeReason.${r}`)}</option>)}
            </select>
            <label htmlFor="d-desc" className="kv-form__label">{t.t('order.disputeDesc')}</label>
            <textarea id="d-desc" name="description" className="kv-field__input" rows={3} maxLength={4000} />
            <SubmitButton idle={t.t('order.disputeBtn')} busy={t.t('store3a.received.busy')} />
          </form>
        ) : (
          <p className="kv-detail__muted">{t.t('store3a.dispute.notYet')}</p>
        )}
      </section>

      <RefusalList surface="order" />
      {poweredByVisible('escrow', null) && <PoweredByMark label={PLATFORM_BRAND.poweredByMark} />}
    </section>
  );
}
