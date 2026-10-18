// apps/web-partner/src/components/partner2/LenderProductsView.tsx · PC-56 PARTNER-2c · W208 THE LENDER'S OWN SHELF, presentational.
//
// Each row as `GET /v1/partner/loan-products` answered it on the kv_partner axis — this lender's own products only (0229's definer; 0090's
// pricing-IP rule: never another lender's terms): the name, the kind from the platform's registry or "kind not registered", the amount range
// in the product's own currency (bigint-exact), the APR, the subvention and the net in INTEGER basis points ("net of subsidy" — never a float
// percentage), the repayment style, the collateral, the tenure, the COUNT of this lender's consented applications in the last 30 days (never an
// applicant), active. "New product" is DECOR (the W2980–W2983 chain): the platform authors loan products (founder Q7) — write to the partners
// mailbox to propose a change (the mailbox FACT, never a literal). "Reload" is the W2984–W2986 re-read chain.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerLoanProduct } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { InsurerRefusals } from './InsurerRefusals';
import { asOfText } from '../../features/partner1/dashboard';
import { lenderTermsRow, type ShelfState } from '../../features/partner2/figures';

const REPAYMENT = ['emi', 'bullet', 'harvest_aligned', 'milk_bill_deduction'];
const COLLATERAL = ['none', 'nwr', 'gold', 'hypothecation', 'group_guarantee'];
/** A stored code as its label when the console knows it, else the code as stored (never an invented label). */
export const repaymentLabel = (t: Tr, code: string) => (REPAYMENT.includes(code) ? t.t(`partner2.loanProducts.repayment.${code}`) : code);
export const collateralLabel = (t: Tr, code: string | null) => (code === null ? t.t('partner2.loanProducts.notSet') : COLLATERAL.includes(code) ? t.t(`partner2.loanProducts.collateral.${code}`) : code);

/** The amount range in the product's own currency — formatMoneyMinor is bigint-exact (no float). */
export function amountRangeText(t: Tr, lang: string, a: { min: string; max: string; currency: string }): string {
  return t.t('partner2.loanProducts.amountRange', { min: formatMoneyMinor(a.min, a.currency, lang), max: formatMoneyMinor(a.max, a.currency, lang) });
}

export function LenderProductsView({ t, lang, state, items, computedAt, windowDays, mailbox }: {
  t: Tr; lang: string; state: ShelfState; items: PartnerLoanProduct[]; computedAt: string | null; windowDays: number | null; mailbox?: Mailbox;
}) {
  if (state === 'off') return <section data-kv-lender="products" data-kv-state="off"><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;
  const head = (
    <>
      <h1>{t.t('partner2.loanProducts.title')}</h1>
      <p className="kv-muted">{t.t('partner2.loanProducts.lead')}</p>
      <p><Link className="kv-btn kv-btn--muted" href="/lender/products?form=review" data-kv-decor="new-product">{t.t('partner2.loanProducts.new')}</Link></p>
    </>
  );
  if (state === 'error') {
    return (
      <section data-kv-lender="products" data-kv-state="error">
        {head}
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner2.loanProducts.error.title')}</h2>
          <p>{t.t('partner2.loanProducts.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/lender/products?act=confirm">{t.t('partner2.retry')}</Link></p>
        </div>
      </section>
    );
  }
  const days = windowDays ?? 30;
  return (
    <section data-kv-lender="products" data-kv-state={state}>
      {head}
      {state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner2.loanProducts.empty.title')}</h2>
          <p>{t.t('partner2.loanProducts.empty.body')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('partner2.loanProducts.colProduct')}</th><th scope="col">{t.t('partner2.loanProducts.colKind')}</th>
            <th scope="col">{t.t('partner2.loanProducts.colAmount')}</th><th scope="col">{t.t('partner2.loanProducts.colApr')}</th>
            <th scope="col">{t.t('partner2.loanProducts.colRepayment')}</th><th scope="col">{t.t('partner2.loanProducts.colCollateral')}</th>
            <th scope="col">{t.t('partner2.loanProducts.colTenure')}</th><th scope="col">{t.t('partner2.loanProducts.colApplications', { days })}</th>
            <th scope="col">{t.t('partner2.loanProducts.colStatus')}</th>
          </tr></thead>
          <tbody>{items.map((p) => {
            const r = lenderTermsRow(p);
            return (
              <tr key={r.id} data-kv-loan-product={r.id}>
                <td><Link href={r.href}>{r.name}</Link></td>
                <td data-kv-col="kind">{'code' in r.kind ? r.kind.code : t.t(r.kind.key)}</td>
                <td data-kv-col="amount">{amountRangeText(t, lang, r.amount)}</td>
                <td data-kv-col="apr">{t.t(r.apr.key, r.apr.vars)}</td>
                <td>{repaymentLabel(t, r.repaymentStyle)}</td>
                <td>{collateralLabel(t, r.collateral)}</td>
                <td>{t.t(r.tenure.key, r.tenure.vars)}</td>
                <td data-kv-col="applications30d">{r.applications30d}</td>
                <td><span className={`kv-status kv-status--${r.active ? 'ok' : 'muted'}`}>{t.t(r.active ? 'partner2.loanProducts.active' : 'partner2.loanProducts.inactive')}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      <p className="kv-muted" data-kv-rates-note="true">{t.t('partner2.loanProducts.ratesNote')}</p>
      <p className="kv-muted" data-kv-apps-note="true">{t.t('partner2.loanProducts.appsNote', { days })}</p>
      <p className="kv-muted" data-kv-fee-note="true">{t.t('partner2.loanProducts.feeNote')}</p>
      <div data-kv-propose="true">
        <p>{t.t('partner2.loanProducts.proposeChange')}</p>
        {mailbox && <MailboxLine t={t} mailbox={mailbox} />}
      </div>
      {computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner2.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/lender/products?act=confirm">{t.t('partner2.retry')}</Link></p>
      <InsurerRefusals t={t} surface="loan_products" />
    </section>
  );
}
