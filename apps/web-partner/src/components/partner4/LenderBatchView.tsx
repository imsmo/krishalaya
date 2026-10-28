// apps/web-partner/src/components/partner4/LenderBatchView.tsx · PC-56 PARTNER-4b · W218 (canon `lender/disbursements/[id]`) — AN HONEST PAGE
// ABOUT WHOSE MONEY MOVES AND WHO SIGNS (founder 4b-3 / 4b-4 / 4b-6), presentational.
//
// The page makes NO READ: there is nothing on this axis to read. A batch is a RUN on the cooperative's own plane, and
// this console holds no privilege on the run tables, the payout tables or a bank account — not a table privilege, not
// one column (0232 asserts nine tables). So it writes NO audit row and has NO error state of its own; its state is
// the platform's public, client-safe flag map, and `partner_console` OFF is printed as OFF (never "lending is off" —
// the `fintech` flag is a tenant module switch this realm does not consult, survey F-20 / E5).
//
// THREE THINGS THE CANON SAYS HERE ARE TRUE, and they are kept in the platform's own words:
//   • the total is verified before a single row is written, and a batch whose lines do not add up is abandoned;
//   • the pre-flight asks about the cooling-off window BEFORE it asks about the account, so a borrower who is still
//     protected is told the real reason and not an account problem (the ordering is pinned by its own unit spec);
//   • nothing was disbursed — a batch is written whole or not at all, never partial-mystery.
// EVERYTHING ELSE GOES: "awaiting your co-approval", the maker / checker / "funds leave YOUR bank rails" claim, the
// batch-contents table with its borrowers and banks, the fee, the "product rule … enforced", "both sides", the
// automatic assembly and the delegation. And the hardest sentence of the wave: there is no second signature worth the
// name on this platform today, because the "checker" is a user id typed into the same request by the same person.
// "Co-approve — disburse now" is DECOR, refused by name through the W2860–W2862 chain.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { LendingSubNav } from './LendingSubNav';
import { batchHref, type LenderHonestState } from '../../features/partner4/figures';

/** The three TRUE lines, each with its own marker so the render test can find it by name. */
const TRUE_LINES = ['total', 'preflight', 'allOrNothing'] as const;

export function LenderBatchView({ t, state }: { t: Tr; state: LenderHonestState }) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="batch" />;
  return (
    <section data-kv-lender="batch" data-kv-state={state}>
      <h1>{t.t('partner4.batch.title')}</h1>
      <p className="kv-muted">{t.t('partner4.batch.lead')}</p>
      <LendingSubNav t={t} current={null} />

      <div className="kv-card" data-kv-statement="whoseMoney">
        <h2 className="kv-card__title">{t.t('partner4.batch.whoseMoneyTitle')}</h2>
        <p>{t.t('partner4.batch.whoseMoney')}</p>
        <p>{t.t('partner4.batch.neverYours')}</p>
      </div>

      <div className="kv-card" data-kv-statement="whoSigns">
        <h2 className="kv-card__title">{t.t('partner4.batch.whoSignsTitle')}</h2>
        <p>{t.t('partner4.batch.whoSigns')}</p>
        <p>{t.t('partner4.batch.realCheckerOwed')}</p>
      </div>

      <div className="kv-card" data-kv-statement="true">
        <h2 className="kv-card__title">{t.t('partner4.batch.trueTitle')}</h2>
        <ul>{TRUE_LINES.map((l) => <li key={l} data-kv-true={l}>{t.t(`partner4.batch.true.${l}`)}</li>)}</ul>
      </div>

      <p className="kv-pager" data-kv-acts="batch">
        <Link className="kv-btn kv-btn--muted" href={`${batchHref()}?act=confirm`} data-kv-decor="coApprove">{t.t('partner4.batch.coApproveAct')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href="/lender/disbursements" data-kv-real="payouts">{t.t('partner4.batch.viewPayouts')}</Link>
      </p>
      <LenderRefusals t={t} surface="disbursement_batch" />
    </section>
  );
}
