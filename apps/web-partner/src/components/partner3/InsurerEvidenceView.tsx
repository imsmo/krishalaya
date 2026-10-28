// apps/web-partner/src/components/partner3/InsurerEvidenceView.tsx · PC-56 PARTNER-3b · W255 EVIDENCE REVIEW — AN HONEST PAGE (founder Q4 + Q5 on
// evidence), presentational.
//
// "Claim evidence — photos, videos and documents — stays with the farmer and the organisation that serves them. Insurers do not see, review,
// verify or request evidence on the platform." (`partner3.evidence.statement`, the founder's words of 2026-10-28.)
//
// The page's ONE read is PARTNER-3a's audited counts (`GET /v1/partner/insurance/claims/counts`): COUNTS OF CLAIMS by survey status (founder
// 3b-1) — awaiting a survey (intimated + documents pending), survey scheduled, surveyed — with the FY label the database answered and an as-of.
// Never a count of photos, videos, documents or media items; never a person; never a media URL. The canon's media rows, machine pre-checks,
// auto-verification, duplicate signal, confidence scores, re-shoot requests, routes and "lands here within minutes of the voice call" are
// refused BY NAME below. "Take next" and "Retry" are DECOR (the W2866–W2868 chain, `?act=confirm` — the confirm state is the whole chain);
// "View claims" is real.
import Link from 'next/link';
import type { PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimsRefusals } from './InsurerClaimsChain';
import { asOfText } from '../../features/partner1/dashboard';
import { surveyStageCounts, windowLabel, type CountsState } from '../../features/partner3/figures';

export function InsurerEvidenceView({ t, lang, state, counts }: { t: Tr; lang: string; state: CountsState; counts: PartnerInsuranceClaimCounts | null }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="evidence" />;
  const win = windowLabel(counts);
  return (
    <section data-kv-insurer="evidence" data-kv-state={state}>
      <h1>{t.t('partner3.evidence.title')}</h1>
      <ClaimsSubNav t={t} current="/insurer/claims/evidence" />
      <p className="kv-statement" data-kv-statement="partner3.evidence.statement">{t.t('partner3.evidence.statement')}</p>
      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner3.evidence.error.title')}</h2>
          <p>{t.t('partner3.evidence.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/claims/evidence?act=confirm" data-kv-retry="true">{t.t('partner3.retry')}</Link></p>
        </div>
      ) : state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner3.evidence.empty.title')}</h2>
          <p>{t.t('partner3.evidence.empty.body')}</p>
        </div>
      ) : counts && (
        <div className="kv-card kv-counts" data-kv-counts="evidence">
          <h2 className="kv-card__title">{win ? t.t(win.key, win.vars) : t.t('partner3.surveys.countsTitle')}</h2>
          <dl className="kv-counts__list">
            {surveyStageCounts(counts.byStatus).map((c) => (
              <div key={c.id} className="kv-counts__item" data-kv-count={c.id}><dt>{t.t(c.key)}</dt><dd>{c.n}</dd></div>
            ))}
          </dl>
          <p className="kv-muted">{t.t('partner3.surveys.countsOnlyClaims')}</p>
          <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner3.asOf', { time: asOfText(counts.computedAt, lang) })}</p>
        </div>
      )}
      <p className="kv-pager">
        <Link className="kv-btn kv-btn--muted" href="/insurer/claims/evidence?act=confirm" data-kv-decor="take-next">{t.t('partner3.claims.takeNext')}</Link>{' '}
        <Link className="kv-btn" href="/insurer/claims" data-kv-real="claims">{t.t('partner3.insights.viewClaims')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href="/insurer/surveys" data-kv-real="surveys">{t.t('partner3.evidence.viewSurveys')}</Link>
      </p>
      <ClaimsRefusals t={t} surface="evidence" />
    </section>
  );
}
