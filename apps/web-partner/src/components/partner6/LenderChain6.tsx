// apps/web-partner/src/components/partner6/LenderChain6.tsx · PC-56 PARTNER-6b — ONE DECOR chain page of the lender's two honest pages, a query
// state of its parent page (founder 6b-5):
//   • `consents_export` (`/lender/consents?export=queued|ready`, W2921–W2922) — exports are not available from the partner console; write to
//     the partners mailbox (the mailbox FACT read at runtime by lib/partners-mailbox.ts — never a literal);
//   • `consents_act` (`?act=`, W2923–W2925) — Retry on a page that reads nothing: nothing to re-read, nothing to confirm;
//   • `regulatory_form` (`/lender/reports/regulatory?form=error|review|success|failure`, W2987–W2990) — the 4c `kcc_form` shape: a form chain
//     with no form, its own mailbox sentence for a lender that needs data for a filing of its own; no state claims a confirm page;
//   • `regulatory_act` (`?act=`, W2991–W2993) — Retry re-reads nothing.
// Each state prints its page's founder-approved statement first, its own sentence, its refusals BY NAME, and ONE link back to the TRIGGERING
// page. No form, no input, no act, no figure.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { SettlementRefusals } from './InsurerChain6';
import { chain6ById, type Chain6Id } from '../../features/partner6/refusals';

/** The PARTNER-6 refusal list printed on one surface (the same component the settlement pages use — it is keyed by surface only). */
export const Refusals6 = SettlementRefusals;

export function LenderChain6({ t, chain, state, mailbox }: { t: Tr; chain: Chain6Id; state: string; mailbox?: Mailbox }) {
  const c = chain6ById(chain);
  const k = c.key(state);
  const href = c.page;
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {c.mailbox && (
        <div data-kv-export-note="true">
          <p>{t.t(c.mailboxKey ?? 'partner4.export.notAvailable')}</p>
          {mailbox && <MailboxLine t={t} mailbox={mailbox} />}
        </div>
      )}
      <Refusals6 t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-back={href}>{t.t('partner6.chain.back')}</Link></p>
    </section>
  );
}
