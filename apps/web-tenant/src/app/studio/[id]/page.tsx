// apps/web-tenant/src/app/studio/[id]/page.tsx · one course's studio detail (PC-26): facts + lessons + the
// add-lesson form + ONLY the legal lifecycle actions (features/studio/manage mirrors draft→review→published;
// published↔paused; →archived — the API re-checks each transition + education.author/.publish). A missing/
// foreign id → notFound() (tenant-scoped read = IDOR guard). Money float-free; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { MediaUploader } from '../../../components/MediaUploader';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { canSubmit, canPublish, canPause, canResume, canArchive, CONTENT_KINDS } from '../../../features/studio/manage';
import { courseLifecycleAction, addLessonAction } from '../actions';
import type { Course, CourseLesson } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('studio.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'submit', 'publish', 'resume', 'pause', 'archive', 'lesson']);
const ERR = new Set(['action', 'illegal', 'lesson', 'lessonno', 'title', 'kind', 'content', 'quiz_empty', 'quiz_question', 'quiz_options', 'quiz_answer']);

export default async function StudioCoursePage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/studio/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let course: Course & { lessons?: CourseLesson[] };
  try { course = await tenantClient().courses.get(params.id); }
  catch { notFound(); }

  let lessons: CourseLesson[] = course.lessons ?? [];
  if (!course.lessons) {
    try { lessons = await tenantClient().courses.lessons(params.id); } catch { lessons = []; }
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = course.status;

  const uploaderLabels = {
    add: t.t('studio.lessonMediaAdd'), hint: t.t('studio.lessonMediaHint'), uploading: t.t('studio.uploading'),
    failed: t.t('studio.uploadFailed'), remove: t.t('studio.remove'),
  };

  const lifecycle: Array<{ kind: string; label: string; show: boolean; muted?: boolean }> = [
    { kind: 'submit', label: t.t('studio.actSubmit'), show: canSubmit(s) },
    { kind: 'publish', label: t.t('studio.actPublish'), show: canPublish(s) },
    { kind: 'pause', label: t.t('studio.actPause'), show: canPause(s), muted: true },
    { kind: 'resume', label: t.t('studio.actResume'), show: canResume(s) },
    { kind: 'archive', label: t.t('studio.actArchive'), show: canArchive(s), muted: true },
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{course.defaultTitle}</h1>
        <Link href="/studio" className="kv-btn--link">← {t.t('studio.title')}</Link>
      </div>

      {okKey && <p className="kv-success" role="status">{t.t(`studio.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`studio.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('studio.colStatus')}</dt><dd><span className="kv-badge">{t.t(`studio.status.${s}`) || s}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('studio.colLevel')}</dt><dd>{t.t(`studio.level.${course.level}`) || course.level}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('studio.colPrice')}</dt><dd>{course.priceMinor === '0' ? t.t('studio.free') : formatMoneyMinor(course.priceMinor, course.currencyCode, lang)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('studio.colCert')}</dt><dd>{course.certEnabled ? t.t('studio.certYes') : t.t('common.dash')}</dd></div>
      </dl>

      <div className="kv-actions">
        {lifecycle.filter((a) => a.show).map((a) => (
          <form key={a.kind} action={courseLifecycleAction} className="kv-inline-form">
            <input type="hidden" name="id" value={course.id} />
            <input type="hidden" name="kind" value={a.kind} />
            <button type="submit" className={a.muted ? 'kv-btn kv-btn--muted' : 'kv-btn'}>{a.label}</button>
          </form>
        ))}
      </div>

      <h2>{t.t('studio.lessons')}</h2>
      {lessons.length === 0 ? <p className="kv-muted">{t.t('studio.lessonsEmpty')}</p> : (
        <table className="kv-table">
          <thead><tr><th>#</th><th>{t.t('studio.lessonTitle')}</th><th>{t.t('studio.lessonKind')}</th></tr></thead>
          <tbody>
            {lessons.map((l) => (
              <tr key={l.id}>
                <td>{l.moduleNo}.{l.lessonNo}</td>
                <td>{l.defaultTitle}</td>
                <td><span className="kv-badge">{l.contentKind}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('studio.addLesson')}</summary>
        <form action={addLessonAction} className="kv-form">
          <input type="hidden" name="id" value={course.id} />
          <label htmlFor="l-mod" className="kv-field__label">{t.t('studio.moduleNo')}</label>
          <input id="l-mod" name="moduleNo" className="kv-input" inputMode="numeric" pattern="\d{1,3}" defaultValue="1" />
          <label htmlFor="l-no" className="kv-field__label">{t.t('studio.lessonNo')}</label>
          <input id="l-no" name="lessonNo" className="kv-input" inputMode="numeric" pattern="\d{1,3}" required />
          <label htmlFor="l-title" className="kv-field__label">{t.t('studio.lessonTitle')}</label>
          <input id="l-title" name="title" className="kv-input" required maxLength={250} />
          <label htmlFor="l-kind" className="kv-field__label">{t.t('studio.lessonKind')}</label>
          <select id="l-kind" name="contentKind" className="kv-input" defaultValue="video">
            {CONTENT_KINDS.map((k) => <option key={k} value={k}>{t.t(`studio.kind.${k}`)}</option>)}
          </select>
          <span className="kv-field__label">{t.t('studio.lessonMedia')}</span>
          <MediaUploader labels={uploaderLabels} fieldName="lessonMediaId" single />
          <label htmlFor="l-body" className="kv-field__label">{t.t('studio.lessonBody')}</label>
          <textarea id="l-body" name="body" className="kv-textarea" rows={4} maxLength={20000} />
          <label htmlFor="l-quiz" className="kv-field__label">{t.t('studio.quizText')}</label>
          <textarea id="l-quiz" name="quizText" className="kv-textarea" rows={6} maxLength={20000}
            placeholder={'Q: …\nA) …\n*B) …  ← *\nH: …'} />
          <p className="kv-field__hint">{t.t('studio.quizHint')}</p>
          <p className="kv-field__hint">{t.t('studio.lessonContentHint')}</p>
          <button type="submit" className="kv-btn">{t.t('studio.addLessonBtn')}</button>
        </form>
      </details>
    </section>
  );
}
