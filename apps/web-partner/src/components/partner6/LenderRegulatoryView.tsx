// apps/web-partner/src/components/partner6/LenderRegulatoryView.tsx · PC-56 PARTNER-6b · W224 (canon `lender/reports/regulatory`) — AN HONEST
// PAGE THAT READS NOTHING (founder 6b-3, door Q6-A), presentational.
//
// The platform produces no regulatory extract and classifies nothing for a regulator; it never gives the organisation a borrower's gender or
// landholding; the book's own figures are on Portfolio and DPD aging (REAL links — the canon's "View portfolio" was a dead button); the
// organisation files its own returns and the platform never files for it; the partners mailbox for a lender that needs data for a filing of
// its own. NO figure, NO percentage, NO classification, NO extract, NO hash, NO regulator's return named as a platform product. No read → no
// audit row and NO error state; the state is the public flag map. "Generate a pack" is DECOR → the W2987–W2990 FORM chain (no input, with
// the mailbox line). The way back to "SLA & reports" (W214) is real — the canon drew this page as an orphan. No form, no input.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { LenderSwitchedOff } from '../partner4/LenderChain';
import { Refusals6 } from './LenderChain6';
import type { LenderHonestState } from '../../features/partner4/figures';
import { regulatoryHref } from '../../features/partner6/figures';

export function LenderRegulatoryView({ t, state, mailbox }: { t: Tr; state: LenderHonestState; mailbox: Mailbox }) {
  if (state === 'off') return <LenderSwitchedOff t={t} page="regulatory" />;
  return (
    <section data-kv-lender="regulatory" data-kv-state={state}>
      <p className="kv-backlink"><Link href="/lender/reports" data-kv-real="reports">{t.t('partner6.regulatory.back')}</Link></p>
      <h1>{t.t('partner6.regulatory.title')}</h1>
      <p className="kv-muted">{t.t('partner6.regulatory.lead')}</p>

      <div className="kv-card" data-kv-statement="regulatory">
        <h2 className="kv-card__title">{t.t('partner6.regulatory.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner6.regulatory.statement">{t.t('partner6.regulatory.statement')}</p>
        <p className="kv-pager" data-kv-acts="book">
          <Link className="kv-btn kv-btn--muted" href="/lender/portfolio" data-kv-real="portfolio">{t.t('partner6.regulatory.viewPortfolio')}</Link>{' '}
          <Link className="kv-btn kv-btn--muted" href="/lender/portfolio/aging" data-kv-real="aging">{t.t('partner6.regulatory.viewAging')}</Link>
        </p>
      </div>

      <div className="kv-card" data-kv-regulatory-contact="true">
        <h2 className="kv-card__title">{t.t('partner6.regulatory.contactTitle')}</h2>
        <p data-kv-statement="partner6.regulatory.mailboxAsk">{t.t('partner6.regulatory.mailboxAsk')}</p>
        <MailboxLine t={t} mailbox={mailbox} />
      </div>

      <p className="kv-pager" data-kv-acts="regulatory">
        <Link className="kv-btn kv-btn--muted" href={`${regulatoryHref()}?form=review`} data-kv-decor="pack">{t.t('partner6.regulatory.packAct')}</Link>
      </p>
      <Refusals6 t={t} surface="regulatory" />
    </section>
  );
}
