// apps/web-tenant/src/app/courses/[id]/lessons/[lessonId]/quiz/page.tsx · the quiz form chain — W2727–W2730 · PC-56
// TENANT-7b. W413 says *"one question shown — the builder saves each as you go"*, and the canon's quiz module names
// three actions on this chain: *"Add explanations · Record by voice · Save question."* This is ONE question (`?n=`; the
// count + 1 is a new one) with up to six options, an explanation per option (mandatory — *"Save is disabled until every
// option teaches something, right or wrong"*), the correct option, and the quiz's certificate threshold, which rides on
// every question's form because W413 draws it there. *Add explanations* is this form opened on the question with the
// gap. *Record by voice* is REFUSED BY NAME: no speech-to-text provider is wired to this console.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getTranslator } from '../../../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { FormReview, LessonRecord } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey, generalRefusals, isFormError, nothingStoredKey, normalisedKey,
  readCarried, refusalKey, refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey, carryValues,
} from '../../../../../../features/forms/chain';
import { MAX_CARRIED_LENGTH_LESSON, QUESTION_FORM, QUESTION_FORM_FIELDS, QUIZ_MAX_OPTIONS, answerNumber, lessonHref, questionNo, quizFormPath, voiceRefusedKey } from '../../../../../../features/courses/lessons';
import { saveQuestionFromChainAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.question.title'), robots: { index: false, follow: false } };
}

type Q = { q: string; options: string[]; answer: number; explanations?: string[] };

export default async function QuizFormPage({ params, searchParams }: { params: { id: string; lessonId: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = quizFormPath(params.id, params.lessonId);
  await requireSession(PATH);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  let values = readCarried(searchParams, QUESTION_FORM_FIELDS);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;

  let rec: LessonRecord | null = null;
  try { rec = await tenantClient().courses.lesson(params.id, params.lessonId); } catch { rec = null; }
  const questions: Q[] = Array.isArray((rec?.lesson.quiz as { questions?: unknown } | null)?.questions) ? ((rec!.lesson.quiz as { questions: Q[] }).questions) : [];
  const n = questionNo(typeof searchParams.n === 'string' ? searchParams.n : undefined, questions.length);
  const isEdit = n <= questions.length;
  const meta = { n: String(n) };
  const carried = carryValues(step, { ...values, ...meta }, MAX_CARRIED_LENGTH_LESSON);
  const withMeta = (v: Record<string, string | undefined | null>) => ({ ...v, ...meta });
  // EDIT: the first visit opens with the question as it stands.
  if (step === 'edit' && isEdit && Object.keys(values).length === 0) {
    const cur = questions[n - 1];
    values = { q: cur.q, answer: answerNumber(cur.answer), passingPct: rec?.lesson.quizPassingPct == null ? '' : String(rec.lesson.quizPassingPct) };
    cur.options.forEach((o, i) => { values[`opt${i + 1}`] = o; values[`expl${i + 1}`] = cur.explanations?.[i] ?? ''; });
    for (const k of Object.keys(values)) if (!values[k]) delete values[k];
  }
  if (step === 'edit' && !isEdit && !values.passingPct && rec?.lesson.quizPassingPct != null) values.passingPct = String(rec.lesson.quizPassingPct);

  let review: FormReview | null = null;
  let reviewError: string | null = null;
  if (step === 'review') {
    try { review = await tenantClient().courses.previewQuestion(params.id, params.lessonId, n, Object.fromEntries(QUESTION_FORM_FIELDS.map((f) => [f, values[f]]))); }
    catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }
  const backHref = lessonHref(params.id, params.lessonId);
  const rows = Array.from({ length: QUIZ_MAX_OPTIONS }, (_, i) => i + 1);

  return (
    <section>
      <h1>{t.t(isEdit ? 'form.question.editTitle' : 'form.question.title', { n: String(n) })}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {rec && rec.lesson.contentKind !== 'quiz' && <div className="kv-error" role="alert"><p>{t.t(refusalKey(QUESTION_FORM, 'NOT_A_QUIZ'))}</p></div>}

      {step === 'edit' && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          <input type="hidden" name="n" value={n} />
          <div className="kv-card kv-card--notice"><p>{t.t('lessons.quiz.mirror')}</p></div>
          <label className="kv-field" htmlFor="q-text">
            <span>{t.t(fieldLabelKey(QUESTION_FORM, 'q'))}</span>
            <textarea id="q-text" name="q" defaultValue={values.q ?? ''} rows={3} maxLength={500} required />
          </label>
          <p className="kv-field__hint">{t.t(voiceRefusedKey())}</p>
          <fieldset className="kv-card">
            <legend>{t.t('form.question.optionsLegend')}</legend>
            <p className="kv-field__hint">{t.t('form.question.optionsHint')}</p>
            {rows.map((i) => (
              <div key={i} className="kv-card">
                <label className="kv-field" htmlFor={`q-answer-${i}`}>
                  <input id={`q-answer-${i}`} type="radio" name="answer" value={String(i)} defaultChecked={values.answer === String(i)} />
                  <span>{t.t('form.question.correctMark', { n: String(i) })}</span>
                </label>
                <label className="kv-field" htmlFor={`q-opt-${i}`}>
                  <span>{t.t(fieldLabelKey(QUESTION_FORM, `opt${i}`))}</span>
                  <input id={`q-opt-${i}`} name={`opt${i}`} defaultValue={values[`opt${i}`] ?? ''} maxLength={200} />
                </label>
                <label className="kv-field" htmlFor={`q-expl-${i}`}>
                  <span>{t.t(fieldLabelKey(QUESTION_FORM, `expl${i}`))}</span>
                  <textarea id={`q-expl-${i}`} name={`expl${i}`} defaultValue={values[`expl${i}`] ?? ''} rows={2} maxLength={500} placeholder={t.t('form.question.explPlaceholder')} />
                </label>
              </div>
            ))}
          </fieldset>
          <label className="kv-field" htmlFor="q-threshold">
            <span>{t.t(fieldLabelKey(QUESTION_FORM, 'passingPct'))}</span>
            <input id="q-threshold" name="passingPct" defaultValue={values.passingPct ?? ''} inputMode="numeric" maxLength={4} placeholder="70%" />
          </label>
          <p className="kv-field__hint">{t.t('form.question.thresholdHint')}</p>
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(QUESTION_FORM, r.code))}</p></div>)}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.filter((f) => f.entered !== null || f.stored !== null || refusalsFor(review, f.name).length > 0 || f.name === 'q' || f.name === 'answer' || f.name === 'passingPct').map((f) => (
                    <tr key={f.name}>
                      <td>{t.t(fieldLabelKey(QUESTION_FORM, f.name))}</td>
                      <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span> : <strong>{storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {refusalsFor(review, f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(QUESTION_FORM, r.code))}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="kv-field__hint">{t.t(diffKey(review))}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.before')}</th><th>{t.t('form.col.after')}</th></tr></thead>
                  <tbody>{review.diff.map((d) => <tr key={d.field}><td>{t.t(fieldLabelKey(QUESTION_FORM, d.field))}</td><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody>
                </table>
              )}
              {review.diff && review.diff.length === 0 && <p className="kv-field__hint">{t.t('form.diff.unchanged')}</p>}
              {review.ready ? (
                <form action={saveQuestionFromChainAction}>
                  <input type="hidden" name="courseId" value={params.id} />
                  <input type="hidden" name="lessonId" value={params.lessonId} />
                  <input type="hidden" name="n" value={n} />
                  {QUESTION_FORM_FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <button type="submit" className="kv-btn">{t.t('form.question.save')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(PATH, 'edit', withMeta(values), MAX_CARRIED_LENGTH_LESSON)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('form.question.saved', { n: String(n) })}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('lesson', params.lessonId) && <p><Link href={auditHref('lesson', params.lessonId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          <p><Link href={`${PATH}?n=${questions.length + 1}`} className="kv-btn--link">{t.t('lessons.quiz.newQuestion')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
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
