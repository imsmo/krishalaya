// apps/web-partner/src/components/partner5/LenderCollectionsCaseView.tsx · PC-56 PARTNER-5b · W220 (canon `lender/collections/[id]`) — AN
// HONEST PAGE THAT READS NOTHING (founder 5b-1 / 5b-3, door Q5), presentational.
//
// There is no collections case on this platform. The `[id]` is a LOAN id (DELTA: the canon's is a case id), and the page LOOKS NOTHING UP,
// so every id — known, foreign, unknown or malformed — prints the same page: no not-found, no existence oracle. The id is never printed; it
// is only ENCODED into two links (the loan's own page, the restructure page).
//
// THE CANON'S TWO REAL INPUTS ARE NEVER RENDERED: no input, select, textarea, label-for or form exists in this component's markup (the
// render test asserts the DOM; M2 plants one). "Log contact" and "Record promise" are DECOR → the W2914–W2917 form chain (`?form=`) with NO
// mailbox line — the platform must not offer to relay a lender's contact with a cooperative's member. "Propose restructure" is a REAL link
// to the honest restructure page; "Back to workbench" a real link to `/lender/collections`. No read → no audit row, no error state.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { LenderSwitchedOff } from '../partner4/LenderChain';
import { LendingSubNav } from '../partner4/LendingSubNav';
import { LenderRefusals5 } from './LenderChain5';
import { loanHref, type LenderHonestState } from '../../features/partner4/figures';
import { collectionsCaseHref, collectionsHref, restructureHref } from '../../features/partner5/figures';

export function LenderCollectionsCaseView({ t, state, loanId }: { t: Tr; state: LenderHonestState; loanId: string }) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="collections_case" />;
  const self = collectionsCaseHref(loanId);
  return (
    <section data-kv-lender="collections_case" data-kv-state={state}>
      <p className="kv-backlink"><Link href={collectionsHref()} data-kv-back={collectionsHref()}>{t.t('partner5.case.backToCollections')}</Link></p>
      <LendingSubNav t={t} current={null} />
      <h1>{t.t('partner5.case.title')}</h1>
      <p className="kv-muted">{t.t('partner5.case.lead')}</p>

      <div className="kv-card" data-kv-statement="case">
        <h2 className="kv-card__title">{t.t('partner5.case.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner5.case.statement">{t.t('partner5.case.statement')}</p>
        <p data-kv-case-note="noRelay">{t.t('partner5.case.noRelay')}</p>
      </div>

      <p className="kv-statement" data-kv-statement="partner5.collections.noSellingBlock">{t.t('partner5.collections.noSellingBlock')}</p>

      <p className="kv-pager" data-kv-acts="case">
        <Link className="kv-btn kv-btn--muted" href={loanHref(loanId)} data-kv-real="loan">{t.t('partner5.case.viewLoan')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={restructureHref(loanId)} data-kv-real="restructure">{t.t('partner5.case.proposeRestructure')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?form=review`} data-kv-decor="logContact">{t.t('partner5.case.logContactAct')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={`${self}?form=review`} data-kv-decor="recordPromise">{t.t('partner5.case.recordPromiseAct')}</Link>
      </p>
      <LenderRefusals5 t={t} surface="collections_case" />
    </section>
  );
}
