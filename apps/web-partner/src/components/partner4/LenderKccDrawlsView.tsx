// apps/web-partner/src/components/partner4/LenderKccDrawlsView.tsx · PC-56 PARTNER-4c · W217 (canon `lender/kcc/[id]/drawls`) — AN HONEST
// PAGE WITH NOTHING OF THE LEDGER ON IT (founder 4c-1, taken under the founder's standing authority), presentational.
//
// The drawl ledger EXISTS as a table — 0069 built it for this very screen, partitioned it, put it under row-level
// security and made it unwritable-twice by grant — and it MOVES NO MONEY. An entry raises or lowers what a farmer owes
// with no posting to any wallet, no key that makes a repeat safe, no second person and no switch that could stop it;
// the column made to store the interest arithmetic is never written, so an interest entry is an amount somebody typed.
// Therefore NOT ONE figure of it reaches a lender in this wave: no entry, no amount, no running balance, no note of
// what was bought or sold, no place the money is said to have gone, no check of its purpose and no interest.
//
// The page makes NO READ — so it writes NO audit row and has NO error state of its own (the 3b rule) — and its state is
// the platform's public, client-safe flag map. The canon's ONE TRUE sentence is kept ("a fresh KCC sits at zero until
// the season starts — no drawl, no interest, no cost"). The canon's own stale backend banner is NEVER copied (founder
// 4c-4) and "the ledger is append-only and safe" is refused until the trigger exists (founder 4c-5, P4-B7).
// "Export (signed)" is DECOR into the W2951–W2952 chain + the mailbox line; the crumb back to W216 is the canon's own
// edge that FLOWMAP omits.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { LendingSubNav } from './LendingSubNav';
import { kccDrawlsHref, kccHref, type LenderHonestState } from '../../features/partner4/figures';

/** The two statements this page exists to print, each with its own marker so a render test can find it by name. */
const STATEMENTS = ['notShown', 'ownRecord'] as const;

export function LenderKccDrawlsView({ t, state, loanId }: { t: Tr; state: LenderHonestState; loanId: string }) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="kccDrawls" />;
  const self = kccDrawlsHref(loanId);
  return (
    <section data-kv-lender="kcc_drawls" data-kv-state={state}>
      <p className="kv-backlink"><Link href={kccHref(loanId)} data-kv-back={kccHref(loanId)}>{t.t('partner4.drawls.backToKcc')}</Link></p>
      <LendingSubNav t={t} current={null} loanId={loanId} />
      <h1>{t.t('partner4.drawls.title')}</h1>
      <p className="kv-muted">{t.t('partner4.drawls.lead')}</p>

      <div className="kv-card" data-kv-statement={STATEMENTS[0]}>
        <h2 className="kv-card__title">{t.t('partner4.drawls.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner4.drawls.statement">{t.t('partner4.drawls.statement')}</p>
        <p data-kv-drawls-note="notMoney">{t.t('partner4.drawls.notMoney')}</p>
        <p data-kv-drawls-note="whenShown">{t.t('partner4.drawls.whenShown')}</p>
      </div>

      <div className="kv-card" data-kv-statement={STATEMENTS[1]}>
        <h2 className="kv-card__title">{t.t('partner4.drawls.ownRecordTitle')}</h2>
        <p data-kv-drawls-note="ownRecord">{t.t('partner4.drawls.ownRecord')}</p>
        <p data-kv-drawls-note="integrityOwed">{t.t('partner4.drawls.integrityOwed')}</p>
      </div>

      <p className="kv-statement" data-kv-statement="partner4.drawls.zeroTruth">{t.t('partner4.drawls.zeroTruth')}</p>

      <p className="kv-pager" data-kv-acts="drawls">
        <Link className="kv-btn kv-btn--muted" href={`${self}?export=queued`} data-kv-decor="export">{t.t('partner4.drawls.exportAct')}</Link>{' '}
        <Link className="kv-btn kv-btn--muted" href={kccHref(loanId)} data-kv-real="kcc">{t.t('partner4.drawls.backToKcc')}</Link>
      </p>
      <LenderRefusals t={t} surface="kcc_drawls" />
    </section>
  );
}
