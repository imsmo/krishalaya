// apps/web-partner/src/components/partner2/InsurerReportsView.tsx · PC-56 PARTNER-2b · W254 REPORTS — AN HONEST PAGE (founder Q2 / Q3 / 2b-1),
// presentational.
//
// "Signed extracts for your filings are not available from the partner console yet" (`partner2.reports.statement`): there is no partner export
// plane (P2-B6, named). "We never file for you" is TRUE and stays. "View policies" is real (`/insurer/policies`). "Generate Q1 pack" is DECOR →
// the reports page's own form state (`?form=` — the canon sends it to the PRODUCT form chain, F-18). Every regulatory and payout claim of the
// canon — the rural quota, the claims turnaround, the complaint counts, the fingerprinted extracts, the replay, the schedule, the download
// mark, the drill-ins — is refused by name below. The page reads no figure (so no audit row): its state is the platform's flag map.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import type { HonestState } from '../../features/partner2/figures';

export function InsurerReportsView({ t, state }: { t: Tr; state: HonestState }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="reports" />;
  return (
    <section data-kv-insurer="reports" data-kv-state={state}>
      <h1>{t.t('partner2.reports.title')}</h1>
      <p className="kv-statement" data-kv-statement="partner2.reports.statement">{t.t('partner2.reports.statement')}</p>
      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner2.reports.error.title')}</h2>
          <p>{t.t('partner2.reports.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/reports">{t.t('partner2.retry')}</Link></p>
        </div>
      ) : (
        <>
          <p className="kv-muted">{t.t('partner2.reports.neverFile')}</p>
          <p className="kv-muted">{t.t('partner2.reports.lead')}</p>
          <p className="kv-pager">
            <Link className="kv-btn" href="/insurer/policies" data-kv-real="policies">{t.t('partner2.reports.viewPolicies')}</Link>{' '}
            <Link className="kv-btn kv-btn--muted" href="/insurer/reports?form=review" data-kv-decor="pack">{t.t('partner2.reports.generate')}</Link>
          </p>
        </>
      )}
      <InsurerRefusals t={t} surface="ins_reports" />
    </section>
  );
}
