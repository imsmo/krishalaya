// apps/web-tenant/src/app/people/ambassadors/earnings/page.tsx · W161 · AMBASSADOR EARNINGS — THE WEEKLY RUN UNDER MAKER-CHECKER ·
// PC-56 TENANT-SW-b (founder decision 2026-10-03, closes F-23 / F-17).
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • the CURRENT run: period, prepared at, the MAKER (the Thursday 23:00 IST job, or the named person), totals with stipends, and
//     "Funding: main available covers total" — a REAL read of the cooperative's Main wallet at prepare time (and at the last pay
//     attempt), printed with when it was read; per-ambassador lines (masked phone) with their status and any shortfall;
//   • "Approve run" → the mutate chain W2478–W2480 (`./act`): the CHECKER confirms. The database refuses the person who prepared
//     it (trg_apr_moves), so the page does not offer Confirm to the maker and says why. Confirming PAYS: tenant Main → each
//     ambassador's wallet, one zero-sum transfer per ambassador; a line the wallet cannot cover is `unfunded` with its shortfall
//     (nothing moves for it) and the run is named partly paid / unfunded — a kind refusal; "Pay again" re-runs only those lines;
//   • "pays Friday" is printed FROM THE RUN (its pay date), never as a promise; with no run prepared the page says so;
//   • the run history (µs keyset); "pays alongside the dairy cycle" is REFUSED BY NAME (no coupling built), and the stipend is
//     whole-month only — pro-rata is refused by name, said.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AmbassadorRun, AmbassadorRunCurrent } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { AMBASSADORS_HREF, detailHref } from '../../../../features/ambassadors/console';
import {
  EARNINGS_HREF, RUN_REFUSED_BY_NAME, cursorFrom, fundingKey, runActHref, runActsFor, runLineStatusKey, runStatusKey, swbState,
} from '../../../../features/swb/console';
import { AsOf } from '../../../../components/AsOf';
import { asOfLabels } from '../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.run.title'), robots: { index: false, follow: false } };
}

export default async function AmbassadorEarningsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(EARNINGS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m && /^-?\d+$/.test(m) ? m : '0', 'INR', lang);
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : t.t('common.dash'));
  const day = (ymd: string) => formatDate(`${ymd.slice(0, 10)}T00:00:00+05:30`, lang, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={AMBASSADORS_HREF}>{t.t('amb.title')}</Link> / <span aria-current="page">{t.t('swb.run.title')}</span></nav>;
  if (!env.featureAmbassadors) {
    return <section>{crumbs}<h1>{t.t('swb.run.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('amb.state.flaggedOff.title')}</strong><p>{t.t('amb.state.flaggedOff.body')}</p></div></section>;
  }
  const cursor = cursorFrom(searchParams.cursor);
  let current: AmbassadorRunCurrent | null = null; let history: { items: AmbassadorRun[]; nextCursor: string | null } = { items: [], nextCursor: null };
  let state: string | null = null;
  const [c, h] = await Promise.allSettled([tenantClient().ambassadors.currentRun(), tenantClient().ambassadors.runs({ cursor, limit: 20 })]);
  if (c.status === 'fulfilled') current = c.value; else { const e = c.reason instanceof SdkError ? c.reason : null; state = swbState(e?.code, e?.status); }
  if (h.status === 'fulfilled') history = h.value; else if (!state) { const e = h.reason instanceof SdkError ? h.reason : null; state = swbState(e?.code, e?.status); }
  const run = current?.run ?? null;
  const acts = runActsFor(run);

  return (
    <section>
      {crumbs}
      <h1>{t.t('swb.run.title')}</h1>
      {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
      <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
      <p className="kv-field__hint">{t.t('swb.run.lede')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`amb.state.${state}.title`)}</strong><p>{t.t(`amb.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={EARNINGS_HREF} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.retry')}</Link></p>}
        </div>
      )}
      {current && (
        <>
          <h2>{t.t('swb.run.current')}</h2>
          {!run ? (
            <div className="kv-card">
              <p><strong>{t.t('swb.run.none')}</strong></p>
              <p className="kv-field__hint">{t.t('swb.run.nextAuto', { at: when(current.nextAutoPrepareAt), pay: day(current.nextPayDate) })}</p>
            </div>
          ) : (
            <>
              <dl className="kv-tiles">
                <div className="kv-tile"><dt>{t.t('swb.run.period')}</dt><dd><strong>{run.periodStart ? `${when(run.periodStart)} – ` : `${t.t('swb.run.periodOpen')} – `}{when(run.periodEnd)}</strong></dd>
                  <dd className="kv-field__hint">{t.t(`swb.run.kind.${run.kind}`)}</dd></div>
                <div className="kv-tile"><dt>{t.t('swb.run.total')}</dt><dd><strong>{money(run.totalMinor)}</strong></dd>
                  <dd className="kv-field__hint">{t.t('swb.run.totalSplit', { commission: money(run.totalCommissionMinor), stipend: money(run.totalStipendMinor), n: formatNumber(run.lineCount, lang) })}</dd></div>
                <div className="kv-tile"><dt>{t.t('swb.run.funding')}</dt><dd><strong>{t.t(fundingKey(run.lastPayCheck ?? run.fundingCheck), { amount: money((run.lastPayCheck ?? run.fundingCheck).shortfallMinor) })}</strong></dd>
                  <dd className="kv-field__hint">{t.t('swb.run.fundingRead', { balance: money((run.lastPayCheck ?? run.fundingCheck).mainBalanceMinor), at: when((run.lastPayCheck ?? run.fundingCheck).readAt) })}</dd></div>
                <div className="kv-tile"><dt>{t.t('swb.run.payDate')}</dt><dd><strong>{day(run.payDate)}</strong></dd><dd className="kv-field__hint">{t.t(runStatusKey(run.status))}</dd></div>
              </dl>
              <p className="kv-field__hint">{t.t(run.maker === 'job' ? 'swb.run.maker.job' : 'swb.run.maker.person', { at: when(run.preparedAt) })}
                {run.viewerIsMaker && <> · <strong>{t.t('swb.run.youPrepared')}</strong></>}</p>
              <p className="kv-field__hint">{t.t('swb.run.prepareReason')}: {run.prepareReason}</p>
              <p className="kv-actions">
                {acts.map((a) => <span key={a}><Link href={runActHref(a, run.id)} className={`kv-btn ${a === 'confirm' || a === 'pay' ? 'kv-btn--primary' : 'kv-btn--muted'} kv-btn--sm`}>{t.t(`swb.run.act.${a}`)}</Link>{' '}</span>)}
              </p>
              {run.status === 'prepared' && run.viewerIsMaker && <p className="kv-card kv-card--notice">{t.t('swb.run.makerCannotConfirm')}</p>}
              <table className="kv-table">
                <caption className="kv-detail__muted">{t.t('swb.run.lines', { n: formatNumber(run.lines.length, lang) })}</caption>
                <thead><tr><th scope="col">{t.t('swb.run.col.ambassador')}</th><th scope="col">{t.t('swb.run.col.commission')}</th><th scope="col">{t.t('swb.run.col.stipend')}</th>
                  <th scope="col">{t.t('swb.run.col.total')}</th><th scope="col">{t.t('swb.run.col.status')}</th></tr></thead>
                <tbody>{run.lines.map((l) => (
                  <tr key={l.id}>
                    <th scope="row"><Link href={detailHref(l.ambassadorId)} className="kv-link">{l.displayName ?? t.t('amb.person.unnamed')}</Link><div className="kv-field__hint">{l.phoneMasked ?? t.t('common.dash')}</div></th>
                    <td>{money(l.commissionMinor)}<div className="kv-field__hint">{t.t('swb.run.earnings', { n: formatNumber(l.earningCount, lang) })}</div></td>
                    <td>{l.stipendMonth ? <>{money(l.stipendMinor)}<div className="kv-field__hint">{l.stipendMonth.slice(0, 7)}</div></> : t.t('common.dash')}</td>
                    <td><strong>{money(l.totalMinor)}</strong></td>
                    <td>{t.t(runLineStatusKey(l.status))}
                      {l.status === 'unfunded' && l.shortfallMinor && <div className="kv-field__hint">{t.t('swb.run.line.short', { amount: money(l.shortfallMinor) })}</div>}
                      {l.paidAt && <div className="kv-field__hint">{when(l.paidAt)}</div>}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="kv-field__hint">{t.t('swb.run.legs')}</p>
            </>
          )}
          {!run && acts.includes('prepare') && <p><Link href={runActHref('prepare')} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('swb.run.act.prepare')}</Link></p>}
        </>
      )}

      {!state && (
        <>
          <h2>{t.t('swb.run.history')}</h2>
          {history.items.length === 0 ? <p className="kv-detail__muted">{t.t('swb.run.historyEmpty')}</p> : (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('swb.run.payDate')}</th><th scope="col">{t.t('swb.run.col.kind')}</th><th scope="col">{t.t('swb.run.total')}</th>
                <th scope="col">{t.t('swb.run.col.paid')}</th><th scope="col">{t.t('swb.run.col.status')}</th><th scope="col">{t.t('swb.run.col.maker')}</th></tr></thead>
              <tbody>{history.items.map((r) => (
                <tr key={r.id}>
                  <td>{day(r.payDate)}</td><td>{t.t(`swb.run.kind.${r.kind}`)}</td><td>{money(r.totalMinor)}</td><td>{money(r.paidMinor)}</td>
                  <td>{t.t(runStatusKey(r.status))}</td><td>{t.t(r.maker === 'job' ? 'swb.run.makerShort.job' : 'swb.run.makerShort.person')}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {history.nextCursor && <p><Link href={`${EARNINGS_HREF}?cursor=${encodeURIComponent(history.nextCursor)}`} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.nextPage')}</Link></p>}
        </>
      )}
      <div className="kv-card kv-card--notice">{RUN_REFUSED_BY_NAME.map((k) => <p key={k} className="kv-field__hint">{t.t(`swb.run.refused.${k}`)}</p>)}</div>
    </section>
  );
}
