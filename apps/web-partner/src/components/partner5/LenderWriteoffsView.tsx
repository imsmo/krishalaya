// apps/web-partner/src/components/partner5/LenderWriteoffsView.tsx · PC-56 PARTNER-5a · W222 (canon `lender/portfolio/writeoffs`) — THE
// WRITTEN-OFF LOANS AS LOAN FACTS (founder 5a-3 / 5a-7), presentational.
//
// What `GET /v1/partner/loans/counts` and `GET /v1/partner/loans?status=written_off` answered, and nothing else:
//   • the written-off count and outstanding from the counts read — over the loans OPENED in its IST window (there is no write-off date on
//     this platform), with the window's label and that caveat printed plainly;
//   • `partner5.writeoffs.statement` and `partner5.writeoffs.lockdownNote`, verbatim (founder 5a-7);
//   • every written-off loan on this lender's products (the list is NOT windowed — the page says so) as LOAN FACTS ONLY: the reference
//     (linking to that loan's own page), the product kind, the cooperative's public name, principal, outstanding, status, opened.
// NEVER on this page: why a loan was written off, when, by whom, a person, a scheme, an animal or a death — the view is handed loan facts
// and renders only the named fields of each (the render test smuggles extra fields in and proves they never reach the markup).
// Export is DECOR with the partners-mailbox line (W3024–W3025); Retry is the PARITY-DECOR re-read (W3026–W3028); "View portfolio" is real.
import Link from 'next/link';
import { moneyText } from '../../features/rtl/money';
import type { PartnerBookCounts, PartnerBookLoan } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderSwitchedOff } from '../partner4/LenderChain';
import { LendingSubNav } from '../partner4/LendingSubNav';
import { LenderRefusals5 } from './LenderChain5';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel } from '../../features/partner2/figures';
import {
  kindLabel, loanHref, loanRef, loanStatusKey, loanStatusTone, writeoffsHref, writeoffsSummary, WRITEOFFS_PAGE, type Lender5State,
} from '../../features/partner5/figures';

export function LenderWriteoffsView({ t, lang, state, counts, items, nextCursor, computedAt }: {
  t: Tr; lang: string; state: Lender5State; counts: PartnerBookCounts | null; items: PartnerBookLoan[];
  nextCursor: string | null; computedAt: string | null;
}) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="writeoffs" />;
  const money = (m: string) => moneyText(m, 'INR', lang);
  const kl = (l: { key: string } | { raw: string }) => ('key' in l ? t.t(l.key) : l.raw);
  const s = writeoffsSummary(counts);
  return (
    <section data-kv-lender="writeoffs" data-kv-state={state}>
      <h1>{t.t('partner5.writeoffs.title')}</h1>
      <p className="kv-muted">{t.t('partner5.writeoffs.lead')}</p>
      <LendingSubNav t={t} current={WRITEOFFS_PAGE} />
      <p className="kv-statement" data-kv-statement="partner5.writeoffs.statement">{t.t('partner5.writeoffs.statement')}</p>
      <p className="kv-statement" data-kv-statement="partner5.writeoffs.lockdownNote">{t.t('partner5.writeoffs.lockdownNote')}</p>

      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner5.writeoffs.error.title')}</h2>
          <p>{t.t('partner5.writeoffs.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={`${WRITEOFFS_PAGE}?act=confirm`} data-kv-retry="writeoffs">{t.t('partner4.retry')}</Link></p>
        </div>
      ) : (
        <>
          <div className="kv-card kv-counts" data-kv-counts="writeoffs">
            <h2 className="kv-card__title">{s.window ? t.t(s.window.key, s.window.vars) : t.t('partner5.aging.thisWindow')}</h2>
            <dl className="kv-counts__list">
              <div className="kv-counts__item" data-kv-count="written_off">
                <dt>{t.t('partner5.writeoffs.count')}</dt>
                <dd>{s.count} · {money(s.outstandingMinor)}</dd>
              </div>
            </dl>
            <p className="kv-muted" data-kv-window-note="true">{t.t('partner5.writeoffs.windowNote')}</p>
            <p className="kv-muted" data-kv-counts-only="true">{t.t('partner4.portfolio.countsOnly')}</p>
            {counts && <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner4.asOf', { time: asOfText(counts.computedAt, lang) })}</p>}
          </div>

          {items.length === 0 ? (
            <div className="kv-card kv-empty-state">
              <h2 className="kv-card__title">{t.t('partner5.writeoffs.empty.title')}</h2>
              <p>{t.t('partner5.writeoffs.empty.body')}</p>
            </div>
          ) : (
            <table className="kv-table" data-kv-table="writeoffs">
              <caption>{t.t('partner5.writeoffs.listTitle')}</caption>
              <thead><tr>
                <th scope="col">{t.t('partner4.portfolio.colLoan')}</th><th scope="col">{t.t('partner4.portfolio.colKind')}</th>
                <th scope="col">{t.t('partner4.portfolio.colPrincipal')}</th><th scope="col">{t.t('partner4.portfolio.colOutstanding')}</th>
                <th scope="col">{t.t('partner4.portfolio.colStatus')}</th><th scope="col">{t.t('partner5.writeoffs.colOpened')}</th>
              </tr></thead>
              <tbody>{items.map((l) => (
                <tr key={l.id} data-kv-loan={l.id}>
                  <td><Link href={loanHref(l.id)}>{loanRef(l.id)}</Link> <span className="kv-muted">{fpoLabel(l.fpoName, t.t('partner1.fpoUnnamed'))}</span></td>
                  <td>{kl(kindLabel(l.kindCode))}</td>
                  <td>{money(l.principalMinor)}</td>
                  <td>{money(l.outstandingMinor)}</td>
                  <td><span className={`kv-status kv-status--${loanStatusTone(l.status)}`}>{t.t(loanStatusKey(l.status))}</span></td>
                  <td>{l.openedAt ? asOfText(l.openedAt, lang) : t.t('common.dash')}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="kv-muted" data-kv-list-note="true">{t.t('partner5.writeoffs.listNote')}</p>
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={writeoffsHref(nextCursor)} data-kv-next="true">{t.t('partner4.next')}</Link></p>}
          {computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner4.asOf', { time: asOfText(computedAt, lang) })}</p>}

          <p className="kv-pager" data-kv-acts="writeoffs">
            <Link className="kv-btn kv-btn--muted" href={`${WRITEOFFS_PAGE}?export=queued`} data-kv-decor="export">{t.t('partner5.writeoffs.export')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href="/lender/portfolio" data-kv-real="portfolio">{t.t('partner5.viewPortfolio')}</Link>
          </p>
        </>
      )}
      <LenderRefusals5 t={t} surface="writeoffs" />
    </section>
  );
}
