// apps/web-partner/src/components/partner4/LenderLoanView.tsx · PC-56 PARTNER-4a · W215 ONE LOAN — ITS OWN FACTS, AND THE RECORDED HISTORY
// (founder 4a-2 / 4a-5), presentational.
//
// What `GET /v1/partner/loans/:id` and `GET …/:id/repayments` answered, and nothing else: the loan REFERENCE and the application reference
// (their ids' short forms — there is no loan number), the product and its `loan_kind` code, the cooperative's PUBLIC name, the principal, the
// stamped rate in INTEGER basis points, the disbursal date, the status, the outstanding — and the repayments RECORDED against it: the due
// date, both amounts, the date paid.
//
// The three sentences this page exists to print:
//   • "no maturity date recorded · no next due date recorded" — the truth, because every loan both rails open has both NULL and there is no
//     instalment plan on this platform. Not a dash, not a guess, not a term computed from a product's tenure range;
//   • "no foreclosure fee is charged — nothing on this platform charges one" — TRUE BY ABSENCE, printed as the absence it is;
//   • the "Consent status (servicing)" sentence, kept — and made TRUE by 0231's narrowing: a lender now genuinely cannot reach her milk
//     volumes, her quality data or even the repayment CHANNEL that said her milk cheque was tapped.
// The borrower, the milk-bill percentage, the herd claim, the ledger anchors, the fee, the term, the plan and every "on time" are refused by
// name. "Borrower statement (PDF)" is DECOR with the partners-mailbox line — the only trigger of the W2876–W2877 chain.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerBookLoan, PartnerBookRepayment } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { LendingSubNav } from './LendingSubNav';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel } from '../../features/partner2/figures';
import { aprLine, applicationRef, kindLabel, loanRef, loanStatusKey, loanStatusTone, maturityText, nextDueText, type LenderFailure } from '../../features/partner4/figures';

function Field({ id, label, value }: { id: string; label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row" data-kv-fact={id}><dt>{label}</dt><dd>{value}</dd></div>;
}

export function LenderLoanView({ t, lang, l, repayments, failure, notFound, computedAt }: {
  t: Tr; lang: string; l: PartnerBookLoan | null; repayments: PartnerBookRepayment[]; failure: LenderFailure | null; notFound: boolean; computedAt: string | null;
}) {
  if (failure === 'off') return <LenderSwitchedOff t={t} page="loan" />;
  const back = <p className="kv-backlink"><Link href="/lender/portfolio" data-kv-back="/lender/portfolio">{t.t('partner4.loan.back')}</Link></p>;
  if (notFound) {
    return (
      <section data-kv-lender="loan" data-kv-state="not_found">
        {back}
        <h1>{t.t('partner4.loan.notFound.title')}</h1>
        <p>{t.t('partner4.loan.notFound.body')}</p>
        <LenderRefusals t={t} surface="loan" />
      </section>
    );
  }
  if (!l) {
    return (
      <section data-kv-lender="loan" data-kv-state="error">
        {back}
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner4.loan.error.title')}</h2>
          <p>{t.t('partner4.loan.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/lender/portfolio?act=confirm">{t.t('partner4.retry')}</Link></p>
        </div>
        <LenderRefusals t={t} surface="loan" />
      </section>
    );
  }
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const kl = (c: string | null) => { const x = kindLabel(c); return 'key' in x ? t.t(x.key) : x.raw; };
  const mat = maturityText(l.maturityDate);
  const due = nextDueText(l.nextDueDate);
  const apr = aprLine(l.interestAprBps);
  const self = `/lender/portfolio/${encodeURIComponent(l.id)}`;
  return (
    <section data-kv-lender="loan" data-kv-state="ok">
      {back}
      {/* PC-56 PARTNER-4c: passing this loan's id draws the sub-navigation's KCC row against THIS loan — the inbound edge to W216 that the
          canon never drew (its sidebar cannot reach W216 or W217 at all, survey F-22). */}
      <LendingSubNav t={t} current={null} loanId={l.id} />
      <h1>{t.t('partner4.loan.title')} {loanRef(l.id)}</h1>
      <p><span className={`kv-status kv-status--${loanStatusTone(l.status)}`}>{t.t(loanStatusKey(l.status))}</span></p>

      <dl className="kv-facts">
        <Field id="application" label={t.t('partner4.loan.application')} value={<Link href={`/lender/queue/${encodeURIComponent(l.applicationId)}`} data-kv-real="application">{applicationRef(l.applicationId)}</Link>} />
        <Field id="product" label={t.t('partner4.loan.product')} value={l.productName ?? t.t('common.dash')} />
        <Field id="kind" label={t.t('partner4.loan.kind')} value={kl(l.kindCode)} />
        <Field id="fpo" label={t.t('partner4.loan.fpo')} value={fpoLabel(l.fpoName, t.t('partner1.fpoUnnamed'))} />
        <Field id="principal" label={t.t('partner4.loan.principal')} value={money(l.principalMinor)} />
        <Field id="apr" label={t.t('partner4.loan.apr')} value={t.t(apr.key, apr.vars)} />
        <Field id="outstanding" label={t.t('partner4.loan.outstanding')} value={money(l.outstandingMinor)} />
        <Field id="disbursed" label={t.t('partner4.loan.disbursed')} value={l.disbursedAt ?? t.t('common.dash')} />
        <Field id="maturity" label={t.t('partner4.loan.maturityLabel')} value={t.t(mat.key, mat.vars ?? {})} />
        <Field id="nextDue" label={t.t('partner4.loan.nextDueLabel')} value={t.t(due.key, due.vars ?? {})} />
      </dl>
      <p className="kv-muted" data-kv-rate-note="true">{t.t('partner4.loan.rateNote')}</p>
      <p className="kv-statement" data-kv-statement="partner4.loan.noForeclosureFee">{t.t('partner4.loan.noForeclosureFee')}</p>

      {/* the "Consent status (servicing)" block — kept, and made true by 0231 */}
      <section className="kv-card" data-kv-consent="servicing" aria-labelledby="kv-servicing-title">
        <h2 id="kv-servicing-title" className="kv-card__title">{t.t('partner4.loan.servicingConsentTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner4.loan.servicingConsent">{t.t('partner4.loan.servicingConsent')}</p>
        <p data-kv-servicing-seen="true">{t.t('partner4.loan.servicingSeen')}</p>
        <p data-kv-servicing-unseen="true">{t.t('partner4.loan.servicingUnseen')}</p>
      </section>

      <section data-kv-repayments="true" aria-labelledby="kv-repayments-title">
        <h2 id="kv-repayments-title">{t.t('partner4.loan.historyTitle')}</h2>
        <p className="kv-muted" data-kv-history-note="true">{t.t('partner4.loan.historyNote')}</p>
        {repayments.length === 0 ? (
          <div className="kv-card kv-empty-state">
            <h3 className="kv-card__title">{t.t('partner4.loan.noRepayments.title')}</h3>
            <p>{t.t('partner4.loan.noRepayments.body')}</p>
          </div>
        ) : (
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('partner4.loan.colDue')}</th><th scope="col">{t.t('partner4.loan.colAmountDue')}</th>
              <th scope="col">{t.t('partner4.loan.colAmountPaid')}</th><th scope="col">{t.t('partner4.loan.colPaidAt')}</th>
            </tr></thead>
            <tbody>{repayments.map((r) => (
              <tr key={r.id} data-kv-repayment={r.id}>
                <td>{r.dueDate ?? t.t('common.dash')}</td>
                <td>{money(r.amountDueMinor)}</td>
                <td>{money(r.amountPaidMinor)}</td>
                <td>{r.paidAt ? asOfText(r.paidAt, lang) : t.t('common.dash')}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <p className="kv-pager" data-kv-acts="loan">
        <Link className="kv-btn kv-btn--muted" href={`${self}?export=queued`} data-kv-decor="statement">{t.t('partner4.loan.statement')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href="/lender/portfolio" data-kv-real="portfolio">{t.t('partner4.loan.viewPortfolio')}</Link>
      </p>
      {computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner4.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <LenderRefusals t={t} surface="loan" />
    </section>
  );
}
