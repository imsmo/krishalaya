// apps/web-partner/src/components/partner6/InsurerSettlementView.tsx · PC-56 PARTNER-6a · W261 ONE CLAIM'S "SETTLEMENT" — AN HONEST PAGE THAT
// READS NOTHING (founder 6a-2), presentational.
//
// "No settlement exists for any claim on this platform. This claim's own facts are on its claim page." The `[id]` is a CLAIM id (DELTA: the
// canon's is a settlement id) and the page LOOKS NOTHING UP, so every id — known, foreign, unknown or malformed — prints the same page: no
// not-found, no existence oracle, no error state, no input. The id is never printed; it is only ENCODED into the one link to the claim's own
// page (3a's `/insurer/claims/[id]`, which answers its own not-found). Never a claimant, a decider or approver, an amount, an account tail, a
// surveyor, an animal tag, a diagnosis, a message, an offer, a reinsurance note, a hash or a retention promise — each refused BY NAME below.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from '../partner3/ClaimsSubNav';
import { SettlementRefusals } from './InsurerChain6';
import type { HonestState } from '../../features/partner2/figures';
import { claimHref, settlementsHref } from '../../features/partner6/figures';

export function InsurerSettlementView({ t, state, claimId }: { t: Tr; state: HonestState; claimId: string }) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="settlement" />;
  return (
    <section data-kv-insurer="settlement" data-kv-state={state}>
      <p className="kv-backlink"><Link href={settlementsHref()} data-kv-back={settlementsHref()}>{t.t('partner6.settlement.back')}</Link></p>
      <ClaimsSubNav t={t} current={null} />
      <h1>{t.t('partner6.settlement.title')}</h1>
      <p className="kv-muted">{t.t('partner6.settlement.lead')}</p>
      <div className="kv-card" data-kv-statement="settlement">
        <h2 className="kv-card__title">{t.t('partner6.settlement.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner6.settlement.statement">{t.t('partner6.settlement.statement')}</p>
      </div>
      <p className="kv-pager" data-kv-acts="settlement">
        <Link className="kv-btn" href={claimHref(claimId)} data-kv-real="claim">{t.t('partner6.settlement.viewClaim')}</Link>
      </p>
      <SettlementRefusals t={t} surface="settlement" />
    </section>
  );
}
