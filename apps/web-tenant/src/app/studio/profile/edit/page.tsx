// apps/web-tenant/src/app/studio/profile/edit/page.tsx · the instructor form chain — W2636–W2639 · PC-56 TENANT-7d.
//
// The canon's instructor module names two actions on this chain — *"Add credential · Save profile"* — TWO forms over TWO
// rows, so this page carries `?form=profile` (default) or `?form=credential`, and `?credential=` makes the credential form
// a RE-UPLOAD of a rejected one (W419 *"Re-upload a clearer scan"*), the chain's edit mode with a diff. One page, four
// states, values in the URL (6d-4's ruling), and a review the API computes from the facts the writer uses: the platform
// language registry, the media asset in THIS tenant's bucket, the row as it stands.
//
// WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED: each language by its registry name; the credential's status once filed
// (`submitted` — the desk's queue, not a face match); on a re-upload, the desk's note the new scan answers. The languages
// come off the form as checkboxes and travel as ONE comma-joined value; the bio may run long, so this chain declares its
// own carried-length ceiling as 7b's lesson chain did.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { MediaUploader } from '../../../../components/MediaUploader';
import { SdkError } from '@krishalaya/sdk-js';
import type { FormReview, InstructorView } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey, generalRefusals, isFormError, nothingStoredKey, normalisedKey,
  readCarried, refusalKey, refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey, carryValues,
} from '../../../../features/forms/chain';
import {
  CREDENTIAL_FIELDS, CREDENTIAL_FORM, MAX_CARRIED_LENGTH_PROFILE, PROFILE_FIELDS, PROFILE_FORM, PROFILE_FORM_PATH, formDoneKey, instructorForm, joinLanguages, languageChecked, profileHref, refusedKey,
} from '../../../../features/studio/instructor';
import { saveInstructorFormAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.profile.title'), robots: { index: false, follow: false } };
}

export default async function InstructorFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = PROFILE_FORM_PATH;
  await requireSession(PATH);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const form = instructorForm(typeof searchParams.form === 'string' ? searchParams.form : undefined);
  const FORM = form === 'profile' ? PROFILE_FORM : CREDENTIAL_FORM;
  const FIELDS: readonly string[] = form === 'profile' ? PROFILE_FIELDS : CREDENTIAL_FIELDS;
  const credentialId = form === 'credential' && typeof searchParams.credential === 'string' && searchParams.credential.length > 0 ? searchParams.credential : null;
  const isRefile = credentialId !== null;
  let values = readCarried(searchParams, FIELDS);
  if (form === 'profile') { const langs = joinLanguages(searchParams.languages); if (langs) values.languages = langs; else delete values.languages; }
  const meta = { form, credential: credentialId ?? undefined };
  const MAX = MAX_CARRIED_LENGTH_PROFILE;
  const carried = carryValues(step, { ...values, ...meta }, MAX);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const savedId = typeof searchParams.saved === 'string' ? searchParams.saved : null;
  const withMeta = (v: Record<string, string | undefined | null>) => ({ ...v, ...meta });

  // the row as it stands — the profile's first values, the registry for the checkboxes, the rejected credential's values
  let me: InstructorView | null = null; let reviewNote: string | null = null;
  try { me = await tenantClient().instructors.me(); } catch { me = null; }
  if (step === 'edit' && form === 'profile' && me && Object.keys(values).length === 0) {
    values = { ...me.form };
    for (const k of Object.keys(values)) if (!values[k]) delete values[k];
  }
  if (step === 'edit' && isRefile && Object.keys(values).length === 0) {
    try { const f = await tenantClient().instructors.credentialForm(credentialId); reviewNote = f.reviewNote || null; values = Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== 'reviewNote' && typeof v === 'string' && v.length > 0)) as Record<string, string>; }
    catch { values = {}; }
  }
  let registry = me?.languages ?? [];
  if (registry.length === 0 && form === 'profile') { try { registry = await tenantClient().instructors.languages(); } catch { registry = []; } }

  let review: FormReview | null = null; let reviewError: string | null = null;
  if (step === 'review') {
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f, values[f]]));
      review = form === 'profile' ? await tenantClient().instructors.preview({ form: 'profile', ...body }) : await tenantClient().instructors.preview({ form: 'credential', credentialId: credentialId ?? undefined, ...body });
    } catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }
  const backHref = profileHref();
  const uploaderLabels = { add: t.t('form.credential.upload.add'), hint: t.t('form.credential.upload.hint'), uploading: t.t('studio.uploading'), failed: t.t('studio.uploadFailed'), remove: t.t('studio.remove') };

  return (
    <section>
      <h1>{t.t(form === 'profile' ? 'form.profile.title' : isRefile ? 'form.credential.refileTitle' : 'form.credential.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'edit' && form === 'credential' && !me && <div className="kv-card kv-card--notice" role="status"><p>{t.t('form.credential.needsProfile')}</p><p><Link href={chainHref(PATH, 'edit', { form: 'profile' })} className="kv-btn--link">{t.t('studio.createProfile')}</Link></p></div>}
      {step === 'edit' && isRefile && reviewNote && <div className="kv-error" role="alert"><p>{t.t('profile.rejectedReason', { reason: reviewNote })}</p></div>}

      {step === 'edit' && form === 'profile' && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          <input type="hidden" name="form" value="profile" />
          <label className="kv-field" htmlFor="ip-name">
            <span>{t.t(fieldLabelKey(PROFILE_FORM, 'displayName'))}</span>
            <input id="ip-name" name="displayName" defaultValue={values.displayName ?? ''} maxLength={120} />
          </label>
          <p className="kv-field__hint">{t.t('form.profile.nameHint')}</p>
          <label className="kv-field" htmlFor="ip-bio">
            <span>{t.t(fieldLabelKey(PROFILE_FORM, 'bio'))}</span>
            <textarea id="ip-bio" name="bio" defaultValue={values.bio ?? ''} maxLength={2000} rows={5} required />
          </label>
          <p className="kv-field__hint">{t.t('form.profile.bioHint')}</p>
          <fieldset className="kv-field">
            <legend>{t.t(fieldLabelKey(PROFILE_FORM, 'languages'))}</legend>
            {registry.length === 0 ? <p className="kv-field__hint">{t.t('form.profile.registryUnavailable')}</p> : registry.map((l) => (
              <label key={l.code} htmlFor={`ip-lang-${l.code}`} className="kv-field">
                <input id={`ip-lang-${l.code}`} type="checkbox" name="languages" value={l.code} defaultChecked={languageChecked(values, l.code)} />
                <span>{l.nameNative} · {l.nameEnglish} ({l.code})</span>
              </label>
            ))}
          </fieldset>
          <p className="kv-field__hint">{t.t('form.profile.languagesHint')}</p>
          <fieldset className="kv-field">
            <legend>{t.t(fieldLabelKey(PROFILE_FORM, 'visibility'))}</legend>
            <label htmlFor="ip-vis-public" className="kv-field"><input id="ip-vis-public" type="radio" name="visibility" value="public" defaultChecked={(values.visibility ?? 'public') === 'public'} /><span>{t.t('profile.visibility.public')}</span></label>
            <label htmlFor="ip-vis-private" className="kv-field"><input id="ip-vis-private" type="radio" name="visibility" value="private" defaultChecked={values.visibility === 'private'} /><span>{t.t('profile.visibility.private')}</span></label>
          </fieldset>
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'edit' && form === 'credential' && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          <input type="hidden" name="form" value="credential" />
          {isRefile && <input type="hidden" name="credential" value={credentialId} />}
          <label className="kv-field" htmlFor="ic-title">
            <span>{t.t(fieldLabelKey(CREDENTIAL_FORM, 'title'))}</span>
            <input id="ic-title" name="title" defaultValue={values.title ?? ''} maxLength={200} required />
          </label>
          <label className="kv-field" htmlFor="ic-issuer">
            <span>{t.t(fieldLabelKey(CREDENTIAL_FORM, 'issuer'))}</span>
            <input id="ic-issuer" name="issuer" defaultValue={values.issuer ?? ''} maxLength={200} />
          </label>
          <label className="kv-field" htmlFor="ic-year">
            <span>{t.t(fieldLabelKey(CREDENTIAL_FORM, 'yearAwarded'))}</span>
            <input id="ic-year" name="yearAwarded" defaultValue={values.yearAwarded ?? ''} inputMode="numeric" maxLength={4} />
          </label>
          <label className="kv-field" htmlFor="ic-doc">
            <span>{t.t(fieldLabelKey(CREDENTIAL_FORM, 'documentMediaId'))}</span>
            <input id="ic-doc" name="documentMediaId" defaultValue={values.documentMediaId ?? ''} maxLength={40} />
          </label>
          <MediaUploader labels={uploaderLabels} fieldName="documentMediaId" single kind="document" inputId="ic-upload" />
          <p className="kv-field__hint">{t.t('form.credential.documentHint')}</p>
          <p className="kv-field__hint">{t.t(refusedKey('faceMatch'))}</p>
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(FORM, r.code))}</p></div>)}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{t.t(fieldLabelKey(FORM, f.name))}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span> : <strong>{storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {refusalsFor(review, f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(FORM, r.code))}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="kv-field__hint">{t.t(diffKey(review))}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.before')}</th><th>{t.t('form.col.after')}</th></tr></thead>
                  <tbody>{review.diff.map((d) => <tr key={d.field}><td>{t.t(fieldLabelKey(FORM, d.field))}</td><td style={{ whiteSpace: 'pre-line' }}>{d.before ?? t.t('common.dash')}</td><td style={{ whiteSpace: 'pre-line' }}><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody>
                </table>
              )}
              {review.diff && review.diff.length === 0 && <p className="kv-field__hint">{t.t('form.diff.unchanged')}</p>}
              {review.ready ? (
                <form action={saveInstructorFormAction}>
                  <input type="hidden" name="form" value={form} />
                  {isRefile && <input type="hidden" name="credential" value={credentialId} />}
                  {FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <button type="submit" className="kv-btn">{t.t('form.submit')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(PATH, 'edit', withMeta(values), MAX)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(formDoneKey(form, isRefile))}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('instructor', savedId) && <p><Link href={auditHref('instructor', savedId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, withMeta(values), MAX)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
