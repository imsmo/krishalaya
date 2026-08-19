// apps/web-tenant/src/app/logistics/[id]/page.tsx · W227 (Shipment detail) — the dispatcher's page
// (PC-56 TENANT-5a). shipments.get is tenant-scoped server-side; a missing/foreign id → notFound() (IDOR guard).
// The DELIVER mutation still lives only on the order detail page (single mutation home) and this page links there.
//
// WHAT CHANGED, AND WHY IT IS THE WHOLE POINT OF W227:
//   • **the three actions this page exists for could not be called from any screen.** `POST :id/assign`,
//     `:id/schedule-pickup` and `:id/cancel` have existed on the API since the module was built and the SDK
//     had no method for any of them, so the canon's assign panel and cancel form had nothing behind them;
//   • the JOURNEY PLAN W227 draws in three numbered steps is rendered from the shipment's real status —
//     and its two weighbridge slips are shown as NOT BUILT, because there is no weighbridge anywhere in this
//     platform. W225 stakes a tick on it ("Weighbridge slips both ends — the 2-qtl dispute taught us; now
//     it's physics") and W227 stakes its whole dispute-prevention story on slip #1 vs slip #2. Drawing them
//     as part of a completed step would tell an FPO that 998 kg was weighed at both ends when nothing
//     weighed anything — which is the evidence they would reach for in exactly the dispute the canon
//     describes;
//   • and POSSESSION is reported for what it can actually prove. `shipments.pickup_otp_hash` existed
//     unwritten from 0007 to 0151, so every shipment created before this wave proves the delivery end only.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import type { Shipment } from '@krishalaya/sdk-js';
import { canDispatch, milestoneKey, possessionIsProven, possessionKey, refusalKey, stepVerdict, weighbridgeVerdict } from '../../../features/logistics/shipments';
import { assignAction, schedulePickupAction, cancelShipmentAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('logistics.detailTitle'), robots: { index: false, follow: false } };
}

export default async function ShipmentDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { error?: string; ok?: string } }) {
  await requireSession(`/logistics/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let s: Shipment & { possessionProof?: 'both_ends' | 'delivery_only' | 'pickup_only' | 'neither'; deliveryAttempts?: number; nextMilestone?: Parameters<typeof milestoneKey>[0] };
  try { s = await tenantClient().shipments.get(params.id) as typeof s; }
  catch { notFound(); }

  const proof = s.possessionProof ?? 'neither';
  const dispatchable = canDispatch(s, true);

  const facts: Array<[string, string]> = [
    [t.t('logistics.colStatus'), t.t(`logistics.status.${s.status}`) || s.status],
    [t.t('logistics.awb'), s.awbNo ?? t.t('common.dash')],
    [t.t('logistics.colPickup'), s.scheduledPickupAt ? formatDate(s.scheduledPickupAt, lang) : t.t('common.dash')],
    [t.t('logistics.pickedUp'), s.pickedUpAt ? formatDate(s.pickedUpAt, lang) : t.t('common.dash')],
    [t.t('logistics.colDelivered'), s.deliveredAt ? formatDate(s.deliveredAt, lang) : t.t('common.dash')],
    [t.t('logistics.colOtp'), s.requiresOtp ? t.t('logistics.otpYes') : t.t('common.dash')],
    [t.t('logistics.pod'), s.podMediaId ? t.t('logistics.podYes') : t.t('common.dash')],
    // The attempt counter W226's "one free re-attempt" needs to be a number rather than an adjective.
    [t.t('ship.attempts'), String(s.deliveryAttempts ?? 0)],
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('logistics.detailTitle')}</h1>
        <Link href="/logistics" className="kv-btn--link">← {t.t('logistics.title')}</Link>
      </div>

      <dl className="kv-facts">
        {facts.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      {/* The refusal the money gate can now return, translated BY NAME. W226 prints "payment clears first"
          and until this wave nothing enforced it. */}
      {searchParams?.error && <p className="kv-error" role="alert">{t.t(refusalKey(String(searchParams.error)))}</p>}
      {searchParams?.ok && <p className="kv-card kv-card--notice" role="status">{t.t(`ship.ok.${String(searchParams.ok)}`)}</p>}

      {/* W225's tick, honestly. Only a shipment holding BOTH codes renders as proven. */}
      <p className={possessionIsProven(proof) ? 'kv-field__hint' : 'kv-card kv-card--notice'} role={possessionIsProven(proof) ? undefined : 'status'}>
        {t.t(possessionKey(proof))}
      </p>

      <h2>{t.t('ship.journey')}</h2>
      <ol className="kv-steps">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} data-verdict={stepVerdict(n, s.status)}>
            <strong>{t.t(`ship.step.${n}`)}</strong> — {t.t(`ship.verdict.${stepVerdict(n, s.status)}`)}
            {/* Steps 1 and 3 each name a weighbridge slip in the canon. Neither exists. */}
            {(n === 1 || n === 3) && (
              <span className="kv-badge kv-badge--warn"> {t.t(`ship.verdict.${weighbridgeVerdict()}`)} · {t.t('ship.weighbridge')}</span>
            )}
          </li>
        ))}
      </ol>

      {dispatchable && (
        <>
          <h2>{t.t('ship.assign')}</h2>
          <form action={assignAction} className="kv-inline-form">
            <input type="hidden" name="id" value={s.id} />
            <label htmlFor="a-rider" className="kv-field__label">{t.t('ship.rider')}</label>
            <input id="a-rider" name="riderUserId" className="kv-input" placeholder={t.t('ship.riderPlaceholder')} />
            <label htmlFor="a-vehicle" className="kv-field__label">{t.t('ship.vehicle')}</label>
            <input id="a-vehicle" name="vehicleId" className="kv-input" placeholder={t.t('ship.vehiclePlaceholder')} />
            <button type="submit" className="kv-btn">{t.t('ship.assignAction')}</button>
          </form>

          <h2>{t.t('ship.schedulePickup')}</h2>
          <form action={schedulePickupAction} className="kv-inline-form">
            <input type="hidden" name="id" value={s.id} />
            <label htmlFor="p-at" className="kv-field__label">{t.t('ship.pickupAt')}</label>
            <input id="p-at" name="scheduledPickupAt" type="datetime-local" className="kv-input" required />
            <label htmlFor="p-win" className="kv-field__label">{t.t('ship.window')}</label>
            <input id="p-win" name="windowMins" type="number" min={0} max={1440} defaultValue={30} className="kv-input" />
            <label htmlFor="p-own" className="kv-field__label">
              <input id="p-own" name="fromOwnPremises" type="checkbox" /> {t.t('ship.fromOwnPremises')}
            </label>
            <button type="submit" className="kv-btn">{t.t('ship.scheduleAction')}</button>
          </form>
          <p className="kv-field__hint">{t.t('ship.pickupOtpNote')}</p>
        </>
      )}

      <h2>{t.t('ship.cancel')}</h2>
      <form action={cancelShipmentAction} className="kv-inline-form">
        <input type="hidden" name="id" value={s.id} />
        <label htmlFor="c-reason" className="kv-field__label">{t.t('ship.cancelReason')}</label>
        <select id="c-reason" name="reason" className="kv-input" required defaultValue="">
          <option value="" disabled>{t.t('ship.cancelReasonPick')}</option>
          {['buyer_rescheduled', 'weather_hold', 'vehicle_breakdown'].map((r) => (
            <option key={r} value={r}>{t.t(`ship.cancelReason.${r}`)}</option>
          ))}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('ship.cancelAction')}</button>
      </form>
      {/* W227, verbatim: "This action is recorded · order stays confirmed — cancelling transport never
          cancels the sale." That is true of this platform and worth saying on the button. */}
      <p className="kv-field__hint">{t.t('ship.cancelNote')}</p>

      <p>
        <Link href={`/logistics/${s.id}/tracking`} className="kv-btn kv-btn--muted">{t.t('ship.tracking.title')}</Link>{' '}
        <Link href={`/orders/${s.orderId}`} className="kv-btn">{t.t('logistics.openOrder')}</Link>
      </p>
      <p className="kv-field__hint">{t.t('logistics.deliverNote')}</p>
    </section>
  );
}
