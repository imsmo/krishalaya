// apps/web-tenant/src/app/studio/insights/page.tsx · W417 · Learner insights — PC-56 TENANT-SW-f (founder: NEW CAPTURE + 50-LEARNER FLOOR).
//
// The per-lesson drop-off funnel is REAL from day one (lesson progress: started → completed). The quiz-miss heatmap (per question, % not
// correct) and the evening usage curve (watch seconds by IST hour) need the capture that began with this release, and print ONLY when the
// lesson has ≥ 50 distinct learners with captured data — below that they are REFUSED BY NAME with the real count and the floor ("small
// cohorts stay anonymous, by design"); before any capture, "capture began <date>". "Fix suggestion: recompress the images" is refused by
// name (no advisory generator). Aggregates only — an instructor sees shapes and shares, never a named learner. µs paging of courses.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { StudioCourse, StudioCourseInsights, StudioLesson } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DataTable } from '../../../components/DataTable';
import { AsOf } from '../../../components/AsOf';
import { STUDIO_INSIGHTS_HREF, asOfLabels, isUuid, sharePercent, swfPageState } from '../../../features/swf/console';
import { MethodLine, RefusedLine } from '../../insights/RefusedLine';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.learner.title'), robots: { index: false, follow: false } }; }

export default async function LearnerInsightsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(STUDIO_INSIGHTS_HREF);
  const t = getTranslator(); const lang = getLang();
  const course = isUuid(searchParams.course) ? searchParams.course : null;
  let list: { items: StudioCourse[]; nextCursor: string | null } | null = null; let one: StudioCourseInsights | null = null; let state: string | null = null;
  try {
    if (course) one = await tenantClient().studioInsights.course(course);
    else list = await tenantClient().studioInsights.courses({ cursor: searchParams.cursor, limit: 25 });
  } catch (e) { state = swfPageState(e instanceof SdkError ? e.status : undefined); if (course && e instanceof SdkError && e.code === 'COURSE_NOT_FOUND') state = 'notFound'; }
  const pctOf = (a: number, b: number) => (b > 0 ? sharePercent(Math.floor((a * 10_000) / b)) : t.t('common.dash'));
  const floorLine = (v: Exclude<StudioLesson['watchCurve'], { kind: 'shown' }>) => (
    v.code === 'NO_CAPTURE_YET'
      ? <span>{t.t('swf.learner.noCapture', { date: one?.captureBegan ? formatDate(one.captureBegan, lang, { dateStyle: 'medium' }) : t.t('common.dash') })} <code>{v.code}</code></span>
      : <RefusedLine t={t} lang={lang} code={v.code} words={one?.refusals} label={t.t('swf.learner.floorCount', { n: String(v.learners), floor: String(v.floor) })} />);
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swf.learner.studio')}><Link href="/studio">{t.t('swf.learner.studio')}</Link> / <span aria-current="page">{t.t('swf.learner.title')}</span></nav>
      <h1>{t.t('swf.learner.title')}</h1>
      <p className="kv-field__hint">{t.t('swf.learner.lead')}</p>
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swf.state.${state}.title`)}</strong><p>{t.t(state === 'flaggedOff' ? 'swf.learner.flaggedOff' : state === 'restricted' ? 'swf.learner.restricted' : `swf.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={course ? `${STUDIO_INSIGHTS_HREF}?course=${course}` : STUDIO_INSIGHTS_HREF} className="kv-btn--link">{t.t('swf.retry')}</Link></p>}
        </div>
      ) : list ? (
        <>
          <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
          {list.items.length === 0 ? <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swf.learner.empty.title')}</strong><p>{t.t('swf.learner.empty.body')}</p></div> : (
            <DataTable rows={list.items} empty={t.t('swf.learner.empty.title')} columns={[
              { header: t.t('swf.learner.col.course'), cell: (c) => <Link href={`${STUDIO_INSIGHTS_HREF}?course=${c.id}`} className="kv-btn--link">{c.title}</Link> },
              { header: t.t('swf.learner.col.enrolled'), cell: (c) => formatNumber(c.enrolled, lang) },
              { header: t.t('swf.learner.col.completion'), cell: (c) => pctOf(c.completed, c.enrolled) },
            ]} />
          )}
          {list.nextCursor && <p><Link href={`${STUDIO_INSIGHTS_HREF}?cursor=${encodeURIComponent(list.nextCursor)}`} className="kv-btn--link">{t.t('swf.more')}</Link></p>}
        </>
      ) : one && (
        <>
          <AsOf at={one.asOf} labels={asOfLabels(t)} />
          <p><strong>{one.course.title}</strong> · {t.t('swf.learner.enrolledCompletion', { n: String(one.course.enrolled), pct: pctOf(one.course.completed, one.course.enrolled) })}</p>
          <h2>{t.t('swf.learner.funnel')}</h2>
          <DataTable rows={one.lessons} empty={t.t('swf.learner.noLessons')} columns={[
            { header: t.t('swf.learner.col.lesson'), cell: (l) => `${l.moduleNo}.${l.lessonNo} — ${l.title}` },
            { header: t.t('swf.learner.col.started'), cell: (l) => formatNumber(l.started, lang) },
            { header: t.t('swf.learner.col.completed'), cell: (l) => `${formatNumber(l.completed, lang)} (${pctOf(l.completed, l.started)})` },
          ]} />
          <h2>{t.t('swf.learner.heatmap')}</h2>
          <ul className="kv-list">{one.lessons.filter((l) => l.quizMiss).map((l) => (
            <li key={l.lessonId}><strong>{l.title}</strong>: {l.quizMiss!.kind === 'shown'
              ? <span>{l.quizMiss!.questions.map((q) => `${t.t('swf.learner.q', { n: String(q.questionNo) })} ${q.missBps === null ? t.t('common.dash') : sharePercent(q.missBps)}`).join(' · ')} <span className="kv-detail__muted">({t.t('swf.learner.learners', { n: String(l.quizMiss!.learners) })})</span></span>
              : floorLine(l.quizMiss as Exclude<StudioLesson['watchCurve'], { kind: 'shown' }>)}</li>))}</ul>
          <h2>{t.t('swf.learner.curve')}</h2>
          <ul className="kv-list">{one.lessons.map((l) => (
            <li key={l.lessonId}><strong>{l.title}</strong>: {l.watchCurve.kind === 'shown'
              ? <span>{l.watchCurve.hours.map((h) => `${String(h.hour).padStart(2, '0')}:00 ${t.t('swf.learner.seconds', { n: formatNumber(h.seconds, lang) })}`).join(' · ')} <span className="kv-detail__muted">({t.t('swf.learner.learners', { n: String(l.watchCurve.learners) })})</span></span>
              : floorLine(l.watchCurve)}</li>))}</ul>
          <div className="kv-card"><p><strong>{t.t('swf.learner.fix')}</strong></p><p><RefusedLine t={t} lang={lang} code={one.advisory.code} words={one.refusals} /></p></div>
          <div className="kv-card"><h2>{t.t('swf.methods')}</h2><ul className="kv-list">{['funnel', 'quiz_miss', 'watch_curve'].map((m) => <MethodLine key={m} t={t} lang={lang} code={m} words={one!.methods} />)}</ul>
            <p className="kv-field__hint">{t.t('swf.learner.aggregatesOnly', { floor: String(one.floor) })}</p></div>
          <p><Link href={STUDIO_INSIGHTS_HREF} className="kv-btn--link">{t.t('swf.learner.allCourses')}</Link></p>
        </>
      )}
    </section>
  );
}
