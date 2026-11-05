// apps/web-partner/src/components/partner5/LenderReportsView.tsx · PC-56 PARTNER-5c · W214 (canon `lender/reports`) — THE PROMISE THE
// PLATFORM SETS (founder 5c-1, door Q7 option A), presentational.
//
// What PARTNER-1a's dashboard read answered in its `sla` block, and nothing else:
//   • the platform's PUBLISHED decision promise in its own sentence (or that none is published), and that the platform sets it — never
//     "your contract";
//   • the measured decision time over the read's window as COUNTS (decided; decided within the promise; decided after the promise — the
//     count `decided − withinPromise`, never a cause) and two DURATIONS (median, nine in ten), whole hours and minutes from whole seconds;
//   • the production-zero reason, verbatim;
//   • the partners mailbox line where the canon prints packs and escalations; "View dashboard" a real link.
// **NO PERCENTAGE, NO SHARE, NO RATE AND NO RATIO APPEAR ON THIS PAGE**, and nothing here divides. Export is DECOR with the mailbox line
// (W3009–W3010); Retry is the PARITY-DECOR re-read (W3011–W3013).
import Link from 'next/link';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { LenderSwitchedOff } from '../partner4/LenderChain';
import { LenderRefusals5 } from './LenderChain5';
import { asOfText } from '../../features/partner1/dashboard';
import { REPORTS_PAGE, slaFigures, type Lender5State, type SlaShape } from '../../features/partner5/figures';

export function LenderReportsView({ t, lang, state, sla, computedAt, orgName, mailbox }: {
  t: Tr; lang: string; state: Lender5State; sla: SlaShape | null; computedAt: string | null; orgName: string | null; mailbox: Mailbox;
}) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="reports" />;
  const f = slaFigures(sla);
  const dur = (d: { hours: number; minutes: number }) => t.t('partner5.sla.duration', { hours: d.hours, minutes: d.minutes });
  return (
    <section data-kv-lender="reports" data-kv-state={state}>
      <h1>{t.t('partner5.sla.title')}</h1>
      <p className="kv-muted" data-kv-org="true">{orgName ?? t.t('partner.shell.orgUnknown')}</p>
      <p className="kv-muted">{t.t('partner5.sla.lead')}</p>

      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner5.sla.error.title')}</h2>
          <p>{t.t('partner5.sla.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={`${REPORTS_PAGE}?act=confirm`} data-kv-retry="sla">{t.t('partner4.retry')}</Link></p>
        </div>
      ) : (
        <>
          <div className="kv-card" data-kv-sla-promise={f.promiseHours ?? 'none'}>
            <h2 className="kv-card__title">{t.t('partner5.sla.promiseTitle')}</h2>
            <p data-kv-statement={f.promiseHours === null ? 'partner5.sla.promiseNone' : 'partner5.sla.promise'}>
              {f.promiseHours === null ? t.t('partner5.sla.promiseNone') : t.t('partner5.sla.promise', { hours: f.promiseHours })}
            </p>
            <p className="kv-muted" data-kv-statement="partner5.sla.promiseSetBy">{t.t('partner5.sla.promiseSetBy')}</p>
          </div>

          <div className="kv-card kv-counts" data-kv-sla-measured={f.decided}>
            <h2 className="kv-card__title">{t.t('partner5.sla.measuredTitle', { days: f.days })}</h2>
            {state === 'empty' ? (
              <p data-kv-sla-none="true">{t.t('partner5.sla.noneDecided', { days: f.days })}</p>
            ) : (
              <ul className="kv-list">
                <li data-kv-sla-decided={f.decided}>{t.t('partner5.sla.decided', { n: f.decided })}</li>
                {f.within !== null && <li data-kv-sla-within={f.within}>{t.t('partner5.sla.within', { w: f.within, n: f.decided })}</li>}
                {f.after !== null && <li data-kv-sla-after={f.after}>{t.t('partner5.sla.after', { late: f.after, n: f.decided })}</li>}
                {f.median && <li data-kv-sla-median="true">{t.t('partner5.sla.median', { duration: dur(f.median) })}</li>}
                {f.p90 && <li data-kv-sla-p90="true">{t.t('partner5.sla.p90', { duration: dur(f.p90) })}</li>}
              </ul>
            )}
            <p className="kv-statement" data-kv-statement="partner5.sla.zeroReason">{t.t('partner5.sla.zeroReason')}</p>
            <p className="kv-muted" data-kv-live-note="true">{t.t('partner5.sla.liveNote')}</p>
            {computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner4.asOf', { time: asOfText(computedAt, lang) })}</p>}
          </div>

          <div className="kv-card" data-kv-sla-contact="true">
            <h2 className="kv-card__title">{t.t('partner5.sla.contactTitle')}</h2>
            <p>{t.t('partner5.sla.contactBody')}</p>
            <MailboxLine t={t} mailbox={mailbox} />
          </div>

          <p className="kv-pager" data-kv-acts="sla">
            <Link className="kv-btn kv-btn--muted" href={`${REPORTS_PAGE}?export=queued`} data-kv-decor="export">{t.t('partner5.sla.export')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href="/dashboard" data-kv-real="dashboard">{t.t('partner5.sla.viewDashboard')}</Link>
          </p>
        </>
      )}
      {/* PC-56 PARTNER-6b (founder 6b-3, survey F-10): the inbound edge the canon never drew — W224 is reached from here, in every state */}
      <p className="kv-pager" data-kv-acts="regulatory">
        <Link className="kv-btn kv-btn--muted" href="/lender/reports/regulatory" data-kv-real="regulatory">{t.t('partner6.regulatory.fromReports')}</Link>
      </p>
      <LenderRefusals5 t={t} surface="sla" />
    </section>
  );
}
