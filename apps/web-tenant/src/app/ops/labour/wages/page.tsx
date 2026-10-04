// apps/web-tenant/src/app/ops/labour/wages/page.tsx · W166 · WAGE RUNS — THE DAILY 18:00 IST RUN AND ADVANCES · PC-56 TENANT-SW-b
// (F-11 decided 2026-10-03).
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • today's run (or "queued for 18:00 IST" before it runs) + the run history by IST day: Worker (short name + MASKED phone) ·
//     Job · Gross · Advance recovery · Net · Status — `retrying` names its next 16:00 IST attempt, `failed` is named after the
//     ladder (one retry a day × 3), `skipped_unfunded` says the escrow could not cover it;
//   • wages are WALLET LEGS from each booking's escrow (Hold → worker Main), keyed per confirmed-day set — not a bank payout; the
//     retired "payouts" lane is refused by name;
//   • the manual 11b pay act stays an exception and is listed as "manual";
//   • advances: outstanding total (real), the list, Request / Approve / Reject → the mutate chain W2821–W2823. An advance is at most
//     50 % of the job's expected wage (the database's cap); approver ≠ requester (the database's wall); recovery takes at most 25 %
//     of each later payout's gross. Write-off is REFUSED BY NAME (founder).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AdvancePage, WageRun, WageRunLine, WageToday } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { LABOUR_HREF, jobHref } from '../../../../features/labour/console';
import {
  ADVANCE_CAP_PCT, ADVANCE_RECOVERY_PCT, ADV_FILTERS, ATTENDANCE_HREF, WAGES_HREF, WAGE_REFUSED_BY_NAME, advActHref, advActsFor, advFilterFrom, advStatusKey, cursorFrom,
  swbState, wageLineKey, wageRunStatusKey, ymdFrom,
} from '../../../../features/swb/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.wage.title'), robots: { index: false, follow: false } };
}

export default async function WageRunsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(WAGES_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m && /^-?\d+$/.test(m) ? m : '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const day = (ymd: string) => formatDate(`${ymd.slice(0, 10)}T00:00:00+05:30`, lang, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : t.t('common.dash'));
  const advFilter = advFilterFrom(searchParams.adv);
  const advCursor = cursorFrom(searchParams.advCursor);
  const before = ymdFrom(searchParams.before);
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}><span>{t.t('lab.breadcrumb.operations')}</span> / <Link href={LABOUR_HREF}>{t.t('lab.breadcrumb.labour')}</Link> / <span aria-current="page">{t.t('swb.wage.title')}</span></nav>;
  const flaggedOff = <section>{crumbs}<h1>{t.t('swb.wage.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>;
  if (!env.featureLabour) return flaggedOff;

  let today: WageToday | null = null; let history: { items: WageRun[]; nextBefore: string | null } = { items: [], nextBefore: null };
  let adv: AdvancePage = { items: [], nextCursor: null, totals: null }; let state: string | null = null; let advState: string | null = null;
  const [a, h, v] = await Promise.allSettled([tenantClient().labour.wagesToday(), tenantClient().labour.wageRuns({ before, limit: 14 }), tenantClient().labour.advances({ status: advFilter, cursor: advCursor, limit: 50 })]);
  if (a.status === 'fulfilled') today = a.value; else { const e = a.reason instanceof SdkError ? a.reason : null; state = swbState(e?.code, e?.status); }
  if (h.status === 'fulfilled') history = h.value;
  if (v.status === 'fulfilled') adv = v.value; else { const e = v.reason instanceof SdkError ? v.reason : null; advState = swbState(e?.code, e?.status); }
  if (state === 'flaggedOff') return flaggedOff;

  const lineRow = (l: WageRunLine) => (
    <tr key={l.id}>
      <th scope="row">{l.workerShortName ?? t.t('swb.workerUnnamed')}<div className="kv-field__hint">{l.workerPhoneMasked ?? t.t('common.dash')}</div></th>
      <td><Link href={jobHref(l.bookingId)} className="kv-link">{l.bookingNo ?? t.t('common.dash')}</Link><div className="kv-field__hint">{t.t('swb.wage.days', { n: n(l.daysConfirmed) })}</div></td>
      <td>{money(l.grossMinor)}</td><td>{money(l.advanceRecoveryMinor)}</td><td><strong>{money(l.netMinor)}</strong></td>
      <td>{t.t(wageLineKey(l.status))}
        {l.status === 'retrying' && <div className="kv-field__hint">{t.t('swb.wage.nextRetry', { at: when(l.nextRetryAt), n: n(l.attempts) })}</div>}
        {(l.status === 'failed' || l.status === 'retrying') && l.lastError && <div className="kv-field__hint"><code>{l.lastError}</code></div>}</td>
    </tr>
  );
  const head = <thead><tr><th scope="col">{t.t('swb.wage.col.worker')}</th><th scope="col">{t.t('swb.wage.col.job')}</th><th scope="col">{t.t('swb.wage.col.gross')}</th>
    <th scope="col">{t.t('swb.wage.col.recovery')}</th><th scope="col">{t.t('swb.wage.col.net')}</th><th scope="col">{t.t('swb.wage.col.status')}</th></tr></thead>;

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('swb.wage.title')}</h1>
        <p className="kv-actions"><Link href={advActHref('request')} className="kv-btn kv-btn--muted">{t.t('swb.adv.act.request')}</Link>{' '}<Link href={ATTENDANCE_HREF} className="kv-btn--link">{t.t('swb.att.title')}</Link></p>
      </div>
      <p className="kv-field__hint">{t.t('swb.wage.lede')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`lab.state.${state}.title`)}</strong><p>{t.t(`lab.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={WAGES_HREF} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.retry')}</Link></p>}
        </div>
      )}
      {today && (
        <>
          <dl className="kv-tiles">
            <div className="kv-tile"><dt>{t.t('swb.wage.tile.today')}</dt><dd><strong>{today.run ? money(today.run.netMinor) : t.t('swb.wage.queued')}</strong></dd>
              <dd className="kv-field__hint">{today.run ? `${t.t(wageRunStatusKey(today.run.status))} · ${day(today.runDate)}` : t.t('swb.wage.queuedAt', { date: day(today.runDate) })}</dd></div>
            <div className="kv-tile"><dt>{t.t('swb.wage.tile.week')}</dt><dd><strong>{money(today.paidLast7Days.netMinor)}</strong></dd><dd className="kv-field__hint">{t.t('swb.wage.days', { n: n(today.paidLast7Days.workerDays) })}</dd></div>
            <div className="kv-tile"><dt>{t.t('swb.wage.tile.advances')}</dt><dd><strong>{money(today.advancesOutstanding.outstandingMinor)}</strong></dd>
              <dd className="kv-field__hint">{t.t('swb.wage.tile.advancesSub', { n: n(today.advancesOutstanding.advances), workers: n(today.advancesOutstanding.workers) })}</dd></div>
            <div className="kv-tile"><dt>{t.t('swb.wage.tile.ladder')}</dt><dd><strong>{n(today.retryLadder.length)}</strong></dd><dd className="kv-field__hint">{t.t('swb.wage.ladderRule')}</dd></div>
          </dl>

          <h2>{t.t('swb.wage.todayRun', { date: day(today.runDate) })}</h2>
          {today.run && <p className="kv-field__hint">{t.t('swb.wage.runTotals', { gross: money(today.run.grossMinor), rec: money(today.run.advanceRecoveryMinor), net: money(today.run.netMinor), n: n(today.run.lineCount) })}</p>}
          {today.lines.length === 0 ? <p className="kv-detail__muted">{t.t(today.run ? 'swb.wage.noLines' : 'swb.wage.notYet')}</p> : <table className="kv-table">{head}<tbody>{today.lines.map(lineRow)}</tbody></table>}

          {today.retryLadder.length > 0 && (<><h2>{t.t('swb.wage.ladder')}</h2><table className="kv-table">{head}<tbody>{today.retryLadder.map(lineRow)}</tbody></table></>)}

          <h2>{t.t('swb.wage.manual')}</h2>
          {today.manual.length === 0 ? <p className="kv-detail__muted">{t.t('swb.wage.manualNone')}</p> : (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('swb.wage.col.worker')}</th><th scope="col">{t.t('swb.wage.col.job')}</th><th scope="col">{t.t('swb.wage.col.gross')}</th><th scope="col">{t.t('swb.wage.col.recovery')}</th><th scope="col">{t.t('swb.wage.col.net')}</th><th scope="col">{t.t('swb.wage.col.status')}</th></tr></thead>
              <tbody>{today.manual.map((p) => (
                <tr key={p.id}><th scope="row">{p.workerShortName ?? t.t('swb.workerUnnamed')}<div className="kv-field__hint">{p.workerPhoneMasked}</div></th>
                  <td><Link href={jobHref(p.bookingId)} className="kv-link">{p.bookingNo ?? t.t('common.dash')}</Link></td><td>{money(p.grossMinor)}</td><td>{money(p.advanceRecoveryMinor)}</td><td>{money(p.netMinor)}</td>
                  <td>{t.t('swb.wage.manualTag')}<div className="kv-field__hint">{when(p.createdAt)}</div></td></tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}

      {!state && (
        <>
          <h2>{t.t('swb.wage.history')}</h2>
          {history.items.length === 0 ? <p className="kv-detail__muted">{t.t('swb.wage.historyEmpty')}</p> : (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('swb.wage.col.day')}</th><th scope="col">{t.t('swb.wage.col.lines')}</th><th scope="col">{t.t('swb.wage.col.gross')}</th><th scope="col">{t.t('swb.wage.col.recovery')}</th><th scope="col">{t.t('swb.wage.col.net')}</th><th scope="col">{t.t('swb.wage.col.status')}</th></tr></thead>
              <tbody>{history.items.map((r) => (
                <tr key={r.id}><td>{day(r.runDate)}</td><td>{n(r.lineCount)}</td><td>{money(r.grossMinor)}</td><td>{money(r.advanceRecoveryMinor)}</td><td>{money(r.netMinor)}</td><td>{t.t(wageRunStatusKey(r.status))}</td></tr>
              ))}</tbody>
            </table>
          )}
          {history.nextBefore && <p><Link href={`${WAGES_HREF}?before=${history.nextBefore}`} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.nextPage')}</Link></p>}
        </>
      )}

      <h2>{t.t('swb.adv.title')}</h2>
      <p className="kv-field__hint">{t.t('swb.adv.rule', { cap: String(ADVANCE_CAP_PCT), rec: String(ADVANCE_RECOVERY_PCT) })}</p>
      {advState ? <p className="kv-field__hint">{t.t(advState === 'restricted' ? 'swb.adv.restricted' : 'swb.adv.error')}</p> : (
        <>
          {adv.totals && <p><strong>{t.t('swb.adv.outstanding', { amount: money(adv.totals.outstandingMinor), n: n(adv.totals.advances) })}</strong></p>}
          <nav className="kv-pager" aria-label={t.t('swb.adv.title')}>
            <Link href={WAGES_HREF} className={`kv-btn--link${!advFilter ? ' is-active' : ''}`}>{t.t('swb.adv.filter.all')}</Link>
            {ADV_FILTERS.map((f) => <Link key={f} href={`${WAGES_HREF}?adv=${f}`} className={`kv-btn--link${f === advFilter ? ' is-active' : ''}`}>{t.t(`swb.adv.filter.${f}`)}</Link>)}
          </nav>
          {adv.items.length === 0 ? <p className="kv-detail__muted">{t.t('swb.adv.empty')}</p> : (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('swb.wage.col.worker')}</th><th scope="col">{t.t('swb.wage.col.job')}</th><th scope="col">{t.t('swb.adv.col.amount')}</th>
                <th scope="col">{t.t('swb.adv.col.recovered')}</th><th scope="col">{t.t('swb.adv.col.cap')}</th><th scope="col">{t.t('swb.wage.col.status')}</th><th scope="col">{t.t('swb.att.col.acts')}</th></tr></thead>
              <tbody>{adv.items.map((x) => (
                <tr key={x.id}>
                  <th scope="row">{x.workerShortName ?? t.t('swb.workerUnnamed')}<div className="kv-field__hint">{x.workerPhoneMasked ?? t.t('common.dash')}</div></th>
                  <td>{x.bookingId ? <Link href={jobHref(x.bookingId)} className="kv-link">{x.bookingNo ?? t.t('common.dash')}</Link> : t.t('common.dash')}</td>
                  <td>{money(x.amountMinor)}{x.requestReason && <div className="kv-field__hint">{x.requestReason}</div>}</td>
                  <td>{money(x.recoveredMinor)}<div className="kv-field__hint">{t.t('swb.adv.left', { amount: money(x.outstandingMinor) })}</div></td>
                  <td>{x.capMinor ? money(x.capMinor) : t.t('common.dash')}</td>
                  <td>{t.t(advStatusKey(x.status))}{x.rejectReason && <div className="kv-field__hint">{x.rejectReason}</div>}</td>
                  <td>{advActsFor(x).map((act) => <span key={act}><Link href={advActHref(act, x.id)} className="kv-btn--link">{t.t(`swb.adv.act.${act}`)}</Link>{' '}</span>)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {adv.nextCursor && <p><Link href={`${WAGES_HREF}?${new URLSearchParams({ ...(advFilter ? { adv: advFilter } : {}), advCursor: adv.nextCursor }).toString()}`} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('lab.nextPage')}</Link></p>}
        </>
      )}
      <div className="kv-card kv-card--notice">{WAGE_REFUSED_BY_NAME.map((k) => <p key={k} className="kv-field__hint">{t.t(`swb.wage.refused.${k}`)}</p>)}</div>
    </section>
  );
}
