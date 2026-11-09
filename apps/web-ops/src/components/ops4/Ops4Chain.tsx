// apps/web-ops/src/components/ops4/Ops4Chain.tsx · PC-56 OPS-4a — ONE chain page of the hire desk: the chc mutate chain (W3304–W3306) and the
// equipment mutate chain (W3318–W3320), PARITY-DECOR, each a query state (`?act=`) of the page that opened it (the Ops3Chain shape). Each state
// prints the statement first ("This console only reads machine hire."), its own sentence (nothing changed), its refusals BY NAME — the canon's
// zero-sum sentence among them, refused with its own words and NEVER printed — and links Back to the page that opened it. The confirm state's
// one link IS a re-read of that page; when the opener reads nothing (W409) the chain says there is nothing to read again and offers no re-read
// (DECOR). No form, no act, no money. Also the surfaces' refusal list (`Ops4Refusals`), printed BY NAME from features/ops4/refusals.ts.
import Link from 'next/link';
import { chain4ById, OPS4_REFUSALS, type Chain4Id, type Ops4Surface, type Tr } from '../../features/ops4/refusals';

export function Ops4Refusals({ t, surface }: { t: Tr; surface: Ops4Surface }) {
  const rows = OPS4_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('ops4.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Ops4Chain({ t, chain, state, page, reads = true }: { t: Tr; chain: Chain4Id; state: string; page: string; reads?: boolean }) {
  const c = chain4ById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={reads ? c.kind : 'DECOR'} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(reads ? `${k}.body` : 'ops4.chain.readsNothing')}</p>
      {/* PARITY-DECOR: the confirm state's one link IS the re-read (W3304 / W3318 "Proceed" is reading the page again). */}
      {reads && state === 'confirm'
        ? <p className="kv-pager"><Link className="kv-btn" href={page} data-kv-real="reread">{t.t('ops4.chain.reread')}</Link></p> : null}
      <Ops4Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={page} data-kv-back={page}>{t.t('ops4.chain.back')}</Link></p>
    </section>
  );
}
