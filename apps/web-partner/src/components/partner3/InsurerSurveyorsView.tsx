// apps/web-partner/src/components/partner3/InsurerSurveyorsView.tsx · PC-56 PARTNER-3b · W257 SURVEYOR NETWORK — AN HONEST PAGE (founder Q5),
// presentational.
//
// "There is no surveyor roster on the platform and this console manages nobody's staff. Surveys are arranged by the organisation that serves the
// farmer." (`partner3.surveyors.statement`, the founder's words of 2026-10-28.)
//
// The page makes NO READ and prints NO COUNT — a surveyor is not an entity on the platform, so there is nothing to count. Its only state is the
// platform's public flag map (`partner_console`, `insurance`): OFF reads as switched off, and there is no error state because there is no read
// to fail. The canon's professional network, its three named surveyors with phones, belts, completed-survey counts, turnaround days and weekly
// availability, its empanelment buttons, its automatic workload balancing and conflict recusal, its pay per completed report and its
// qualification checks are refused BY NAME below. "Empanel surveyor" (three times in the canon) and "Retry" are DECOR → the W2904–W2906 chain
// (`?act=confirm`, whose sentence IS the whole chain); "View claims" is real.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimsRefusals } from './InsurerClaimsChain';
import type { HonestState } from '../../features/partner2/figures';

export function InsurerSurveyorsView({ t, state }: { t: Tr; state: HonestState }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="surveyors" />;
  return (
    <section data-kv-insurer="surveyors" data-kv-state={state}>
      <h1>{t.t('partner3.surveyors.title')}</h1>
      <ClaimsSubNav t={t} current="/insurer/surveyors" />
      <p className="kv-statement" data-kv-statement="partner3.surveyors.statement">{t.t('partner3.surveyors.statement')}</p>
      <p className="kv-muted">{t.t('partner3.surveyors.lead')}</p>
      <p className="kv-pager" data-kv-acts="surveyors">
        <Link className="kv-btn kv-btn--muted" href="/insurer/surveyors?act=confirm" data-kv-decor="empanel">{t.t('partner3.surveyors.empanel')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href="/insurer/surveyors?act=confirm" data-kv-decor="retry">{t.t('partner3.retry')}</Link>{' '}
        <Link className="kv-btn" href="/insurer/claims" data-kv-real="claims">{t.t('partner3.insights.viewClaims')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href="/insurer/surveys" data-kv-real="surveys">{t.t('partner3.evidence.viewSurveys')}</Link>
      </p>
      <ClaimsRefusals t={t} surface="surveyors" />
    </section>
  );
}
