// apps/web-partner/src/components/partner3/InsurerEvidenceBoardView.tsx · PC-56 PARTNER-3b · W256 EVIDENCE BOARD — AN HONEST PAGE (founder Q4 +
// Q5 on evidence), presentational.
//
// Where the canon draws a media board (a video with its length, an ear-tag close-up, two photos, a registry cross-check, each with checks and a
// confidence score, and the claimant's name and phone above them), this page prints the CLAIM'S FACTS — the shared `ClaimFacts` wall, the same
// component the claim detail and the survey report use — and then the evidence statement: claim evidence stays with the farmer and the
// organisation that serves them; insurers do not see, review, verify or request it. Nothing of the evidence itself exists here to leak: the SDK
// type carries no media, no URL, no count, no uploader and no name.
//
// "Request re-shoot (guided)" and "Verify — schedule survey" (twice in the canon) are DECOR → the W2866–W2868 chain (`?act=confirm`, whose
// sentence IS the whole chain). "Back to queue" → `/insurer/claims/evidence`; "Open the claim" → `/insurer/claims/[id]`. Another insurer's claim
// or an absent id is "not found" (never "not yours", never a 403).
import Link from 'next/link';
import type { PartnerInsuranceClaim } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimFacts, ClaimStatusPill, claimEventText } from './ClaimFacts';
import { ClaimsRefusals } from './InsurerClaimsChain';
import { asOfText } from '../../features/partner1/dashboard';
import type { InsurerFailure } from '../../features/partner2/figures';

export function InsurerEvidenceBoardView({ t, lang, c, failure, notFound }: {
  t: Tr; lang: string; c: (PartnerInsuranceClaim & { computedAt?: string }) | null; failure: InsurerFailure | null; notFound?: boolean;
}) {
  if (failure === 'off' || failure === 'insurance_off') return <InsurerSwitchedOff t={t} which={failure} page="evidence_board" />;
  const back = <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/claims/evidence" data-kv-back="/insurer/claims/evidence">{t.t('partner3.board.back')}</Link></p>;
  if (notFound) {
    return (
      <section data-kv-insurer="evidence_board" data-kv-state="not_found">
        <h1>{t.t('partner3.board.notFound.title')}</h1>
        <p>{t.t('partner3.board.notFound.body')}</p>
        {back}
      </section>
    );
  }
  if (failure || !c) {
    return (
      <section data-kv-insurer="evidence_board" data-kv-state="error">
        <h1>{t.t('partner3.board.title')}</h1>
        <div className="kv-card" role="alert">
          <p>{t.t('partner3.board.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/claims/evidence?act=confirm" data-kv-retry="true">{t.t('partner3.retry')}</Link></p>
        </div>
        {back}
      </section>
    );
  }
  const self = `/insurer/claims/evidence/${encodeURIComponent(c.id)}`;
  return (
    <section data-kv-insurer="evidence_board" data-kv-state="ok" data-kv-claim={c.id}>
      <h1>{t.t('partner3.board.heading', { event: claimEventText(t, c.eventTypeCode) })}</h1>
      <ClaimsSubNav t={t} current={null} />
      <ClaimStatusPill t={t} status={c.status} />
      <p className="kv-statement" data-kv-statement="partner3.evidence.statement">{t.t('partner3.evidence.statement')}</p>
      <ClaimFacts t={t} lang={lang} c={c} />
      <p className="kv-muted">{t.t('partner3.claim.factsOnly')}</p>
      {/* The canon's three acts (it draws "Verify — schedule survey" twice): each lands on the chain's one confirm state, which says no. */}
      <p className="kv-pager" data-kv-acts="evidence_board">
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="reshoot">{t.t('partner3.board.reshoot')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="verify">{t.t('partner3.board.verify')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="retry">{t.t('partner3.retry')}</Link>
      </p>
      <p className="kv-pager">
        <Link className="kv-btn" href={`/insurer/claims/${encodeURIComponent(c.id)}`} data-kv-real="claim">{t.t('partner3.board.openClaim')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`/insurer/surveys/${encodeURIComponent(c.id)}/report`} data-kv-real="survey_report">{t.t('partner3.board.openReport')}</Link>
      </p>
      {c.computedAt && <p className="kv-muted" data-kv-asof={c.computedAt}>{t.t('partner3.asOf', { time: asOfText(c.computedAt, lang) })}</p>}
      <ClaimsRefusals t={t} surface="evidence_board" />
      {back}
    </section>
  );
}
