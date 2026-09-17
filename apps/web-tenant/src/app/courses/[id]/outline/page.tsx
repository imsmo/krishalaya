// apps/web-tenant/src/app/courses/[id]/outline/page.tsx · W411 — the course builder: the OUTLINE and the reorder act ·
// PC-56 TENANT-7b.
//
// W411's body is one table: position · lesson (linked to its record) · content_kind · duration (mm:ss) · language
// coverage per language · a row menu whose *"Reorder lesson N (keyboard: move up/down controls in the row menu)"* is the
// reorder act, here as two links into the lesson MUTATE chain (a move is a state change with a reason and an audit row,
// Completeness Law B4). The footer counts what the table shows — `12 lessons · 4 video ↔ 4 audio-only pairs · gu
// 12/12 · hi 12/12 · en 10/12` — and the languages are the TENANT's, not three codes.
//
// W411's header cards (topic · price · certificate) are the COURSE record's fields: they are shown and their edit is
// 7a's form chain. *"Start from template"* (the empty state) is NAMED, not built: there is no template table. The
// read-only state is a person who can read the course but not author it (another instructor, a reader).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CourseOutline } from '@krishalaya/sdk-js';
import { courseHref, editCourseHref, publishHref, statusKey } from '../../../../features/courses/desk';
import {
  clockText, coverageKey, coverageMark, kindKey, lessonActHref, lessonCompletionText, lessonHref, lessonPageStateKey, lessonStatusKey,
  lessonTransportState, newLessonHref, outlineSummary, positionText, ROW_ACTS, lessonActLabelKey,
} from '../../../../features/courses/lessons';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lessons.outlineTitle'), robots: { index: false, follow: false } };
}

export default async function CourseOutlinePage({ params }: { params: { id: string } }) {
  const href = `/courses/${encodeURIComponent(params.id)}/outline`;
  await requireSession(href);
  const t = getTranslator();
  const lang = getLang();

  let outline: CourseOutline | null = null;
  let state: ReturnType<typeof lessonTransportState> | null = null;
  try { outline = await tenantClient().courses.outline(params.id); }
  catch (e) { state = e instanceof SdkError ? lessonTransportState(e.code, e.status) : 'error'; if (state === 'notFound') notFound(); }

  if (!outline) {
    return (
      <section>
        <h1>{t.t('lessons.outlineTitle')}</h1>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(lessonPageStateKey(state ?? 'error'))}</p>
          {state === 'error' && <p><Link href={href} className="kv-btn--link">{t.t('lessons.retryLoad')}</Link></p>}
          {state === 'notEnabled' && <p className="kv-field__hint">{t.t('lessons.state.notEnabledHint')}</p>}
          <p><Link href={courseHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      </section>
    );
  }

  const { course, lessons, languages, canEdit, gate } = outline;
  const sum = outlineSummary(lessons, languages);
  const n = (x: number) => formatNumber(x, lang);

  return (
    <section>
      <nav aria-label={t.t('common.breadcrumb')} className="kv-field__hint">
        <Link href={courseHref(course.id)} className="kv-btn--link">{course.defaultTitle}</Link> · {t.t('lessons.outlineTitle')}
      </nav>
      <div className="kv-page-head">
        <h1>{course.defaultTitle} <span className="kv-badge">{t.t(statusKey(course.status))}</span></h1>
        <div className="kv-actions">
          <Link href={publishHref(course.id)} className="kv-btn kv-btn--muted">{t.t('courses.reviewPublish')}</Link>
          {canEdit && <Link href={newLessonHref(course.id)} className="kv-btn">{t.t('lessons.addLesson')}</Link>}
        </div>
      </div>
      <p className="kv-field__hint">{t.t('lessons.outlineSub')}</p>

      {/* ---- W411's three cards: the course record's own fields, edited through 7a's chain ---- */}
      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('courses.topic')}</dt><dd>{course.topicCode ? `${course.topicCode} · ${course.topicName ?? ''}` : t.t('courses.topicNone')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('courses.price')}</dt><dd>{course.priceMinor === '0' ? t.t('courses.free') : `${course.priceMajor ?? course.priceMinor} ${course.currencyCode}`}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('courses.certificate')}</dt><dd>{course.certEnabled ? t.t('courses.certYes') : t.t('courses.certNo')}</dd></div>
      </dl>
      {canEdit && <p><Link href={editCourseHref(course.id)} className="kv-btn--link">{t.t('courses.edit')}</Link></p>}
      <div className="kv-card kv-card--notice"><p><strong>{t.t('lessons.rule.title')}</strong> {t.t('lessons.rule.body')}</p></div>
      {!canEdit && <div className="kv-card kv-card--notice" role="status"><p>{t.t('lessons.state.readOnly')}</p></div>}

      {/* ---- the outline ---- */}
      {lessons.length === 0 ? (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('lessons.empty.title')}</p>
          <p className="kv-field__hint">{t.t('lessons.empty.templateNamed')}</p>
          {canEdit && <p><Link href={newLessonHref(course.id)} className="kv-btn">{t.t('lessons.addLesson')}</Link></p>}
        </div>
      ) : (
        <div className="kv-table-wrap">
          <table className="kv-table">
            <caption className="kv-field__hint">{t.t('lessons.outlineCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t.t('lessons.col.position')}</th>
                <th scope="col">{t.t('lessons.col.lesson')}</th>
                <th scope="col">{t.t('lessons.col.kind')}</th>
                <th scope="col">{t.t('lessons.col.status')}</th>
                <th scope="col">{t.t('lessons.col.duration')}</th>
                <th scope="col">{t.t('lessons.col.coverage')}</th>
                <th scope="col">{t.t('lessons.col.completion')}</th>
                {canEdit && <th scope="col">{t.t('lessons.col.reorder')}</th>}
              </tr>
            </thead>
            <tbody>
              {lessons.map((v) => (
                <tr key={v.lesson.id}>
                  <td>{positionText(v)}</td>
                  <td><Link href={lessonHref(course.id, v.lesson.id)}>{v.lesson.defaultTitle}</Link>{v.lesson.siblingLessonId && <span className="kv-field__hint"> · {t.t('lessons.pairedMark')}</span>}</td>
                  <td><span className="kv-badge">{t.t(kindKey(v.lesson.contentKind))}</span></td>
                  <td><span className="kv-badge">{t.t(lessonStatusKey(v.lesson.status))}</span></td>
                  <td>{clockText(v.lesson.durationSecs) ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                  <td>
                    {languages.map((l) => {
                      const m = coverageMark(v, l);
                      return <span key={l} className={m === 'missing' ? 'kv-badge kv-error' : 'kv-badge'} aria-label={`${l}: ${t.t(coverageKey(m))}`}>{l} {m === 'reviewed' ? '✓' : m === 'draft' ? '…' : m === 'missing' ? '—' : '·'}</span>;
                    })}
                  </td>
                  <td>{lessonCompletionText(v.stats) ?? <span className="kv-field__hint">{t.t('lessons.completionNobody')}</span>}</td>
                  {canEdit && (
                    <td>
                      {ROW_ACTS.map((a) => <Link key={a} href={lessonActHref(course.id, v.lesson.id, a)} className="kv-btn--link" aria-label={`${t.t(lessonActLabelKey(a))} — ${v.lesson.defaultTitle}`}>{t.t(lessonActLabelKey(a))}</Link>)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv-field__hint">
            {t.t('lessons.footer.lessons', { n: n(sum.lessons) })} · {t.t('lessons.footer.pairs', { v: n(sum.videos), p: n(sum.paired) })}
            {sum.coverage.map((c) => <span key={c.lang}> · {c.lang} {n(c.met)}/{n(c.of)}</span>)}
            {gate.blocking.length > 0 && <> · {t.t('lessons.footer.flagged', { n: n(gate.blocking.length) })}</>}
          </p>
          <p className="kv-field__hint">{t.t('lessons.coverageLegend')}</p>
        </div>
      )}
      <p className="kv-field__hint" style={{ fontStyle: 'italic' }}>{t.t('lessons.outlineQuote')}</p>
    </section>
  );
}
