// apps/web-partner/src/components/partner4/LenderQueueView.tsx · PC-56 PARTNER-4a · W206 THE LOAN QUEUE — FACTS, NEVER A BORROWER (founder
// 4a-2), presentational.
//
// What `GET /v1/partner/applications` and `GET /v1/partner/loans/counts` answered, and nothing else: the consented applications on this
// lender's own products, newest first — the application REFERENCE (its id's short form: `partner_app_ref` is never written), the product, the
// requested amount, the purpose CATEGORY (the product's `loan_kind` code), the status, the day it was applied; the SEVEN statuses the
// application machine can produce as FILTERS, with `draft` marked as a state this axis never shows and `docs_pending` refused by name; keyset
// paging; and the COUNTS of this lender's own book in the FY window beside them, with the server's as-of.
// NO "SLA left" column, NO Score column, NO Collateral column, NO borrower name, NO phone, NO place — there is nothing to fill them with.
// "Take next (SLA order)" is DECOR (the W2878–W2880 chain, `?act=`); the canon's dead "View portfolio" button is built as a REAL link.
import Link from 'next/link';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { PartnerApplication, PartnerBookCounts } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { LendingSubNav } from './LendingSubNav';
import { asOfText } from '../../features/partner1/dashboard';
import {
  APPLICATION_STATUSES_VISIBLE, QUEUE_BOXES, applicationHref, applicationRef, boxKey, headlineFigures, queueHref, windowLabel,
  type LenderListState, type QueueBox,
} from '../../features/partner4/figures';
import { statusKey, statusTone } from '../../features/lending/application';

export function LenderQueueView({ t, lang, state, items, counts, box, status, nextCursor, computedAt }: {
  t: Tr; lang: string; state: LenderListState; items: PartnerApplication[]; counts: PartnerBookCounts | null;
  box: QueueBox; status?: string; nextCursor: string | null; computedAt: string | null;
}) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="queue" />;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const win = windowLabel(counts);
  return (
    <section data-kv-lender="queue" data-kv-state={state}>
      <h1>{t.t('partner4.queue.title')}</h1>
      <p className="kv-muted">{t.t('partner4.queue.lead')}</p>
      <LendingSubNav t={t} current="/lender/queue" />

      {counts && (
        <div className="kv-card kv-counts" data-kv-counts="book">
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
          <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner4.asOf', { time: asOfText(counts.computedAt, lang) })}</p>
        </div>
      )}

      <p><Link className="kv-btn kv-btn--muted" href="/lender/queue?act=confirm" data-kv-decor="take-next">{t.t('partner4.queue.takeNext')}</Link></p>

      <nav className="kv-filters" aria-label={t.t('partner4.queue.filterBox')}>
        {QUEUE_BOXES.map((b) => (
          <Link key={b} href={queueHref(b, status)} className={`kv-chip${box === b ? ' is-active' : ''}`} aria-current={box === b ? 'true' : undefined} data-kv-box={b}>{t.t(boxKey(b))}</Link>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('partner4.queue.filterStatus')}>
        <Link href={queueHref(box)} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('partner4.queue.allStatuses')}</Link>
        {APPLICATION_STATUSES_VISIBLE.map((s) => (
          <Link key={s} href={queueHref(box, s)} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined} data-kv-status-filter={s}>{t.t(statusKey(s))}</Link>
        ))}
      </nav>
      <p className="kv-muted" data-kv-draft-note="true">{t.t('partner4.queue.draftNote')}</p>

      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner4.queue.error.title')}</h2>
          <p>{t.t('partner4.queue.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/lender/queue?act=confirm">{t.t('partner4.retry')}</Link></p>
        </div>
      ) : state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t(status ? 'partner4.queue.emptyFilter.title' : 'partner4.queue.empty.title')}</h2>
          <p>{t.t(status ? 'partner4.queue.emptyFilter.body' : 'partner4.queue.empty.body')}</p>
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/lender/portfolio" data-kv-real="portfolio">{t.t('partner4.queue.viewPortfolio')}</Link></p>
        </div>
      ) : (
        <>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('partner4.queue.colApplication')}</th><th scope="col">{t.t('partner4.queue.colProduct')}</th>
              <th scope="col">{t.t('partner4.queue.colRequested')}</th><th scope="col">{t.t('partner4.queue.colCategory')}</th>
              <th scope="col">{t.t('partner4.queue.colStatus')}</th><th scope="col">{t.t('partner4.queue.colApplied')}</th>
            </tr></thead>
            <tbody>{items.map((a) => (
              <tr key={a.id} data-kv-application={a.id}>
                <td><Link href={applicationHref(a.id)}>{applicationRef(a.applicantRef)}</Link></td>
                <td>{a.product.name}</td>
                <td>{money(a.amountRequestedMinor)}</td>
                <td>{a.purposeCategory ?? t.t('partner4.kind.notRecorded')}</td>
                <td><span className={`kv-status kv-status--${statusTone(a.status)}`}>{t.t(statusKey(a.status))}</span></td>
                <td>{a.createdAt ? formatDate(a.createdAt, lang) : t.t('common.dash')}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="kv-muted" data-kv-no-timer="true">{t.t('partner4.queue.noTimerNote')}</p>
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/lender/portfolio" data-kv-real="portfolio">{t.t('partner4.queue.viewPortfolio')}</Link></p>
        </>
      )}
      {state === 'ok' && nextCursor && <p className="kv-pager"><Link className="kv-btn" href={queueHref(box, status, nextCursor)} data-kv-next="true">{t.t('partner4.next')}</Link></p>}
      {state !== 'error' && computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner4.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <LenderRefusals t={t} surface="queue" />
    </section>
  );
}
