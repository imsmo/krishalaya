// apps/web-ops/src/components/ops2/Ops2Chain.tsx · PC-56 OPS-2c — ONE DECOR chain page (W3350–W3354 on `/warehouse/billing`, W3360–W3361 on
// `/warehouse/insights`), a query state of its parent page (the OPS-1 `Ops1Chain` shape). Each state prints the page's founder-approved statement
// first, its own sentence (nothing queued, nothing to confirm, nothing ran, nothing attempted), its refusals BY NAME — the canon's zero-sum sentence
// among them, refused with its own words and NEVER printed — and links back to the TRIGGERING page. No form, no act, no money.
// Also the surfaces' refusal list (`Ops2Refusals`), printed BY NAME from features/ops2/refusals.ts.
// PC-56 OPS-2b: the same component prints the 2b chains — the REAL assay act chain (W3297–W3299: the confirm state carries the record form as its
// child, the failure state the server's named reason) and the DECOR assay export / enwr chains. `back` is the page that opened the chain when that
// page carries its own ids (W372 / W373: `features/ops2/receipts.ts` chain2bBack); otherwise the chain's page.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { chain2ById, OPS2_REFUSALS, type Chain2Id, type Ops2Surface, type Tr } from '../../features/ops2/refusals';

export function Ops2Refusals({ t, surface }: { t: Tr; surface: Ops2Surface }) {
  const rows = OPS2_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('ops2.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Ops2Chain({ t, chain, state, back, children }: { t: Tr; chain: Chain2Id; state: string; back?: string; children?: ReactNode }) {
  const c = chain2ById(chain);
  const k = c.key(state);
  const href = back ?? c.page;
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {children}
      <Ops2Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={href} data-kv-back={href}>{t.t('ops2.chain.back')}</Link></p>
    </section>
  );
}
