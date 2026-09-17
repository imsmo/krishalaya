// apps/web-tenant/src/app/courses/[id]/publish/page.tsx · W416 — review & publish · PC-56 TENANT-7a.
//
// W416: *"This screen submits to the tenant content desk — publish is the desk's act, not yours (maker-checker).
// Gate checklist — all must pass. Submission is blocked until English subtitles reach 12/12 — two lessons named above
// are the honest gap, not hidden behind an average."* And its states: *Returned with notes · Nothing submitted yet ·
// Publish stays with the desk · Couldn't submit for review*.
//
// THE GATE IS THE API's (`course-publish-gate`), and it has THREE states per check: pass, fail, and NOT MEASURED. At 7a
// six of W416's seven gates had no column (subtitle tracks, thumbnail frames, a video's audio sibling, a quiz option's
// explanation) and were printed as not measured, never blocking. PC-56 TENANT-7b gave the lesson record those columns
// (0171) and the six are MEASURED now — one `SUBTITLES` row per language the tenant teaches in, never three fixed codes
// — and they block, naming the lesson by position. `not_measured` remains in the type for a check some future wave
// cannot yet answer; no check prints it today.
//
// TWO PERSONAS, ONE SCREEN. The instructor sees the gate and *Submit for review*; the desk sees the same gate and
// *Publish* / *Return with notes*. Which buttons exist is the API's verdict for THIS caller — a maker never sees a
// publish button for their own course, and the screen says why.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CourseActs } from '@krishalaya/sdk-js';
import { gateRowKey, outlineHref } from '../../../../features/courses/lessons';
import {
  DESK_ACTS, actHref, actLabelKey, actRefusalKey, courseHref, courseTransportState, gateCheckKey, gateMeasuredText, gateStateKey,
  gateUnmeasuredKey, pageStateKey, publishScreenKey, publishScreenState, statusKey, verdictFor,
} from '../../../../features/courses/desk';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('courses.publish.title'), robots: { index: false, follow: false } };
}

export default async function CoursePublishPage({ params }: { params: { id: string } }) {
  const href = `/courses/${encodeURIComponent(params.id)}/publish`;
  await requireSession(href);
  const t = getTranslator();
  const lang = getLang();

  let acts: CourseActs | null = null;
  let state: ReturnType<typeof courseTransportState> | null = null;
  try { acts = await tenantClient().courses.acts(params.id); }
  catch (e) {
    state = e instanceof SdkError ? courseTransportState(e.code, e.status) : 'error';
    if (state === 'notFound') notFound();
  }

  if (!acts) {
    return (
      <section>
        <h1>{t.t('courses.publish.title')}</h1>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state ?? 'error'))}</p>
          {state === 'error' && <p><Link href={href} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
          <p><Link href={courseHref(params.id)} className="kv-btn--link">{t.t('courses.back')}</Link></p>
        </div>
      </section>
    );
  }

  const { course, gate } = acts;
  const screen = publishScreenState(course);
  const submit = verdictFor(acts.acts, 'submit');
  const desk = DESK_ACTS.map((a) => verdictFor(acts!.acts, a)).filter((v): v is NonNullable<typeof v> => v !== null);
  const deskMayAct = desk.some((v) => v.allowed);
  const failing = gate.checks.filter((c) => c.state === 'fail');

  return (
    <section>
      <p className="kv-field__hint"><Link href={courseHref(course.id)} className="kv-btn--link">{course.defaultTitle}</Link> › {t.t('courses.publish.title')}</p>
      <h1>{t.t('courses.publish.title')} <span className="kv-badge">{t.t(statusKey(course.status))}</span></h1>
      <p className="kv-field__hint">{t.t('courses.publish.lead')}</p>

      {/* ---- the screen's own state, W416's words ---- */}
      <div className="kv-card kv-card--notice" role="status">
        <p>{t.t(publishScreenKey(screen))}</p>
        {screen === 'returned' && course.reviewNote && (
          <blockquote>
            <p>“{course.reviewNote}”</p>
            {course.reviewedAt && <p className="kv-field__hint">{t.t('courses.publish.returnedAt', { at: formatDate(course.reviewedAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
          </blockquote>
        )}
        {screen === 'underReview' && course.submittedAt && <p className="kv-field__hint">{t.t('courses.publish.submittedAt', { at: formatDate(course.submittedAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
      </div>

      {/* ---- the gate checklist ---- */}
      <h2>{t.t('courses.publish.gateHeading')}</h2>
      <table className="kv-table">
        <thead><tr><th>{t.t('courses.publish.col.check')}</th><th>{t.t('courses.publish.col.state')}</th><th>{t.t('courses.publish.col.detail')}</th></tr></thead>
        <tbody>
          {gate.checks.map((c) => (
            <tr key={gateRowKey(c)}>
              <td>{t.t(gateCheckKey(c.code))}{c.code === 'SUBTITLES' && c.lang ? ` — ${c.lang}` : ''}</td>
              <td>
                <span className={c.state === 'fail' ? 'kv-badge kv-error' : 'kv-badge'} aria-label={t.t(gateStateKey(c.state))}>
                  {c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : '—'} {t.t(gateStateKey(c.state))}
                </span>
                {gateMeasuredText(c) && c.state !== 'not_measured' && <> {gateMeasuredText(c)}</>}
              </td>
              <td>
                {c.state === 'not_measured' && <span className="kv-field__hint">{t.t(gateUnmeasuredKey(c.code))}</span>}
                {c.code === 'THUMBNAILS_REAL' && <span className="kv-field__hint">{t.t('courses.gateNote.THUMBNAILS_REAL')} </span>}
                {c.named.length > 0 && <ul>{c.named.map((n) => <li key={n}>{n}</li>)}</ul>}
                {c.declared && <span className="kv-field__hint">{Object.entries(c.declared).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="kv-field__hint">{gate.ready ? t.t('courses.publish.gateReady') : t.t('courses.publish.gateBlocked', { n: String(failing.length) })} <Link href={outlineHref(course.id)} className="kv-btn--link">{t.t('lessons.outlineTitle')}</Link></p>
      <p className="kv-field__hint">{t.t('courses.publish.unmeasuredNote')}</p>

      {/* ---- the instructor's act ---- */}
      {submit && (
        <div className="kv-actions">
          {submit.allowed
            ? <Link href={actHref(course.id, 'submit')} className="kv-btn">{t.t(actLabelKey('submit'))}</Link>
            : <span className="kv-field__hint">{t.t(actLabelKey('submit'))}: {submit.refusals.map((r) => t.t(actRefusalKey(r))).join(' · ')}</span>}
        </div>
      )}

      {/* ---- the desk's two acts, or the sentence that publish stays with the desk ---- */}
      <h2>{t.t('courses.publish.deskHeading')}</h2>
      {deskMayAct ? (
        <div className="kv-actions">
          {desk.filter((v) => v.allowed).map((v) => (
            <Link key={v.act} href={actHref(course.id, v.act)} className={v.act === 'publish' ? 'kv-btn' : 'kv-btn kv-btn--muted'}>{t.t(actLabelKey(v.act))}</Link>
          ))}
        </div>
      ) : (
        <p className="kv-field__hint">{t.t('courses.publish.state.deskOnly')}</p>
      )}
      {desk.filter((v) => !v.allowed && !v.refusals.includes('ILLEGAL_FROM_STATUS') && !v.refusals.includes('NO_PERMISSION')).map((v) => (
        <p key={v.act} className="kv-field__hint">{t.t(actLabelKey(v.act))}: {v.refusals.map((r) => t.t(actRefusalKey(r))).join(' · ')}</p>
      ))}
      <p className="kv-field__hint">{t.t('courses.publish.motto')}</p>
    </section>
  );
}
