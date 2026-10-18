// apps/web-partner/src/components/partner2/InsurerChain.tsx · PC-56 PARTNER-2a — ONE DECOR / PARITY-DECOR chain page of the insurer console
// (W2869–W2875, W2881–W2890): a query state of its parent page (`/insurer/products?form=review` …). It says what is TRUE of that step — products
// are authored by the platform, a re-read writes nothing, no export or document exists, nothing is issued / cancelled / endorsed here — prints
// the chain's refusals by name, and links back to ITS OWN page (never the canon's "Back → W245" or "Retry — back to confirm": DELTA
// chain_back_defect). No form, no act, nothing written.
// PC-56 PARTNER-2b: a chain of an honest page prints that page's founder-approved statement first (issuance, premiums, reports, parametric);
// an export / pack chain (founder 2b-1) prints "exports are not available from the partner console yet; write to the partners mailbox" and
// the mailbox FACT (lib/partners-mailbox.ts — never a literal), when the page passes it.
// PC-56 PARTNER-2c: the lender's shelf reuses this chain page for W2980–W2986 (`lender_form` prints "write to the partners mailbox to propose a
// change" above the fact — the chain's `mailboxKey`).
import Link from 'next/link';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { InsurerRefusals } from './InsurerRefusals';
import { chain2ById, type Chain2Id } from '../../features/partner2/refusals';

export function InsurerChain({ t, chain, state, back, mailbox }: { t: Tr; chain: Chain2Id; state: string; back?: string; mailbox?: Mailbox }) {
  const c = chain2ById(chain);
  const k = c.key(state);
  // a policy's own chain links back to that policy (the page passes it); without one, to the list — never a route pattern like `[id]`
  const href = back ?? (c.page.includes('[id]') ? c.page.slice(0, c.page.indexOf('/[id]')) : c.page);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      {c.statement && <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>}
      <p>{t.t(`${k}.body`)}</p>
      {c.mailbox && (
        <div data-kv-export-note="true">
          <p>{t.t(c.mailboxKey ?? 'partner2.export.notAvailable')}</p>
          {mailbox && <MailboxLine t={t} mailbox={mailbox} />}
        </div>
      )}
      <InsurerRefusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-back={href}>{t.t('partner2.chain.back')}</Link></p>
    </section>
  );
}
