// apps/web-gov/src/components/gov1/Gov1Chain.tsx · PC-56 GOV-1a — ONE state of a GOV-1a chain, a query state (`?act=`) of the page that opened
// it (the web-ops Ops5Chain shape). The login chain (W3229–W3232) is REAL except its review state (DECOR); the access chain (W3198–W3200) is
// REAL from "Request a role", approve and remove, and PARITY-DECOR from the error state's "Retry" (the confirm state's one link IS a re-read).
// Every state prints its refusals BY NAME (the canon's shared chain sentences among them, refused in their own words and NEVER printed) and
// links Back to the page that opened it — `CHAIN_BACK`, one place: the login chain → /login, never the dashboard (the canon's defect).
import type { ReactNode } from 'react';
import { CHAIN_BACK, chain1ById, GOV1_REFUSALS, type Chain1Id, type Gov1Surface, type Tr } from '../../features/gov1/refusals';

export function Gov1Refusals({ t, surface }: { t: Tr; surface: Gov1Surface }) {
  const rows = GOV1_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('gov1.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Gov1Chain({ t, chain, state, children }: { t: Tr; chain: Chain1Id; state: string; children?: ReactNode }) {
  const c = chain1ById(chain);
  const k = c.key(state);
  const back = CHAIN_BACK[chain];
  const kind = c.decorStates.includes(state) ? 'DECOR' : c.kind;
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {children}
      {/* PARITY-DECOR: the confirm state's one link IS the re-read of the page that opened it. */}
      {c.kind === 'PARITY-DECOR' && state === 'confirm'
        ? <p className="kv-pager"><a className="kv-btn" href={back} data-kv-real="reread">{t.t(c.rereadKey)}</a></p> : null}
      <Gov1Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><a className="kv-btn kv-btn--muted" href={back} data-kv-back={back}>{t.t(c.backKey)}</a></p>
    </section>
  );
}
