// apps/web-partner/src/components/partner2/InsurerProductView.tsx · PC-56 PARTNER-2a · W247 ONE OF THE INSURER'S PRODUCTS — READ-ONLY.
//
// Every stored field as data (`GET /v1/partner/insurance/products/:id`): the name, the kind ("not registered"), the insurer's own rate, the
// stored terms and sum-insured rules printed as stored text (nothing is evaluated — a parametric trigger is never run, founder Q3), the
// government's share and the commission as recorded rates ("nothing is charged against them today", Q4), parametric yes / no, active,
// created / updated, the policies on it by status. "Choose kind" and "Save" are DECOR (the W2869–W2872 chain on this page, founder Q7).
import Link from 'next/link';
import type { PartnerInsuranceProduct } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import { formulaLine } from './InsurerProductsView';
import { asOfText } from '../../features/partner1/dashboard';
import { bpsText, POLICY_STATUSES, statusKey, termsText, type InsurerFailure } from '../../features/partner2/figures';

export function InsurerProductView({ t, lang, p, failure, notFound }: { t: Tr; lang: string; p: (PartnerInsuranceProduct & { computedAt?: string }) | null; failure: InsurerFailure | null; notFound?: boolean }) {
  if (failure === 'off' || failure === 'insurance_off') return <InsurerSwitchedOff t={t} which={failure} page="product" />;
  const back = <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/products">{t.t('partner2.product.back')}</Link></p>;
  if (notFound) {
    return <section data-kv-insurer="product" data-kv-state="not_found"><h1>{t.t('partner2.product.notFound.title')}</h1><p>{t.t('partner2.product.notFound.body')}</p>{back}</section>;
  }
  if (failure || !p) {
    return (
      <section data-kv-insurer="product" data-kv-state="error">
        <h1>{t.t('partner2.product.title')}</h1>
        <div className="kv-card" role="alert"><p>{t.t('partner2.products.error.body')}</p></div>
        {back}
      </section>
    );
  }
  const self = `/insurer/products/${encodeURIComponent(p.id)}`;
  const row = (id: string, label: string, value: string) => <div className="kv-facts__row" data-kv-fact={id}><dt>{label}</dt><dd>{value}</dd></div>;
  return (
    <section data-kv-insurer="product" data-kv-state="ok" data-kv-product={p.id}>
      <h1>{p.productName}</h1>
      <p className="kv-muted">{t.t('partner2.product.readOnly')}</p>
      <dl className="kv-card kv-facts">
        {row('kind', t.t('partner2.products.colKind'), p.kind.code ?? t.t('partner2.products.kindNotRegistered'))}
        {row('terms', t.t('partner2.products.colTerms'), formulaLine(t, lang, p.formula))}
        {row('subsidy', t.t('partner2.products.colSubsidy'), t.t('partner2.products.recordedRate', { rate: bpsText(p.govtSubsidyBps), bps: p.govtSubsidyBps }))}
        {row('commission', t.t('partner2.products.colCommission'), t.t('partner2.products.recordedRate', { rate: bpsText(p.ourCommissionBps), bps: p.ourCommissionBps }))}
        {row('parametric', t.t('partner2.products.colParametric'), t.t(p.isParametric ? 'partner2.yes' : 'partner2.no'))}
        {row('status', t.t('partner2.products.colStatus'), t.t(p.active ? 'partner2.products.active' : 'partner2.products.inactive'))}
        {row('created', t.t('partner2.product.created'), p.createdAt ? asOfText(p.createdAt, lang) : t.t('partner2.none'))}
        {row('updated', t.t('partner2.product.updated'), p.updatedAt ? asOfText(p.updatedAt, lang) : t.t('partner2.none'))}
      </dl>
      <p className="kv-muted" data-kv-recorded="true">{t.t('partner2.products.recordedNote')}</p>
      <h2 className="kv-card__title">{t.t('partner2.product.storedTerms')}</h2>
      <pre className="kv-code" data-kv-stored-terms="true">{termsText(p.storedTerms)}</pre>
      <h2 className="kv-card__title">{t.t('partner2.product.sumInsuredRules')}</h2>
      <pre className="kv-code">{termsText(p.sumInsuredRules)}</pre>
      <h2 className="kv-card__title">{t.t('partner2.product.policiesTitle')}</h2>
      <ul className="kv-list" data-kv-policy-counts="true">
        {POLICY_STATUSES.map((s) => <li key={s}>{t.t(statusKey(s))}: {p.policies[s] ?? 0}</li>)}
      </ul>
      <p className="kv-pager">
        <Link className="kv-btn kv-btn--muted" href={`${self}?form=review`} data-kv-decor="choose-kind">{t.t('partner2.product.chooseKind')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?form=review`} data-kv-decor="save">{t.t('partner2.product.save')}</Link>
      </p>
      {p.computedAt && <p className="kv-muted" data-kv-asof={p.computedAt}>{t.t('partner2.asOf', { time: asOfText(p.computedAt, lang) })}</p>}
      <InsurerRefusals t={t} surface="ins_product" />
      {back}
    </section>
  );
}
