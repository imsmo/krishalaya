// apps/web-tenant/src/app/courses/[id]/page.tsx · W179 — one course, the desk's view of it · PC-56 TENANT-7a.
//
// W179 shows the record (topic · level · price · instructor · lessons across modules · cert · learners, completion),
// the lessons table (M·L · kind · duration · completion), *"learner reality"*, the quiz note, and the ARCHIVE box with
// its mandatory reason. Every act here is the mutate chain (W2550–W2552): the button links to the confirm step and the
// API's verdict decides which buttons exist — an act the server refuses is printed with its reason, never as a 403.
//
// WHAT IS SHOWN AND WHAT IS NAMED
//   • Learners / completion / certificates: this tenant's enrolments (`stats`), integer arithmetic, nothing invented.
//   • Per-lesson completion, *"most-watched hour"*, *"41% listen audio-only"*: `lesson_progress` holds `seconds_watched`
//     and `completed_at` per enrolment; a per-lesson completion is a real aggregate this wave did not build (it is a
//     read over the module's hottest table and belongs with the lesson record, TENANT-7b); the hour-of-day and the
//     audio-only share have NO column at all. All three are named on the screen, not faked.
//   • *"Preview as member"*: the learner surface is the mobile app; the console has no learner view. Named.
//   • *"Add lesson"*: the lesson chain (W2664–W2667) is TENANT-7b's; until then the link goes to PC-26's studio form.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { Course, CourseActs, CourseLesson, CourseStats } from '@krishalaya/sdk-js';
import {
  COURSES_HREF, DETAIL_ROW_ACTS, actHref, actLabelKey, actRefusalKey, courseTransportState, editCourseHref, lessonsHref, levelKey,
  originKey, pageStateKey, publishHref, refusedActs, statusKey, verdictFor, completionPct, learnersOf,
} from '../../../features/courses/desk';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('courses.detailTitle'), robots: { index: false, follow: false } };
}

const durationText = (secs: number | null | undefined): string | null => {
  if (secs === null || secs === undefined) return null;
  const m = Math.floor(secs / 60); const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default async function CourseDetailPage({ params }: { params: { id: string } }) {
  const href = `/courses/${encodeURIComponent(params.id)}`;
  await requireSession(href);
  const t = getTranslator();
  const lang = getLang();

  let course: (Course & { lessons?: CourseLesson[] }) | null = null;
  let acts: CourseActs | null = null;
  let stats: CourseStats | null = null;
  let state: ReturnType<typeof courseTransportState> | null = null;
  try {
    course = await tenantClient().courses.get(params.id);
  } catch (e) {
    state = e instanceof SdkError ? courseTransportState(e.code, e.status) : 'error';
    if (state === 'notFound') notFound();
  }
  if (course) {
    // The verdicts are the desk's or the owner's; a reader with neither still sees the record (W179's restricted state
    // is about EDITING). The stats are the desk's read; an owner sees them for their own course through `mine`.
    try { acts = await tenantClient().courses.acts(course.id); stats = acts.stats; } catch { acts = null; }
  }

  if (state !== null || !course) {
    return (
      <section>
        <h1>{t.t('courses.detailTitle')}</h1>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state ?? 'error'))}</p>
          {state === 'error' && <p><Link href={href} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
          <p><Link href={COURSES_HREF} className="kv-btn--link">{t.t('courses.back')}</Link></p>
        </div>
      </section>
    );
  }

  const lessons = course.lessons ?? [];
  const modules = new Set(lessons.map((l) => l.moduleNo)).size;
  const quizzes = lessons.filter((l) => l.contentKind === 'quiz');
  const pct = completionPct(stats); const learners = learnersOf(stats);
  const archive = acts ? verdictFor(acts.acts, 'archive') : null;
  const rowActs = acts ? DETAIL_ROW_ACTS.map((a) => verdictFor(acts!.acts, a)).filter((v): v is NonNullable<typeof v> => v !== null) : [];
  const editable = !!acts && !course.isPlatformLibrary && course.status !== 'archived';

  return (
    <section>
      <p className="kv-field__hint"><Link href={COURSES_HREF} className="kv-btn--link">{t.t('courses.title')}</Link> › {course.defaultTitle}</p>
      <div className="kv-page-head">
        <h1>{course.defaultTitle} <span className="kv-badge">{t.t(statusKey(course.status))}</span></h1>
        <span>
          {editable && <Link href={editCourseHref(course.id)} className="kv-btn kv-btn--muted">{t.t('courses.edit')}</Link>}{' '}
          {!course.isPlatformLibrary && <Link href={publishHref(course.id)} className="kv-btn kv-btn--muted">{t.t('courses.reviewPublish')}</Link>}{' '}
          {editable && <Link href={lessonsHref(course.id)} className="kv-btn">{t.t('courses.addLesson')}</Link>}
        </span>
      </div>

      {/* ---- the record line W179 prints under the title ---- */}
      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('courses.col.topic')}</dt><dd>{course.topicCode ? <><code>{course.topicCode}</code> · {course.topicName}</> : t.t('courses.noTopic')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('courses.col.level')}</dt><dd>{t.t(levelKey(course.level))}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('courses.col.price')}</dt><dd>{course.priceMinor === '0' ? t.t('courses.free') : formatMoneyMinor(course.priceMinor, course.currencyCode, lang)} <span className="kv-field__hint">{course.currencyCode}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('courses.origin')}</dt><dd>{t.t(originKey(course))}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('courses.lessons')}</dt><dd>{t.t('courses.lessonsAcross', { n: formatNumber(lessons.length, lang), m: formatNumber(modules, lang) })}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('courses.col.cert')}</dt><dd>{course.certEnabled ? t.t('courses.certYes') : t.t('courses.certNo')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('courses.col.learners')}</dt><dd>{learners === null ? t.t('courses.noLearnersYet') : <>{formatNumber(learners, lang)}{pct !== null && <> · {formatNumber(pct, lang)}% {t.t('courses.completionWord')}</>}{stats && <> · {formatNumber(stats.certificates, lang)} {t.t('courses.tile.certificates')}</>}</>}</dd></div>
        {course.publishedAt && <div className="kv-facts__row"><dt>{t.t('courses.publishedAt')}</dt><dd>{formatDate(course.publishedAt, lang, { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>}
      </dl>
      {/* W179 names the instructor. This platform stores the instructor's user id and no display name on the
          instructor row; the profile screen (W419, TENANT-7d) owns the name and its verification. */}
      <p className="kv-field__hint">{t.t('courses.instructorNote')}</p>

      {/* ---- the acts row: offered when allowed, printed with its reason when not ---- */}
      {acts && rowActs.length > 0 && (
        <div className="kv-actions">
          {rowActs.filter((v) => v.allowed).map((v) => (
            <Link key={v.act} href={actHref(course!.id, v.act)} className="kv-btn">{t.t(actLabelKey(v.act))}</Link>
          ))}
          {rowActs.filter((v) => !v.allowed && !v.refusals.includes('ILLEGAL_FROM_STATUS')).map((v) => (
            <span key={v.act} className="kv-field__hint">{t.t(actLabelKey(v.act))}: {v.refusals.map((r) => t.t(actRefusalKey(r))).join(' · ')}</span>
          ))}
        </div>
      )}

      {/* ---- lessons (module · lesson unique) ---- */}
      <h2>{t.t('courses.lessonsHeading')}</h2>
      {lessons.length === 0 ? (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('courses.lessonsEmpty')}</p>
          {editable && <p><Link href={lessonsHref(course.id)} className="kv-btn--link">{t.t('courses.addLesson')}</Link></p>}
        </div>
      ) : (
        <table className="kv-table">
          <thead><tr><th>M·L</th><th>{t.t('courses.lessonTitle')}</th><th>{t.t('courses.lessonKind')}</th><th>{t.t('courses.lessonDuration')}</th><th>{t.t('courses.col.completion')}</th></tr></thead>
          <tbody>
            {lessons.map((l) => (
              <tr key={l.id}>
                <td>{l.moduleNo}·{l.lessonNo}</td>
                <td>{l.defaultTitle}</td>
                <td><span className="kv-badge">{t.t(`courses.kind.${l.contentKind}`)}</span></td>
                <td>{l.contentKind === 'quiz' ? t.t('courses.quizQuestions', { n: formatNumber(Array.isArray((l.quiz as { questions?: unknown[] } | null)?.questions) ? ((l.quiz as { questions: unknown[] }).questions.length) : 0, lang) }) : (durationText(l.durationSecs) ?? t.t('common.dash'))}</td>
                <td><span className="kv-field__hint">{t.t('courses.lessonCompletionNotBuilt')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ---- learner reality: what the platform measures, and what it does not ---- */}
      <h2>{t.t('courses.reality.heading')}</h2>
      <ul>
        <li>{learners === null ? t.t('courses.noLearnersYet') : t.t('courses.reality.learners', { n: formatNumber(learners, lang), c: formatNumber(stats?.completed ?? 0, lang) })}</li>
        <li>{stats ? t.t('courses.reality.certificates', { n: formatNumber(stats.certificates, lang) }) : t.t('courses.reality.certificatesNone')}</li>
        <li className="kv-field__hint">{t.t('courses.reality.hourNotMeasured')}</li>
        <li className="kv-field__hint">{t.t('courses.reality.audioNotMeasured')}</li>
        <li className="kv-field__hint">{t.t('courses.reality.previewNotBuilt')}</li>
      </ul>

      <h2>{t.t('courses.quiz.heading')}</h2>
      <p>{quizzes.length === 0 ? t.t('courses.quiz.none') : t.t('courses.quiz.count', { n: formatNumber(quizzes.length, lang) })} <span className="kv-field__hint">{t.t('courses.quiz.rule')}</span></p>
      <p className="kv-field__hint">{t.t('courses.quiz.thresholdNotBuilt')}</p>

      {/* ---- W179's archive box: destructive, its own place, its reason on the confirm step ---- */}
      {archive && (
        <div className="kv-card">
          <h2>{t.t('courses.archive.heading')}</h2>
          <p className="kv-field__hint">{t.t('courses.archive.note')}</p>
          {archive.allowed
            ? <p><Link href={actHref(course.id, 'archive')} className="kv-btn kv-btn--muted">{t.t(actLabelKey('archive'))}</Link></p>
            : <p className="kv-field__hint">{archive.refusals.map((r) => t.t(actRefusalKey(r))).join(' · ')}</p>}
        </div>
      )}
      {acts && refusedActs(acts.acts).length === acts.acts.length && course.status !== 'archived' && (
        <p className="kv-field__hint">{t.t('courses.state.editRestricted')}</p>
      )}
      {!acts && !course.isPlatformLibrary && <p className="kv-field__hint">{t.t('courses.state.editRestricted')}</p>}
    </section>
  );
}
