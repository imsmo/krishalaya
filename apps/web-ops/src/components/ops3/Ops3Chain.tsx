// apps/web-ops/src/components/ops3/Ops3Chain.tsx · PC-56 OPS-3c — ONE chain page of the rate card (W3338–W3339 DECOR, W3340–W3342 PARITY-DECOR),
// a query state of `/rates` (the OPS-1 `Ops1Chain` / OPS-2 `Ops2Chain` shape). Each state prints the page's statement first ("Rates are changed on
// your organisation's dairy console, not here."), its own sentence (nothing queued, nothing made, nothing changed), its refusals BY NAME — the
// canon's zero-sum sentence among them, refused with its own words and NEVER printed — and links back to `/rates`. No form, no act, no money.
// Also the surfaces' refusal list (`Ops3Refusals`), printed BY NAME from features/ops3/refusals.ts.
import Link from 'next/link';
import { chain3ById, OPS3_REFUSALS, type Chain3Id, type Ops3Surface, type Tr } from '../../features/ops3/refusals';

export function Ops3Refusals({ t, surface }: { t: Tr; surface: Ops3Surface }) {
  const rows = OPS3_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('ops3.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Ops3Chain({ t, chain, state }: { t: Tr; chain: Chain3Id; state: string }) {
  const c = chain3ById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {/* PARITY-DECOR: the confirm state's one link IS the re-read (W3340 "Proceed" is reading the cards again). */}
      {c.kind === 'PARITY-DECOR' && state === 'confirm'
        ? <p className="kv-pager"><Link className="kv-btn" href={c.page} data-kv-real="reread">{t.t('ops3.chain.reread')}</Link></p> : null}
      <Ops3Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={c.page} data-kv-back={c.page}>{t.t('ops3.chain.back')}</Link></p>
    </section>
  );
}
