// apps/web-tenant/src/app/ops/logistics/pod/[id]/act/page.tsx · W238 · the POD MUTATE chain (confirm → success → failure) — PC-56 TENANT-SW-a.
// flag (a coded reason; "other" needs a note; a variance amount for weight_variance) · approve (optional note) · propose a reject (note ≥ 10)
// · confirm the reject (a different person — the database refuses the proposer, the driver and the dispatcher). The success screen reads
// the act's audit entry back from the trail.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { PodReview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../../../features/mutate/chain';
import { POD_FLAG_REASONS, POD_HREF, codeKey, isPodAct, isUuid, pageState, podFlagRefusal } from '../../../../../../features/swa/console';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { podActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.pod.actTitle'), robots: { index: false, follow: false } }; }
const AUDIT: Record<string, string> = { flag: 'logistics.pod_flagged', approve: 'logistics.pod_approved', reject: 'logistics.pod_reject_proposed', confirmReject: 'logistics.pod_rejected' };

export default async function PodActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const detail = `${POD_HREF}/${params.id}`; const base = `${detail}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const act = isPodAct(searchParams.act) ? searchParams.act : 'approve';
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim();
  const note = (searchParams.note ?? '').trim().slice(0, 1000);
  const variance = (searchParams.varianceMinor ?? '').trim().slice(0, 16);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z0-9_]{2,60}$/.test(x));
  let r: PodReview | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { r = await tenantClient().shipments.podReview(params.id); }
    catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, false); }
  }
  const offered = !!r && (act === 'flag' ? r.canFlag : act === 'approve' ? r.canApprove : act === 'reject' ? r.canProposeReject : r.canConfirmReject);
  const touched = reason !== '' || note !== '' || variance !== '';
  const refusal = act === 'flag' ? podFlagRefusal(reason, note, variance)
    : act === 'reject' ? (note.length < 10 ? 'rejectNote' : null)
    : act === 'approve' ? (note !== '' && note.length < 3 ? 'note' : null) : null;
  const ready = refusal === null;
  const needsForm = act !== 'confirmReject';

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.pod.title')}><Link href={POD_HREF}>{t.t('swa.pod.title')}</Link> / <Link href={detail}>{t.t('swa.pod.detailTitle')}</Link> / <span aria-current="page">{t.t(`swa.pod.act.${act}`)}</span></nav>
      <h1>{t.t(`swa.pod.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (state || !r ? (
        <div className="kv-error" role="alert"><strong>{t.t(`swa.pod.state.${state ?? 'error'}.title`)}</strong><p>{t.t(`swa.pod.state.${state ?? 'error'}.body`)}</p></div>
      ) : (
        <>
          <div className="kv-card">
            <p>{t.t(`swa.pod.act.rule.${act}`)}</p>
            <p className="kv-detail__muted">{t.t('swa.pod.col.shipment')}: <code>{r.shipmentId.slice(0, 8)}</code> · {t.t(r.podMediaId ? 'swa.pod.photo.yes' : 'swa.pod.photo.no')} · {t.t(r.otpVerified ? 'swa.pod.otp.yes' : 'swa.pod.otp.no')}</p>
            {r.decisionNote && act === 'confirmReject' && <p className="kv-detail__muted">{r.decisionNote}</p>}
            <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          </div>
          {!offered && <div className="kv-error" role="alert"><p>{t.t(r.youDroveOrDispatched ? 'swa.pod.youDroveBody' : `swa.pod.act.notOffered.${act}`)}</p></div>}
          {offered && needsForm && (
            <form method="get" action={base} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" />
              <input type="hidden" name="act" value={act} />
              {act === 'flag' && (
                <>
                  <label className="kv-field" htmlFor="p-reason"><span>{t.t('swa.pod.form.reason')}</span>
                    <select id="p-reason" name="reason" className="kv-input" defaultValue={reason}>
                      <option value="">{t.t('swa.pod.form.reasonPick')}</option>
                      {POD_FLAG_REASONS.map((x) => <option key={x} value={x}>{t.t(`swa.pod.reason.${x}`)}</option>)}
                    </select></label>
                  <label className="kv-field" htmlFor="p-var"><span>{t.t('swa.pod.form.variance')}</span>
                    <input id="p-var" name="varianceMinor" className="kv-input" inputMode="numeric" pattern="[1-9][0-9]{0,15}" defaultValue={variance} /></label>
                </>
              )}
              <label className="kv-field" htmlFor="p-note"><span>{t.t(act === 'reject' ? 'swa.pod.form.rejectNote' : 'swa.pod.form.note')}</span>
                <textarea id="p-note" name="note" className="kv-textarea" rows={2} maxLength={1000} defaultValue={note} /></label>
              {touched && refusal && <p className="kv-field__hint">{t.t(`swa.pod.form.err.${refusal}`)}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {offered && ready ? (
            <form action={podActAction} className="kv-actions">
              <input type="hidden" name="id" value={params.id} />
              <input type="hidden" name="act" value={act} />
              {reason && <input type="hidden" name="reason" value={reason} />}
              {note && <input type="hidden" name="note" value={note} />}
              {variance && <input type="hidden" name="varianceMinor" value={variance} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
              <Link href={detail} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={detail} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      ))}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`swa.pod.act.done.${act}`)}</p></div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="pod_review" entityId={params.id} action={AUDIT[act]} />}
          {isUuid(searchParams.disputeId) && <p><Link href={`/disputes/${searchParams.disputeId}`} className="kv-btn--link">{t.t('swa.pod.openDispute')}</Link></p>}
          <p><Link href={detail} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failed.map((c) => <li key={c}>{t.t(codeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', act, ...(reason ? { reason } : {}), ...(note ? { note } : {}), ...(variance ? { varianceMinor: variance } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={detail} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
