// apps/web-tenant/src/app/ops/labour/attendance/page.tsx · W165 · ATTENDANCE — RECORDED AND REVIEWED · PC-56 TENANT-SW-b (F-12
// decided 2026-10-03: an out-of-fence clock-in is RECORDED and flagged, never refused).
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • tiles Clean · Needs review · Paper backfill · Unconfirmed > 24 h — real counts (GET /labour/attendance/summary);
//   • rows: worker (short name + MASKED phone), job, day, method (self / paper backfill / supervisor vouch), the fence distance
//     the clock-in was recorded at, the review status and whether the employer confirmed — the tenant-wide list, µs keyset;
//   • acts → the mutate chain W2495–W2497 (`./act`), each with a reason: Vouch / Refuse a needs-review day, Confirm a day,
//     "Confirm all clean records" (ONE keyed act; each day confirmed on its own), Paper backfill (evidence + reason);
//   • THE DUAL-CONFIRM LAW IS PRINTED AS ENFORCED: the database compares the confirmer with the assigned worker and refuses a
//     worker confirming their own day, and refuses to confirm a needs-review day without a vouch;
//   • the offline on-device clock store is REFUSED BY NAME (mobile — not built).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AttendanceReviewRow, AttendanceReviewSummary } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { LABOUR_HREF, jobHref } from '../../../../features/labour/console';
import {
  ATTENDANCE_HREF, ATT_FILTERS, ATT_REFUSED_BY_NAME, WAGES_HREF, attActHref, attActsFor, attFilterFrom, attHref, cursorFrom, methodKey, reviewStatusKey, swbState,
} from '../../../../features/swb/console';
import { AsOf } from '../../../../components/AsOf';
import { asOfLabels } from '../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.att.title'), robots: { index: false, follow: false } };
}

export default async function AttendanceReviewPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(ATTENDANCE_HREF);
  const t = getTranslator();
  const lang = getLang();
  const n = (v: number) => formatNumber(v, lang);
  const day = (ymd: string) => formatDate(`${ymd.slice(0, 10)}T00:00:00+05:30`, lang, { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
  const time = (iso: string | null) => (iso ? formatDate(iso, lang, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : t.t('common.dash'));
  const filter = attFilterFrom(searchParams.status);
  const cursor = cursorFrom(searchParams.cursor);
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}><span>{t.t('lab.breadcrumb.operations')}</span> / <Link href={LABOUR_HREF}>{t.t('lab.breadcrumb.labour')}</Link> / <span aria-current="page">{t.t('swb.att.title')}</span></nav>;
  const flaggedOff = <section>{crumbs}<h1>{t.t('swb.att.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>;
  if (!env.featureLabour) return flaggedOff;

  let rows: { items: AttendanceReviewRow[]; nextCursor: string | null } = { items: [], nextCursor: null };
  let tiles: AttendanceReviewSummary | null = null; let state: string | null = null;
  const [l, s] = await Promise.allSettled([tenantClient().labour.attendanceReview({ status: filter, cursor, limit: 50 }), tenantClient().labour.attendanceSummary()]);
  if (l.status === 'fulfilled') rows = l.value; else { const e = l.reason instanceof SdkError ? l.reason : null; state = swbState(e?.code, e?.status); }
  if (s.status === 'fulfilled') tiles = s.value;
  if (state === 'flaggedOff') return flaggedOff;

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('swb.att.title')}</h1>
        {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
        <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
        <p className="kv-actions">
          <Link href={attActHref('confirm_clean')} className="kv-btn kv-btn--primary">{t.t('swb.att.act.confirm_clean')}</Link>{' '}
          <Link href={attActHref('backfill')} className="kv-btn kv-btn--muted">{t.t('swb.att.act.backfill')}</Link>{' '}
          <Link href={WAGES_HREF} className="kv-btn--link">{t.t('swb.wage.title')}</Link>
        </p>
      </div>
      <p className="kv-field__hint">{t.t('swb.att.lede', { m: tiles ? n(tiles.fenceM) : '100' })}</p>
      <p className="kv-card kv-card--notice">{t.t('swb.att.law')}</p>

      {tiles && (
        <dl className="kv-tiles">
          <div className="kv-tile"><dt>{t.t('swb.att.tile.clean')}</dt><dd><strong>{n(tiles.clean)}</strong></dd></div>
          <div className="kv-tile"><dt>{t.t('swb.att.tile.needsReview')}</dt><dd><strong>{n(tiles.needsReview)}</strong></dd></div>
          <div className="kv-tile"><dt>{t.t('swb.att.tile.paperBackfill')}</dt><dd><strong>{n(tiles.paperBackfill)}</strong></dd></div>
          <div className="kv-tile"><dt>{t.t('swb.att.tile.unconfirmed24h')}</dt><dd><strong>{n(tiles.unconfirmed24h)}</strong></dd>
            <dd className="kv-field__hint">{t.t('swb.att.tile.today', { workers: n(tiles.workersToday), jobs: n(tiles.activeJobs) })}</dd></div>
        </dl>
      )}

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`lab.state.${state}.title`)}</strong><p>{t.t(`lab.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={attHref(filter, cursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.retry')}</Link></p>}
        </div>
      )}

      {!state && (
        <>
          <nav className="kv-pager" aria-label={t.t('lab.tabs')}>
            {ATT_FILTERS.map((f) => <Link key={f} href={attHref(f)} className={`kv-btn--link${f === filter ? ' is-active' : ''}`} aria-current={f === filter ? 'page' : undefined}>{t.t(`swb.att.filter.${f}`)}</Link>)}
          </nav>
          {rows.items.length === 0 ? <div className="kv-card"><p className="kv-detail__muted">{t.t('swb.att.empty')}</p></div> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('swb.att.col.worker')}</th><th scope="col">{t.t('swb.att.col.job')}</th><th scope="col">{t.t('swb.att.col.day')}</th>
                <th scope="col">{t.t('swb.att.col.method')}</th><th scope="col">{t.t('swb.att.col.fence')}</th><th scope="col">{t.t('swb.att.col.status')}</th><th scope="col">{t.t('swb.att.col.acts')}</th>
              </tr></thead>
              <tbody>{rows.items.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.workerShortName ?? t.t('swb.workerUnnamed')}<div className="kv-field__hint">{r.workerPhoneMasked}</div></th>
                  <td><Link href={jobHref(r.bookingId)} className="kv-link">{r.bookingNo ?? t.t('common.dash')}</Link></td>
                  <td>{day(r.workDate)}<div className="kv-field__hint">{time(r.clockInAt)} – {time(r.clockOutAt)}</div></td>
                  <td>{t.t(methodKey(r.method))}{r.backfillReason && <div className="kv-field__hint">{r.backfillReason}</div>}</td>
                  <td>{r.fenceDistanceM === null ? t.t('swb.att.fence.none') : t.t(r.outOfFence ? 'swb.att.fence.out' : 'swb.att.fence.in', { m: n(r.fenceDistanceM) })}</td>
                  <td>{t.t(r.confirmed ? 'swb.att.confirmed' : 'swb.att.unconfirmed')} · {t.t(reviewStatusKey(r.reviewStatus))}
                    {r.vouchReason && <div className="kv-field__hint">{t.t('swb.att.vouchedBecause')} {r.vouchReason}</div>}
                    {r.paid && <div className="kv-field__hint">{t.t('swb.att.paid')}</div>}</td>
                  <td>{attActsFor(r).map((a) => <span key={a}><Link href={attActHref(a, r.id)} className="kv-btn--link">{t.t(`swb.att.act.${a}`)}</Link>{' '}</span>)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {rows.nextCursor && <p><Link href={attHref(filter, rows.nextCursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.nextPage')}</Link></p>}
        </>
      )}
      <div className="kv-card kv-card--notice">{ATT_REFUSED_BY_NAME.map((k) => <p key={k} className="kv-field__hint">{t.t(`swb.att.refused.${k}`)}</p>)}</div>
    </section>
  );
}
