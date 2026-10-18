// apps/web-partner/src/components/partner2/InsurerPolicyView.tsx · PC-56 PARTNER-2a · W250 ONE POLICY ON THE INSURER'S PRODUCTS, presentational.
//
// The policy facts (`GET /v1/partner/insurance/policies/:id`): number or "no policy number yet", product, the FPO's public name, subject TYPE,
// sum insured, the farmer's premium share as stored, status, valid dates, created. There is NO subject block (no animal tag, no breed, no
// health record, no valuation), NO holder and NO payment reference (founder Q6). "Issue" / "Cancel" / "Endorse" are DECOR (the W2888–W2890
// chain on this page — founder Q5: nothing is issued, cancelled or endorsed from the partner console); "Download policy document" is refused
// (W2886–W2887: no document exists — P2-B7). Another insurer's policy or an absent id is "not found" (never "not yours").
import Link from 'next/link';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerInsurancePolicy } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel, policyNoText, statusKey, statusTone, subjectKey, type InsurerFailure } from '../../features/partner2/figures';

export function InsurerPolicyView({ t, lang, p, failure, notFound }: { t: Tr; lang: string; p: (PartnerInsurancePolicy & { computedAt?: string }) | null; failure: InsurerFailure | null; notFound?: boolean }) {
  if (failure === 'off' || failure === 'insurance_off') return <InsurerSwitchedOff t={t} which={failure} page="policy" />;
  const back = <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/policies">{t.t('partner2.policy.back')}</Link></p>;
  if (notFound) {
    return <section data-kv-insurer="policy" data-kv-state="not_found"><h1>{t.t('partner2.policy.notFound.title')}</h1><p>{t.t('partner2.policy.notFound.body')}</p>{back}</section>;
  }
  if (failure || !p) {
    return (
      <section data-kv-insurer="policy" data-kv-state="error">
        <h1>{t.t('partner2.policy.title')}</h1>
        <div className="kv-card" role="alert"><p>{t.t('partner2.policies.error.body')}</p></div>
        {back}
      </section>
    );
  }
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const day = (d: string | null) => (d ? formatDate(d, lang, { dateStyle: 'medium', timeZone: 'UTC' }) : t.t('partner2.none'));
  const self = `/insurer/policies/${encodeURIComponent(p.id)}`;
  const row = (id: string, label: string, value: string) => <div className="kv-facts__row" data-kv-fact={id}><dt>{label}</dt><dd>{value}</dd></div>;
  return (
    <section data-kv-insurer="policy" data-kv-state="ok" data-kv-policy={p.id}>
      <h1>{policyNoText(p.policyNo, t.t('partner2.policies.noNumber'))}</h1>
      <p><span className={`kv-status kv-status--${statusTone(p.status)}`}>{t.t(statusKey(p.status))}</span></p>
      <dl className="kv-card kv-facts">
        {row('product', t.t('partner2.policies.colProduct'), p.productName ?? t.t('partner2.none'))}
        {row('fpo', t.t('partner2.policies.colFpo'), fpoLabel(p.fpoName, t.t('partner1.fpoUnnamed')))}
        {row('subject', t.t('partner2.policies.colSubject'), t.t(subjectKey(p.subjectType)))}
        {row('sum_insured', t.t('partner2.policies.colSumInsured'), money(p.sumInsuredMinor))}
        {row('premium', t.t('partner2.policy.premium'), money(p.premiumMinor))}
        {row('valid', t.t('partner2.policies.colValid'), t.t('partner2.policies.validRange', { from: day(p.validFrom), until: day(p.validUntil) }))}
        {row('created', t.t('partner2.policy.created'), p.createdAt ? asOfText(p.createdAt, lang) : t.t('partner2.none'))}
        {row('reference', t.t('partner2.policy.reference'), p.id)}
      </dl>
      <p className="kv-muted">{t.t('partner2.policy.factsOnly')}</p>
      {p.status === 'active' && <p className="kv-muted" data-kv-cover="active">{t.t('partner2.policy.coverStarted')}</p>}
      {p.status === 'proposed' && <p className="kv-muted" data-kv-cover="proposed">{t.t('partner2.policy.awaitingPayment')}</p>}
      <p className="kv-pager">
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="issue">{t.t('partner2.policy.issue')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="cancel">{t.t('partner2.policy.cancel')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="endorse">{t.t('partner2.policy.endorse')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?export=queued`} data-kv-decor="document">{t.t('partner2.policy.document')}</Link>
      </p>
      {p.computedAt && <p className="kv-muted" data-kv-asof={p.computedAt}>{t.t('partner2.asOf', { time: asOfText(p.computedAt, lang) })}</p>}
      <InsurerRefusals t={t} surface="ins_policy" />
      {back}
    </section>
  );
}
