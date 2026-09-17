// apps/web-tenant/src/app/courses/[id]/lessons/new/page.tsx · the lesson form chain — W2664–W2667 · PC-56 TENANT-7b.
//
// The canon's lesson module names three actions on this chain — *"Add chapter · Edit · Save draft"* — and W412's
// subtitle rows land here too (*"Edit"* per language). One page, four states, values in the URL (6d-4's ruling), and a
// review the API computes from the facts the writer uses: `?lesson=` makes it an EDIT with a diff; `?mode=subtitle&
// languageCode=gu` makes it the SUBTITLE form for one track. A chapter is a line on the lesson, so *Add chapter* is
// this form with the chapters field in view. *Save draft* is what the write does: a lesson is born `draft`.
//
// WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED: the position the lesson will take (`1·5` — appended to its
// module; moving it is the reorder act), the media asset's kind and SCAN state, every clock in the canon's `mm:ss`,
// and the audio twin by its title. The upload itself is the media boundary's three steps (a presigned PUT, then a
// confirm) — the only client-side component on this page — and the id it returns travels like every other value;
// a person without JS may paste an id instead.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator } from '../../../../../lib/i18n';
import { MediaUploader } from '../../../../../components/MediaUploader';
import { SdkError } from '@krishalaya/sdk-js';
import type { FormReview, LessonRecord } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey, generalRefusals, isFormError, nothingStoredKey, normalisedKey,
  readCarried, refusalKey, refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey, carryValues,
} from '../../../../../features/forms/chain';
import {
  CONTENT_KINDS, MAX_CARRIED_LENGTH_LESSON, MAX_LONG_TEXT, formMode, formOf, kindKey, lessonFormDoneKey, lessonFormPath, lessonHref, outlineHref, SPEECH_KINDS,
} from '../../../../../features/courses/lessons';
import { saveLessonFromChainAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.lesson.title'), robots: { index: false, follow: false } };
}

export default async function LessonFormPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = lessonFormPath(params.id);
  await requireSession(PATH);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const mode = formMode(typeof searchParams.mode === 'string' ? searchParams.mode : undefined);
  const lessonId = typeof searchParams.lesson === 'string' && searchParams.lesson.length > 0 ? searchParams.lesson : null;
  const isEdit = lessonId !== null;
  const { form: FORM, fields: FIELDS } = formOf(mode);
  let values = readCarried(searchParams, FIELDS);
  const meta = { lesson: lessonId ?? undefined, mode: mode === 'subtitle' ? 'subtitle' : undefined };
  const carried = carryValues(step, { ...values, ...meta }, MAX_CARRIED_LENGTH_LESSON);
  const createdId = typeof searchParams.created === 'string' ? searchParams.created : lessonId;
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const withMeta = (v: Record<string, string | undefined | null>) => ({ ...v, ...meta });

  // EDIT / SUBTITLE: the record as it stands — the form's first values, the twin select, the languages.
  let rec: LessonRecord | null = null;
  if (isEdit) { try { rec = await tenantClient().courses.lesson(params.id, lessonId); } catch { rec = null; } }
  let audioLessons = rec?.audioLessons ?? [];
  if (!isEdit) { try { audioLessons = (await tenantClient().courses.outline(params.id)).lessons.filter((v) => v.lesson.contentKind === 'audio').map((v) => ({ id: v.lesson.id, defaultTitle: v.lesson.defaultTitle, position: `${v.lesson.moduleNo}·${v.position}`, pairedWith: null })); } catch { audioLessons = []; } }
  if (step === 'edit' && rec && mode === 'lesson' && Object.keys(values).length === 0) {
    values = { ...rec.form };
    for (const k of Object.keys(values)) if (!values[k]) delete values[k];
  }
  const languages = rec?.languages ?? [];
  // The subtitle mode opens with the track as it stands — its text is not on the record read (it can be long); the
  // review's diff reports a replaced body by size.
  if (mode === 'subtitle' && step === 'edit' && !values.languageCode && typeof searchParams.languageCode === 'string') values.languageCode = searchParams.languageCode;
  const existingTrack = mode === 'subtitle' && rec ? rec.tracks.find((x) => x.languageCode === values.languageCode) ?? null : null;

  let review: FormReview | null = null;
  let reviewError: string | null = null;
  if (step === 'review' && (mode === 'lesson' || isEdit)) {
    try {
      const c = tenantClient().courses;
      review = mode === 'subtitle'
        ? await c.previewSubtitle(params.id, lessonId as string, { languageCode: values.languageCode, body: values.body, reviewed: values.reviewed })
        : await c.previewLesson(params.id, { ...Object.fromEntries(FIELDS.map((f) => [f, values[f]])), lessonId: lessonId ?? undefined });
    } catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }

  const backHref = isEdit ? lessonHref(params.id, lessonId) : outlineHref(params.id);
  const kind = values.contentKind ?? 'video';
  const uploaderKind = kind === 'audio' ? 'audio' : kind === 'pdf' ? 'document' : 'video';
  const uploaderLabels = { add: t.t('form.lesson.upload.add'), hint: t.t('form.lesson.upload.hint'), uploading: t.t('studio.uploading'), failed: t.t('studio.uploadFailed'), remove: t.t('studio.remove') };
  const title = mode === 'subtitle' ? t.t('form.subtitle.title') : t.t(isEdit ? 'form.lesson.editTitle' : 'form.lesson.title');

  return (
    <section>
      <h1>{title}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {mode === 'subtitle' && !isEdit && <div className="kv-error" role="alert"><p>{t.t('form.subtitle.noLesson')}</p></div>}

      {step === 'edit' && mode === 'lesson' && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          {isEdit && <input type="hidden" name="lesson" value={lessonId} />}
          {!isEdit && (
            <label className="kv-field" htmlFor="l-module">
              <span>{t.t(fieldLabelKey(FORM, 'moduleNo'))}</span>
              <input id="l-module" name="moduleNo" defaultValue={values.moduleNo ?? '1'} inputMode="numeric" maxLength={3} />
            </label>
          )}
          {isEdit && <p className="kv-field__hint">{t.t('form.lesson.positionFixed')}</p>}
          <label className="kv-field" htmlFor="l-title">
            <span>{t.t(fieldLabelKey(FORM, 'defaultTitle'))}</span>
            <input id="l-title" name="defaultTitle" defaultValue={values.defaultTitle ?? ''} maxLength={250} required />
          </label>
          <label className="kv-field" htmlFor="l-kind">
            <span>{t.t(fieldLabelKey(FORM, 'contentKind'))}</span>
            <select id="l-kind" name="contentKind" defaultValue={kind}>
              {CONTENT_KINDS.map((k) => <option key={k} value={k}>{t.t(kindKey(k))}</option>)}
            </select>
          </label>
          <p className="kv-field__hint">{t.t('form.lesson.kindHint')}</p>
          <label className="kv-field" htmlFor="l-media">
            <span>{t.t(fieldLabelKey(FORM, 'mediaId'))}</span>
            <input id="l-media" name="mediaId" defaultValue={values.mediaId ?? ''} maxLength={40} />
          </label>
          <MediaUploader labels={uploaderLabels} fieldName="mediaId" single kind={uploaderKind} inputId="l-upload" />
          <p className="kv-field__hint">{t.t('form.lesson.mediaHint')}</p>
          <label className="kv-field" htmlFor="l-duration">
            <span>{t.t(fieldLabelKey(FORM, 'duration'))}</span>
            <input id="l-duration" name="duration" defaultValue={values.duration ?? ''} placeholder="08:20" maxLength={12} />
          </label>
          <label className="kv-field" htmlFor="l-body">
            <span>{t.t(fieldLabelKey(FORM, 'body'))}</span>
            <textarea id="l-body" name="body" defaultValue={values.body ?? ''} rows={6} maxLength={MAX_LONG_TEXT} />
          </label>
          <p className="kv-field__hint">{t.t('form.lesson.bodyHint', { n: String(MAX_LONG_TEXT) })}</p>
          <label className="kv-field" htmlFor="l-sibling">
            <span>{t.t(fieldLabelKey(FORM, 'siblingLessonId'))}</span>
            <select id="l-sibling" name="siblingLessonId" defaultValue={values.siblingLessonId ?? ''}>
              <option value="">{t.t('form.lesson.siblingNone')}</option>
              {audioLessons.map((a) => <option key={a.id} value={a.id} disabled={!!a.pairedWith && a.pairedWith !== lessonId}>{a.position} · {a.defaultTitle}{a.pairedWith && a.pairedWith !== lessonId ? ` · ${t.t('form.lesson.siblingTaken')}` : ''}</option>)}
            </select>
          </label>
          <p className="kv-field__hint">{t.t('form.lesson.siblingHint')}</p>
          <label className="kv-field" htmlFor="l-thumb">
            <span>{t.t(fieldLabelKey(FORM, 'thumbnailAt'))}</span>
            <input id="l-thumb" name="thumbnailAt" defaultValue={values.thumbnailAt ?? ''} placeholder="02:31" maxLength={12} />
          </label>
          <p className="kv-field__hint">{t.t('form.lesson.thumbnailHint')}</p>
          <label className="kv-field" htmlFor="l-chapters">
            <span>{t.t(fieldLabelKey(FORM, 'chapters'))}</span>
            <textarea id="l-chapters" name="chapters" defaultValue={values.chapters ?? ''} rows={5} maxLength={4000} placeholder={'00:00 — Why colostrum, in the first hour\n02:14 — How much, how often'} />
          </label>
          <p className="kv-field__hint">{t.t('form.lesson.chaptersHint')}</p>
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'edit' && mode === 'subtitle' && isEdit && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          <input type="hidden" name="lesson" value={lessonId} />
          <input type="hidden" name="mode" value="subtitle" />
          {rec && !SPEECH_KINDS.has(rec.lesson.contentKind) && <div className="kv-error" role="alert"><p>{t.t(refusalKey(FORM, 'KIND_HAS_NO_SPEECH'))}</p></div>}
          <label className="kv-field" htmlFor="s-lang">
            <span>{t.t(fieldLabelKey(FORM, 'languageCode'))}</span>
            <select id="s-lang" name="languageCode" defaultValue={values.languageCode ?? ''}>
              <option value="">{t.t('form.subtitle.languageNone')}</option>
              {languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          {existingTrack && <p className="kv-field__hint">{t.t('form.subtitle.existing', { n: String(existingTrack.bodyLength), status: t.t(`lessons.coverage.${existingTrack.status}`) })}</p>}
          <label className="kv-field" htmlFor="s-body">
            <span>{t.t(fieldLabelKey(FORM, 'body'))}</span>
            <textarea id="s-body" name="body" defaultValue={values.body ?? ''} rows={12} maxLength={MAX_LONG_TEXT} placeholder={'WEBVTT\n\n00:00.000 --> 00:04.000\n…'} />
          </label>
          <p className="kv-field__hint">{t.t('form.subtitle.bodyHint', { n: String(MAX_LONG_TEXT) })}</p>
          <label className="kv-field" htmlFor="s-reviewed">
            <input id="s-reviewed" type="checkbox" name="reviewed" value="1" defaultChecked={values.reviewed === '1'} />
            <span>{t.t(fieldLabelKey(FORM, 'reviewed'))}</span>
          </label>
          <p className="kv-field__hint">{t.t('form.subtitle.reviewedHint')}</p>
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
                <form action={saveLessonFromChainAction}>
                  <input type="hidden" name="courseId" value={params.id} />
                  {isEdit && <input type="hidden" name="lesson" value={lessonId} />}
                  <input type="hidden" name="mode" value={mode} />
                  {FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <button type="submit" className="kv-btn">{t.t('form.submit')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(PATH, 'edit', withMeta(values), MAX_CARRIED_LENGTH_LESSON)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(lessonFormDoneKey(mode, isEdit))}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('lesson', createdId) && <p><Link href={auditHref('lesson', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          {createdId && <p><Link href={lessonHref(params.id, createdId)} className="kv-btn--link">{t.t('form.lesson.open')}</Link></p>}
          <p><Link href={outlineHref(params.id)} className="kv-btn--link">{t.t('lessons.backToOutline')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, withMeta(values), MAX_CARRIED_LENGTH_LESSON)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
