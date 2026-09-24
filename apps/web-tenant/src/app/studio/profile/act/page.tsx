// apps/web-tenant/src/app/studio/profile/act/page.tsx · the instructor mutate chain — W2640 confirm → W2641 success →
// W2642 failure · PC-56 TENANT-7d.
//
// W2640 names ONE action on this chain: *"Retry"* — W419's *"Couldn't verify the credential … Retry"*. That describes an
// automated check this platform does not run (nothing matches a face or reads a certificate), so *Retry* is REFUSED BY
// NAME here. What this chain hosts instead are the acts a person performs on the record, each a verdict the API takes and
// re-takes on the locked row: the desk's `verify` / `unverify` of the instructor (maker ≠ checker — never on themselves),
// the desk's `accept` / `reject` of a credential (a rejection's reason IS the note the instructor reads), and the
// instructor's own `withdraw` of a credential (not the last accepted one while verified).
//
// THE CONFIRM STEP REVIEWS THE OBJECT AND THE REASON. The reason is mandatory, never pre-filled; the object is the
// instructor (and the credential, when the act is about one), printed as the API holds them.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { INSTRUCTOR_ACTS, SdkError } from '@krishalaya/sdk-js';
import type { InstructorAct, InstructorView } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey, readCarried, reasonState, reasonStateKey,
  repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../features/mutate/chain';
import { INSTRUCTOR_MUTATE_FIELDS, PROFILE_ACT_PATH, actDoneKey, actLabelKey, actNeedsCredential, backFromChain, credentialStatusKey, refusedKey, verdictFor } from '../../../../features/studio/instructor';
import { instructorActAction } from './actions';

export const dynamic = 'force-dynamic';

const MODULE = 'instructor';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.instructor.title'), robots: { index: false, follow: false } };
}

export default async function InstructorActPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = PROFILE_ACT_PATH;
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, INSTRUCTOR_MUTATE_FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const act = (INSTRUCTOR_ACTS as readonly string[]).includes(values.act ?? '') ? (values.act as InstructorAct) : null;
  const instructorId = values.instructor ?? null;
  const credentialId = act && actNeedsCredential(act) ? (values.credentialId ?? null) : null;

  let preview: InstructorView | null = null; let previewError: string | null = null;
  if (step === 'confirm' && act && instructorId) {
    try { preview = await tenantClient().instructors.get(instructorId); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const verdict = preview && act ? verdictFor(preview.acts, act, credentialId) : null;
  const credential = preview && credentialId ? preview.credentials.find((c) => c.credential.id === credentialId) ?? null : null;
  const reason = values.reason ?? '';
  const rState = reasonState(reason);
  const backHref = backFromChain(instructorId, preview?.isSelf ?? false);

  return (
    <section>
      <h1>{act ? t.t(actLabelKey(act)) : t.t('mutate.instructor.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && (!act || !instructorId) && <div className="kv-error" role="alert"><p>{t.t('mutate.instructor.noAct')}</p><p className="kv-field__hint">{t.t(refusedKey('retry'))}</p></div>}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}
      {step === 'confirm' && act && preview && !verdict && <div className="kv-error" role="alert"><p>{t.t(mutateRefusalKey(MODULE, actNeedsCredential(act) ? 'CREDENTIAL_UNKNOWN' : 'ILLEGAL_FROM_STATUS'))}</p></div>}

      {step === 'confirm' && act && preview && verdict && (
        <>
          <div className="kv-card">
            <h2>{preview.name ?? t.t('studio.unnamed')} {preview.instructor.isVerified ? <span className="kv-badge kv-badge--ok">{t.t('profile.verifiedBadge')}</span> : <span className="kv-badge">{t.t('studio.notVerified')}</span>}</h2>
            <p className="kv-field__hint">{t.t('mutate.instructor.object', { languages: preview.instructor.languages.join(', ') || t.t('common.dash'), n: formatNumber(preview.credentials.filter((c) => c.credential.status === 'accepted').length, lang) })}</p>
            {credential && <p>{credential.credential.title}{credential.credential.issuer && <> — {credential.credential.issuer}</>} <span className="kv-badge">{t.t(credentialStatusKey(credential.credential.status))}</span> <span className="kv-field__hint">· {credential.document?.scanStatus ?? t.t('profile.document.unknown')}</span></p>}
            {verdict.to && <p className="kv-field__hint">{t.t('mutate.instructor.transition', { to: t.t(`mutate.instructor.to.${verdict.to}`) })}</p>}
            <p className="kv-field__hint">{t.t(`mutate.instructor.note.${act}`)}</p>
            <p className="kv-field__hint">{t.t('mutate.course.noMoney')}</p>
          </div>
          {verdict.refusals.filter((c) => c !== 'REASON_REQUIRED').map((code) => <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(MODULE, code))}</p></div>)}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="act" value={act} />
            <input type="hidden" name="instructor" value={instructorId as string} />
            {credentialId && <input type="hidden" name="credentialId" value={credentialId} />}
            <label className="kv-field" htmlFor="act-reason">
              <span>{t.t(act === 'reject' ? 'mutate.instructor.noteLabel' : 'mutate.instructor.reasonLabel')}</span>
              <textarea id="act-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t(act === 'reject' ? 'mutate.instructor.noteRecorded' : 'mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>
          {canConfirm({ allowed: verdict.refusals.every((c) => c === 'REASON_REQUIRED') }, reason) ? (
            <form action={instructorActAction}>
              <input type="hidden" name="instructor" value={instructorId as string} />
              <input type="hidden" name="act" value={act} />
              <input type="hidden" name="reason" value={reason} />
              {credentialId && <input type="hidden" name="credentialId" value={credentialId} />}
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(actDoneKey(act)) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('instructor', instructorId) && <p><Link href={auditHref('instructor', instructorId as string)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
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
