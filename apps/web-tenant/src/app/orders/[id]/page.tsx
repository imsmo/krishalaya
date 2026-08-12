// apps/web-tenant/src/app/orders/[id]/page.tsx · seller order detail + fulfilment. Server-first: requireSession
// gates it, orders.get(id) returns the order (tenant-scoped server-side; a missing/foreign id → notFound() = the
// IDOR guard). Renders line items + server-computed totals (formatMoneyMinor — never a float), surfaces only the
// LEGAL lifecycle actions for the current status (features/orders/lifecycle.ts, unit-tested), and a shipment
// section: view status/AWB and, where a shipment needs proof-of-delivery, a deliver form (buyer OTP + optional PoD
// photo). All copy via i18n; degrades on read failure; noindex.
//
// SDK note (not a gap, just a limit): the shipments resource exposes deliver(OTP) but no create/assign/AWB-setter,
// so AWB + carrier are shown read-only — we never fake an editor for fields the SDK can't write.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { sellerActions } from '../../../features/orders/lifecycle';
import { orderTransitionAction, deliverShipmentAction } from './actions';
import { MediaUploader } from '../../../components/MediaUploader';
import { invoiceFileName } from '../../../features/orders/invoice';
import { basisKey, showMoneyLine, snapshotKey } from '../../../features/orders/console';
import type { OrderMoneyBox, OrderTimelineEvent } from '@krishalaya/sdk-js';
import type { OrderDetail, Shipment, InvoiceDownload } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('orderDetail.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['action', 'illegal', 'otp', 'deliver']);

export default async function OrderDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/orders/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let order: OrderDetail;
  try { order = await tenantClient().orders.get(params.id); }
  catch { notFound(); }

  // Shipments are best-effort context; a failure here must not break the order page (Law 12).
  let shipments: Shipment[] = [];
  try { shipments = (await tenantClient().shipments.list({ box: 'all', orderId: order.id, limit: 20 })).items; }
  catch { shipments = []; }

  // Invoice PDF (PC-20, 2026-08-04): the invoices endpoint is ownership-gated to the order's buyer OR SELLER, so
  // the seller console offers the same best-effort presigned download the storefront ships — omitted (never faked)
  // when the invoice/PDF isn't generated yet.
  let invoice: InvoiceDownload | null = null;
  try { invoice = await tenantClient().payments.invoices.downloadUrl(order.id); }
  catch { invoice = null; }

  const actions = sellerActions(order.status);
  const okKey = searchParams.ok ?? null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const money = (m: string) => formatMoneyMinor(m, order.currencyCode, lang);

  const totals: Array<[string, string]> = [
    [t.t('orderDetail.subtotal'), money(order.subtotalMinor)],
    [t.t('orderDetail.delivery'), money(order.deliveryFeeMinor)],
    [t.t('orderDetail.discount'), money(order.discountMinor)],
    [t.t('orderDetail.tax'), money(order.taxMinor)],
    [t.t('orderDetail.commission'), money(order.commissionMinor)],
    [t.t('orderDetail.total'), money(order.totalMinor)],
  ];

  // ---- PC-56 TENANT-3a · W134's timeline + money box. Both degrade to absence: a card that cannot load must
  // never take the order page down with it (Law 12). ----
  let events: OrderTimelineEvent[] = []; let eventsFailed = false;
  try { events = await tenantClient().orders.events(params.id); } catch { eventsFailed = true; }
  let moneyBox: OrderMoneyBox | null = null;   // (`money` is already this file's formatter — kept distinct)
  try { moneyBox = await tenantClient().orders.money(params.id); } catch { moneyBox = null; }

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('orderDetail.heading', { orderNo: order.orderNo })}</h1>
        <Link href="/orders" className="kv-btn--link">← {t.t('orders.title')}</Link>
      </div>
      <p className="kv-muted"><span className="kv-badge">{order.status}</span>{order.createdAt ? ` · ${formatDate(order.createdAt, lang)}` : ''}</p>

      {okKey && <p className="kv-success" role="status">{t.t('orderDetail.done')}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`orderDetail.error.${errorKey}`)}</p>}

      <h2 className="kv-section-title">{t.t('orderDetail.items')}</h2>
      <table className="kv-table">
        <thead><tr>
          <th>{t.t('orderDetail.colItem')}</th><th>{t.t('orderDetail.colQty')}</th>
          <th>{t.t('orderDetail.colUnitPrice')}</th><th>{t.t('orderDetail.colLineTotal')}</th>
        </tr></thead>
        <tbody>
          {order.items.map((it, i) => (
            <tr key={`${it.listing_id}-${i}`}>
              <td>{it.title_snapshot}</td>
              <td>{it.quantity} {it.unit_code}</td>
              <td>{money(it.unit_price_minor)}</td>
              <td>{money(it.line_total_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {invoice && (
        <p>
          <a className="kv-btn--link" href={invoice.url} download={invoiceFileName(invoice.invoiceNo)} rel="noopener">
            {t.t('orderDetail.invoiceDownload', { invoiceNo: invoice.invoiceNo })}
          </a>
        </p>
      )}

      <dl className="kv-facts kv-facts--totals">
        {totals.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      {actions.length > 0 && (
        <div className="kv-actions">
          <h2 className="kv-section-title">{t.t('orderDetail.actions')}</h2>
          {actions.map((a) => (
            <form key={a} action={orderTransitionAction} className="kv-inline-form">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="action" value={a} />
              <button type="submit" className={`kv-btn${a === 'cancel' ? ' kv-btn--muted' : ''}`}>{t.t(`orderDetail.action.${a}`)}</button>
            </form>
          ))}
        </div>
      )}

      <h2 className="kv-section-title">{t.t('orderDetail.shipment')}</h2>
      {shipments.length === 0 ? (
        <p className="kv-empty-state">{t.t('orderDetail.noShipment')}</p>
      ) : shipments.map((s) => (
        <div key={s.id} className="kv-card">
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('orderDetail.shipStatus')}</dt><dd><span className="kv-badge">{s.status}</span></dd></div>
            <div className="kv-facts__row"><dt>{t.t('orderDetail.awb')}</dt><dd>{s.awbNo ?? t.t('common.dash')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('orderDetail.deliveredAt')}</dt><dd>{s.deliveredAt ? formatDate(s.deliveredAt, lang) : t.t('common.dash')}</dd></div>
          </dl>
          {s.requiresOtp && !s.deliveredAt && (
            <form action={deliverShipmentAction} className="kv-form">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="shipmentId" value={s.id} />
              <label htmlFor={`otp-${s.id}`} className="kv-field__label">{t.t('orderDetail.otpLabel')}</label>
              <input id={`otp-${s.id}`} name="otp" inputMode="numeric" pattern="\d{4,8}" className="kv-input" required autoComplete="one-time-code" />
              <span className="kv-field__label">{t.t('orderDetail.podLabel')}</span>
              <MediaUploader fieldName="podMediaId" single labels={{
                add: t.t('listingNew.mediaAdd'), hint: t.t('orderDetail.podHint'),
                uploading: t.t('listingNew.mediaUploading'), failed: t.t('listingNew.mediaFailed'), remove: t.t('listingNew.mediaRemove'),
              }} />
              <button type="submit" className="kv-btn">{t.t('orderDetail.markDelivered')}</button>
            </form>
          )}
        </div>
      ))}
      {/* ---- W134's timeline: order_events, recorded on every hop since 0005 and read here for the first time ---- */}
      <h2 className="kv-section-title">{t.t('od.timeline')}</h2>
      {eventsFailed ? (
        <p className="kv-fine">{t.t('od.timelineFailed')}</p>
      ) : events.length === 0 ? (
        <p className="kv-empty-state">{t.t('od.timelineEmpty')}</p>
      ) : (
        <ul>
          {events.map((e, i) => (
            <li key={i}>
              <span className="kv-badge">{e.toStatus}</span>{' '}
              {e.fromStatus && <span className="kv-fine">{t.t('od.from', { from: e.fromStatus })} </span>}
              {formatDate(e.at, lang)}
              {e.actorName && <span className="kv-fine"> · {e.actorName}</span>}
              {e.note && <span className="kv-fine"> · {e.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* ---- W134's money box: the FROZEN figures, each with the basis its number comes from ---- */}
      <h2 className="kv-section-title">{t.t('od.moneyHeading')}</h2>
      {moneyBox ? (
        <>
          <dl className="kv-facts">
            {moneyBox.lines.filter(showMoneyLine).map((l) => (
              <div key={l.key} className="kv-facts__row">
                <dt>{t.t(`od.line.${l.key}` as never)}</dt>
                <dd>
                  {formatMoneyMinor(l.minor, moneyBox!.currencyCode, lang)}
                  <div className="kv-detail__muted">{t.t(`od.basis.${basisKey(l.basis)}` as never)}</div>
                </dd>
              </div>
            ))}
          </dl>
          <p className="kv-fine">{t.t('od.buyerPaid', { total: formatMoneyMinor(moneyBox.buyerPaidMinor, moneyBox.currencyCode, lang) })}</p>
          <p className="kv-fine">{t.t('od.sellerGross', { gross: formatMoneyMinor(moneyBox.sellerGrossMinor, moneyBox.currencyCode, lang) })}</p>
          {/* The snapshot verdict — including the one that cannot be recovered. */}
          <p className="kv-fine kv-note">{t.t(`od.snapshot.${snapshotKey(moneyBox.snapshot)}` as never)}</p>
          <p className="kv-fine">{t.t('od.tdsNote')}</p>
        </>
      ) : (
        <p className="kv-fine">{t.t('od.moneyFailed')}</p>
      )}
    </section>
  );
}
