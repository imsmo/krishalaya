// apps/web-tenant/src/app/courses/new/page.tsx · the course form chain — W2546–W2549 · PC-56 TENANT-7a.
//
// The canon's shared form pattern (B2) over the course module's actions *"New course"* (W178) and the EDIT W179's
// *"Course editing restricted … price changes need tenant_admin"* implies: one page, four states, values in the URL,
// and a review the API computes from the facts the writer uses (6d-4's pattern, unchanged in shape). With `?id=` the
// same page is the EDIT chain and the review carries the diff against the row as it stands — W2547's *"where
// applicable"*, applicable here.
//
// WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED: the currency (the tenant's, resolved server-side — a price with no
// currency beside it is a number, not money), the price AS STORED at that currency's scale, and the topic as `code ·
// name` from the registry. *"Start from template"* (W411/W410) is the third action this chain would host and is named,
// not built: there is no template table.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { Course, CourseTopic, FormReview } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey,
  generalRefusals, isFormError, nothingStoredKey, normalisedKey, readCarried, refusalKey, refusalsFor,
  repeatedFailuresGapKey, retryHref, storedText, valuesLostKey, carryValues,
} from '../../../features/forms/chain';
import { COURSES_HREF, COURSE_FORM_FIELDS, COURSE_LEVELS, FORM, NEW_COURSE_HREF, courseHref, formDoneKey, levelKey } from '../../../features/courses/desk';
import { saveCourseFromChainAction } from './actions';

export const dynamic = 'force-dynamic';

const PATH = NEW_COURSE_HREF;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.course.title'), robots: { index: false, follow: false } };
}

export default async function CourseFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PATH);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const id = typeof searchParams.id === 'string' && searchParams.id.length > 0 ? searchParams.id : null;
  const isEdit = id !== null;
  let values = readCarried(searchParams, COURSE_FORM_FIELDS);
  const carried = carryValues(step, { ...values, id: id ?? undefined });
  const createdId = typeof searchParams.created === 'string' ? searchParams.created : id;
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const withId = (v: Record<string, string | undefined | null>) => ({ ...v, id: id ?? undefined });

  // The registry, for the topic select — a code a person picks, never a uuid they type.
  let topics: CourseTopic[] = [];
  try { topics = await tenantClient().courses.topics(); } catch { topics = []; }

  // EDIT: on the first visit to the form, the fields are the row as it stands.
  let current: Course | null = null;
  if (isEdit) {
    try { current = await tenantClient().courses.get(id); } catch { current = null; }
    if (step === 'edit' && current && Object.keys(values).length === 0) {
      values = {
        defaultTitle: current.defaultTitle, topicCode: current.topicCode ?? '', level: current.level,
        // The major text is the API's (computed at the currency's own scale); the console never divides money.
        priceMajor: current.priceMinor === '0' ? '' : (current.priceMajor ?? ''),
        certEnabled: current.certEnabled ? '1' : '', coverMediaId: current.coverMediaId ?? '',
      };
      for (const k of Object.keys(values)) if (!values[k]) delete values[k];
    }
  }

  let review: FormReview | null = null;
  let reviewError: string | null = null;
  if (step === 'review') {
    try {
      review = await tenantClient().courses.preview({
        id: id ?? undefined,
        defaultTitle: values.defaultTitle, topicCode: values.topicCode, level: values.level, priceMajor: values.priceMajor,
        certEnabled: values.certEnabled, coverMediaId: values.coverMediaId,
      });
    } catch (e) {
      reviewError = e instanceof SdkError ? (e.code || 'review') : 'review';
    }
  }

  const backHref = isEdit ? courseHref(id) : COURSES_HREF;

  return (
    <section>
      <h1>{t.t(isEdit ? 'form.course.editTitle' : 'form.course.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}

      {step === 'edit' && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          {isEdit && <input type="hidden" name="id" value={id} />}
          <label className="kv-field" htmlFor="c-title">
            <span>{t.t(fieldLabelKey(FORM, 'defaultTitle'))}</span>
            <input id="c-title" name="defaultTitle" defaultValue={values.defaultTitle ?? ''} maxLength={250} required />
          </label>
          <label className="kv-field" htmlFor="c-topic">
            <span>{t.t(fieldLabelKey(FORM, 'topicCode'))}</span>
            <select id="c-topic" name="topicCode" defaultValue={values.topicCode ?? ''}>
              <option value="">{t.t('form.course.topicNone')}</option>
              {topics.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
            </select>
          </label>
          <p className="kv-field__hint">{t.t('form.course.topicHint')}</p>
          <label className="kv-field" htmlFor="c-level">
            <span>{t.t(fieldLabelKey(FORM, 'level'))}</span>
            <select id="c-level" name="level" defaultValue={values.level ?? 'basic'}>
              {COURSE_LEVELS.map((l) => <option key={l} value={l}>{t.t(levelKey(l))}</option>)}
            </select>
          </label>
          <label className="kv-field" htmlFor="c-price">
            <span>{t.t(fieldLabelKey(FORM, 'priceMajor'))}</span>
            <input id="c-price" name="priceMajor" defaultValue={values.priceMajor ?? ''} inputMode="decimal" maxLength={20} />
          </label>
          <p className="kv-field__hint">{t.t('form.course.priceHint')}</p>
          <label className="kv-field" htmlFor="c-cert">
            <input id="c-cert" type="checkbox" name="certEnabled" value="1" defaultChecked={values.certEnabled === '1'} />
            <span>{t.t(fieldLabelKey(FORM, 'certEnabled'))}</span>
          </label>
          <label className="kv-field" htmlFor="c-cover">
            <span>{t.t(fieldLabelKey(FORM, 'coverMediaId'))}</span>
            <input id="c-cover" name="coverMediaId" defaultValue={values.coverMediaId ?? ''} maxLength={40} />
          </label>
          <p className="kv-field__hint">{t.t('form.course.coverHint')}</p>
          {/* A GET, so the review step is a URL an instructor can bookmark and come back to. */}
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => (
                <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(FORM, r.code))}</p></div>
              ))}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{t.t(fieldLabelKey(FORM, f.name))}</td>
                      <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {storedText(f).isNothing
                          ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>
                          : <strong>{storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {refusalsFor(review, f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(FORM, r.code))}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* W2547: the diff "where applicable" — an EDIT has one; a create has nothing to be different from. */}
              <p className="kv-field__hint">{t.t(diffKey(review))}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.before')}</th><th>{t.t('form.col.after')}</th></tr></thead>
                  <tbody>
                    {review.diff.map((d) => (
                      <tr key={d.field}><td>{t.t(fieldLabelKey(FORM, d.field))}</td><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {review.diff && review.diff.length === 0 && <p className="kv-field__hint">{t.t('form.diff.unchanged')}</p>}

              {review.ready ? (
                <form action={saveCourseFromChainAction}>
                  {isEdit && <input type="hidden" name="id" value={id} />}
                  {COURSE_FORM_FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <button type="submit" className="kv-btn">{t.t('form.submit')}</button>
                </form>
              ) : (
                <p className="kv-field__hint">{t.t('form.fixFirst')}</p>
              )}
              <p><Link href={chainHref(PATH, 'edit', withId(values))} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(formDoneKey(isEdit))}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('course', createdId) && (
            <p><Link href={auditHref('course', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>
          )}
          {createdId && <p><Link href={courseHref(createdId)} className="kv-btn--link">{t.t('form.course.open')}</Link></p>}
          <p><Link href={COURSES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, withId(values))} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
