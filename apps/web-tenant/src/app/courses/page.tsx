// apps/web-tenant/src/app/courses/page.tsx · W178 — the tenant's course library, the content DESK's view · PC-56 TENANT-7a.
//
// W178: *"Your library + the platform library (tenant_id NULL — KVK & university content). 80% of content stays free
// by playbook; paid courses share 80% with the instructor."* Four tiles, four status chips with counts, a table with
// Learners and Completion, a pager, and five states (empty · error · restricted · loading · flagged off).
//
// THE DESK READS `box=all`, which the API grants to `course.publish` only — so an instructor without the desk key
// lands on W178's own *"Courses restricted"* state, and their library is `/studio` (W410, TENANT-7d). The platform
// library appears here as its PUBLISHED rows only: the API stopped passing KVK drafts through this wave.
//
// THE FOURTH TILE IS REFUSED BY NAME. *"Instructor royalties (30d) ₹2,265"* is a sum over a ledger this platform does not
// keep: a paid enrolment pays the instructor's wallet at purchase time (`course_purchase`), and no row records the
// royalty as a royalty. Printing a figure here would be client-side money arithmetic over enrolments × price, which
// Law 2 forbids and W418 (TENANT-7d) owns.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { Course, CourseDesk, CourseStats } from '@krishalaya/sdk-js';
import {
  COURSES_HREF, NEW_COURSE_HREF, STATUS_TABS, completionPct, courseHref, courseTransportState, learnersOf, levelKey, libraryHref, originKey,
  pageStateKey, royaltiesTileKey, statusKey, statusTab, type CoursePageState,
} from '../../features/courses/desk';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('courses.title'), robots: { index: false, follow: false } };
}

export default async function CoursesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(COURSES_HREF);
  const t = getTranslator();
  const lang = getLang();
  const status = statusTab(typeof searchParams.status === 'string' ? searchParams.status : null);
  const cursor = typeof searchParams.cursor === 'string' ? searchParams.cursor : null;

  let desk: CourseDesk | null = null;
  let items: Course[] = []; let stats: Record<string, CourseStats> = {}; let nextCursor: string | null = null;
  let state: CoursePageState | null = null;
  try {
    const c = tenantClient().courses;
    const [d, page] = await Promise.all([c.desk(), c.listDesk({ status: status ?? undefined, cursor: cursor ?? undefined, limit: 50 })]);
    desk = d; items = page.items; stats = page.stats; nextCursor = page.nextCursor;
  } catch (e) {
    state = e instanceof SdkError ? courseTransportState(e.code, e.status) : 'error';
  }

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('courses.title')}</h1>
        {state === null && <Link href={NEW_COURSE_HREF} className="kv-btn">{t.t('courses.new')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('courses.lead')}</p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && <p><Link href={libraryHref(status, cursor)} className="kv-btn--link">{t.t('courses.retry')}</Link></p>}
          {state === 'restricted' && <p><Link href="/studio" className="kv-btn--link">{t.t('courses.toStudio')}</Link></p>}
        </div>
      )}

      {desk && (
        <>
          {/* ---- W178's four tiles: three measured over the tenant's enrolments, one refused ---- */}
          <div className="kv-stats">
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('courses.tile.published')}</span>
              <strong className="kv-stat__value">{formatNumber(desk.byStatus.published + desk.libraryPublished, lang)}</strong>
              <span className="kv-stat__hint">{formatNumber(desk.byStatus.published, lang)} {t.t('courses.tile.yours')} · {formatNumber(desk.libraryPublished, lang)} {t.t('courses.tile.library')}</span>
            </div>
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('courses.tile.learners', { days: String(desk.windowDays) })}</span>
              <strong className="kv-stat__value">{formatNumber(desk.learners30d, lang)}</strong>
              <span className="kv-stat__hint">{t.t('courses.tile.learnersHint')}</span>
            </div>
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('courses.tile.completions', { days: String(desk.windowDays) })}</span>
              <strong className="kv-stat__value">{formatNumber(desk.completions30d, lang)}</strong>
              <span className="kv-stat__hint">{formatNumber(desk.certificates30d, lang)} {t.t('courses.tile.certificates')} · {formatNumber(desk.certificatesLifetime, lang)} {t.t('courses.tile.certificatesLifetime')}</span>
            </div>
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('courses.tile.royalties')}</span>
              <strong className="kv-stat__value">{t.t('common.dash')}</strong>
              <span className="kv-stat__hint">{t.t(royaltiesTileKey())}</span>
            </div>
          </div>

          {/* ---- the status chips, as GET filters with counts; a chip resets the cursor ---- */}
          <nav className="kv-tabs" aria-label={t.t('courses.chips.label')}>
            <Link href={libraryHref(null)} className={status === null ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={status === null ? 'page' : undefined}>{t.t('courses.chips.all')}</Link>
            {STATUS_TABS.map((s) => (
              <Link key={s} href={libraryHref(s)} className={status === s ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={status === s ? 'page' : undefined}>
                {t.t(statusKey(s))} {formatNumber(desk.byStatus[s], lang)}
              </Link>
            ))}
          </nav>

          {items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t(status ? 'courses.emptyFiltered' : 'courses.empty')}</p>
              {desk.libraryPublished > 0 && <p className="kv-field__hint">{t.t('courses.emptyLibrary', { n: formatNumber(desk.libraryPublished, lang) })}</p>}
              <p><Link href={NEW_COURSE_HREF} className="kv-btn--link">{t.t('courses.new')}</Link></p>
            </div>
          ) : (
            <table className="kv-table">
              <thead>
                <tr>
                  <th>{t.t('courses.col.course')}</th>
                  <th>{t.t('courses.col.topic')}</th>
                  <th>{t.t('courses.col.level')}</th>
                  <th>{t.t('courses.col.price')}</th>
                  <th>{t.t('courses.col.learners')}</th>
                  <th>{t.t('courses.col.completion')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const st = stats[c.id]; const pct = completionPct(st); const learners = learnersOf(st);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={courseHref(c.id)} className="kv-link">{c.defaultTitle}</Link>
                        <div className="kv-field__hint">
                          <span className="kv-badge">{t.t(statusKey(c.status))}</span>{' '}
                          {t.t(originKey(c))}
                          {c.lessonCount !== null && c.lessonCount !== undefined && <> · {formatNumber(c.lessonCount, lang)} {t.t('courses.lessons')}</>}
                        </div>
                      </td>
                      <td>{c.topicCode ? <><code>{c.topicCode}</code> <span className="kv-field__hint">{c.topicName}</span></> : <span className="kv-field__hint">{t.t('courses.noTopic')}</span>}</td>
                      <td>{t.t(levelKey(c.level))}</td>
                      <td>{c.priceMinor === '0' ? t.t('courses.free') : formatMoneyMinor(c.priceMinor, c.currencyCode, lang)}</td>
                      <td>{learners === null ? <span className="kv-field__hint">{t.t('common.dash')}</span> : formatNumber(learners, lang)}</td>
                      <td>{pct === null ? <span className="kv-field__hint">{t.t('courses.noLearnersYet')}</span> : `${formatNumber(pct, lang)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {/* W178 sorts by learners; a keyset page over an aggregate is not a page anybody can come back to, so the
              order is creation, newest first, and the screen says so. */}
          <p className="kv-field__hint">{t.t('courses.orderNote')} · {t.t('courses.libraryLearnersNote')}</p>
          {nextCursor && <p className="kv-pager"><Link href={libraryHref(status, nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</Link></p>}
          <p className="kv-field__hint">{t.t('courses.topicNote')}</p>
        </>
      )}
    </section>
  );
}
