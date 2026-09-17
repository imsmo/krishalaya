// apps/web-tenant/src/app/courses/[id]/lessons/[lessonId]/page.tsx · W412 (lesson video) and W413 (quiz builder) — ONE
// record, two faces · PC-56 TENANT-7b.
//
// W412 is the lesson as a thing with a file: *Upload video · queued/processing/ready · Chapters · Thumbnail · Audio-only
// fallback · Subtitle tracks · Save draft · Mark ready*. W413 is the lesson as a thing with questions: *Question ·
// Options — each needs an explanation (mandatory) · Passing threshold (certificate only) · Save question · Record by
// voice*. Both are `course_lessons` rows, and the canon's own outline links a video row to W412 and the quiz row to
// W413, so one page renders the face the kind calls for.
//
// WHAT THIS PAGE DECLARES HONESTLY ABOUT VIDEO. `core/media` stores the file (MP4/MOV through a presigned PUT) and
// gates it on an antivirus scan; a CLEAN file is served through a presigned link. Nothing transcodes it, extracts its
// audio, cuts a thumbnail frame or drafts subtitles. So the stepper prints the SCAN state and the lesson's own `ready`;
// *"Extract audio-only version"* is the audio twin the instructor uploads as a second lesson and pairs; the thumbnail
// is a declared second into the video, stored and not rendered; a subtitle track is text a person supplied and marked
// reviewed. W412's *"Retry"* and W413's *"Record by voice"* are refused by name.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { ReactNode } from 'react';
import type { LessonRecord, MediaDownloadLink } from '@krishalaya/sdk-js';
import { courseHref } from '../../../../../features/courses/desk';
import { mutateRefusalKey } from '../../../../../features/mutate/chain';
import {
  HEADER_ACTS, ROW_ACTS, canServe, clockText, coverageKey, coverageMark, editLessonHref, kindKey, lessonActHref, lessonActLabelKey, lessonCompletionText,
  lessonPageStateKey, lessonStatusKey, lessonTransportState, lessonVerdictFor, mediaState, mediaStateKey, outlineHref, positionText, questionHref,
  retryRefusedKey, subtitleHref, thumbnailKey, voiceRefusedKey,
} from '../../../../../features/courses/lessons';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lessons.recordTitle'), robots: { index: false, follow: false } };
}

type Quiz = { questions: Array<{ q: string; options: string[]; answer: number; explanations?: string[] }> };
const readQuiz = (raw: unknown): Quiz | null => {
  const qs = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs)) return null;
  return { questions: qs.filter((x) => x && typeof x === 'object' && Array.isArray((x as Quiz['questions'][number]).options)) as Quiz['questions'] };
};

export default async function LessonRecordPage({ params }: { params: { id: string; lessonId: string } }) {
  const href = `/courses/${encodeURIComponent(params.id)}/lessons/${encodeURIComponent(params.lessonId)}`;
  await requireSession(href);
  const t = getTranslator();
  const lang = getLang();

  let rec: LessonRecord | null = null;
  let state: ReturnType<typeof lessonTransportState> | null = null;
  try { rec = await tenantClient().courses.lesson(params.id, params.lessonId); }
  catch (e) { state = e instanceof SdkError ? lessonTransportState(e.code, e.status) : 'error'; if (state === 'notFound') notFound(); }

  if (!rec) {
    return (
      <section>
        <h1>{t.t('lessons.recordTitle')}</h1>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(lessonPageStateKey(state ?? 'error'))}</p>
          {state === 'error' && <p><Link href={href} className="kv-btn--link">{t.t('lessons.retryLoad')}</Link></p>}
          {state === 'notEnabled' && <p className="kv-field__hint">{t.t('lessons.state.notEnabledHint')}</p>}
          <p><Link href={outlineHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      </section>
    );
  }

  const { course, lesson, media, acts, canEdit, tracks, languages, moduleSize } = rec;
  const isQuiz = lesson.contentKind === 'quiz';
  const ms = mediaState(media);
  // A servable link only for a CLEAN file — and only when asked for by a page that may show it.
  let link: MediaDownloadLink | null = null;
  if (media && canServe(media)) { try { link = await tenantClient().media.downloadUrl(media.id); } catch { link = null; } }
  const quiz = isQuiz ? readQuiz(lesson.quiz) : null;
  const n = (x: number) => formatNumber(x, lang);
  const headerAct = HEADER_ACTS.map((a) => lessonVerdictFor(acts, a)).find((v) => v && v.allowed) ?? null;
  const refusedHeader = HEADER_ACTS.map((a) => lessonVerdictFor(acts, a)).filter((v): v is NonNullable<typeof v> => !!v && !v.allowed && v.refusals.some((r) => r !== 'ILLEGAL_FROM_STATUS'));

  return (
    <section>
      <nav aria-label={t.t('common.breadcrumb')} className="kv-field__hint">
        <Link href={courseHref(course.id)} className="kv-btn--link">{course.defaultTitle}</Link> · <Link href={outlineHref(course.id)} className="kv-btn--link">{t.t('lessons.outlineTitle')}</Link> · {lesson.defaultTitle}
      </nav>
      <div className="kv-page-head">
        <h1>{lesson.defaultTitle} <span className="kv-badge">{t.t(kindKey(lesson.contentKind))}</span> <span className="kv-badge">{t.t(lessonStatusKey(lesson.status))}</span></h1>
        {canEdit && (
          <div className="kv-actions">
            {isQuiz
              ? <Link href={questionHref(course.id, lesson.id, (quiz?.questions.length ?? 0) + 1)} className="kv-btn kv-btn--muted">{t.t('lessons.quiz.newQuestion')}</Link>
              : <Link href={editLessonHref(course.id, lesson.id)} className="kv-btn kv-btn--muted">{t.t('lessons.saveDraft')}</Link>}
            {headerAct && <Link href={lessonActHref(course.id, lesson.id, headerAct.act)} className="kv-btn">{t.t(lessonActLabelKey(headerAct.act))}</Link>}
          </div>
        )}
      </div>
      <p className="kv-field__hint">{t.t('lessons.recordSub', { p: positionText(rec), n: n(moduleSize), course: course.defaultTitle })}</p>
      {!canEdit && <div className="kv-card kv-card--notice" role="status"><p>{t.t(isQuiz ? 'lessons.state.quizRestricted' : 'lessons.state.videoRestricted')}</p></div>}
      {/* every reason the state act would be refused, printed — no button 403s */}
      {canEdit && refusedHeader.map((v) => v.refusals.filter((r) => r !== 'ILLEGAL_FROM_STATUS').map((r) => (
        <div className="kv-error" role="alert" key={`${v.act}-${r}`}><p>{t.t(lessonActLabelKey(v.act))}: {t.t(mutateRefusalKey('lesson', r))}</p></div>
      )))}

      {isQuiz ? (
        /* ================= W413 — THE QUIZ BUILDER ================= */
        <>
          <div className="kv-card kv-card--notice"><p>{t.t('lessons.quiz.mirror')}</p></div>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('lessons.quiz.threshold')}</dt><dd>{lesson.quizPassingPct === null || lesson.quizPassingPct === undefined ? <span className="kv-field__hint">{t.t('lessons.quiz.thresholdNone')}</span> : `${n(lesson.quizPassingPct)}%`}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('lessons.quiz.questions')}</dt><dd>{n(quiz?.questions.length ?? 0)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('lessons.quiz.voice')}</dt><dd><span className="kv-field__hint">{t.t(voiceRefusedKey())}</span></dd></div>
          </dl>
          <p className="kv-field__hint">{t.t('lessons.quiz.thresholdHint')}</p>
          {rec.quiz && rec.quiz.missingExplanations.length > 0 && (
            <div className="kv-error" role="alert">
              <p>{t.t('lessons.quiz.missingExplanations', { n: n(rec.quiz.missingExplanations.length) })}</p>
              {canEdit && <p><Link href={questionHref(course.id, lesson.id, rec.quiz.missingExplanations[0].question)} className="kv-btn--link">{t.t('lessons.quiz.addExplanations')}</Link></p>}
            </div>
          )}
          {!quiz || quiz.questions.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t('lessons.quiz.empty')}</p>
              {canEdit && <p><Link href={questionHref(course.id, lesson.id, 1)} className="kv-btn">{t.t('lessons.quiz.newQuestion')}</Link></p>}
            </div>
          ) : (
            <ol className="kv-list">
              {quiz.questions.map((q, qi) => (
                <li key={qi} className="kv-card">
                  <h2>{n(qi + 1)}. {q.q}</h2>
                  <ol type="A">
                    {q.options.map((o, oi) => (
                      <li key={oi}>
                        <strong>{o}</strong>{oi === q.answer && <span className="kv-badge"> {t.t('lessons.quiz.correct')}</span>}
                        <p className="kv-field__hint">{(q.explanations?.[oi] ?? '').trim().length > 0 ? q.explanations![oi] : <span className="kv-error">{t.t('lessons.quiz.noExplanation')}</span>}</p>
                      </li>
                    ))}
                  </ol>
                  {canEdit && <p><Link href={questionHref(course.id, lesson.id, qi + 1)} className="kv-btn--link">{t.t('lessons.quiz.editQuestion')}</Link></p>}
                </li>
              ))}
            </ol>
          )}
          <p className="kv-field__hint" style={{ fontStyle: 'italic' }}>{t.t('lessons.quiz.quote')}</p>
        </>
      ) : (
        /* ================= W412 — THE LESSON ================= */
        <>
          <h2>{t.t('lessons.media.heading')}</h2>
          <div className="kv-card">
            <p className="kv-field__hint">{t.t('lessons.media.limits')}</p>
            <p><span className={ms === 'blocked' ? 'kv-badge kv-error' : 'kv-badge'}>{t.t(mediaStateKey(ms))}</span> <span className="kv-badge">{t.t(lessonStatusKey(lesson.status))}</span></p>
            <p className="kv-field__hint">{t.t('lessons.media.honest')}</p>
            {media && (
              <dl className="kv-facts">
                <div className="kv-facts__row"><dt>{t.t('lessons.media.kind')}</dt><dd>{media.kind} · {media.mimeType}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('lessons.media.bytes')}</dt><dd>{media.bytes}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('lessons.col.duration')}</dt><dd>{clockText(lesson.durationSecs) ?? t.t('common.dash')}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('lessons.media.served')}</dt><dd>{link ? <a href={link.url} rel="noreferrer">{t.t('lessons.media.open')}</a> : <span className="kv-field__hint">{t.t('lessons.media.notServed')}</span>}</dd></div>
              </dl>
            )}
            {ms === 'blocked' && (
              <div className="kv-error" role="alert">
                <p>{t.t('lessons.media.blocked.title')}</p>
                <p className="kv-field__hint">{t.t('lessons.media.blocked.body')}</p>
                <p className="kv-field__hint">{t.t(retryRefusedKey())}</p>
                {canEdit && <p><Link href={editLessonHref(course.id, lesson.id)} className="kv-btn--link">{t.t('lessons.media.reupload')}</Link></p>}
              </div>
            )}
            {ms === 'none' && lesson.contentKind !== 'article' && <p className="kv-field__hint">{t.t('lessons.media.none')}</p>}
            {lesson.body && <p>{lesson.body}</p>}
          </div>

          {(lesson.contentKind === 'video' || lesson.contentKind === 'audio' || lesson.contentKind === 'live') && (
            <>
              <h2>{t.t('lessons.chapters.heading')} {canEdit && <Link href={editLessonHref(course.id, lesson.id)} className="kv-btn--link">{t.t('lessons.chapters.add')}</Link>}</h2>
              {(lesson.chapters ?? []).length === 0 ? <p className="kv-field__hint">{t.t('lessons.chapters.none')}</p> : (
                <ul className="kv-list">{(lesson.chapters ?? []).map((c) => <li key={c.at}><span className="kv-mono">{clockText(c.at)}</span> — {c.title}</li>)}</ul>
              )}
            </>
          )}

          {lesson.contentKind === 'video' && (
            <>
              <h2>{t.t('lessons.thumbnail.heading')}</h2>
              <p>{t.t(thumbnailKey(lesson.thumbnailFrameSecs), { at: clockText(lesson.thumbnailFrameSecs) ?? '' })}</p>
              <p className="kv-field__hint">{t.t('lessons.thumbnail.honest')}</p>
              <h2>{t.t('lessons.twin.heading')}</h2>
              {rec.sibling
                ? <p>{t.t('lessons.twin.paired')} <Link href={`/courses/${encodeURIComponent(course.id)}/lessons/${encodeURIComponent(rec.sibling.id)}`}>{rec.sibling.defaultTitle}</Link></p>
                : <p className="kv-error">{t.t('lessons.twin.none')}</p>}
              <p className="kv-field__hint">{t.t('lessons.twin.honest')}</p>
            </>
          )}
          {lesson.contentKind === 'audio' && rec.pairedWith && <p className="kv-field__hint">{t.t('lessons.twin.of')} <Link href={`/courses/${encodeURIComponent(course.id)}/lessons/${encodeURIComponent(rec.pairedWith.id)}`}>{rec.pairedWith.defaultTitle}</Link></p>}

          {(lesson.contentKind === 'video' || lesson.contentKind === 'audio' || lesson.contentKind === 'live') && (
            <>
              <h2>{t.t('lessons.subtitles.heading')}</h2>
              <table className="kv-table">
                <thead><tr><th scope="col">{t.t('lessons.subtitles.language')}</th><th scope="col">{t.t('lessons.col.status')}</th><th scope="col">{t.t('lessons.subtitles.size')}</th>{canEdit && <th scope="col"></th>}</tr></thead>
                <tbody>
                  {languages.map((l) => {
                    const tr = tracks.find((x) => x.languageCode === l);
                    const m = coverageMark({ lesson, subtitles: Object.fromEntries(tracks.map((x) => [x.languageCode, x.status])) }, l);
                    return (
                      <tr key={l}>
                        <td>{l}</td>
                        <td><span className={m === 'missing' ? 'kv-badge kv-error' : 'kv-badge'}>{t.t(coverageKey(m))}</span></td>
                        <td>{tr ? n(tr.bodyLength) : <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                        {canEdit && <td><Link href={subtitleHref(course.id, lesson.id, l)} className="kv-btn--link">{tr ? t.t('lessons.subtitles.edit') : t.t('lessons.subtitles.add')}</Link></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="kv-field__hint">{tracks.length === 0 ? t.t('lessons.subtitles.none') : t.t('lessons.subtitles.honest')}</p>
            </>
          )}
          <p className="kv-field__hint" style={{ fontStyle: 'italic' }}>{t.t('lessons.quote')}</p>
        </>
      )}

      <h2>{t.t('lessons.reality.heading')}</h2>
      <p>{lessonCompletionText(rec.stats) ? t.t('lessons.reality.completion', { x: lessonCompletionText(rec.stats) as string }) : t.t('lessons.completionNobody')}</p>
      {canEdit && (
        <p className="kv-field__hint">
          {ROW_ACTS.map((a) => { const v = lessonVerdictFor(acts, a); return v?.allowed ? <Link key={a} href={lessonActHref(course.id, lesson.id, a)} className="kv-btn--link">{t.t(lessonActLabelKey(a))}</Link> : <span key={a}>{t.t(lessonActLabelKey(a))}: {t.t(mutateRefusalKey('lesson', v?.refusals[0] ?? 'AT_TOP'))}</span>; }).reduce<ReactNode[]>((acc, x, i) => (i === 0 ? [x] : [...acc, ' · ', x]), [])}
        </p>
      )}
      <p><Link href={outlineHref(course.id)} className="kv-btn--link">{t.t('lessons.backToOutline')}</Link></p>
    </section>
  );
}
