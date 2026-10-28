// apps/web-partner/src/components/partner4/LenderChain.tsx · PC-56 PARTNER-4a — ONE DECOR / PARITY-DECOR chain page of the lending console
// (W2876–W2877, W2878–W2880, W2891–W2892, W2893–W2895), a query state of its parent page (`/lender/queue?act=confirm` …):
//   • the loan mutate chain (`?act=`) is PARITY-DECOR — Retry is a re-read, "Take next" and "Request clarification" are DECOR, and nothing
//     is taken, clarified or disbursed here. The canon wires APPROVE and REJECT to this chain too, and those two ARE real: they keep their
//     own forms on the application page, where the Idempotency-Key is minted at render. The chain never pretends to be them;
//   • the two export chains (`?export=`) are DECOR — exports are not available from the partner console yet; write to the partners mailbox,
//     and the mailbox FACT is read at runtime (lib/partners-mailbox.ts; never a literal, the brand guard scans for one).
// Each state prints its refusals BY NAME and links back to ITS OWN page — never the canon's "Back → W206" from W207 and W215, and never the
// loan export chain's crumb, which names W206 although W215's button is its only trigger (DELTA `chain_returns`). No form, no act.
// Also the lending surfaces' refusal list (`LenderRefusals`), printed BY NAME from features/partner4/refusals.ts.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { chain4ById, PARTNER4_REFUSALS, type Chain4Id, type Partner4Surface } from '../../features/partner4/refusals';

export function LenderRefusals({ t, surface }: { t: Tr; surface: Partner4Surface }) {
  const rows = PARTNER4_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('partner4.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function LenderChain({ t, chain, state, back, mailbox }: { t: Tr; chain: Chain4Id; state: string; back?: string; mailbox?: Mailbox }) {
  const c = chain4ById(chain);
  const k = c.key(state);
  // a record's own chain links back to THAT record (the page passes it); without one, to the chain's own list page —
  // never a route pattern like `[id]`
  const href = back ?? (c.page.includes('[id]') ? c.page.slice(0, c.page.indexOf('/[id]')) : c.page);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p>{t.t(`${k}.body`)}</p>
      {c.mailbox && (
        <div data-kv-export-note="true">
          <p>{t.t('partner4.export.notAvailable')}</p>
          {mailbox && <MailboxLine t={t} mailbox={mailbox} />}
        </div>
      )}
      <LenderRefusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-back={href}>{t.t('partner4.chain.back')}</Link></p>
    </section>
  );
}

/** The partner console switched off (`partner_console`): PARTNER-0's own words. There is no lending equivalent — the platform's `fintech`
 *  flag is a TENANT module switch the partner realm deliberately does not consult (survey F-20 / E5), so a lending page can never honestly
 *  say "lending is switched off on the platform" the way an insurer page says it of `insurance`. Never "unavailable". */
export function LenderSwitchedOff({ t, page }: { t: Tr; page: string }) {
  return (
    <section data-kv-lender={page} data-kv-state="off">
      <h1>{t.t('partner.off.title')}</h1>
      <p className="kv-muted">{t.t('partner.off.body')}</p>
    </section>
  );
}
