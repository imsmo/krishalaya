// apps/web-storefront/src/app/orders/[id]/page.tsx · one order's detail. PROTECTED + dynamic. Reads the order via
// the authed SDK; a missing/foreign id → notFound() (the API + RLS only return the caller's own order — no IDOR).
// Renders the status timeline, line items, the server-computed totals breakdown, and shipment tracking
// (shipments.list by order — degrades to "no shipment yet" if the logistics flag is off or none exist). Money via
// formatMoneyMinor, timestamps via formatDate (Law 2, Law 12).
//
// P1-4: a completed order offers a real **invoice PDF download** via `payments.invoices.downloadUrl(orderId)` (a
// short-lived presigned GET, ownership-gated server-side). We fetch it best-effort and render a download link only
// when the PDF is actually available — if the invoice isn't generated yet (renderer disabled / not completed) the
// SDK throws and we simply omit the link (no fabricated download). Filenames via the pure invoiceFileName helper.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { OrderDetail, Shipment, InvoiceDownload, ReturnCase } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { OrderTimeline } from '../../../components/OrderTimeline';
import { orderTimeline, ORDER_STEPS } from '../../../features/orders/timeline';
import { invoiceFileName } from '../../../features/orders/invoice';
import { canCancelOrder, canRequestReturn, returnAlreadyOpen, DISPUTE_REASONS } from '../../../features/orders/buyer-actions';
import { cancelOrderAction, raiseDisputeAction, requestReturnAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {   // the title is a static translation; the id is never in it (noindex page)
  const t = getTranslator();
  return { title: t.t('order.detailTitle'), robots: { index: false, follow: false } };
}

const BUYER_OK = new Set(['cancelled', 'dispute', 'return']);
const BUYER_ERR = new Set(['cancel', 'cancel_illegal', 'dispute', 'dispute_reason', 'dispute_description', 'dispute_dup',
  'return', 'return_reason', 'return_dup', 'return_ineligible']);

export default async function OrderDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { status?: string; ok?: string; error?: string } }) {
  await requireSession(`/orders/${encodeURIComponent(params.id)}`);
  const t = getTranslator();
  const lang = getLang();

  let order: OrderDetail | null = null;
  try { order = await serverClient().orders.get(params.id); }
  catch (e) { if (e instanceof SdkError && e.isNotFound) notFound(); order = null; }

  if (!order) {
    return <section className="kv-order"><h1>{t.t('order.detailTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('order.loadError')}</p></section>;
  }

  // Shipment tracking is optional/flagged on the API — never let its absence break the order page.
  let shipments: Shipment[] = [];
  try { shipments = (await serverClient().shipments.list({ orderId: order.id })).items; } catch { shipments = []; }

  // PC-55 B8: does this order already have a return case? Read the buyer's own box and match on order id — the
  // list is small and buyer-scoped server-side. Best-effort: the returns rail being unavailable must not break the
  // order page (Law 12), but note the consequence — with no read we show the FORM, and a duplicate request then
  // fails as a 409 the action translates into "you already asked". That is the safe direction: the buyer may see one
  // redundant refusal, never a silently-lost request.
  let existingReturn: ReturnCase | null = null;
  try {
    const mine = await serverClient().returns.list({ box: 'mine', limit: 50 });
    existingReturn = mine.items.find((r) => r.orderId === order!.id) ?? null;
  } catch { existingReturn = null; }

  // Invoice PDF (P1-4): best-effort presigned download — omitted when the invoice/PDF isn't available yet.
  let invoice: InvoiceDownload | null = null;
  try { invoice = await serverClient().payments.invoices.downloadUrl(order.id); } catch { invoice = null; }

  const cur = order.currencyCode;
  const ts = (v?: string | null) => (v ? formatDate(v, lang) : null);
  const isComplete = orderTimeline(order.status).currentIndex === ORDER_STEPS.length - 1;

  return (
    <section className="kv-order">
      <h1>{t.t('order.orderNo', { no: order.orderNo })}</h1>

      {searchParams.status === 'reviewed' && <p className="kv-form__notice" role="status">{t.t('review.thanks')}</p>}
      {searchParams.ok && BUYER_OK.has(searchParams.ok) && <p className="kv-form__notice" role="status">{t.t(`order.ok.${searchParams.ok}`)}</p>}
      {searchParams.error && BUYER_ERR.has(searchParams.error) && <p className="kv-form__error" role="alert">{t.t(`order.error.${searchParams.error}`)}</p>}

      <OrderTimeline status={order.status} />

      <section className="kv-order__section" aria-labelledby="items-h">
        <h2 id="items-h">{t.t('order.items')}</h2>
        <ul className="kv-confirm__items">
          {order.items.map((it) => (
            <li key={it.listing_id} className="kv-confirm__item">
              <span>{it.title_snapshot} × {it.quantity} {it.unit_code}</span>
              <span>{formatMoneyMinor(it.line_total_minor, cur, lang)}</span>
            </li>
          ))}
        </ul>
        <div className="kv-confirm__totals">
          <p className="kv-confirm__row"><span>{t.t('cart.subtotal')}</span> <span>{formatMoneyMinor(order.subtotalMinor, cur, lang)}</span></p>
          <p className="kv-confirm__row"><span>{t.t('checkout.delivery')}</span> <span>{formatMoneyMinor(order.deliveryFeeMinor, cur, lang)}</span></p>
          {order.discountMinor !== '0' && <p className="kv-confirm__row"><span>{t.t('checkout.discount')}</span> <span>{formatMoneyMinor(order.discountMinor, cur, lang)}</span></p>}
          <p className="kv-confirm__row"><span>{t.t('checkout.tax')}</span> <span>{formatMoneyMinor(order.taxMinor, cur, lang)}</span></p>
          <p className="kv-confirm__row kv-confirm__row--total"><span>{t.t('checkout.total')}</span> <strong>{formatMoneyMinor(order.totalMinor, cur, lang)}</strong></p>
        </div>
        {invoice && (
          <p className="kv-order__invoice">
            {/* Plain <a>: an external presigned S3 URL, not an app route. (Next's @next/next/* rules are not part of
                this repo's flat ESLint config — naming one in a disable directive is itself an error.) */}
            <a href={invoice.url} className="kv-link" download={invoiceFileName(invoice.invoiceNo)} target="_blank" rel="noopener noreferrer">
              {t.t('order.downloadInvoice', { no: invoice.invoiceNo })}
            </a>
          </p>
        )}
      </section>

      <section className="kv-order__section" aria-labelledby="ship-h">
        <h2 id="ship-h">{t.t('order.tracking')}</h2>
        {shipments.length === 0 ? (
          <p className="kv-detail__muted">{t.t('order.noShipment')}</p>
        ) : (
          <ul className="kv-order__shipments">
            {shipments.map((s) => (
              <li key={s.id} className="kv-order__shipment">
                <p className="kv-order__shipstatus">{t.t('order.shipmentStatus')}: <strong>{s.status}</strong></p>
                {s.awbNo && <p className="kv-detail__muted">{t.t('order.awb')}: {s.awbNo}</p>}
                {ts(s.scheduledPickupAt) && <p className="kv-detail__muted">{t.t('order.scheduledPickup')}: {ts(s.scheduledPickupAt)}</p>}
                {ts(s.pickedUpAt) && <p className="kv-detail__muted">{t.t('order.pickedUp')}: {ts(s.pickedUpAt)}</p>}
                {ts(s.deliveredAt) && <p className="kv-detail__muted">{t.t('order.delivered')}: {ts(s.deliveredAt)}</p>}
                {s.requiresOtp && <p className="kv-detail__muted">{t.t('order.otpNote')}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="kv-cart__actions">
        {isComplete && <Link href={`/orders/${encodeURIComponent(order.id)}/review`} className="kv-btn">{t.t('review.writeCta')}</Link>}
        {canCancelOrder(order.status) && (
          <form action={cancelOrderAction} className="kv-inline-form">
            <input type="hidden" name="id" value={order.id} />
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('order.cancelBtn')}</button>
          </form>
        )}
        <Link href="/orders" className="kv-btn--link">{t.t('order.backToList')}</Link>
      </div>

      {/* PC-55 B8: return the goods → returns.request. Shown only on a delivered/completed order, and replaced by
          the case's own status once one exists — a buyer who already asked needs the state, not a second form. */}
      {canRequestReturn(order.status) && (
        existingReturn ? (
          <section className="kv-form__card" aria-labelledby="ret-h">
            <h2 id="ret-h">{t.t('order.returnTitle')}</h2>
            <p><strong>{t.t(`returns.status.${existingReturn.status}`)}</strong></p>
            {existingReturn.reasonCode && <p className="kv-detail__muted">{t.t(`order.disputeReason.${existingReturn.reasonCode}`)}</p>}
            {returnAlreadyOpen(existingReturn.status) && <p className="kv-detail__muted">{t.t('order.returnOpenHint')}</p>}
            {existingReturn.status === 'approved' && <p className="kv-detail__muted">{t.t('order.returnShipHint')}</p>}
            {/* The API serves the refund's wallet TRANSACTION, not an amount — so we say the refund was issued and
                point at the wallet, rather than printing a number this page did not receive (Law 2). */}
            {existingReturn.status === 'refunded' && <p>{t.t('order.returnRefunded')}</p>}
          </section>
        ) : (
          <details className="kv-form__card">
            <summary>{t.t('order.returnTitle')}</summary>
            <form action={requestReturnAction} className="kv-form">
              <input type="hidden" name="id" value={order.id} />
              <label htmlFor="r-reason" className="kv-form__label">{t.t('order.returnReason')}</label>
              <select id="r-reason" name="reasonCode" className="kv-field__input" defaultValue="" required>
                <option value="" disabled>{t.t('order.disputeReasonChoose')}</option>
                {DISPUTE_REASONS.map((r) => <option key={r} value={r}>{t.t(`order.disputeReason.${r}`)}</option>)}
              </select>
              <p className="kv-detail__muted">{t.t('order.returnHint')}</p>
              <button type="submit" className="kv-btn">{t.t('order.returnBtn')}</button>
            </form>
          </details>
        )
      )}

      {/* PC-24b: report a problem → disputes.raise (server enforces eligibility + one-per-order). */}
      <details className="kv-form__card">
        <summary>{t.t('order.reportProblem')}</summary>
        <form action={raiseDisputeAction} className="kv-form">
          <input type="hidden" name="id" value={order.id} />
          <label htmlFor="d-reason" className="kv-form__label">{t.t('order.disputeReason')}</label>
          <select id="d-reason" name="reasonCode" className="kv-field__input" defaultValue="" required>
            <option value="" disabled>{t.t('order.disputeReasonChoose')}</option>
            {DISPUTE_REASONS.map((r) => <option key={r} value={r}>{t.t(`order.disputeReason.${r}`)}</option>)}
          </select>
          <label htmlFor="d-desc" className="kv-form__label">{t.t('order.disputeDesc')}</label>
          <textarea id="d-desc" name="description" className="kv-field__input" rows={3} maxLength={4000} />
          <p className="kv-detail__muted">{t.t('order.disputeHint')}</p>
          <button type="submit" className="kv-btn">{t.t('order.disputeBtn')}</button>
        </form>
      </details>
    </section>
  );
}
