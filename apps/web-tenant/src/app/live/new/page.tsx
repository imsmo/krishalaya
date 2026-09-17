// apps/web-tenant/src/app/live/new/page.tsx · the live form chain — W2671–W2674 · PC-56 TENANT-7c.
//
// The canon's live module names two actions on this chain — *"New class · Schedule anyway"* — and both are ONE form over
// ONE row. One page, four states, values in the URL (6d-4's ruling), and a review the API computes from the facts the
// writer uses: `?class=` makes it an EDIT with a diff. *Schedule anyway* is the `clashAccepted` checkbox: the review
// refuses a class that overlaps another of the HOST's own (`HOST_CLASH`) until the host ticks it, and the acceptance is
// stored on the row — the canon's "soft warning" as a fact a person acknowledged rather than a banner they may have missed.
//
// THE CLOCK IS THE COOPERATIVE'S. The host types a date and a wall-clock time; the API turns them into an instant in the
// tenant's own timezone (`tenants.country_code → countries.timezone`, 6c-1's resolution) and the review prints BOTH — the
// wall-clock with its zone, and the UTC instant the row will hold — so *"20:30"* is 20:30 in Anand whatever zone this
// console's server runs in. WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED: that instant, the class's end, and the other
// class it clashes with, by title and time.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { Course, FormReview, LiveClassView } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey, generalRefusals, isFormError, nothingStoredKey, normalisedKey,
  readCarried, refusalKey, refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey, carryValues,
} from '../../../features/forms/chain';
import { LIVE_FIELDS, LIVE_FORM, LIVE_FORM_PATH, backFromChain, liveClassHref, liveFormDoneKey, liveHref, refusedKey } from '../../../features/live/classes';
import { saveLiveClassAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.live.title'), robots: { index: false, follow: false } };
}

export default async function LiveFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = LIVE_FORM_PATH;
  await requireSession(PATH);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const classId = typeof searchParams.class === 'string' && searchParams.class.length > 0 ? searchParams.class : null;
  const isEdit = classId !== null;
  let values = readCarried(searchParams, LIVE_FIELDS);
  const meta = { class: classId ?? undefined };
  const carried = carryValues(step, { ...values, ...meta });
  const createdId = typeof searchParams.created === 'string' ? searchParams.created : classId;
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const withMeta = (v: Record<string, string | undefined | null>) => ({ ...v, ...meta });

  // EDIT: the class as it stands — the form's first values. CREATE: the courses this person may hold a class on.
  let rec: LiveClassView | null = null; let courses: Course[] = [];
  if (isEdit) { try { rec = await tenantClient().liveClasses.get(classId); } catch { rec = null; } }
  else { try { courses = (await tenantClient().courses.list({ box: 'mine', limit: 100 })).items; } catch { courses = []; } }
  if (step === 'edit' && rec && Object.keys(values).length === 0) {
    values = { ...rec.form };
    for (const k of Object.keys(values)) if (!values[k]) delete values[k];
  }
  // a new class defaults to reminders ON — the canon's cadence is the default, not a preference
  const firstOpen = step === 'edit' && !isEdit && Object.keys(values).length <= 1;

  let review: FormReview | null = null; let reviewError: string | null = null;
  if (step === 'review') {
    try { review = await tenantClient().liveClasses.preview({ ...Object.fromEntries(LIVE_FIELDS.map((f) => [f, values[f]])), id: classId ?? undefined }); }
    catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }
  const backHref = backFromChain(classId);
  const clashRow = review?.fields.find((f) => f.name === 'clash') ?? null;

  return (
    <section>
      <h1>{t.t(isEdit ? 'form.live.editTitle' : 'form.live.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {isEdit && rec && !rec.canEdit && <div className="kv-error" role="alert"><p>{t.t('form.live.notEditable')}</p></div>}

      {step === 'edit' && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          {isEdit && <input type="hidden" name="class" value={classId} />}
          {!isEdit ? (
            <label className="kv-field" htmlFor="lc-course">
              <span>{t.t(fieldLabelKey(LIVE_FORM, 'courseId'))}</span>
              <select id="lc-course" name="courseId" defaultValue={values.courseId ?? ''} required>
                <option value="">{t.t('form.live.courseNone')}</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.defaultTitle}</option>)}
              </select>
            </label>
          ) : <p className="kv-field__hint">{t.t('form.live.courseFixed', { course: rec?.course?.defaultTitle ?? t.t('live.noCourse') })}</p>}
          <p className="kv-field__hint">{t.t('form.live.courseHint')}</p>
          <label className="kv-field" htmlFor="lc-title">
            <span>{t.t(fieldLabelKey(LIVE_FORM, 'title'))}</span>
            <input id="lc-title" name="title" defaultValue={values.title ?? ''} maxLength={250} required />
          </label>
          <label className="kv-field" htmlFor="lc-date">
            <span>{t.t(fieldLabelKey(LIVE_FORM, 'date'))}</span>
            <input id="lc-date" name="date" type="date" defaultValue={values.date ?? ''} required />
          </label>
          <label className="kv-field" htmlFor="lc-time">
            <span>{t.t(fieldLabelKey(LIVE_FORM, 'time'))}</span>
            <input id="lc-time" name="time" type="time" defaultValue={values.time ?? ''} required />
          </label>
          <p className="kv-field__hint">{t.t('form.live.zoneHint', { zone: rec?.timezone ?? t.t('form.live.zoneOfCoop') })}</p>
          <label className="kv-field" htmlFor="lc-duration">
            <span>{t.t(fieldLabelKey(LIVE_FORM, 'durationMins'))}</span>
            <input id="lc-duration" name="durationMins" defaultValue={values.durationMins ?? '60'} inputMode="numeric" maxLength={3} />
          </label>
          <label className="kv-field" htmlFor="lc-capacity">
            <span>{t.t(fieldLabelKey(LIVE_FORM, 'capacity'))}</span>
            <input id="lc-capacity" name="capacity" defaultValue={values.capacity ?? ''} inputMode="numeric" maxLength={6} />
          </label>
          <p className="kv-field__hint">{t.t('live.capacityRule')}</p>
          <label className="kv-field" htmlFor="lc-join">
            <span>{t.t(fieldLabelKey(LIVE_FORM, 'joinUrl'))}</span>
            <input id="lc-join" name="joinUrl" type="url" defaultValue={values.joinUrl ?? ''} maxLength={500} placeholder="https://…" />
          </label>
          <p className="kv-field__hint">{t.t('form.live.joinHint')}</p>
          <label className="kv-field" htmlFor="lc-remind">
            <input id="lc-remind" type="checkbox" name="remind" value="1" defaultChecked={firstOpen ? true : values.remind === '1'} />
            <span>{t.t(fieldLabelKey(LIVE_FORM, 'remind'))}</span>
          </label>
          <p className="kv-field__hint">{t.t('live.reminderRule')}</p>
          <label className="kv-field" htmlFor="lc-clash">
            <input id="lc-clash" type="checkbox" name="clashAccepted" value="1" defaultChecked={values.clashAccepted === '1'} />
            <span>{t.t(fieldLabelKey(LIVE_FORM, 'clashAccepted'))}</span>
          </label>
          <p className="kv-field__hint">{t.t('form.live.clashHint')} {t.t(refusedKey('sharedCalendar'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('autoRecord'))}</p>
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(LIVE_FORM, r.code))}</p></div>)}
              {clashRow && clashRow.stored && <div className="kv-card kv-card--notice" role="status"><p>{t.t('form.live.clashFound')}</p><p style={{ whiteSpace: 'pre-line' }}>{clashRow.stored}</p></div>}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{t.t(fieldLabelKey(LIVE_FORM, f.name))}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span> : <strong>{storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {refusalsFor(review, f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(LIVE_FORM, r.code))}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="kv-field__hint">{t.t(diffKey(review))}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.before')}</th><th>{t.t('form.col.after')}</th></tr></thead>
                  <tbody>{review.diff.map((d) => <tr key={d.field}><td>{t.t(fieldLabelKey(LIVE_FORM, d.field))}</td><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody>
                </table>
              )}
              {review.diff && review.diff.length === 0 && <p className="kv-field__hint">{t.t('form.diff.unchanged')}</p>}
              {review.ready ? (
                <form action={saveLiveClassAction}>
                  {isEdit && <input type="hidden" name="class" value={classId} />}
                  {LIVE_FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <button type="submit" className="kv-btn">{t.t(isEdit ? 'form.submit' : 'form.live.schedule')}</button>
                </form>
              ) : (
                <>
                  <p className="kv-field__hint">{t.t('form.fixFirst')}</p>
                  {refusalsFor(review, 'clashAccepted').some((r) => r.code === 'HOST_CLASH') && (
                    <p><Link href={chainHref(PATH, 'review', withMeta({ ...values, clashAccepted: '1' }))} className="kv-btn kv-btn--muted">{t.t('form.live.scheduleAnyway')}</Link></p>
                  )}
                </>
              )}
              <p><Link href={chainHref(PATH, 'edit', withMeta(values))} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(liveFormDoneKey(isEdit))}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('live_session', createdId) && <p><Link href={auditHref('live_session', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          {createdId && <p><Link href={liveClassHref(createdId)} className="kv-btn--link">{t.t('form.live.open')}</Link></p>}
          <p><Link href={liveHref()} className="kv-btn--link">{t.t('form.live.backToSchedule')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, withMeta(values))} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
