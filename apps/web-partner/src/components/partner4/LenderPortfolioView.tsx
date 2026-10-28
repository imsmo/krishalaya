// apps/web-partner/src/components/partner4/LenderPortfolioView.tsx · PC-56 PARTNER-4a · W212 THE PORTFOLIO — COUNTS AND SUMS, NEVER A RATE
// (founder 4a-2 / 4a-5 / 4a-7), presentational.
//
// What `GET /v1/partner/loans/counts` and `GET /v1/partner/loans` answered, and nothing else:
//   • the FY window the DATABASE answered (April–March, Asia/Kolkata) with its label and the server's as-of, and the caveat printed plainly —
//     these figures are the loans OPENED in this window, so a loan opened before 1 April is in the list below but not in them;
//   • outstanding and the active count as THE TWO FIGURES THEY ARE; the restructured count; the written-off count and its sum;
//   • the kind mix over the NINE platform `loan_kind` codes + "not recorded", each with its count and its two bigint sums;
//   • the book's newest loans, every row linking to its own page — the inbound edge the canon never drew for W215 (survey F-22).
// **NO PERCENTAGE APPEARS ON THIS PAGE.** No PAR, no average ticket, no share of the book, no five-bucket chart, no off-platform comparison
// and no "honest attribution" block: each is refused by name below. Export is DECOR with the partners-mailbox line (founder 4a-7).
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerBookCounts, PartnerBookLoan } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { LendingSubNav } from './LendingSubNav';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel } from '../../features/partner2/figures';
import {
  headlineFigures, kindLabel, kindRows, loanHref, loanRef, loanStatusKey, loanStatusTone, portfolioHref, statusRows, windowLabel, LOAN_STATUSES,
  type LenderCountsState,
} from '../../features/partner4/figures';

export function LenderPortfolioView({ t, lang, state, counts, items, status, nextCursor, computedAt }: {
  t: Tr; lang: string; state: LenderCountsState; counts: PartnerBookCounts | null; items: PartnerBookLoan[];
  status?: string; nextCursor: string | null; computedAt: string | null;
}) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="portfolio" />;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const kl = (l: { key: string } | { raw: string }) => ('key' in l ? t.t(l.key) : l.raw);
  const win = windowLabel(counts);
  return (
    <section data-kv-lender="portfolio" data-kv-state={state}>
      <h1>{t.t('partner4.portfolio.title')}</h1>
      <p className="kv-muted">{t.t('partner4.portfolio.lead')}</p>
      <LendingSubNav t={t} current="/lender/portfolio" />

      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner4.portfolio.error.title')}</h2>
          <p>{t.t('partner4.portfolio.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/lender/portfolio?act=confirm">{t.t('partner4.retry')}</Link></p>
        </div>
      ) : (
        <>
          <div className="kv-card kv-counts" data-kv-counts="portfolio">
            <h2 className="kv-card__title">{win ? t.t(win.key, win.vars) : t.t('partner4.portfolio.countsTitle')}</h2>
            <dl className="kv-counts__list">
              {headlineFigures(counts).map((f) => (
                <div key={f.id} className="kv-counts__item" data-kv-count={f.id}>
                  <dt>{t.t(f.key)}</dt>
                  <dd>{f.count}{f.minor !== null && <> · {money(f.minor)}</>}</dd>
                </div>
              ))}
            </dl>
            <p className="kv-muted" data-kv-window-note="true">{t.t('partner4.portfolio.windowNote')}</p>
            <p className="kv-muted" data-kv-counts-only="true">{t.t('partner4.portfolio.countsOnly')}</p>
            {counts && <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner4.asOf', { time: asOfText(counts.computedAt, lang) })}</p>}
          </div>

          <table className="kv-table" data-kv-table="status">
            <caption>{t.t('partner4.portfolio.byStatus')}</caption>
            <thead><tr><th scope="col">{t.t('partner4.portfolio.colStatus')}</th><th scope="col">{t.t('partner4.portfolio.colLoans')}</th></tr></thead>
            <tbody>{statusRows(counts?.byStatus).map((r) => (
              <tr key={r.status} data-kv-status-row={r.status}><td>{t.t(r.key)}</td><td>{r.n}</td></tr>
            ))}</tbody>
          </table>

          <table className="kv-table" data-kv-table="kind">
            <caption>{t.t('partner4.portfolio.byKind')}</caption>
            <thead><tr>
              <th scope="col">{t.t('partner4.portfolio.colKind')}</th><th scope="col">{t.t('partner4.portfolio.colLoans')}</th>
              <th scope="col">{t.t('partner4.portfolio.colOutstanding')}</th><th scope="col">{t.t('partner4.portfolio.colPrincipal')}</th>
            </tr></thead>
            <tbody>{kindRows(counts).map((r) => (
              <tr key={r.code} data-kv-kind-row={r.code}>
                <td>{kl(r.label)}</td><td>{r.n}</td><td>{money(r.outstandingMinor)}</td><td>{money(r.principalMinor)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="kv-muted" data-kv-kinds-note="true">{t.t('partner4.portfolio.kindsNote')}</p>

          <nav className="kv-filters" aria-label={t.t('partner4.portfolio.filterStatus')}>
            <Link href={portfolioHref()} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('partner4.portfolio.allStatuses')}</Link>
            {LOAN_STATUSES.map((s) => (
              <Link key={s} href={portfolioHref(s)} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined} data-kv-status-filter={s}>{t.t(loanStatusKey(s))}</Link>
            ))}
          </nav>

          {items.length === 0 ? (
            <div className="kv-card kv-empty-state">
              <h2 className="kv-card__title">{t.t(status ? 'partner4.portfolio.emptyFilter.title' : 'partner4.portfolio.empty.title')}</h2>
              <p>{t.t(status ? 'partner4.portfolio.emptyFilter.body' : 'partner4.portfolio.empty.body')}</p>
              <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/lender/queue" data-kv-real="queue">{t.t('partner4.portfolio.viewQueue')}</Link></p>
            </div>
          ) : (
            <table className="kv-table" data-kv-table="loans">
              <caption>{t.t('partner4.portfolio.book')}</caption>
              <thead><tr>
                <th scope="col">{t.t('partner4.portfolio.colLoan')}</th><th scope="col">{t.t('partner4.portfolio.colKind')}</th>
                <th scope="col">{t.t('partner4.portfolio.colPrincipal')}</th><th scope="col">{t.t('partner4.portfolio.colOutstanding')}</th>
                <th scope="col">{t.t('partner4.portfolio.colStatus')}</th><th scope="col">{t.t('partner4.portfolio.colDisbursed')}</th>
              </tr></thead>
              <tbody>{items.map((l) => (
                <tr key={l.id} data-kv-loan={l.id}>
                  <td><Link href={loanHref(l.id)}>{loanRef(l.id)}</Link> <span className="kv-muted">{fpoLabel(l.fpoName, t.t('partner1.fpoUnnamed'))}</span></td>
                  <td>{kl(kindLabel(l.kindCode))}</td>
                  <td>{money(l.principalMinor)}</td>
                  <td>{money(l.outstandingMinor)}</td>
                  <td><span className={`kv-status kv-status--${loanStatusTone(l.status)}`}>{t.t(loanStatusKey(l.status))}</span></td>
                  <td>{l.disbursedAt ?? t.t('common.dash')}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={portfolioHref(status, nextCursor)} data-kv-next="true">{t.t('partner4.next')}</Link></p>}
          <p className="kv-pager" data-kv-acts="portfolio">
            <Link className="kv-btn kv-btn--muted" href="/lender/portfolio?export=queued" data-kv-decor="export">{t.t('partner4.portfolio.export')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href="/lender/queue" data-kv-real="queue">{t.t('partner4.portfolio.viewQueue')}</Link>
          </p>
          {computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner4.asOf', { time: asOfText(computedAt, lang) })}</p>}
        </>
      )}
      <LenderRefusals t={t} surface="portfolio" />
    </section>
  );
}
