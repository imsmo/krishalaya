// apps/web-partner/src/components/partner3/InsurerClaimsChain.tsx · PC-56 PARTNER-3a — ONE DECOR / PARITY-DECOR chain page of the claims console
// (W2855–W2859), a query state of its parent page (`/insurer/claims?act=confirm` …): the claim mutate chain says a re-read writes nothing and
// that nothing is taken, decided or paid here (PARITY-DECOR; "Take next" DECOR); the claim export chain says exports are not available from the
// partner console yet — write to the partners mailbox — and prints the mailbox FACT (lib/partners-mailbox.ts; never a literal). Each state prints
// its refusals by name and links back to ITS OWN page (never the canon's "Back → W252" from W253 / W264 — DELTA chain_returns). No form, no act.
// Also the claims surfaces' refusal list (`ClaimsRefusals`), printed BY NAME from features/partner3/refusals.ts.
//
// PC-56 PARTNER-3b — the six 3b act chains (W2866–W2868, W2904–W2906, W2934–W2936, W3014–W3016) are DECOR with ONE state: `?act=confirm`,
// whose body is the founder's own sentence, keyed exactly `partner3.chain.act3b.confirm` (`statement: true` on the chain), under the shared 3b
// chain title. There is no success and no failure state to reach, because nothing is ever attempted.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import type { Mailbox } from '../partner1/HelpView';
import { MailboxLine } from '../partner1/MailboxLine';
import { chain3ById, PARTNER3_REFUSALS, type Chain3Id, type Partner3Surface } from '../../features/partner3/refusals';

export function ClaimsRefusals({ t, surface }: { t: Tr; surface: Partner3Surface }) {
  const rows = PARTNER3_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('partner3.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function InsurerClaimsChain({ t, chain, state, back, mailbox }: { t: Tr; chain: Chain3Id; state: string; back?: string; mailbox?: Mailbox }) {
  const c = chain3ById(chain);
  const k = c.key(state);
  // a claim's own chain links back to that claim (the page passes it); without one, to the queue — never a route pattern like `[id]`
  const href = back ?? (c.page.includes('[id]') ? c.page.slice(0, c.page.indexOf('/[id]')) : c.page);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-state={state} role="status">
      <h1>{t.t(c.statement ? 'partner3.chain.act3b.title' : `${k}.title`)}</h1>
      {c.statement
        ? <p className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>
        : <p>{t.t(`${k}.body`)}</p>}
      {c.mailbox && (
        <div data-kv-export-note="true">
          <p>{t.t('partner3.export.notAvailable')}</p>
          {mailbox && <MailboxLine t={t} mailbox={mailbox} />}
        </div>
      )}
      <ClaimsRefusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-back={href}>{t.t('partner3.chain.back')}</Link></p>
    </section>
  );
}
