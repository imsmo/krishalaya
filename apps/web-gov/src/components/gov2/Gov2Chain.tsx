// apps/web-gov/src/components/gov2/Gov2Chain.tsx · PC-56 GOV-2b — ONE state of a GOV-2b chain, a query state (`?do=…&act=`) of the page that
// opened it (the Gov1Chain shape). The authoring chains (scheme form, scheme send, rule form, rule removal) are DECOR in every state —
// refused BY NAME, no form, no input, nothing sent (Q5-A); the re-read chains (opened by an error state's Retry) are PARITY-DECOR — the
// confirm state's one link IS the re-read of the page that opened it. Every state prints Q5-A's sentence and its refusals BY NAME (the
// canon's shared chain sentences refused in their own words, NEVER printed) and links Back to the page that opened it (`back`, from
// `chain2Back`: a chain opened on a scheme returns to THAT scheme, never the list). All copy via i18n; no inline styles.
import type { ReactNode } from 'react';
import { chain2ById, GOV2_REFUSALS, type Chain2Id, type Gov2Surface, type Tr } from '../../features/gov2/refusals';

export function Gov2Refusals({ t, surface }: { t: Tr; surface: Gov2Surface }) {
  const rows = GOV2_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('gov2.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Gov2Chain({ t, chain, state, back, children }: { t: Tr; chain: Chain2Id; state: string; back: string; children?: ReactNode }) {
  const c = chain2ById(chain);
  const k = c.key(state);
  const backKey = back === '/schemes' ? 'gov2.chain.backList' : 'gov2.chain.backScheme';
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {children}
      {/* PARITY-DECOR: the confirm state's one link IS the re-read of the page that opened it. */}
      {c.kind === 'PARITY-DECOR' && state === 'confirm'
        ? <p className="kv-pager"><a className="kv-btn" href={back} data-kv-real="reread">{t.t(c.rereadKey)}</a></p> : null}
      <Gov2Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><a className="kv-btn kv-btn--muted" href={back} data-kv-back={back}>{t.t(backKey)}</a></p>
    </section>
  );
}
