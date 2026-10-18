// apps/web-partner/src/components/partner2/InsurerProductsView.tsx · PC-56 PARTNER-2a · W246 THE INSURER'S OWN PRODUCTS, presentational.
//
// Each row as `GET /v1/partner/insurance/products` answered it on the kv_partner axis — this insurer's own products only (0090's pricing-IP
// rule: never another insurer's terms): the name, the kind ("not registered" — the kind registry is empty, survey F-13), the stored terms
// as the insurer's own rate in integer basis points (or a fixed amount, or "cannot be priced"), the government's share and the commission
// as RECORDED rates ("nothing is charged against them today", founder Q4), parametric yes / no (the trigger copy refused), active, and the
// policies on it. "New product" is DECOR (the W2869–W2872 chain): the platform authors products (founder Q7).
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerInsuranceProduct } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import { asOfText } from '../../features/partner1/dashboard';
import { bpsText, formulaText, policiesTotal, type InsurerListState } from '../../features/partner2/figures';

export function formulaLine(t: Tr, lang: string, f: PartnerInsuranceProduct['formula']): string {
  const x = formulaText(f);
  return x.key === 'partner2.formula.flat' ? t.t(x.key, { amount: formatMoneyMinor(x.vars.amountMinor, 'INR', lang) }) : t.t(x.key, x.vars);
}

export function InsurerProductsView({ t, lang, state, items, computedAt }: { t: Tr; lang: string; state: InsurerListState; items: PartnerInsuranceProduct[]; computedAt: string | null }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="products" />;
  const head = (
    <>
      <h1>{t.t('partner2.products.title')}</h1>
      <p className="kv-muted">{t.t('partner2.products.lead')}</p>
      <p><Link className="kv-btn kv-btn--muted" href="/insurer/products?form=review" data-kv-decor="new-product">{t.t('partner2.products.new')}</Link></p>
    </>
  );
  if (state === 'error') {
    return (
      <section data-kv-insurer="products" data-kv-state="error">
        {head}
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner2.products.error.title')}</h2>
          <p>{t.t('partner2.products.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/products?retry=confirm">{t.t('partner2.retry')}</Link></p>
        </div>
      </section>
    );
  }
  return (
    <section data-kv-insurer="products" data-kv-state={state}>
      {head}
      {state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner2.products.empty.title')}</h2>
          <p>{t.t('partner2.products.empty.body')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('partner2.products.colProduct')}</th><th scope="col">{t.t('partner2.products.colKind')}</th>
            <th scope="col">{t.t('partner2.products.colTerms')}</th><th scope="col">{t.t('partner2.products.colSubsidy')}</th>
            <th scope="col">{t.t('partner2.products.colCommission')}</th><th scope="col">{t.t('partner2.products.colParametric')}</th>
            <th scope="col">{t.t('partner2.products.colPolicies')}</th><th scope="col">{t.t('partner2.products.colStatus')}</th>
          </tr></thead>
          <tbody>{items.map((p) => (
            <tr key={p.id} data-kv-product={p.id}>
              <td><Link href={`/insurer/products/${encodeURIComponent(p.id)}`}>{p.productName}</Link></td>
              <td>{p.kind.code ?? t.t('partner2.products.kindNotRegistered')}</td>
              <td>{formulaLine(t, lang, p.formula)}</td>
              <td>{t.t('partner2.products.recordedRate', { rate: bpsText(p.govtSubsidyBps), bps: p.govtSubsidyBps })}</td>
              <td>{t.t('partner2.products.recordedRate', { rate: bpsText(p.ourCommissionBps), bps: p.ourCommissionBps })}</td>
              <td>{t.t(p.isParametric ? 'partner2.yes' : 'partner2.no')}</td>
              <td>{policiesTotal(p.policies)}</td>
              <td><span className={`kv-status kv-status--${p.active ? 'ok' : 'muted'}`}>{t.t(p.active ? 'partner2.products.active' : 'partner2.products.inactive')}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="kv-muted" data-kv-recorded="true">{t.t('partner2.products.recordedNote')}</p>
      {/* PC-56 PARTNER-2b (founder 2b-4): the parametric page is reached from here and the dashboard — never from the nav */}
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/parametric" data-kv-parametric-link="products">{t.t('partner2.products.viewParametric')}</Link></p>
      {computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner2.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <InsurerRefusals t={t} surface="ins_products" />
    </section>
  );
}
