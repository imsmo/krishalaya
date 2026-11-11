// apps/web-gov/src/components/gov5/MgnregaViews.tsx · PC-56 GOV-5a — W345 (`/mgnrega`, "MGNREGA") and its chains, presentational (rendered by
// app/mgnrega/page.tsx and by the render tests). GOV-5 Q1-A, Q2-A and Q3-A (lead-applied; the founder may reopen).
//
// THE PAGE takes NO data but the signed-in authority's name (`me`, the shell's own read): there is nothing about a job card, a worker, a
// household, a day of attendance, a worksite, a demand for work or a wage that it could print. Q3's, Q2's and Q1's sentences verbatim and the
// download sentence; "What this console does not do" names W345's acts and W346, W347, W348 and W440's features once each, in plain words; the
// refusals BY NAME. GOV-5b adds the sections "Wages" (W349, Q1-A) and "Social audit" (W350, Q5-A). No list, table, count, form, button or write; the chains are reached by address only. All copy via i18n; no inline styles;
// no physical direction.
import type { GovMe } from '@krishalaya/sdk-js';
import { chain5ById, GOV5_NOT_DONE, GOV5_REFUSALS, GOV5_SECTIONS_5B, type Chain5Id, type Gov5Surface, type Tr } from '../../features/gov5/refusals';

/** The page's opening sentences, in the order printed (Q3 first: whose register MGNREGA's is). Q1's (the wage sentence) heads the
 *  GOV-5b section "Wages" and Q5's the section "Social audit" (GOV5_SECTIONS_5B) — each printed once. */
export const GOV5_STATEMENTS = ['gov5.q3', 'gov5.q2'] as const;

export function Gov5Refusals({ t, surface }: { t: Tr; surface: Gov5Surface }) {
  const rows = GOV5_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('gov5.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Gov5Chain({ t, chain, state }: { t: Tr; chain: Chain5Id; state: string }) {
  const c = chain5ById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {/* PARITY-DECOR: a re-read chain's confirm state has ONE more link, and it IS the re-read of /mgnrega. */}
      {c.kind === 'PARITY-DECOR' && state === 'confirm'
        ? <p className="kv-pager"><a className="kv-btn" href={c.back} data-kv-real="reread">{t.t('gov5.chain.reread')}</a></p> : null}
      <Gov5Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><a className="kv-btn kv-btn--muted" href={c.back} data-kv-back={c.back}>{t.t('gov5.chain.back')}</a></p>
    </section>
  );
}

export function MgnregaView({ t, me }: { t: Tr; me: GovMe | null }) {
  return (
    <section data-kv-page="mgnrega">
      <h1>{t.t('gov5.mgnrega.title')}</h1>
      {me ? <p className="kv-muted" data-kv-signed-in="">{t.t('gov1.dash.signedIn', { authority: me.authority?.name ?? t.t('common.dash') })}</p> : null}
      {GOV5_STATEMENTS.map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
      <section className="kv-card" data-kv-not-done="" aria-labelledby="kv-not-done">
        <h2 id="kv-not-done" className="kv-card__title">{t.t('gov5.notDone.title')}</h2>
        <ul>{GOV5_NOT_DONE.map((n) => <li key={n.id} data-kv-not-done-item={n.id}>{t.t(n.key)}</li>)}</ul>
      </section>
      {/* GOV-5b: W349 "Wages" (Q1-A) and W350 "Social audit" (Q5-A) — a statement, each feature named once as not done, the refusals. */}
      {GOV5_SECTIONS_5B.map((s) => (
        <section key={s.id} className="kv-card" data-kv-not-done="" data-kv-section={s.id} aria-labelledby={`kv-section-${s.id}`}>
          <h2 id={`kv-section-${s.id}`} className="kv-card__title">{t.t(s.title)}</h2>
          <p className="kv-statement" data-kv-statement={s.statement}>{t.t(s.statement)}</p>
          <ul>{s.items.map((n) => <li key={n.id} data-kv-not-done-item={n.id}>{t.t(n.key)}</li>)}</ul>
          <Gov5Refusals t={t} surface={s.surface} />
        </section>
      ))}
      <p className="kv-statement" data-kv-statement="gov5.download">{t.t('gov5.download')}</p>
      <Gov5Refusals t={t} surface="mgnrega" />
    </section>
  );
}
