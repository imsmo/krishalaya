// apps/web-partner/src/components/partner3/InsurerClaimView.tsx · PC-56 PARTNER-3a · W253 ONE CLAIM ON THE INSURER'S PRODUCTS — THE FACTS (founder
// Q3 + Q4), presentational.
//
// What `GET /v1/partner/insurance/claims/:id` answered: the claim REFERENCE (its id), the policy number or "no policy number yet" (linked to the
// policy on the insurer's own book), the product, the FPO's public name, the subject TYPE, the event type code (or "not recorded"), the event
// date, "reported within 72 hours" as recorded, the status, the approved amount AS RECORDED, the survey's damage percentage when recorded (the
// ONE survey figure an insurer sees — and the only "%" on any 3a page), filed / last changed / closed. There is NO claimant, phone, survey
// note, surveyor, media, message or timeline block (each refused by name below). "Decide" is DECOR with the founder's sentence
// (`partner3.claim.decideStatement`): the organisation that serves the farmer records the decision today. Retry → the W2857–W2859 re-read chain.
// Another insurer's claim or an absent id is "not found" (never "not yours").
import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerInsuranceClaim } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimsRefusals } from './InsurerClaimsChain';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel, policyNoText, subjectKey, type InsurerFailure } from '../../features/partner2/figures';
import { claimStatusKey, claimStatusTone, damageText, eventLabel, reportedKey } from '../../features/partner3/figures';

export function InsurerClaimView({ t, lang, c, failure, notFound }: { t: Tr; lang: string; c: (PartnerInsuranceClaim & { computedAt?: string }) | null; failure: InsurerFailure | null; notFound?: boolean }) {
  if (failure === 'off' || failure === 'insurance_off') return <InsurerSwitchedOff t={t} which={failure} page="claim" />;
  const back = <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/claims" data-kv-back="/insurer/claims">{t.t('partner3.claim.back')}</Link></p>;
  if (notFound) {
    return <section data-kv-insurer="claim" data-kv-state="not_found"><h1>{t.t('partner3.claim.notFound.title')}</h1><p>{t.t('partner3.claim.notFound.body')}</p>{back}</section>;
  }
  if (failure || !c) {
    return (
      <section data-kv-insurer="claim" data-kv-state="error">
        <h1>{t.t('partner3.claim.title')}</h1>
        <div className="kv-card" role="alert"><p>{t.t('partner3.claims.error.body')}</p></div>
        {back}
      </section>
    );
  }
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const day = (d: string | null) => (d ? formatDate(d, lang, { dateStyle: 'medium', timeZone: 'UTC' }) : t.t('partner3.none'));
  const at = (d: string | null) => (d ? asOfText(d, lang) : t.t('partner3.none'));
  const ev = eventLabel(c.eventTypeCode);
  const damage = damageText(c.damagePercent);
  const self = `/insurer/claims/${encodeURIComponent(c.id)}`;
  const row = (id: string, label: string, value: ReactNode) => <div className="kv-facts__row" data-kv-fact={id}><dt>{label}</dt><dd>{value}</dd></div>;
  return (
    <section data-kv-insurer="claim" data-kv-state="ok" data-kv-claim={c.id}>
      <h1>{t.t('partner3.claim.heading', { event: 'key' in ev ? t.t(ev.key) : ev.raw })}</h1>
      <ClaimsSubNav t={t} current={null} />
      <p><span className={`kv-status kv-status--${claimStatusTone(c.status)}`}>{t.t(claimStatusKey(c.status))}</span></p>
      <dl className="kv-card kv-facts">
        {row('reference', t.t('partner3.claim.reference'), <span className="kv-code">{c.id}</span>)}
        {row('policy', t.t('partner3.claim.policy'), <Link href={`/insurer/policies/${encodeURIComponent(c.policyId)}`}>{policyNoText(c.policyNo, t.t('partner2.policies.noNumber'))}</Link>)}
        {row('product', t.t('partner3.claim.product'), c.productName ?? t.t('partner3.none'))}
        {row('fpo', t.t('partner3.claim.fpo'), fpoLabel(c.fpoName, t.t('partner1.fpoUnnamed')))}
        {row('subject', t.t('partner3.claims.colSubject'), t.t(subjectKey(c.subjectType)))}
        {row('event', t.t('partner3.claims.colEvent'), 'key' in ev ? t.t(ev.key) : ev.raw)}
        {row('event_date', t.t('partner3.claim.eventDate'), day(c.eventDate))}
        {row('reported', t.t('partner3.claims.colReported'), t.t(reportedKey(c.reportedWithin72h)))}
        {row('sum_insured', t.t('partner3.claims.colSumInsured'), money(c.sumInsuredMinor))}
        {row('approved', t.t('partner3.claim.approved'), c.approvedMinor ? t.t('partner3.claim.approvedRecorded', { amount: money(c.approvedMinor) }) : t.t('partner3.claim.noneRecorded'))}
        {damage && row('damage', t.t('partner3.claim.damage'), t.t('partner3.claim.damageRecorded', { value: damage }))}
        {row('filed', t.t('partner3.claim.filed'), at(c.filedAt))}
        {row('changed', t.t('partner3.claim.changed'), at(c.lastChangedAt))}
        {row('closed', t.t('partner3.claim.closed'), c.closedAt ? at(c.closedAt) : t.t('partner3.claim.notClosed'))}
      </dl>
      <p className="kv-muted">{t.t('partner3.claim.factsOnly')}</p>
      {c.reportedWithin72h === false && <p className="kv-muted" data-kv-late="true">{t.t('partner3.claims.lateNote')}</p>}
      <div className="kv-card" data-kv-decide="decor">
        <p><span className="kv-btn kv-btn--muted" aria-disabled="true" data-kv-decor="decide">{t.t('partner3.claim.decide')}</span></p>
        <p className="kv-statement" data-kv-statement="partner3.claim.decideStatement">{t.t('partner3.claim.decideStatement')}</p>
      </div>
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-retry="true">{t.t('partner3.retry')}</Link></p>
      {c.computedAt && <p className="kv-muted" data-kv-asof={c.computedAt}>{t.t('partner3.asOf', { time: asOfText(c.computedAt, lang) })}</p>}
      <ClaimsRefusals t={t} surface="claim" />
      {back}
    </section>
  );
}
