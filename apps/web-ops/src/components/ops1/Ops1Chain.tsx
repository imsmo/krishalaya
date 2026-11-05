// apps/web-ops/src/components/ops1/Ops1Chain.tsx · PC-56 OPS-1a — ONE DECOR chain page (W3332–W3334 on `/payout`, W3369–W3371 on
// `/warehouse/withdrawal`), a query state of its parent page. Each state prints the page's founder-approved statement first, its own sentence
// (nothing to confirm, nothing was done, nothing was attempted), its refusals BY NAME — the canon's zero-sum sentence among them, refused with
// its own words and NEVER printed — and links back to the TRIGGERING page. No form, no act, no money.
// PC-56 OPS-1b: the same component prints the REAL aeps chain's success and failure states (W3290, W3291 on `/aeps/withdrawal`) — the
// record act's own result, with the server's named reason as its child on failure; its confirm state (W3289) is the record form itself
// (AepsRecordView mode 'confirm'). Back is always the chain's page (`/aeps/withdrawal`), never W393.
// Also the surfaces' refusal list (`Ops1Refusals`), printed BY NAME from features/ops1/refusals.ts.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { chain1ById, OPS1_REFUSALS, type Chain1Id, type Ops1Surface, type Tr } from '../../features/ops1/refusals';

export function Ops1Refusals({ t, surface }: { t: Tr; surface: Ops1Surface }) {
  const rows = OPS1_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('ops1.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Ops1Chain({ t, chain, state, children }: { t: Tr; chain: Chain1Id; state: string; children?: ReactNode }) {
  const c = chain1ById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {children}
      <Ops1Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn" href={c.page} data-kv-back={c.page}>{t.t('ops1.chain.back')}</Link></p>
    </section>
  );
}
