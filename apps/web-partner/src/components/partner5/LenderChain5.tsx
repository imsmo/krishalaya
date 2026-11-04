// apps/web-partner/src/components/partner5/LenderChain5.tsx · PC-56 PARTNER-5a — ONE DECOR / PARITY-DECOR chain page of the arrears pages
// (W2929–W2930, W2931–W2933, W3024–W3025, W3026–W3028), a query state of its parent page (`/lender/portfolio/aging?act=confirm` …):
//   • the two export chains (`?export=`) are DECOR — exports are not available from the partner console yet; write to the partners mailbox,
//     and the mailbox FACT is read at runtime (lib/partners-mailbox.ts; never a literal, the brand guard scans for one);
//   • the two mutate chains (`?act=`) are PARITY-DECOR — the only trigger is Retry, a genuine re-read of the same definer; no confirm step,
//     no audit row of its own, no money.
// Each state prints its refusals BY NAME and links back to the page it was opened FROM. No form, no act. The shape of partner4/LenderChain.
// Also the arrears surfaces' refusal list (`LenderRefusals5`), printed BY NAME from features/partner5/refusals.ts.
// PC-56 PARTNER-5b adds the four DECOR chains of the three honest collections pages (W2914–W2917 `?form=`, W2918–W2920 `?act=`, the case
// page's `?act=` and W2999–W3001 `?act=`). Each prints its page's founder-approved statement first (the 4c `statement` precedent), never a
// mailbox line (the collections form chain must not offer to relay anything), and links back to the TRIGGERING page — a record's own page
// passes `back`; without one, a pattern page falls back to its list page, never to a route pattern like `[id]`.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { chain5ById, PARTNER5_REFUSALS, type Chain5Id, type Partner5Surface } from '../../features/partner5/refusals';

export function LenderRefusals5({ t, surface }: { t: Tr; surface: Partner5Surface }) {
  const rows = PARTNER5_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('partner4.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function LenderChain5({ t, chain, state, mailbox, back }: { t: Tr; chain: Chain5Id; state: string; mailbox?: Mailbox; back?: string }) {
  const c = chain5ById(chain);
  const k = c.key(state);
  const href = back ?? (c.page.includes('[id]') ? c.page.slice(0, c.page.indexOf('/[id]')) : c.page);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      {c.statement && <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>}
      <p>{t.t(`${k}.body`)}</p>
      {c.mailbox && (
        <div data-kv-export-note="true">
          <p>{t.t('partner4.export.notAvailable')}</p>
          {mailbox && <MailboxLine t={t} mailbox={mailbox} />}
        </div>
      )}
      <LenderRefusals5 t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-back={href}>{t.t('partner4.chain.back')}</Link></p>
    </section>
  );
}
