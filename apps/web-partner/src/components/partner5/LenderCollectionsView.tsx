// apps/web-partner/src/components/partner5/LenderCollectionsView.tsx · PC-56 PARTNER-5b · W219 (canon `lender/collections`) — AN HONEST
// PAGE THAT READS NOTHING (founder 5b-1 / 5b-2, door Q5), presentational.
//
// A lender does not collect on this platform. The organisation that serves the farmer is the lender of record and services its own book on
// the tenant plane; no borrower in arrears is named, contacted or ranked here — not on this page and not one click further on. So the page
// prints the statement, says WHERE arrears are counted (real links to the repayments page and the days-past-due page, with 5a's zero
// sentence reused BY KEY and no figure of its own), prints PARTNER-4b's code-of-conduct refusals BY KEY (recorded as intent, never as a rule
// the platform keeps), and keeps the canon's one true line only as an ABSENCE: nothing on this platform restricts a borrower's selling
// because of a loan. "Distress is a season, not a character." stays as the page's own voice.
//
// No read → no audit row and NO ERROR STATE of its own (the W217 / 3b rule); the state is the public flag map (`partner_console` OFF prints
// OFF). "Take next case" is DECOR → the W2918–W2920 chain (`?act=`), its label saying there is no next case. No form, no input, no figure.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { LenderSwitchedOff } from '../partner4/LenderChain';
import { LendingSubNav } from '../partner4/LendingSubNav';
import { LenderRefusals5 } from './LenderChain5';
import type { LenderHonestState } from '../../features/partner4/figures';
import { collectionsHref } from '../../features/partner5/figures';

export function LenderCollectionsView({ t, state }: { t: Tr; state: LenderHonestState }) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="collections" />;
  return (
    <section data-kv-lender="collections" data-kv-state={state}>
      <LendingSubNav t={t} current="/lender/collections" />
      <h1>{t.t('partner5.collections.title')}</h1>
      <p className="kv-muted">{t.t('partner5.collections.lead')}</p>

      <div className="kv-card" data-kv-statement="collections">
        <h2 className="kv-card__title">{t.t('partner5.collections.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner5.collections.statement">{t.t('partner5.collections.statement')}</p>
        <p data-kv-collections-note="voice">{t.t('partner5.collections.voice')}</p>
      </div>

      <div className="kv-card" data-kv-statement="whereCounted">
        <h2 className="kv-card__title">{t.t('partner5.collections.whereCountedTitle')}</h2>
        <p data-kv-collections-note="whereCounted">{t.t('partner5.collections.whereCounted')}</p>
        <p className="kv-statement" data-kv-statement="partner5.aging.statement">{t.t('partner5.aging.statement')}</p>
        <p className="kv-pager" data-kv-acts="whereCounted">
          <Link className="kv-btn kv-btn--muted" href="/lender/repayments" data-kv-real="repayments">{t.t('partner5.collections.viewRepayments')}</Link>{' '}
          <Link className="kv-btn kv-btn--muted" href="/lender/portfolio/aging" data-kv-real="aging">{t.t('partner5.collections.viewAging')}</Link>
        </p>
      </div>

      <p className="kv-statement" data-kv-statement="partner5.collections.noSellingBlock">{t.t('partner5.collections.noSellingBlock')}</p>

      <p className="kv-pager" data-kv-acts="collections">
        <Link className="kv-btn kv-btn--muted" href={`${collectionsHref()}?act=confirm`} data-kv-decor="nextCase">{t.t('partner5.collections.nextCaseAct')}</Link>
      </p>
      <LenderRefusals5 t={t} surface="collections" />
    </section>
  );
}
