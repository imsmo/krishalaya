// apps/web-tenant/src/app/courses/[id]/act/page.tsx · the course mutate chain — W2550 confirm → W2551 success →
// W2552 failure · PC-56 TENANT-7a.
//
// W2550 names the actions this chain hosts: *"Archive · Retry · Submit for review · published."* The `published` chip
// on W178 hosts pause and resume; the desk's publish and return are the same chain from W416. *"Retry"* on W178/W179's
// "Couldn't load" cards is a PAGE LOAD, not this chain (6a's ruling, kept). So one page serves six acts, and the act
// travels in the URL beside the reason.
//
// THE CONFIRM STEP REVIEWS THE OBJECT AND THE REASON. The API's verdict for THIS act by THIS caller on THIS course is
// asked at the confirm step and re-taken inside the act's transaction; the reason is mandatory, never pre-filled, and
// is what the audit row will hold. For `return`, the reason IS the desk's note the instructor will read on W416.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { COURSE_ACTS, SdkError } from '@krishalaya/sdk-js';
import type { CourseAct, CourseActs } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey,
  readCarried, reasonState, reasonStateKey, repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../features/mutate/chain';
import { actDoneKey, actLabelKey, courseHref, publishHref, statusKey, verdictFor } from '../../../../features/courses/desk';
import { courseActAction } from './actions';

export const dynamic = 'force-dynamic';

const MODULE = 'course';
const FIELDS = ['act', 'reason'] as const;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.course.title'), robots: { index: false, follow: false } };
}

export default async function CourseActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = `/courses/${encodeURIComponent(params.id)}/act`;
  await requireSession(PATH);
  const t = getTranslator();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const act = (COURSE_ACTS as readonly string[]).includes(values.act ?? '') ? (values.act as CourseAct) : null;
  const backHref = act === 'publish' || act === 'return' ? publishHref(params.id) : courseHref(params.id);

  // The confirm step asks the API for the object and the verdict. Success and failure do not — the act is over.
  let preview: CourseActs | null = null;
  let previewError: string | null = null;
  if (step === 'confirm' && act) {
    try { preview = await tenantClient().courses.acts(params.id); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const verdict = preview && act ? verdictFor(preview.acts, act) : null;
  const reason = values.reason ?? '';
  const rState = reasonState(reason);

  return (
    <section>
      <h1>{act ? t.t(actLabelKey(act)) : t.t('mutate.course.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && !act && <div className="kv-error" role="alert"><p>{t.t('mutate.course.noAct')}</p></div>}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && act && preview && verdict && (
        <>
          {/* ---- THE OBJECT (W2550: "review the object and reason below") ---- */}
          <div className="kv-card">
            <h2>{preview.course.defaultTitle} <span className="kv-badge">{t.t(statusKey(preview.course.status))}</span></h2>
            <p className="kv-field__hint">{t.t('mutate.course.transition', { from: t.t(statusKey(preview.course.status)), to: t.t(statusKey(verdict.to)) })}</p>
            {act === 'submit' && <p className="kv-field__hint">{t.t(preview.gate.ready ? 'mutate.course.gateReady' : 'mutate.course.gateBlocked')}</p>}
            {act === 'return' && <p className="kv-field__hint">{t.t('mutate.course.returnNote')}</p>}
            {act === 'archive' && <p className="kv-field__hint">{t.t('mutate.course.archiveNote')}</p>}
            {act === 'publish' && <p className="kv-field__hint">{t.t('mutate.course.publishNote')}</p>}
            <p className="kv-field__hint">{t.t('mutate.course.noMoney')}</p>
          </div>

          {/* ---- EVERY REASON THE ACT WOULD BE REFUSED ---- */}
          {verdict.refusals.map((code) => (
            <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(MODULE, code))}</p></div>
          ))}

          {/* ---- THE REASON, WHICH IS THE AUDIT ROW ---- */}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="act" value={act} />
            <label className="kv-field" htmlFor="act-reason">
              <span>{t.t(act === 'return' ? 'mutate.course.noteLabel' : 'mutate.course.reasonLabel')}</span>
              <textarea id="act-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>

          {canConfirm(verdict, reason) ? (
            <form action={courseActAction}>
              <input type="hidden" name="id" value={params.id} />
              <input type="hidden" name="act" value={act} />
              <input type="hidden" name="reason" value={reason} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : (
            <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>
          )}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(actDoneKey(act)) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('course', params.id) && <p><Link href={auditHref('course', params.id)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p className="kv-field__hint">{t.t('mutate.course.noMoney')}</p>
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
