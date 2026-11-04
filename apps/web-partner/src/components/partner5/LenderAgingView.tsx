// apps/web-partner/src/components/partner5/LenderAgingView.tsx · PC-56 PARTNER-5a · W223 (canon `lender/portfolio/aging`) — THE BOOK IN
// ARREARS, AS COUNTS (founder 5a-6), presentational.
//
// What `GET /v1/partner/loans/dpd` and `GET /v1/partner/loans/counts` answered, and nothing else:
//   • the platform's SIX rows in a fixed order — the loans with NO due date recorded FIRST (with `partner5.aging.statement` beside them when
//     there are any), then the loans not yet due, then 1–30 · 31–60 · 61–90 · more than 90 days past a recorded due date — each a count and
//     a bigint sum of what is outstanding. The dpd read is NOT windowed: these rows are the whole servicing book;
//   • the sum-check sentence with BOTH figures (the BigInt sum of the six rows, and the servicing book's outstanding) — never a tick alone;
//   • the restructured count from the counts read, which IS windowed (its label says so), and `partner5.aging.restructuredNote` when it is > 0;
//   • `computedAt` as the as-of.
// **NO PERCENTAGE, NO SHARE, NO "UP TO DATE" ROW AND NO ACRONYM FOR DAYS PAST DUE APPEAR ON THIS PAGE.** A row is not a link (a drill-down
// would list the loans behind — refused). Export is DECOR with the partners-mailbox line (W2929–W2930); Retry is the PARITY-DECOR re-read
// (W2931–W2933); "View portfolio" is a real link.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerBookArrears, PartnerBookCounts } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderSwitchedOff } from '../partner4/LenderChain';
import { LendingSubNav } from '../partner4/LendingSubNav';
import { LenderRefusals5 } from './LenderChain5';
import { asOfText } from '../../features/partner1/dashboard';
import { agingRows, agingSumCheck, showRestructuredNote, windowLabel, AGING_PAGE, type Lender5State } from '../../features/partner5/figures';

export function LenderAgingView({ t, lang, state, dpd, counts }: {
  t: Tr; lang: string; state: Lender5State; dpd: PartnerBookArrears | null; counts: PartnerBookCounts | null;
}) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="aging" />;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const rows = agingRows(dpd);
  const check = agingSumCheck(dpd, counts);
  const win = windowLabel(counts);
  const undated = rows.find((r) => r.bucket === 'no_due_date');
  return (
    <section data-kv-lender="aging" data-kv-state={state}>
      <h1>{t.t('partner5.aging.title')}</h1>
      <p className="kv-muted">{t.t('partner5.aging.lead')}</p>
      <LendingSubNav t={t} current={AGING_PAGE} />

      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner5.aging.error.title')}</h2>
          <p>{t.t('partner5.aging.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={`${AGING_PAGE}?act=confirm`} data-kv-retry="aging">{t.t('partner4.retry')}</Link></p>
        </div>
      ) : (
        <>
          <table className="kv-table" data-kv-table="aging">
            <caption>{t.t('partner5.aging.tableTitle')}</caption>
            <thead><tr>
              <th scope="col">{t.t('partner4.arrears.colBucket')}</th>
              <th scope="col">{t.t('partner4.arrears.colLoans')}</th>
              <th scope="col">{t.t('partner4.arrears.colOutstanding')}</th>
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.bucket} data-kv-aging-row={r.bucket} data-kv-behind={r.behind ? 'true' : 'false'}
                aria-describedby={r.bucket === 'no_due_date' && r.n > 0 ? 'kv-aging-statement' : undefined}>
                <td>{t.t(r.key)}</td><td>{r.n}</td><td>{money(r.outstandingMinor)}</td>
              </tr>
            ))}</tbody>
          </table>
          {undated && undated.n > 0 && (
            <p className="kv-statement" id="kv-aging-statement" data-kv-statement="partner5.aging.statement">{t.t('partner5.aging.statement')}</p>
          )}

          <div className="kv-card kv-counts" data-kv-counts="aging">
            <p data-kv-sum-check={check.equal ? 'equal' : 'unequal'}>
              {t.t(check.equal ? 'partner5.aging.sumCheck' : 'partner5.aging.sumMismatch', { sum: money(check.sum), total: money(check.total) })}
            </p>
            <p data-kv-restructured={check.restructured}>
              {t.t('partner5.aging.restructured', { window: win ? t.t(win.key, win.vars) : t.t('partner5.aging.thisWindow'), n: String(check.restructured) })}
            </p>
            {showRestructuredNote(check.restructured) && (
              <p className="kv-muted" data-kv-statement="partner5.aging.restructuredNote">{t.t('partner5.aging.restructuredNote')}</p>
            )}
            <p className="kv-muted" data-kv-windows-note="true">{t.t('partner5.aging.windowsNote')}</p>
            <p className="kv-muted" data-kv-counts-only="true">{t.t('partner4.portfolio.countsOnly')}</p>
            {dpd && <p className="kv-muted" data-kv-asof={dpd.computedAt}>{t.t('partner4.asOf', { time: asOfText(dpd.computedAt, lang) })}</p>}
          </div>

          {state === 'empty' && (
            <div className="kv-card kv-empty-state">
              <h2 className="kv-card__title">{t.t('partner5.aging.empty.title')}</h2>
              <p>{t.t('partner5.aging.empty.body')}</p>
            </div>
          )}

          <p className="kv-pager" data-kv-acts="aging">
            <Link className="kv-btn kv-btn--muted" href={`${AGING_PAGE}?export=queued`} data-kv-decor="export">{t.t('partner5.aging.export')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href="/lender/portfolio" data-kv-real="portfolio">{t.t('partner5.viewPortfolio')}</Link>
          </p>
        </>
      )}
      <LenderRefusals5 t={t} surface="aging" />
    </section>
  );
}
