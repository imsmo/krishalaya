// apps/web-partner/src/components/partner4/LenderKccView.tsx · PC-56 PARTNER-4c · W216 (canon `lender/kcc/[id]`) — AN HONEST PAGE: THERE IS
// NO KCC ACCOUNT ON THIS PLATFORM (founder 4c-2 / 4c-3), presentational.
//
// A Kisan Credit Card loan is an ordinary `loans` row whose product's `loan_kind` code is `kcc`. There is no account
// behind it: no ceiling, no unused remainder, nothing that is re-opened once a year, no sheet of crop finance norms,
// no yearly review of any of them — not one of those is a table, a column or a line of code anywhere. That is the
// statement this page exists to make, and it is printed in every state the page has.
//
// BESIDE the statement the page prints THAT LOAN'S OWN FACTS (founder 4c-2, the lead's engineering call): the canon's
// `[id]` IS a loan id, so the page reuses PARTNER-4a's existing audited `partner_loan` read — the same wall, the same
// projection, ONE audit row — rather than being empty. Nothing is added to the API and no migration is made.
//
// The real canon link "Drawl ledger" → W217 is built (FLOWMAP omits it, and it is the only edge either screen has).
// "Record limit review" is DECOR into the W2953–W2956 FORM chain: there is no ceiling to review, no table, no route,
// no permission and no form. The lifecycle's four claims, the whole "This season" block, the annual-review block and
// every state sentence are refused BY NAME. An unknown id and another lender's loan answer the SAME not-found shape.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerBookLoan } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { LendingSubNav } from './LendingSubNav';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel } from '../../features/partner2/figures';
import { aprLine, kccDrawlsHref, kccHref, kindLabel, loanHref, loanRef, loanStatusKey, loanStatusTone, type LenderFailure } from '../../features/partner4/figures';

function Field({ id, label, value }: { id: string; label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row" data-kv-fact={id}><dt>{label}</dt><dd>{value}</dd></div>;
}

/** The statement, printed in EVERY state of the page: it is true whether or not the loan behind the id was read. */
function Statement({ t }: { t: Tr }) {
  return (
    <div className="kv-card" data-kv-statement="noAccount">
      <h2 className="kv-card__title">{t.t('partner4.kcc.statementTitle')}</h2>
      <p className="kv-statement" data-kv-statement="partner4.kcc.statement">{t.t('partner4.kcc.statement')}</p>
      <p data-kv-kcc-note="notSetHere">{t.t('partner4.kcc.notSetHere')}</p>
      <p className="kv-statement" data-kv-statement="partner4.kcc.zeroTruth">{t.t('partner4.kcc.zeroTruth')}</p>
    </div>
  );
}

export function LenderKccView({ t, lang, loanId, l, failure, notFound, computedAt }: {
  t: Tr; lang: string; loanId: string; l: PartnerBookLoan | null; failure: LenderFailure | null; notFound: boolean; computedAt: string | null;
}) {
  if (failure === 'off') return <LenderSwitchedOff t={t} page="kcc" />;
  const self = kccHref(loanId);
  const back = <p className="kv-backlink"><Link href={loanHref(loanId)} data-kv-back={loanHref(loanId)}>{t.t('partner4.kcc.viewLoan')}</Link></p>;
  const acts = (
    <p className="kv-pager" data-kv-acts="kcc">
      <Link className="kv-btn" href={kccDrawlsHref(loanId)} data-kv-real="drawls">{t.t('partner4.kcc.ledgerLink')}</Link>{' '}
      <Link className="kv-btn kv-btn--muted" href={`${self}?form=review`} data-kv-decor="limitReview">{t.t('partner4.kcc.limitReviewAct')}</Link>
    </p>
  );
  if (notFound) {
    return (
      <section data-kv-lender="kcc" data-kv-state="not_found">
        {back}
        <h1>{t.t('partner4.kcc.notFound.title')}</h1>
        <p>{t.t('partner4.kcc.notFound.body')}</p>
        <Statement t={t} />
        <LenderRefusals t={t} surface="kcc" />
      </section>
    );
  }
  if (!l) {
    // the page's own read failed. THE RETRY IS A PLAIN RE-REQUEST OF THIS PAGE, never the W2957–W2959 chain: there is no act here and
    // nothing of a KCC account to read again (the DELTA `kcc_mutate_no_trigger`).
    return (
      <section data-kv-lender="kcc" data-kv-state="error">
        {back}
        <Statement t={t} />
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner4.kcc.error.title')}</h2>
          <p>{t.t('partner4.kcc.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={self} data-kv-retry={self}>{t.t('partner4.retry')}</Link></p>
        </div>
        {acts}
        <LenderRefusals t={t} surface="kcc" />
      </section>
    );
  }
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const kl = (c: string | null) => { const x = kindLabel(c); return 'key' in x ? t.t(x.key) : x.raw; };
  const apr = aprLine(l.interestAprBps);
  return (
    <section data-kv-lender="kcc" data-kv-state="ok">
      {back}
      <LendingSubNav t={t} current="/lender/kcc/[id]" loanId={loanId} />
      <h1>{t.t('partner4.kcc.title')} {loanRef(l.id)}</h1>
      <p className="kv-muted">{t.t('partner4.kcc.lead')}</p>
      <p><span className={`kv-status kv-status--${loanStatusTone(l.status)}`}>{t.t(loanStatusKey(l.status))}</span></p>

      <Statement t={t} />

      <section className="kv-card" data-kv-kcc-facts="true" aria-labelledby="kv-kcc-facts-title">
        <h2 id="kv-kcc-facts-title" className="kv-card__title">{t.t('partner4.kcc.factsTitle')}</h2>
        <dl className="kv-facts">
          <Field id="loan" label={t.t('partner4.kcc.loanLabel')} value={<Link href={loanHref(l.id)} data-kv-real="loan">{loanRef(l.id)}</Link>} />
          <Field id="product" label={t.t('partner4.loan.product')} value={l.productName ?? t.t('common.dash')} />
          <Field id="kind" label={t.t('partner4.loan.kind')} value={kl(l.kindCode)} />
          <Field id="fpo" label={t.t('partner4.loan.fpo')} value={fpoLabel(l.fpoName, t.t('partner1.fpoUnnamed'))} />
          <Field id="principal" label={t.t('partner4.loan.principal')} value={money(l.principalMinor)} />
          <Field id="apr" label={t.t('partner4.loan.apr')} value={t.t(apr.key, apr.vars)} />
          <Field id="outstanding" label={t.t('partner4.loan.outstanding')} value={money(l.outstandingMinor)} />
          <Field id="disbursed" label={t.t('partner4.loan.disbursed')} value={l.disbursedAt ?? t.t('common.dash')} />
        </dl>
        <p className="kv-muted" data-kv-kcc-note="facts">{t.t('partner4.kcc.factsNote')}</p>
        <p className="kv-muted" data-kv-kcc-note="kind">{t.t('partner4.kcc.kindNote')}</p>
      </section>

      {acts}
      {computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner4.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <LenderRefusals t={t} surface="kcc" />
    </section>
  );
}
