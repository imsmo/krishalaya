// apps/web-partner/src/components/partner3/InsurerSurveyReportView.tsx · PC-56 PARTNER-3b · W259 SURVEY REPORT — AN HONEST PAGE (founder Q4 +
// Q5), presentational.
//
// "The survey report is recorded by the organisation that serves the farmer. The insurer sees the recorded damage percentage and nothing else of
// the report; there is no report-acceptance step on the platform." (`partner3.report.statement`, the founder's words of 2026-10-28.)
//
// The `[id]` in the route is a CLAIM id — there is no survey entity on the platform (the report is a column of the claim; DELTA `w259_claim_id`).
// The page prints the claim's facts (the shared `ClaimFacts` wall, with its damage row left out) and then the REPORT BLOCK, which has exactly
// three branches (`reportText`): the recorded damage percentage — the ONE "%" any PARTNER-3 page prints — or that no survey is recorded on this
// claim yet, or that the recorded report carries no damage percentage. Nothing else of the report ever reaches an insurer.
//
// The canon's findings table over three plots, its named holders, its plot areas, its indicated payouts and their formula, its methodology
// (sample quadrats, GPS pins, a photographed reference plot), its signed field sheet, its acceptance step, its hash seal and its reviewer rule
// are refused BY NAME below. "Accept report — to decision", "Query surveyor" and "Retry" are DECOR → the W3014–W3016 chain (`?act=confirm`,
// whose sentence IS the whole chain); "View scheduling" and "Open the claim" are real. An unknown or another insurer's id is "not found".
import Link from 'next/link';
import type { PartnerInsuranceClaim } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimFacts, ClaimStatusPill, claimEventText } from './ClaimFacts';
import { ClaimsRefusals } from './InsurerClaimsChain';
import { asOfText } from '../../features/partner1/dashboard';
import type { InsurerFailure } from '../../features/partner2/figures';
import { reportText } from '../../features/partner3/figures';

export function InsurerSurveyReportView({ t, lang, c, failure, notFound }: {
  t: Tr; lang: string; c: (PartnerInsuranceClaim & { computedAt?: string }) | null; failure: InsurerFailure | null; notFound?: boolean;
}) {
  if (failure === 'off' || failure === 'insurance_off') return <InsurerSwitchedOff t={t} which={failure} page="survey_report" />;
  const back = <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/surveys" data-kv-back="/insurer/surveys">{t.t('partner3.report.back')}</Link></p>;
  if (notFound) {
    return (
      <section data-kv-insurer="survey_report" data-kv-state="not_found">
        <h1>{t.t('partner3.report.notFound.title')}</h1>
        <p>{t.t('partner3.report.notFound.body')}</p>
        {back}
      </section>
    );
  }
  if (failure || !c) {
    return (
      <section data-kv-insurer="survey_report" data-kv-state="error">
        <h1>{t.t('partner3.report.title')}</h1>
        <div className="kv-card" role="alert">
          <p>{t.t('partner3.report.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/surveys?act=confirm" data-kv-retry="true">{t.t('partner3.retry')}</Link></p>
        </div>
        {back}
      </section>
    );
  }
  const self = `/insurer/surveys/${encodeURIComponent(c.id)}/report`;
  const r = reportText(c);
  return (
    <section data-kv-insurer="survey_report" data-kv-state="ok" data-kv-claim={c.id}>
      <h1>{t.t('partner3.report.heading', { event: claimEventText(t, c.eventTypeCode) })}</h1>
      <ClaimsSubNav t={t} current={null} />
      <ClaimStatusPill t={t} status={c.status} />
      <p className="kv-statement" data-kv-statement="partner3.report.statement">{t.t('partner3.report.statement')}</p>
      <div className="kv-card" data-kv-report={r ? r.key.slice('partner3.report.'.length) : 'none'}>
        <h2 className="kv-card__title">{t.t('partner3.report.blockTitle')}</h2>
        {r && <p>{t.t(r.key, r.vars ?? {})}</p>}
      </div>
      <ClaimFacts t={t} lang={lang} c={c} damage={false} />
      <p className="kv-muted">{t.t('partner3.claim.factsOnly')}</p>
      <p className="kv-pager" data-kv-acts="survey_report">
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="accept">{t.t('partner3.report.accept')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="query">{t.t('partner3.report.query')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="retry">{t.t('partner3.retry')}</Link>
      </p>
      <p className="kv-pager">
        <Link className="kv-btn" href={`/insurer/claims/${encodeURIComponent(c.id)}`} data-kv-real="claim">{t.t('partner3.report.openClaim')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href="/insurer/surveys" data-kv-real="surveys">{t.t('partner3.report.viewScheduling')}</Link>
      </p>
      {c.computedAt && <p className="kv-muted" data-kv-asof={c.computedAt}>{t.t('partner3.asOf', { time: asOfText(c.computedAt, lang) })}</p>}
      <ClaimsRefusals t={t} surface="survey_report" />
      {back}
    </section>
  );
}
