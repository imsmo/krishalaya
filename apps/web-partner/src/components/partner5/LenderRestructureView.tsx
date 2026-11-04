// apps/web-partner/src/components/partner5/LenderRestructureView.tsx · PC-56 PARTNER-5b · W221 (canon `lender/collections/[id]/restructure`)
// — AN HONEST PAGE THAT READS NOTHING (founder 5b-1 / 5b-4, door Q4), presentational.
//
// A restructure is proposed and decided by the organisation that serves the farmer, on the tenant plane, not from this console. The lender
// is not a party to it on this platform and NOTHING OF ANY PROPOSAL is printed: kv_partner holds nothing on the proposals table and keeps
// holding nothing. A restructure cannot yet be accepted or activated on the platform (both refused by name since PARTNER-5a). The loan's
// status appears on its own page — a real link, an href only. "restructure ≠ default" stays as the platform's doctrine. The canon's stale
// backend banner is never copied. "Take to mediation" is DECOR → the W2999–W3001 chain (`?act=`), whose sentences never repeat the canon's
// acceptance order. "Back to case" is a real link to the case page. No read → no audit row, no error state; the `[id]` is a LOAN id.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { LenderSwitchedOff } from '../partner4/LenderChain';
import { LendingSubNav } from '../partner4/LendingSubNav';
import { LenderRefusals5 } from './LenderChain5';
import { loanHref, type LenderHonestState } from '../../features/partner4/figures';
import { collectionsCaseHref, restructureHref } from '../../features/partner5/figures';

export function LenderRestructureView({ t, state, loanId }: { t: Tr; state: LenderHonestState; loanId: string }) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="restructure" />;
  const self = restructureHref(loanId);
  const back = collectionsCaseHref(loanId);
  return (
    <section data-kv-lender="restructure" data-kv-state={state}>
      <p className="kv-backlink"><Link href={back} data-kv-back={back}>{t.t('partner5.restructure.backToCase')}</Link></p>
      <LendingSubNav t={t} current={null} />
      <h1>{t.t('partner5.restructure.title')}</h1>
      <p className="kv-muted">{t.t('partner5.restructure.lead')}</p>

      <div className="kv-card" data-kv-statement="restructure">
        <h2 className="kv-card__title">{t.t('partner5.restructure.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner5.restructure.statement">{t.t('partner5.restructure.statement')}</p>
        <p data-kv-restructure-note="doctrine">{t.t('partner5.restructure.doctrine')}</p>
      </div>

      <p className="kv-pager" data-kv-acts="restructure">
        <Link className="kv-btn kv-btn--muted" href={loanHref(loanId)} data-kv-real="loan">{t.t('partner5.restructure.viewLoan')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={back} data-kv-real="case">{t.t('partner5.restructure.backToCase')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?act=confirm`} data-kv-decor="mediation">{t.t('partner5.restructure.mediationAct')}</Link>
      </p>
      <LenderRefusals5 t={t} surface="restructure" />
    </section>
  );
}
