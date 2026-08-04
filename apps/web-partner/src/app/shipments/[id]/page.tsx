// apps/web-partner/src/app/shipments/[id]/page.tsx · shipment detail + the delivery-lifecycle actions (GET
// shipments/:id; 404 → notFound). Each action (assign → schedule-pickup → picked-up → in-transit → at-hub →
// out-for-delivery → deliver / fail / cancel) is surfaced ONLY when the pure state machine says it's legal; the API
// re-enforces it (a 409 degrades to a notice). Money (charge / COD) via formatMoneyMinor from bigint-minor strings.
// Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { availableActions, statusKey, statusTone, type ShipmentRow, type ShipmentStatus } from '../../../features/logistics/shipment';
import {
  assignAction, schedulePickupAction, pickedUpAction, inTransitAction, atHubAction,
  outForDeliveryAction, deliverAction, failAction, cancelAction,
} from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ship.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['assign', 'schedulePickup', 'pickedUp', 'inTransit', 'atHub', 'outForDelivery', 'deliver', 'fail', 'cancel']);
const ERR = new Set(['partnerId', 'vehicleId', 'riderUserId', 'assignTarget', 'awbNo', 'scheduledPickupAt', 'windowMins', 'otp', 'podMediaId', 'reason', 'forbidden', 'notFound', 'illegal', 'generic']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}
function shortId(v: string | null, dash: string) { return v ? `${v.slice(0, 8)}…` : dash; }
function ts(v: string | null, locale: string, dash: string) { return v ? formatDate(v, locale, { dateStyle: 'medium', timeStyle: 'short' }) : dash; }
function money(v: string | null, dash: string) { return v === null ? dash : formatMoneyMinor(v, 'INR', 'en'); }

export default async function ShipmentDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let s: ShipmentRow | undefined;
  let notice: string | undefined;
  try {
    s = (await partnerClient().request<ShipmentRow>('GET', `shipments/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!s) {
    return <section><p className="kv-backlink"><Link href="/shipments">{t.t('ship.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const dash = t.t('common.dash');
  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const avail = new Set(availableActions(s.status as ShipmentStatus).map((a) => a.key));

  return (
    <section>
      <p className="kv-backlink"><Link href="/shipments">{t.t('ship.back')}</Link></p>
      <h1>{shortId(s.id, dash)}</h1>
      <p><span className={`kv-status kv-status--${statusTone(s.status)}`}>{t.t(statusKey(s.status))}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`ship.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`ship.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('ship.order')} value={shortId(s.orderId, dash)} />
        <Field label={t.t('ship.awb')} value={s.awbNo ?? dash} />
        <Field label={t.t('ship.partner')} value={shortId(s.partnerId, dash)} />
        <Field label={t.t('ship.vehicle')} value={shortId(s.vehicleId, dash)} />
        <Field label={t.t('ship.rider')} value={shortId(s.riderUserId, dash)} />
        <Field label={t.t('ship.scheduledPickup')} value={ts(s.scheduledPickupAt, 'en', dash)} />
        <Field label={t.t('ship.pickedUpAt')} value={ts(s.pickedUpAt, 'en', dash)} />
        <Field label={t.t('ship.deliveredAt')} value={ts(s.deliveredAt, 'en', dash)} />
        <Field label={t.t('ship.charge')} value={money(s.chargeMinor, dash)} />
        <Field label={t.t('ship.cod')} value={money(s.codMinor, dash)} />
        <Field label={t.t('ship.coldChain')} value={t.t(s.requiresColdChain ? 'common.yes' : 'common.no')} />
        <Field label={t.t('ship.created')} value={ts(s.createdAt, 'en', dash)} />
      </dl>

      <h2>{t.t('ship.actionsTitle')}</h2>
      {avail.size === 0 && <p className="kv-muted">{t.t('ship.noActions')}</p>}

      {avail.has('assign') && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('ship.act.assign')}</summary>
          <form action={assignAction} className="kv-form">
            <input type="hidden" name="id" value={s.id} />
            <p className="kv-field__hint">{t.t('ship.assignHint')}</p>
            <label htmlFor="a-partner" className="kv-field__label">{t.t('ship.partner')}</label>
            <input id="a-partner" name="partnerId" className="kv-input" placeholder={t.t('ship.uuidHint')} />
            <label htmlFor="a-vehicle" className="kv-field__label">{t.t('ship.vehicle')}</label>
            <input id="a-vehicle" name="vehicleId" className="kv-input" placeholder={t.t('ship.uuidHint')} />
            <label htmlFor="a-rider" className="kv-field__label">{t.t('ship.rider')}</label>
            <input id="a-rider" name="riderUserId" className="kv-input" placeholder={t.t('ship.uuidHint')} />
            <label htmlFor="a-awb" className="kv-field__label">{t.t('ship.awb')}</label>
            <input id="a-awb" name="awbNo" className="kv-input" maxLength={60} placeholder={t.t('ship.optionalHint')} />
            <button type="submit" className="kv-btn">{t.t('ship.act.assign')}</button>
          </form>
        </details>
      )}

      {avail.has('schedulePickup') && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('ship.act.schedulePickup')}</summary>
          <form action={schedulePickupAction} className="kv-form">
            <input type="hidden" name="id" value={s.id} />
            <label htmlFor="sp-at" className="kv-field__label">{t.t('ship.scheduledPickup')}</label>
            <input id="sp-at" name="scheduledPickupAt" className="kv-input" type="datetime-local" required />
            <label htmlFor="sp-win" className="kv-field__label">{t.t('ship.windowMins')}</label>
            <input id="sp-win" name="windowMins" className="kv-input" inputMode="numeric" placeholder={t.t('ship.optionalHint')} />
            <button type="submit" className="kv-btn">{t.t('ship.act.schedulePickup')}</button>
          </form>
        </details>
      )}

      {avail.has('deliver') && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('ship.act.deliver')}</summary>
          <form action={deliverAction} className="kv-form">
            <input type="hidden" name="id" value={s.id} />
            <p className="kv-field__hint">{t.t('ship.deliverHint')}</p>
            <label htmlFor="d-otp" className="kv-field__label">{t.t('ship.otp')}</label>
            <input id="d-otp" name="otp" className="kv-input" inputMode="numeric" required placeholder={t.t('ship.otpHint')} />
            <label htmlFor="d-pod" className="kv-field__label">{t.t('ship.podMediaId')}</label>
            <input id="d-pod" name="podMediaId" className="kv-input" placeholder={t.t('ship.optionalHint')} />
            <button type="submit" className="kv-btn">{t.t('ship.act.deliver')}</button>
          </form>
        </details>
      )}

      {avail.has('fail') && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('ship.act.fail')}</summary>
          <form action={failAction} className="kv-form">
            <input type="hidden" name="id" value={s.id} />
            <label htmlFor="f-reason" className="kv-field__label">{t.t('ship.failReason')}</label>
            <textarea id="f-reason" name="reason" className="kv-input" rows={2} required maxLength={500} />
            <button type="submit" className="kv-btn kv-btn--danger">{t.t('ship.act.fail')}</button>
          </form>
        </details>
      )}

      <div className="kv-actions">
        {avail.has('pickedUp') && <form action={pickedUpAction}><input type="hidden" name="id" value={s.id} /><button type="submit" className="kv-btn">{t.t('ship.act.pickedUp')}</button></form>}
        {avail.has('inTransit') && <form action={inTransitAction}><input type="hidden" name="id" value={s.id} /><button type="submit" className="kv-btn">{t.t('ship.act.inTransit')}</button></form>}
        {avail.has('atHub') && <form action={atHubAction}><input type="hidden" name="id" value={s.id} /><button type="submit" className="kv-btn">{t.t('ship.act.atHub')}</button></form>}
        {avail.has('outForDelivery') && <form action={outForDeliveryAction}><input type="hidden" name="id" value={s.id} /><button type="submit" className="kv-btn">{t.t('ship.act.outForDelivery')}</button></form>}
        {avail.has('cancel') && <form action={cancelAction}><input type="hidden" name="id" value={s.id} /><button type="submit" className="kv-btn kv-btn--danger">{t.t('ship.act.cancel')}</button></form>}
      </div>
    </section>
  );
}
