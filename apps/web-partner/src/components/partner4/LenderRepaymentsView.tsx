// apps/web-partner/src/components/partner4/LenderRepaymentsView.tsx · PC-56 PARTNER-4b · W211 (canon `lender/repayments`) — WHAT CAME BACK,
// AND WHY NOTHING IS LATE (founder 4b-5 / 4b-6 / 4b-7), presentational.
//
// What `GET /v1/partner/loans/collected` and `GET /v1/partner/loans/dpd` answered, and nothing else:
//   • what was RECORDED against this book in a window of IST days — a count of repayments, a bigint sum, and the number
//     of loans that paid. RECORDED, never DUE: a repayment row is written AT PAYMENT, so nothing here is a plan;
//   • the SIX arrears buckets as counts and bigint sums — 1–30, 31–60, 61–90 and over 90 days past a recorded due date,
//     the loans not yet due, and THE LOANS WITH NO DUE DATE RECORDED. The first four are ZERO on this platform, and the
//     page says WHY with the count of loans that have none, instead of printing four zeros and leaving a lender to guess.
// **NO PERCENTAGE AND NO RATE APPEARS ON THIS PAGE** — no punctuality figure (a repayment's due date IS the moment it
// was paid), no portfolio-at-risk share, no mix by the way a repayment was taken (that is off this axis entirely).
// What is KEPT because it is TRUE: a loan that repays itself from the dairy cycle never becomes a knock on the door
// (the deduction genuinely rides the dairy transaction), and those deductions run whether or not anyone opens this
// screen. THE WHOLE COLLECTIONS CODE OF CONDUCT is refused by name below — the platform enforces none of it.
// Export is DECOR with the partners-mailbox line (W2994–W2995); "View portfolio" is a real link.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerBookArrears, PartnerBookCollected } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { LendingSubNav } from './LendingSubNav';
import { asOfText } from '../../features/partner1/dashboard';
import {
  arrearsReason, arrearsReasonKey, arrearsRows, collectedFigures, windowLabel, type LenderCountsState,
} from '../../features/partner4/figures';

export function LenderRepaymentsView({ t, lang, state, collected, arrears }: {
  t: Tr; lang: string; state: LenderCountsState; collected: PartnerBookCollected | null; arrears: PartnerBookArrears | null;
}) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="repayments" />;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const win = windowLabel(collected);
  const reason = arrearsReason(arrears);
  return (
    <section data-kv-lender="repayments" data-kv-state={state}>
      <h1>{t.t('partner4.repayments.title')}</h1>
      <p className="kv-muted">{t.t('partner4.repayments.lead')}</p>
      <LendingSubNav t={t} current="/lender/repayments" />

      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner4.repayments.error.title')}</h2>
          <p>{t.t('partner4.repayments.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/lender/repayments?act=confirm">{t.t('partner4.retry')}</Link></p>
        </div>
      ) : (
        <>
          <div className="kv-card kv-counts" data-kv-counts="collected">
            <h2 className="kv-card__title">{win ? t.t(win.key, win.vars) : t.t('partner4.repayments.collectedTitle')}</h2>
            <dl className="kv-counts__list">
              {collectedFigures(collected).map((f) => (
                <div key={f.id} className="kv-counts__item" data-kv-count={f.id}>
                  <dt>{t.t(f.key)}</dt>
                  <dd>{f.count}{f.minor !== null && <> · {money(f.minor)}</>}</dd>
                </div>
              ))}
            </dl>
            <p className="kv-muted" data-kv-recorded-note="true">{t.t('partner4.repayments.recordedNote')}</p>
            <p className="kv-muted" data-kv-counts-only="true">{t.t('partner4.portfolio.countsOnly')}</p>
            {collected && <p className="kv-muted" data-kv-asof={collected.computedAt}>{t.t('partner4.asOf', { time: asOfText(collected.computedAt, lang) })}</p>}
          </div>

          <table className="kv-table" data-kv-table="arrears">
            <caption>{t.t('partner4.repayments.arrearsTitle')}</caption>
            <thead><tr>
              <th scope="col">{t.t('partner4.arrears.colBucket')}</th>
              <th scope="col">{t.t('partner4.arrears.colLoans')}</th>
              <th scope="col">{t.t('partner4.arrears.colOutstanding')}</th>
            </tr></thead>
            <tbody>{arrearsRows(arrears).map((r) => (
              <tr key={r.bucket} data-kv-arrears-row={r.bucket} data-kv-arrears={r.arrears ? 'true' : 'false'}>
                <td>{t.t(r.key)}</td><td>{r.n}</td><td>{money(r.outstandingMinor)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p data-kv-arrears-why={reason}>{t.t(arrearsReasonKey(reason), { loans: String(arrears?.noDueDate?.count ?? 0), serviced: String(arrears?.servicing?.count ?? 0) })}</p>
          {arrears && <p className="kv-muted" data-kv-asof={arrears.computedAt}>{t.t('partner4.asOf', { time: asOfText(arrears.computedAt, lang) })}</p>}

          <div className="kv-card" data-kv-kept="dairyCycle">
            <h2 className="kv-card__title">{t.t('partner4.repayments.keptTitle')}</h2>
            <p data-kv-kept-line="dairyCycle">{t.t('partner4.repayments.dairyCycleTruth')}</p>
            <p data-kv-kept-line="autoDeduction">{t.t('partner4.repayments.autoDeduction')}</p>
          </div>

          {state === 'empty' && (
            <div className="kv-card kv-empty-state">
              <h2 className="kv-card__title">{t.t('partner4.repayments.empty.title')}</h2>
              <p>{t.t('partner4.repayments.empty.body')}</p>
            </div>
          )}

          <p className="kv-pager" data-kv-acts="repayments">
            <Link className="kv-btn kv-btn--muted" href="/lender/repayments?export=queued" data-kv-decor="export">{t.t('partner4.repayments.export')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href="/lender/portfolio" data-kv-real="portfolio">{t.t('partner4.repayments.viewPortfolio')}</Link>
          </p>
        </>
      )}
      <LenderRefusals t={t} surface="repayments" />
    </section>
  );
}
