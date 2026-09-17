// apps/web-tenant/src/app/live/page.tsx · W414 — the live schedule · PC-56 TENANT-7c.
//
// W414: *"Schedule, host, and let the recording carry the lesson forward."* A table (class → host view · when · capacity
// · status · the recording's fate), filters as GET-forms that survive a page turn, a keyset pager, *New class* → the form
// chain, and six states (empty · error · restricted · loading · flagged off · the capacity rule).
//
// WHAT THIS SCREEN DOES NOT DRAW, BY NAME. W414's *"20:00–21:30 hint band … your last 4 classes averaged 3× the
// attendance"* averages attendance figures this platform records only as a number the host writes down after each
// class — there is no series to average today, and a band that quoted one would be quoting nothing. Its *"Time clash —
// another tenant's class on the shared platform calendar"* reads a calendar that does not cross tenants here (RLS is the
// wall, by design): the clash the form computes is the HOST's own classes in THIS cooperative. Its *"Auto-record"* names
// a recorder this platform does not run: a recording is a file the host attaches afterwards. All three are printed as
// sentences on this page, not as controls.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { Course, LiveClassListItem } from '@krishalaya/sdk-js';
import { courseTransportState, pageStateKey, type CoursePageState } from '../../features/courses/desk';
import {
  LIVE_BOX_VALUES, LIVE_STATUS_VALUES, capacityText, liveBox, liveBoxKey, liveClassHref, liveStatusFilter, liveStatusKey, newClassHref, refusedKey, rowTail, rowTailKey,
  scheduleHref, whenText,
} from '../../features/live/classes';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('live.title'), robots: { index: false, follow: false } };
}

export default async function LiveSchedulePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession('/live');
  const t = getTranslator();
  const lang = getLang();
  const box = liveBox(typeof searchParams.box === 'string' ? searchParams.box : null);
  const status = liveStatusFilter(typeof searchParams.status === 'string' ? searchParams.status : null);
  const courseId = typeof searchParams.courseId === 'string' && searchParams.courseId.length > 0 ? searchParams.courseId : undefined;
  const cursor = typeof searchParams.cursor === 'string' ? searchParams.cursor : null;

  let items: LiveClassListItem[] = []; let nextCursor: string | null = null; let courses: Course[] = [];
  let state: CoursePageState | null = null;
  try {
    const c = tenantClient();
    const [page, mine] = await Promise.all([c.liveClasses.list({ box, status, courseId, cursor: cursor ?? undefined, limit: 50 }), c.courses.list({ box: 'mine', limit: 100 }).catch(() => ({ items: [] as Course[], nextCursor: null }))]);
    items = page.items; nextCursor = page.nextCursor; courses = mine.items;
  } catch (e) {
    state = e instanceof SdkError ? courseTransportState(e.code, e.status) : 'error';
  }
  const filtered = status !== undefined || courseId !== undefined || box !== 'upcoming';

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('live.title')}</h1>
        {state === null && <Link href={newClassHref()} className="kv-btn">{t.t('live.new')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('live.lead')}</p>
      <p className="kv-field__hint">{t.t('live.declared')}</p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state === 'notFound' ? 'error' : state))}</p>
          {state === 'error' && <p><Link href={scheduleHref({ box, courseId, status, cursor })} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
        </div>
      )}

      {state === null && (
        <>
          {/* ---- the boxes, as GET links; a changed box resets the cursor ---- */}
          <nav className="kv-tabs" aria-label={t.t('live.boxes.label')}>
            {LIVE_BOX_VALUES.map((b) => (
              <Link key={b} href={scheduleHref({ box: b, courseId, status })} className={box === b ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={box === b ? 'page' : undefined}>{t.t(liveBoxKey(b))}</Link>
            ))}
          </nav>
          {/* ---- the filters, as a GET form ---- */}
          <form action="/live" method="get" className="kv-inline-form">
            {box !== 'upcoming' && <input type="hidden" name="box" value={box} />}
            <label className="kv-field" htmlFor="lv-course">
              <span>{t.t('live.filter.course')}</span>
              <select id="lv-course" name="courseId" defaultValue={courseId ?? ''}>
                <option value="">{t.t('live.filter.anyCourse')}</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.defaultTitle}</option>)}
              </select>
            </label>
            <label className="kv-field" htmlFor="lv-status">
              <span>{t.t('live.filter.status')}</span>
              <select id="lv-status" name="status" defaultValue={status ?? ''}>
                <option value="">{t.t('live.filter.anyStatus')}</option>
                {LIVE_STATUS_VALUES.map((s) => <option key={s} value={s}>{t.t(liveStatusKey(s))}</option>)}
              </select>
            </label>
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('live.filter.apply')}</button>
          </form>

          {items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t(filtered ? 'live.emptyFiltered' : 'live.empty')}</p>
              <p className="kv-field__hint">{t.t(refusedKey('hintBand'))}</p>
              <p><Link href={newClassHref()} className="kv-btn--link">{t.t('live.new')}</Link></p>
            </div>
          ) : (
            <table className="kv-table">
              <thead>
                <tr>
                  <th>{t.t('live.col.class')}</th>
                  <th>{t.t('live.col.when')}</th>
                  <th>{t.t('live.col.capacity')}</th>
                  <th>{t.t('live.col.status')}</th>
                  <th>{t.t('live.col.recording')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const cap = capacityText(x.registered, x.session.capacity); const tail = rowTail(x.session);
                  return (
                    <tr key={x.session.id}>
                      <td>
                        <Link href={liveClassHref(x.session.id)} className="kv-link">{x.session.title}</Link>
                        <div className="kv-field__hint">{x.course ? x.course.defaultTitle : t.t('live.noCourse')} · <Link href={liveClassHref(x.session.id)} className="kv-btn--link">{t.t('live.hostView')}</Link></div>
                      </td>
                      <td>{whenText(x)} <span className="kv-field__hint">{x.timezone} · {formatNumber(x.session.durationMins, lang)} {t.t('live.mins')}</span></td>
                      <td>{cap.text}{cap.unlimited && <span className="kv-field__hint"> · {t.t('live.unlimited')}</span>}<div className="kv-field__hint">{t.t('live.registeredHint')}</div></td>
                      <td><span className="kv-badge">{t.t(liveStatusKey(x.session.status))}</span></td>
                      <td>{tail === 'lesson' && x.session.recordingLessonId && x.course ? <Link href={`/courses/${encodeURIComponent(x.course.id)}/lessons/${encodeURIComponent(x.session.recordingLessonId)}`} className="kv-link">{t.t(rowTailKey(tail))}</Link> : <span className="kv-field__hint">{t.t(rowTailKey(tail))}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="kv-field__hint">{t.t(box === 'upcoming' ? 'live.orderUpcoming' : 'live.orderPast')}</p>
          {nextCursor && <p className="kv-pager"><Link href={scheduleHref({ box, courseId, status, cursor: nextCursor })} className="kv-btn--link">{t.t('common.nextPage')}</Link></p>}

          {/* ---- W414's states that are RULES, printed as sentences ---- */}
          <div className="kv-card">
            <p className="kv-field__hint">{t.t('live.capacityRule')}</p>
            <p className="kv-field__hint">{t.t(refusedKey('sharedCalendar'))}</p>
            <p className="kv-field__hint">{t.t(refusedKey('autoRecord'))}</p>
            <p className="kv-field__hint">{t.t('live.reminderRule')}</p>
          </div>
        </>
      )}
    </section>
  );
}
