// apps/web-partner/src/components/partner3/InsurerFraudView.tsx · PC-56 PARTNER-3b · W263 FRAUD FLAGS — AN HONEST PAGE, REFUSED BY NAME
// (founder Q6), presentational.
//
// "There are no fraud flags on the platform and none is raised from this console." (`partner3.fraud.statement`, the founder's words of
// 2026-10-28.)
//
// The page makes NO READ, prints NO COUNT and draws NO ROW. There is no flag table, no signal, no score and no risk desk for claims anywhere on
// the platform, and none is built: the canon's four signals, its three flag rows against named holders, its flag and false-flag rates, its
// marketplace cross-signal, its platform risk desk, its police referral, its automatic flagging and its "flags never appear on the claimant's
// own screens" are each refused BY NAME below. The console never marks a claim suspicious. "Retry" is DECOR → the W2934–W2936 chain
// (`?act=confirm`, whose sentence IS the whole chain); "View claims" is real. Its only state is the platform's public flag map.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimsRefusals } from './InsurerClaimsChain';
import type { HonestState } from '../../features/partner2/figures';

export function InsurerFraudView({ t, state }: { t: Tr; state: HonestState }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="fraud" />;
  return (
    <section data-kv-insurer="fraud" data-kv-state={state}>
      <h1>{t.t('partner3.fraud.title')}</h1>
      <ClaimsSubNav t={t} current="/insurer/claims/fraud" />
      <p className="kv-statement" data-kv-statement="partner3.fraud.statement">{t.t('partner3.fraud.statement')}</p>
      <p className="kv-muted">{t.t('partner3.fraud.lead')}</p>
      <p className="kv-pager" data-kv-acts="fraud">
        <Link className="kv-btn kv-btn--muted" href="/insurer/claims/fraud?act=confirm" data-kv-decor="retry">{t.t('partner3.retry')}</Link>{' '}
        <Link className="kv-btn" href="/insurer/claims" data-kv-real="claims">{t.t('partner3.insights.viewClaims')}</Link>
      </p>
      <ClaimsRefusals t={t} surface="fraud" />
    </section>
  );
}
