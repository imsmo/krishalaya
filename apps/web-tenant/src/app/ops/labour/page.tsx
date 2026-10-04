// apps/web-tenant/src/app/ops/labour/page.tsx · W163 · LABOUR — JOBS · PC-56 TENANT-11b.
// (canon slug `ops/labour`; the old `/labour` route redirects here.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • breadcrumb Operations › Labour; the lede says only what is TRUE: 7 of the booking machine's 12 states are in use (named),
//     the dignity floor is physics (the database refuses a wage below the statutory minimum), and the declarations are fields;
//   • "Wage runs" (W166) and "Attendance" (W165) are live since PC-56 TENANT-SW-b — links to /ops/labour/wages and /ops/labour/attendance;
//   • "Post job" → the form chain W2657–W2660;
//   • KPIs from GET /labour/summary (desk / booking.manage): open jobs + workers needed, in_progress today + clocked in now,
//     awaiting the employer's confirm + the wages it unlocks, fill rate 30 d + median time-to-fill (or the reason there is none);
//   • status tabs are real filters with the API's counts; the enum values a booking never reaches are omitted, not drawn as 0;
//   • columns Starts ▴ (a real sort) · Job (JOB-no + task · village) · Employer · Workers (filled / needed) · Wage vs floor ·
//     Type (kind · declarations) · Status; row link Fill → W164; "Showing N"; µs keyset pages;
//   • states: content, Loading (loading.tsx), Flagged off (the API's `labour` flag → 404, the canon's words), Restricted (403 —
//     the desk scope), Couldn't load (Retry = a page load), and the empty state.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { LabourBooking, LabourBookingPage, LabourSummary } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import {
  LABOUR_HREF, NEW_JOB_HREF, UNREACHABLE_STATUSES, consoleState, cursorFrom, isStatus, jobHref, pageHref, perKey, statusKey, tabHref, tabs, typeKeys, wageKindKey,
} from '../../../features/labour/console';
import { ATTENDANCE_HREF, WAGES_HREF } from '../../../features/swb/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lab.title'), robots: { index: false, follow: false } };
}
const PAGE = 25;

export default async function LabourJobsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(LABOUR_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const day = (ymd: string) => formatDate(`${ymd}T00:00:00+05:30`, lang, { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
  const status = isStatus(searchParams.status) ? searchParams.status : null;
  const sort = searchParams.sort === 'starts' ? 'starts' : 'recent';
  const cursor = cursorFrom(searchParams.cursor);

  const crumbs = (
    <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}>
      <span>{t.t('lab.breadcrumb.operations')}</span> / <span aria-current="page">{t.t('lab.breadcrumb.labour')}</span>
    </nav>
  );
  const flaggedOff = (
    <section>{crumbs}<h1>{t.t('lab.title')}</h1>
      <div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>
  );
  if (!env.featureLabour) return flaggedOff;

  let state: string | null = null;
  let page: LabourBookingPage = { items: [], nextCursor: null, counts: null, unreachableStatuses: [] };
  let summary: LabourSummary | null = null; let summaryState: string | null = null;
  const [p, s] = await Promise.allSettled([
    tenantClient().labour.consoleBookings({ box: 'all', status: status ?? undefined, sort, cursor, limit: PAGE }),
    tenantClient().labour.summary(),
  ]);
  if (p.status === 'fulfilled') page = p.value; else { const err = p.reason instanceof SdkError ? p.reason : null; state = consoleState(err?.code, err?.status); }
  if (s.status === 'fulfilled') summary = s.value; else { const err = s.reason instanceof SdkError ? s.reason : null; summaryState = consoleState(err?.code, err?.status); }
  if (state === 'flaggedOff') return flaggedOff;
  const totalAll = page.counts ? Object.values(page.counts).reduce((a, x) => a + x, 0) : 0;
  const shownTotal = status ? (page.counts?.[status] ?? page.items.length) : totalAll;
  const bps = (v: number) => `${(v / 100).toFixed(v % 100 === 0 ? 0 : 1)}%`;

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('lab.title')}</h1>
        <p className="kv-actions">
          <Link href={WAGES_HREF} className="kv-btn kv-btn--muted">{t.t('lab.wageRuns')}</Link>{' '}
          <Link href={ATTENDANCE_HREF} className="kv-btn kv-btn--muted">{t.t('swb.att.title')}</Link>{' '}
          <Link href={`${NEW_JOB_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('lab.postJob')}</Link>
        </p>
      </div>
      <p className="kv-field__hint">{t.t('lab.lede', { unreachable: UNREACHABLE_STATUSES.join(' · ') })}</p>

      {summary ? (
        <div className="kv-kpis">
          <div className="kv-card"><strong>{t.t('lab.kpi.open', { n: n(summary.openJobs) })}</strong><p className="kv-field__hint">{t.t('lab.kpi.openSub', { n: n(summary.workersNeeded) })}</p></div>
          <div className="kv-card"><strong>{t.t('lab.kpi.inProgress', { n: n(summary.inProgressToday) })}</strong><p className="kv-field__hint">{t.t('lab.kpi.inProgressSub', { n: n(summary.clockedInNow) })}</p></div>
          <div className="kv-card"><strong>{t.t('lab.kpi.awaiting', { n: n(summary.awaitingConfirm.bookings) })}</strong>
            <p className="kv-field__hint">{t.t('lab.kpi.awaitingSub', { days: n(summary.awaitingConfirm.days), amount: money(summary.awaitingConfirm.wagesUnlockedMinor) })}</p>
            {summary.awaitingConfirm.perTaskDays > 0 && <p className="kv-field__hint">{t.t('lab.kpi.awaitingTask', { n: n(summary.awaitingConfirm.perTaskDays) })}</p>}</div>
          <div className="kv-card"><strong>{summary.fill30d.rateBps === null ? t.t('lab.kpi.fillNone') : t.t('lab.kpi.fill', { rate: bps(summary.fill30d.rateBps) })}</strong>
            <p className="kv-field__hint">{summary.fill30d.medianHoursToFill === null ? t.t(`lab.kpi.median.${summary.fill30d.medianReason ?? 'no_jobs_in_30d'}`) : t.t('lab.kpi.median', { h: String(summary.fill30d.medianHoursToFill) })}</p></div>
        </div>
      ) : summaryState && <p className="kv-field__hint">{t.t(summaryState === 'restricted' ? 'lab.kpi.restricted' : 'lab.kpi.error')}</p>}

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`lab.state.${state}.title`)}</strong><p>{t.t(`lab.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={pageHref(LABOUR_HREF, cursor, status ? { status } : {})} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.retry')}</Link></p>}
        </div>
      )}

      {!state && (
        <>
          <nav className="kv-pager" aria-label={t.t('lab.tabs')}>
            <Link href={tabHref(null, sort)} className={`kv-btn--link${status === null ? ' is-active' : ''}`} aria-current={status === null ? 'page' : undefined}>{t.t('lab.tab.all')} ({n(totalAll)})</Link>
            {tabs(page.counts).map((x) => (
              <Link key={x.status} href={tabHref(x.status, sort)} className={`kv-btn--link${x.status === status ? ' is-active' : ''}`} aria-current={x.status === status ? 'page' : undefined}>
                {t.t(statusKey(x.status))} ({n(x.count)})
              </Link>
            ))}
          </nav>

          {page.items.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t(totalAll === 0 ? 'lab.empty.none.title' : 'lab.empty.tab.title')}</strong>
              <p className="kv-detail__muted">{t.t(totalAll === 0 ? 'lab.empty.none.body' : 'lab.empty.tab.body')}</p>
              <Link href={`${NEW_JOB_HREF}?step=edit`} className="kv-btn kv-btn--sm">{t.t('lab.postJob')}</Link>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-detail__muted">{t.t('lab.showing', { n: n(page.items.length), m: n(shownTotal) })}</caption>
              <thead><tr>
                <th scope="col"><Link href={tabHref(status, sort === 'starts' ? 'recent' : 'starts')} className="kv-btn--link">{t.t(sort === 'starts' ? 'lab.col.startsSorted' : 'lab.col.starts')}</Link></th>
                <th scope="col">{t.t('lab.col.job')}</th><th scope="col">{t.t('lab.col.employer')}</th><th scope="col">{t.t('lab.col.workers')}</th>
                <th scope="col">{t.t('lab.col.wage')}</th><th scope="col">{t.t('lab.col.type')}</th><th scope="col">{t.t('lab.col.status')}</th><th scope="col">{t.t('lab.col.open')}</th>
              </tr></thead>
              <tbody>{page.items.map((b: LabourBooking) => (
                <tr key={b.id}>
                  <td>{day(b.startDate)}{b.startTime && <div className="kv-field__hint">{b.startTime}</div>}</td>
                  <th scope="row"><Link href={jobHref(b.id)} className="kv-link">{b.bookingNo}</Link>
                    <div className="kv-field__hint">{[b.taskName ?? t.t('lab.taskUnnamed'), b.villageLabel].filter(Boolean).join(' · ')}</div></th>
                  <td>{b.employerName ?? t.t('lab.employerUnnamed')}{b.onBehalf && <div className="kv-field__hint">{t.t('lab.onBehalfTag')}</div>}</td>
                  <td>{t.t('lab.filled', { filled: n(b.filledCount ?? 0), needed: n(b.neededCount ?? b.workersNeeded) })}</td>
                  <td>{t.t(perKey(b.wageKind), { amount: money(b.wageOfferedMinor) })}<div className="kv-field__hint">{t.t('lab.floor', { amount: money(b.minWageMinor) })}</div></td>
                  <td>{[t.t(wageKindKey(b.wageKind)), ...typeKeys(b).map((k) => t.t(k))].join(' · ')}</td>
                  <td>{t.t(statusKey(b.status))}</td>
                  <td><Link href={jobHref(b.id)} className="kv-btn--link">{t.t(b.status === 'open' ? 'lab.row.fill' : 'lab.row.open')}</Link></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={pageHref(LABOUR_HREF, page.nextCursor, { ...(status ? { status } : {}), ...(sort === 'starts' ? { sort } : {}) })} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.nextPage')}</Link></p>}
          <p className="kv-card kv-card--notice">{t.t('lab.floorNote')}</p>
        </>
      )}
    </section>
  );
}
