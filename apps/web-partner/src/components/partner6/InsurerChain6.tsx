// apps/web-partner/src/components/partner6/InsurerChain6.tsx · PC-56 PARTNER-6a — ONE DECOR chain page of the settlement chain (W2901–W2903), a
// query state of its parent page (`/insurer/settlements?act=confirm` …, and the same chain on a claim's settlement page with `files: []`).
// Each state prints its page's founder-approved statement first, its own sentence (nothing is released, nothing succeeded, nothing was
// attempted), its refusals BY NAME — W2902's zero-sum sentence among them, refused with its own words and NEVER printed — and links back to
// the TRIGGERING page: a claim's own settlement page passes `back`; without one, a pattern page falls back to its list page, never to a route
// pattern like `[id]` (and never to W260 from W261 — the canon's defect). No form, no act, no money, no mailbox.
// Also the settlement surfaces' refusal list (`SettlementRefusals`), printed BY NAME from features/partner6/refusals.ts.
import Link from 'next/link';
import type { Tr } from '../NotYet';
import { chain6ById, PARTNER6_REFUSALS, type Chain6Id, type Partner6Surface } from '../../features/partner6/refusals';

export function SettlementRefusals({ t, surface }: { t: Tr; surface: Partner6Surface }) {
  const rows = PARTNER6_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('partner6.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function InsurerChain6({ t, chain, state, back }: { t: Tr; chain: Chain6Id; state: string; back?: string }) {
  const c = chain6ById(chain);
  const k = c.key(state);
  const href = back ?? (c.page.includes('[id]') ? c.page.slice(0, c.page.indexOf('/[id]')) : c.page);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      <SettlementRefusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-back={href}>{t.t('partner6.chain.back')}</Link></p>
    </section>
  );
}
