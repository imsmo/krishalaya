// apps/web-ops/src/components/ops5/Ops5Chain.tsx · PC-56 OPS-5a — ONE state of the alert chain (W3292–W3294), a query state (`?act=`) of the page
// that opened it (the Ops4Chain shape). Opened from W402 it is REAL: `children` carries the change form, the proposal with confirm / withdraw, or the
// server's own answer; its statement is Q3-A's sentence. Opened from W403 it is PARITY-DECOR: the confirm state's one link IS a re-read of the
// breach; its statement is Q1-A's sentence; nothing is written. Every state prints its refusals BY NAME (the canon's zero-sum and on-call sentences
// among them, refused with their own words and NEVER printed) and links Back to the page that opened it — W403's chain returns to W403, never W402.
// NAMED UPDATE (PC-56 OPS-5b): the Back and re-read labels come from the chain's own definition (5a's two keep their words); the two insights
// chains render here too — the export (REAL: `children` carries the plane's job — queued or ready) and the re-read (PARITY-DECOR, Back → W369).
import Link from 'next/link';
import type { ReactNode } from 'react';
import { chain5ById, OPS5_REFUSALS, type Chain5Id, type Ops5Surface, type Tr } from '../../features/ops5/refusals';

export function Ops5Refusals({ t, surface }: { t: Tr; surface: Ops5Surface }) {
  const rows = OPS5_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('ops5.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Ops5Chain({ t, chain, state, page, children }: { t: Tr; chain: Chain5Id; state: string; page: string; children?: ReactNode }) {
  const c = chain5ById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {children}
      {/* PARITY-DECOR: the confirm state's one link IS the re-read of the page that opened it (from W403: the same breach). */}
      {c.kind === 'PARITY-DECOR' && state === 'confirm'
        ? <p className="kv-pager"><Link className="kv-btn" href={page} data-kv-real="reread">{t.t(c.rereadKey)}</Link></p> : null}
      <Ops5Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href={page} data-kv-back={page}>{t.t(c.backKey)}</Link></p>
    </section>
  );
}
