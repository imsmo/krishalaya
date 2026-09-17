// apps/web-tenant/src/app/live/[id]/act/page.tsx · the live mutate chain — W2675 confirm → W2676 success → W2677 failure ·
// PC-56 TENANT-7c.
//
// W2675 names the actions this chain hosts: *"End class · Retry."* *End class* is the `end` act; beside it the desk's other
// acts on a class — `cancel`, `attendance` (the number the host writes down), `recording` (the file they attach), `to_lesson`
// (W414's *"recorded → lesson 7"*, performed by a person) and `start` (the provider edge, refused by name where no provider
// is bound). *"Retry"* is REFUSED BY NAME on this page: there is no stream to reconnect and no job to re-run.
//
// THE CONFIRM STEP REVIEWS THE OBJECT AND THE REASON. The API's verdict for THIS act by THIS caller on THIS class is asked
// at the confirm step and re-taken inside the act's transaction; the reason is mandatory, never pre-filled; the acts that
// carry a fact (attendance, recording) ask for it here, and the button waits until it is present.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { MediaUploader } from '../../../../components/MediaUploader';
import { LIVE_ACTS, SdkError } from '@krishalaya/sdk-js';
import type { LiveAct, LiveClassView } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey, readCarried, reasonState, reasonStateKey,
  repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../features/mutate/chain';
import { LIVE_MUTATE_FIELDS, actExtra, extraPresent, liveActDoneKey, liveActLabelKey, liveActPath, liveClassHref, liveStatusKey, liveVerdictFor, refusedKey, whenText } from '../../../../features/live/classes';
import { liveActAction } from './actions';

export const dynamic = 'force-dynamic';

const MODULE = 'live';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.live.title'), robots: { index: false, follow: false } };
}

export default async function LiveActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = liveActPath(params.id);
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, LIVE_MUTATE_FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const lessonId = typeof searchParams.lesson === 'string' ? searchParams.lesson : null;
  const act = (LIVE_ACTS as readonly string[]).includes(values.act ?? '') ? (values.act as LiveAct) : null;
  const backHref = liveClassHref(params.id);

  let preview: LiveClassView | null = null; let previewError: string | null = null;
  if (step === 'confirm' && act) {
    try { preview = await tenantClient().liveClasses.get(params.id); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const verdict = preview && act ? liveVerdictFor(preview.acts, act) : null;
  const reason = values.reason ?? '';
  const rState = reasonState(reason);
  const extra = act ? actExtra(act) : null;
  const uploaderLabels = { add: t.t('mutate.live.upload.add'), hint: t.t('mutate.live.upload.hint'), uploading: t.t('studio.uploading'), failed: t.t('studio.uploadFailed'), remove: t.t('studio.remove') };

  return (
    <section>
      <h1>{act ? t.t(liveActLabelKey(act)) : t.t('mutate.live.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && !act && <div className="kv-error" role="alert"><p>{t.t('mutate.live.noAct')}</p><p className="kv-field__hint">{t.t(refusedKey('retry'))}</p></div>}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && act && preview && verdict && (
        <>
          <div className="kv-card">
            <h2>{preview.session.title} <span className="kv-badge">{t.t(liveStatusKey(preview.session.status))}</span></h2>
            <p className="kv-field__hint">{t.t('mutate.live.object', { when: whenText(preview), zone: preview.timezone, course: preview.course?.defaultTitle ?? t.t('live.noCourse') })}</p>
            {verdict.to && <p className="kv-field__hint">{t.t('mutate.live.transition', { from: t.t(liveStatusKey(preview.session.status)), to: t.t(liveStatusKey(verdict.to)) })}</p>}
            <p className="kv-field__hint">{t.t(`mutate.live.note.${act}`)}</p>
            {act === 'attendance' && <p className="kv-field__hint">{t.t('live.host.registered', { n: formatNumber(preview.registered, lang) })}</p>}
            <p className="kv-field__hint">{t.t('mutate.course.noMoney')}</p>
          </div>
          {verdict.refusals.filter((c) => c !== 'REASON_REQUIRED' && c !== 'ATTENDANCE_REQUIRED' && c !== 'MEDIA_REQUIRED').map((code) => <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(MODULE, code))}</p></div>)}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="act" value={act} />
            {extra === 'count' && (
              <label className="kv-field" htmlFor="act-count">
                <span>{t.t('mutate.live.countLabel')}</span>
                <input id="act-count" name="count" defaultValue={values.count ?? ''} inputMode="numeric" maxLength={7} />
              </label>
            )}
            {extra === 'mediaId' && (
              <>
                <label className="kv-field" htmlFor="act-media">
                  <span>{t.t('mutate.live.mediaLabel')}</span>
                  <input id="act-media" name="mediaId" defaultValue={values.mediaId ?? ''} maxLength={40} />
                </label>
                <MediaUploader labels={uploaderLabels} fieldName="mediaId" single kind="video" inputId="act-upload" />
                <p className="kv-field__hint">{t.t('mutate.live.mediaHint')}</p>
              </>
            )}
            <label className="kv-field" htmlFor="act-reason">
              <span>{t.t('mutate.live.reasonLabel')}</span>
              <textarea id="act-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>
          {canConfirm({ allowed: verdict.refusals.every((c) => c === 'REASON_REQUIRED' || c === 'ATTENDANCE_REQUIRED' || c === 'MEDIA_REQUIRED') }, reason) && extraPresent(act, values) ? (
            <form action={liveActAction}>
              <input type="hidden" name="id" value={params.id} />
              <input type="hidden" name="act" value={act} />
              <input type="hidden" name="reason" value={reason} />
              {values.count && <input type="hidden" name="count" value={values.count} />}
              {values.mediaId && <input type="hidden" name="mediaId" value={values.mediaId} />}
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t(extra && !extraPresent(act, values) ? `mutate.live.need.${extra}` : 'mutate.cannotProceed')}</p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(liveActDoneKey(act)) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('live_session', params.id) && <p><Link href={auditHref('live_session', params.id)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          {act === 'to_lesson' && lessonId && <p className="kv-field__hint">{t.t('mutate.live.lessonMade')}</p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p className="kv-field__hint">{t.t(refusedKey('retry'))}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
