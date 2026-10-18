// apps/web-partner/src/components/partner2/LenderProductView.tsx · PC-56 PARTNER-2c · W209 ONE OF THE LENDER'S LOAN PRODUCTS — READ-ONLY.
//
// Every stored field as data (`GET /v1/partner/loan-products/:id`): the kind or "kind not registered", the amount range in the product's own
// currency, the APR, the subvention and the net in INTEGER basis points, the tenure, the LTV, the collateral, the repayment style, the
// origination fee as RECORDED ("the platform's fee leg is not live; nothing is charged today" — fintech.module.ts:17), the required document
// types (their registry codes, or the count), the eligibility rules printed as the lender's OWN stored JSON (nothing is evaluated), active,
// the consented applications in 30 days (a count), added / last changed. "Choose kind" and "Save" are DECOR (the W2980–W2983 chain on this
// page, founder Q7); "Reload" is the W2984–W2986 re-read chain. Another lender's product or an absent id → "not found".
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerLoanProduct } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { InsurerRefusals } from './InsurerRefusals';
import { amountRangeText, collateralLabel, repaymentLabel } from './LenderProductsView';
import { asOfText } from '../../features/partner1/dashboard';
import { bpsInt, documentsText, lenderTermsRow, originationFee, termsText } from '../../features/partner2/figures';

export function LenderProductView({ t, lang, p, failure, notFound, mailbox }: {
  t: Tr; lang: string; p: (PartnerLoanProduct & { computedAt?: string; windowDays?: number }) | null; failure: 'off' | 'error' | null; notFound?: boolean; mailbox?: Mailbox;
}) {
  if (failure === 'off') return <section data-kv-lender="product" data-kv-state="off"><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;
  const back = <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/lender/products">{t.t('partner2.loanProducts.back')}</Link></p>;
  if (notFound) {
    return <section data-kv-lender="product" data-kv-state="not_found"><h1>{t.t('partner2.loanProducts.notFound.title')}</h1><p>{t.t('partner2.loanProducts.notFound.body')}</p>{back}</section>;
  }
  if (failure || !p) {
    return (
      <section data-kv-lender="product" data-kv-state="error">
        <h1>{t.t('partner2.loanProducts.product.title')}</h1>
        <div className="kv-card" role="alert"><p>{t.t('partner2.loanProducts.error.body')}</p></div>
        {back}
      </section>
    );
  }
  const self = `/lender/products/${encodeURIComponent(p.id)}`;
  const r = lenderTermsRow(p);
  const fee = originationFee(p);
  const docs = documentsText(p.requiredDocuments);
  const days = p.windowDays ?? 30;
  const bps = (n: number | null | undefined) => (n === null || n === undefined ? t.t('partner2.loanProducts.notSet') : t.t('partner2.loanProducts.bps', { bps: bpsInt(n) }));
  const row = (id: string, label: string, value: string | number) => <div className="kv-facts__row" data-kv-fact={id}><dt>{label}</dt><dd>{value}</dd></div>;
  return (
    <section data-kv-lender="product" data-kv-state="ok" data-kv-loan-product={p.id}>
      <h1>{p.defaultName}</h1>
      <p className="kv-muted">{t.t('partner2.loanProducts.product.readOnly')}</p>
      <dl className="kv-card kv-facts">
        {row('kind', t.t('partner2.loanProducts.colKind'), 'code' in r.kind ? r.kind.code : t.t(r.kind.key))}
        {row('amount', t.t('partner2.loanProducts.colAmount'), amountRangeText(t, lang, r.amount))}
        {row('currency', t.t('partner2.loanProducts.currency'), r.amount.currency)}
        {row('apr', t.t('partner2.loanProducts.apr'), bps(p.interestAprBps))}
        {row('subvention', t.t('partner2.loanProducts.subvention'), bps(p.subventionBps))}
        {row('net', t.t('partner2.loanProducts.net'), bps(p.netAprBps))}
        {row('tenure', t.t('partner2.loanProducts.colTenure'), t.t(r.tenure.key, r.tenure.vars))}
        {row('ltv', t.t('partner2.loanProducts.ltv'), bps(p.ltvBps))}
        {row('collateral', t.t('partner2.loanProducts.colCollateral'), collateralLabel(t, p.collateralKind))}
        {row('repayment', t.t('partner2.loanProducts.colRepayment'), repaymentLabel(t, p.repaymentStyle))}
        {row('fee', t.t('partner2.loanProducts.fee'), t.t('partner2.loanProducts.feeLine', { amount: formatMoneyMinor(fee.minor, fee.currency, lang), bps: fee.bps }))}
        {row('documents', t.t('partner2.loanProducts.documents'), t.t(docs.key, docs.vars))}
        {row('applications30d', t.t('partner2.loanProducts.colApplications', { days }), r.applications30d)}
        {row('status', t.t('partner2.loanProducts.colStatus'), t.t(r.active ? 'partner2.loanProducts.active' : 'partner2.loanProducts.inactive'))}
        {row('created', t.t('partner2.loanProducts.created'), p.createdAt ? asOfText(p.createdAt, lang) : t.t('partner2.none'))}
        {row('updated', t.t('partner2.loanProducts.updated'), p.updatedAt ? asOfText(p.updatedAt, lang) : t.t('partner2.none'))}
      </dl>
      <p className="kv-muted" data-kv-rates-note="true">{t.t('partner2.loanProducts.ratesNote')}</p>
      <h2 className="kv-card__title">{t.t('partner2.loanProducts.eligibility')}</h2>
      <pre className="kv-code" data-kv-eligibility="true">{termsText(p.eligibilityRules)}</pre>
      <p className="kv-pager">
        <Link className="kv-btn kv-btn--muted" href={`${self}?form=review`} data-kv-decor="choose-kind">{t.t('partner2.loanProducts.chooseKind')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?form=review`} data-kv-decor="save">{t.t('partner2.loanProducts.save')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`}>{t.t('partner2.retry')}</Link>
      </p>
      <div data-kv-propose="true">
        <p>{t.t('partner2.loanProducts.proposeChange')}</p>
        {mailbox && <MailboxLine t={t} mailbox={mailbox} />}
      </div>
      {p.computedAt && <p className="kv-muted" data-kv-asof={p.computedAt}>{t.t('partner2.asOf', { time: asOfText(p.computedAt, lang) })}</p>}
      <InsurerRefusals t={t} surface="loan_product" />
      {back}
    </section>
  );
}
