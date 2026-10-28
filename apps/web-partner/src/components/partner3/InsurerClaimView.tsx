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
// PC-56 PARTNER-3b: the fact block moved to the shared `ClaimFacts` — the wall is now rendered by one component for W253, W256 and W259.
import Link from 'next/link';
import type { PartnerInsuranceClaim } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimFacts, ClaimStatusPill, claimEventText } from './ClaimFacts';
import { ClaimsRefusals } from './InsurerClaimsChain';
import { asOfText } from '../../features/partner1/dashboard';
import { type InsurerFailure } from '../../features/partner2/figures';

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
  const self = `/insurer/claims/${encodeURIComponent(c.id)}`;
  return (
    <section data-kv-insurer="claim" data-kv-state="ok" data-kv-claim={c.id}>
      <h1>{t.t('partner3.claim.heading', { event: claimEventText(t, c.eventTypeCode) })}</h1>
      <ClaimsSubNav t={t} current={null} />
      <ClaimStatusPill t={t} status={c.status} />
      <ClaimFacts t={t} lang={lang} c={c} />
      <p className="kv-muted">{t.t('partner3.claim.factsOnly')}</p>
      {/* PC-56 PARTNER-3b: the canon reaches the evidence board from the evidence queue's "Review" drill-in, and that queue's rows are MEDIA
          rows (refused) — so the only honest way in is from the claim itself. One link, to this claim's board; nothing is shown there either. */}
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={`/insurer/claims/evidence/${encodeURIComponent(c.id)}`} data-kv-real="evidence_board">{t.t('partner3.claim.openEvidence')}</Link></p>
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
