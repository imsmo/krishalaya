// apps/web-tenant/src/app/courses/[id]/lessons/[lessonId]/act/page.tsx · the lesson mutate chain — W2668 confirm → W2669
// success → W2670 failure · PC-56 TENANT-7b.
//
// W2668 names the actions this chain hosts: *"Mark ready · Retry."* *Mark ready* is the `ready` act (and `reopen` is
// its way back); W411's row menu's *"move up/down"* are the two moves, here because a move changes state and gets a
// reason and an audit row (Completeness Law B4). *"Retry"* (W412's *"Couldn't process the video"*) is REFUSED BY NAME on
// this page: there is no processing job to retry — a failed scan is answered by a new upload through the form chain.
//
// THE CONFIRM STEP REVIEWS THE OBJECT AND THE REASON. The API's verdict for THIS act by THIS caller on THIS lesson is
// asked at the confirm step and re-taken inside the act's transaction; the reason is mandatory, never pre-filled.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getTranslator } from '../../../../../../lib/i18n';
import { LESSON_ACTS, SdkError } from '@krishalaya/sdk-js';
import type { LessonAct, LessonRecord } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey, readCarried, reasonState,
  reasonStateKey, repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../../../features/mutate/chain';
import { kindKey, lessonActDoneKey, lessonActLabelKey, lessonActPath, lessonHref, lessonStatusKey, lessonVerdictFor, outlineHref, positionText, retryRefusedKey } from '../../../../../../features/courses/lessons';
import { lessonActAction } from './actions';

export const dynamic = 'force-dynamic';

const MODULE = 'lesson';
const FIELDS = ['act', 'reason'] as const;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.lesson.title'), robots: { index: false, follow: false } };
}

export default async function LessonActPage({ params, searchParams }: { params: { id: string; lessonId: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = lessonActPath(params.id, params.lessonId);
  await requireSession(PATH);
  const t = getTranslator();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const act = (LESSON_ACTS as readonly string[]).includes(values.act ?? '') ? (values.act as LessonAct) : null;
  const isMove = act === 'move_up' || act === 'move_down';
  const backHref = isMove ? outlineHref(params.id) : lessonHref(params.id, params.lessonId);

  let preview: LessonRecord | null = null;
  let previewError: string | null = null;
  if (step === 'confirm' && act) {
    try { preview = await tenantClient().courses.lesson(params.id, params.lessonId); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const verdict = preview && act ? lessonVerdictFor(preview.acts, act) : null;
  const reason = values.reason ?? '';
  const rState = reasonState(reason);

  return (
    <section>
      <h1>{act ? t.t(lessonActLabelKey(act)) : t.t('mutate.lesson.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && !act && <div className="kv-error" role="alert"><p>{t.t('mutate.lesson.noAct')}</p><p className="kv-field__hint">{t.t(retryRefusedKey())}</p></div>}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && act && preview && verdict && (
        <>
          <div className="kv-card">
            <h2>{preview.lesson.defaultTitle} <span className="kv-badge">{t.t(kindKey(preview.lesson.contentKind))}</span> <span className="kv-badge">{t.t(lessonStatusKey(preview.lesson.status))}</span></h2>
            <p className="kv-field__hint">{t.t('mutate.lesson.object', { p: positionText(preview), course: preview.course.defaultTitle })}</p>
            {verdict.to && <p className="kv-field__hint">{t.t('mutate.lesson.transition', { from: t.t(lessonStatusKey(preview.lesson.status)), to: t.t(lessonStatusKey(verdict.to)) })}</p>}
            {isMove && <p className="kv-field__hint">{t.t('mutate.lesson.moveNote', { p: String(preview.position), n: String(preview.moduleSize) })}</p>}
            {act === 'ready' && <p className="kv-field__hint">{t.t('mutate.lesson.readyNote')}</p>}
            {act === 'reopen' && <p className="kv-field__hint">{t.t('mutate.lesson.reopenNote')}</p>}
            <p className="kv-field__hint">{t.t('mutate.course.noMoney')}</p>
          </div>
          {verdict.refusals.map((code) => <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(MODULE, code))}</p></div>)}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="act" value={act} />
            <label className="kv-field" htmlFor="act-reason">
              <span>{t.t('mutate.lesson.reasonLabel')}</span>
              <textarea id="act-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>
          {canConfirm(verdict, reason) ? (
            <form action={lessonActAction}>
              <input type="hidden" name="courseId" value={params.id} />
              <input type="hidden" name="lessonId" value={params.lessonId} />
              <input type="hidden" name="act" value={act} />
              <input type="hidden" name="reason" value={reason} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(lessonActDoneKey(act)) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('lesson', params.lessonId) && <p><Link href={auditHref('lesson', params.lessonId)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
