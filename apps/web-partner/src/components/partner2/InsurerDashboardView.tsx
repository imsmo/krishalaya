// apps/web-partner/src/components/partner2/InsurerDashboardView.tsx · PC-56 PARTNER-2a · W245 THE INSURER DASHBOARD, presentational.
//
// Renders what `GET /v1/partner/insurance/dashboard` computed on the kv_partner axis: policies in force (count + Σ sum insured, from a bigint
// string), proposed (awaiting the farmer's payment — not cover), the FPOs with a policy on the insurer's products, its products — each under
// ONE "as of". Nothing else: no claims figure, no money set aside, no payout line, no run, no premium total called the insurer's (founder Q1 /
// Q2) — those are refused by name below. States: empty → the products page; error → "nothing is affected" + Reload (the W2873–W2875 re-read
// chain); off / insurance_off → the switched-off sentences.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerInsuranceDashboard } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import { asOfText } from '../../features/partner1/dashboard';
import type { InsurerDashboardState } from '../../features/partner2/figures';

function Tile({ id, label, value, hint }: { id: string; label: string; value: string; hint?: string }) {
  return (
    <div className="kv-card kv-stat" data-kv-tile={id}>
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{value}</div>
      {hint && <p className="kv-field__hint">{hint}</p>}
    </div>
  );
}

export function InsurerDashboardView({ t, lang, state, d, orgName, regulatorRefMasked }: {
  t: Tr; lang: string; state: InsurerDashboardState; d: PartnerInsuranceDashboard | null; orgName: string | null; regulatorRefMasked?: string | null;
}) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="dashboard" />;
  const head = (
    <>
      <h1>{t.t('partner2.dash.title')}</h1>
      <p className="kv-muted">{orgName ?? t.t('partner.shell.orgUnknown')}{regulatorRefMasked ? ` · ${t.t('partner2.regulatorRef', { ref: regulatorRefMasked })}` : ''}</p>
    </>
  );
  if (state === 'error' || !d) {
    return (
      <section data-kv-insurer="dashboard" data-kv-state="error">
        {head}
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner2.dash.error.title')}</h2>
          <p>{t.t('partner2.dash.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/dashboard?retry=confirm">{t.t('partner2.retry')}</Link></p>
        </div>
      </section>
    );
  }
  const asOf = <p className="kv-muted" data-kv-asof={d.computedAt}>{t.t('partner2.asOf', { time: asOfText(d.computedAt, lang) })}</p>;
  if (state === 'empty') {
    return (
      <section data-kv-insurer="dashboard" data-kv-state="empty">
        {head}
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner2.dash.empty.title')}</h2>
          <p>{t.t('partner2.dash.empty.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/products">{t.t('partner2.dash.viewProducts')}</Link></p>
        </div>
        {asOf}
        <InsurerRefusals t={t} surface="ins_dashboard" />
      </section>
    );
  }
  return (
    <section data-kv-insurer="dashboard" data-kv-state="ok">
      {head}
      <p className="kv-muted">{t.t('partner2.dash.lead')}</p>
      <div className="kv-stat-row">
        <Tile id="in_force" label={t.t('partner2.dash.inForce')} value={String(d.inForce.count)}
          hint={t.t('partner2.dash.inForceHint', { amount: formatMoneyMinor(d.inForce.sumInsuredMinor, 'INR', lang) })} />
        <Tile id="proposed" label={t.t('partner2.dash.proposed')} value={String(d.proposed)} hint={t.t('partner2.dash.proposedHint')} />
        <Tile id="fpos" label={t.t('partner2.dash.fpos')} value={String(d.fpos)} hint={t.t('partner2.dash.fposHint')} />
        <Tile id="products" label={t.t('partner2.dash.products')} value={String(d.products)} hint={t.t('partner2.dash.productsHint', { policies: d.policies })} />
      </div>
      {asOf}
      <p className="kv-pager">
        <Link className="kv-btn" href="/insurer/policies">{t.t('partner2.dash.viewPolicies')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href="/insurer/products">{t.t('partner2.dash.viewProducts')}</Link>
      </p>
      <InsurerRefusals t={t} surface="ins_dashboard" />
    </section>
  );
}
