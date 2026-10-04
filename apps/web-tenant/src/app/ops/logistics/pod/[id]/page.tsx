// apps/web-tenant/src/app/ops/logistics/pod/[id]/page.tsx · W238 · one POD review — PC-56 TENANT-SW-a.
//
// The evidence the delivery left (photo on file, OTP verified, when), who drove and who dispatched (the dispatcher is recorded only for
// shipments sent out after 0196 — said so on the page), the 2-hour timer, and what has been decided. Acts (each through the mutate chain):
// flag (holds settlement), approve a flagged POD (releases it), propose a reject (≥ 10 characters), confirm a reject — a DIFFERENT person,
// which opens a qty_mismatch dispute carrying the POD evidence. Weighbridge slips: not recorded on this platform (refused by name).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { PodReview } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { POD_HREF, isUuid, pageState, podTimerLeftMinutes } from '../../../../../features/swa/console';
import { AsOf } from '../../../../../components/AsOf';
import { asOfLabels } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.pod.detailTitle'), robots: { index: false, follow: false } }; }

export default async function PodDetailPage({ params }: { params: { id: string } }) {
  const href = `${POD_HREF}/${params.id}`;
  await requireSession(href);
  const t = getTranslator(); const lang = getLang();
  let r: PodReview | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { r = await tenantClient().shipments.podReview(params.id); }
    catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, false); }
  }
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));
  const who = (id: string | null) => (id ? `${id.slice(0, 8)}…` : t.t('common.dash'));
  const left = r && r.status === 'awaiting' ? podTimerLeftMinutes(r.timerDueAt) : null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.pod.title')}><Link href={POD_HREF}>{t.t('swa.pod.title')}</Link> / <span aria-current="page">{t.t('swa.pod.detailTitle')}</span></nav>
      <h1>{t.t('swa.pod.detailTitle')}</h1>
      {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
      <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
      {state || !r ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swa.pod.state.${state ?? 'error'}.title`)}</strong><p>{t.t(`swa.pod.state.${state ?? 'error'}.body`)}</p>
          <p><Link href={POD_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      ) : (
        <>
          <p><span className="kv-badge">{t.t(`swa.pod.status.${r.status}`)}</span>{left !== null && <> · {left === 0 ? t.t('swa.pod.timer.due') : t.t('swa.pod.timer.left', { h: String(Math.floor(left / 60)), m: String(left % 60) })}</>}</p>
          {r.youDroveOrDispatched && <p className="kv-notice" role="note">{t.t('swa.pod.youDroveBody')}</p>}
          <div className="kv-card">
            <h2>{t.t('swa.pod.evidence')}</h2>
            <dl className="kv-detail">
              <dt>{t.t('swa.pod.col.shipment')}</dt><dd><code>{r.shipmentId}</code></dd>
              <dt>{t.t('swa.pod.col.order')}</dt><dd><Link href={`/orders/${r.orderId}`} className="kv-btn--link">{r.orderId.slice(0, 8)}…</Link></dd>
              <dt>{t.t('swa.pod.col.delivered')}</dt><dd>{when(r.deliveredAt)}</dd>
              <dt>{t.t('swa.pod.photo')}</dt><dd>{r.podMediaId ? <>{t.t('swa.pod.photo.yes')} <code>{r.podMediaId.slice(0, 8)}</code></> : t.t('swa.pod.photo.no')}</dd>
              <dt>{t.t('swa.pod.otp')}</dt><dd>{t.t(r.otpVerified ? 'swa.pod.otp.yes' : 'swa.pod.otp.no')}</dd>
              <dt>{t.t('swa.pod.driver')}</dt><dd>{who(r.driverUserId)}</dd>
              <dt>{t.t('swa.pod.dispatcher')}</dt><dd>{r.dispatcherRecorded ? who(r.dispatcherUserId) : t.t('swa.pod.dispatcherNotRecorded')}</dd>
              <dt>{t.t('swa.pod.weighbridgeLabel')}</dt><dd>{t.t('swa.pod.weighbridge')}</dd>
            </dl>
          </div>
          {(r.flaggedAt || r.decidedAt || r.rejectProposedAt || r.autoClearedAt) && (
            <div className="kv-card">
              <h2>{t.t('swa.pod.history')}</h2>
              <dl className="kv-detail">
                {r.flaggedAt && <><dt>{t.t('swa.pod.flagged')}</dt><dd>{when(r.flaggedAt)} · {who(r.flaggedBy)} · {t.t(`swa.pod.reason.${r.flagReason ?? 'other'}`)}{r.varianceMinor ? ` · ${formatMoneyMinor(r.varianceMinor, 'INR', lang)}` : ''}{r.flagNote ? ` · ${r.flagNote}` : ''}</dd></>}
                {r.rejectProposedAt && <><dt>{t.t('swa.pod.rejectProposed')}</dt><dd>{when(r.rejectProposedAt)} · {who(r.rejectProposedBy)}</dd></>}
                {r.decisionNote && <><dt>{t.t('swa.pod.note')}</dt><dd>{r.decisionNote}</dd></>}
                {r.decidedAt && <><dt>{t.t('swa.pod.decided')}</dt><dd>{when(r.decidedAt)} · {who(r.decidedBy)}</dd></>}
                {r.autoClearedAt && <><dt>{t.t('swa.pod.autoCleared')}</dt><dd>{when(r.autoClearedAt)}</dd></>}
                {r.disputeId && <><dt>{t.t('swa.pod.dispute')}</dt><dd><Link href={`/disputes/${r.disputeId}`} className="kv-btn--link">{r.disputeId.slice(0, 8)}…</Link></dd></>}
              </dl>
            </div>
          )}
          <p className="kv-actions">
            {r.canFlag && <Link href={`${href}/act?act=flag`} className="kv-btn">{t.t('swa.pod.act.flag')}</Link>}{' '}
            {r.canApprove && <Link href={`${href}/act?act=approve`} className="kv-btn kv-btn--primary">{t.t('swa.pod.act.approve')}</Link>}{' '}
            {r.canProposeReject && <Link href={`${href}/act?act=reject`} className="kv-btn">{t.t('swa.pod.act.reject')}</Link>}{' '}
            {r.canConfirmReject && <Link href={`${href}/act?act=confirmReject`} className="kv-btn kv-btn--primary">{t.t('swa.pod.act.confirmReject')}</Link>}
          </p>
          {r.status === 'flagged' && r.rejectProposedBy && !r.canConfirmReject && <p className="kv-notice">{t.t('swa.pod.rejectWaits')}</p>}
          <p className="kv-field__hint">{t.t('swa.pod.holdLaw')}</p>
        </>
      )}
    </section>
  );
}
