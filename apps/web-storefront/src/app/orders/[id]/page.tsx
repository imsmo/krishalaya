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
import type { OrderDetail, Shipment, InvoiceDownload } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { OrderTimeline } from '../../../components/OrderTimeline';
import { orderTimeline, ORDER_STEPS } from '../../../features/orders/timeline';
import { invoiceFileName } from '../../../features/orders/invoice';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const t = getTranslator();
  return { title: t.t('order.detailTitle'), robots: { index: false, follow: false } };
}

export default async function OrderDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { status?: string } }) {
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
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages — external presigned S3 URL, not an app route */}
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
        <Link href="/orders" className="kv-btn--link">{t.t('order.backToList')}</Link>
      </div>
    </section>
  );
}
