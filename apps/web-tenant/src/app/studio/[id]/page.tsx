// apps/web-tenant/src/app/studio/[id]/page.tsx · one course's studio detail (PC-26): facts + lessons + the
// lessons. PC-56 TENANT-7a moved every lifecycle act to the course mutate chain (`/courses/[id]/act`) — with a
// reason and an audit row — so this page links there and no longer posts a status change of its own. A missing/
// foreign id → notFound() (tenant-scoped read = IDOR guard). Money float-free; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { courseHref, publishHref } from '../../../features/courses/desk';
import { lessonHref, newLessonHref, outlineHref } from '../../../features/courses/lessons';
import type { Course, CourseLesson } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('studio.detailTitle'), robots: { index: false, follow: false } };
}

export default async function StudioCoursePage({ params }: { params: { id: string } }) {
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

  const s = course.status;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{course.defaultTitle}</h1>
        <Link href="/studio" className="kv-btn--link">← {t.t('studio.title')}</Link>
      </div>

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('studio.colStatus')}</dt><dd><span className="kv-badge">{t.t(`studio.status.${s}`) || s}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('studio.colLevel')}</dt><dd>{t.t(`studio.level.${course.level}`) || course.level}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('studio.colPrice')}</dt><dd>{course.priceMinor === '0' ? t.t('studio.free') : formatMoneyMinor(course.priceMinor, course.currencyCode, lang)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('studio.colCert')}</dt><dd>{course.certEnabled ? t.t('studio.certYes') : t.t('common.dash')}</dd></div>
      </dl>

      {/* PC-56 TENANT-7a: every act on the course itself (submit · publish · pause · resume · archive) is the mutate
          chain behind W179/W416 — one write path, with a reason and an audit row. This page keeps the lessons. */}
      <div className="kv-actions">
        <Link href={courseHref(course.id)} className="kv-btn kv-btn--muted">{t.t('courses.detailTitle')}</Link>
        <Link href={publishHref(course.id)} className="kv-btn">{t.t('courses.reviewPublish')}</Link>
      </div>

      <h2>{t.t('studio.lessons')}</h2>
      {lessons.length === 0 ? <p className="kv-muted">{t.t('studio.lessonsEmpty')}</p> : (
        <table className="kv-table">
          <thead><tr><th>#</th><th>{t.t('studio.lessonTitle')}</th><th>{t.t('studio.lessonKind')}</th></tr></thead>
          <tbody>
            {lessons.map((l) => (
              <tr key={l.id}>
                <td>{l.moduleNo}.{l.lessonNo}</td>
                <td><Link href={lessonHref(course.id, l.id)}>{l.defaultTitle}</Link></td>
                <td><span className="kv-badge">{l.contentKind}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* PC-56 TENANT-7b: the add-lesson form is the lesson chain (API-reviewed, keyed, audited); the outline is W411. */}
      <p><Link href={outlineHref(course.id)} className="kv-btn">{t.t('lessons.outlineTitle')}</Link> <Link href={newLessonHref(course.id)} className="kv-btn kv-btn--muted">{t.t('lessons.addLesson')}</Link></p>
    </section>
  );
}
