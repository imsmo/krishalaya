// apps/web-gov/src/components/gov6/DashboardSections.tsx · PC-56 GOV-6a — W333 ("Analytics") and W357 ("Reports") as sections of `/dashboard`,
// and their chains, presentational (rendered by components/gov1/DashboardViews.tsx, app/dashboard/page.tsx and the render tests). GOV-6 Q1-A,
// Q4-A and Q5-A (lead-applied; the founder may reopen).
//
// THE SECTIONS take NOTHING but the translator: they are given no overview, no count and no person, so they cannot sum, relabel or derive a
// number from what /dashboard prints (F-5, E4) — they print no number at all. Q1's sentence, the "now" said in words, what this console does
// not count, Q5's sentence ("Analytics"); Q4's sentence and what this console does not do ("Reports"); the refusals BY NAME. No list of data,
// table, count, form, button or write; the chains are reached by address only. All copy via i18n; no inline styles; no physical direction.
import { chain6ById, GOV6_REFUSALS, GOV6_SECTIONS_6A, type Chain6Id, type Gov6Surface, type Tr } from '../../features/gov6/refusals';

export function Gov6Refusals({ t, surface }: { t: Tr; surface: Gov6Surface }) {
  const rows = GOV6_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('gov6.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

/** /dashboard's sections "Analytics" (W333) and "Reports" (W357): the same words in every state of the page. */
export function Gov6DashboardSections({ t }: { t: Tr }) {
  return (
    <>
      {GOV6_SECTIONS_6A.map((s) => (
        <section key={s.id} className="kv-card" data-kv-section={s.id} aria-labelledby={`kv-section-${s.id}`}>
          <h2 id={`kv-section-${s.id}`} className="kv-card__title">{t.t(s.title)}</h2>
          <p className="kv-statement" data-kv-statement={s.statement}>{t.t(s.statement)}</p>
          {s.facts.map((k) => <p key={k} className="kv-muted" data-kv-fact={k}>{t.t(k)}</p>)}
          <h3 className="kv-card__title">{t.t(s.listTitle)}</h3>
          <ul data-kv-not-done="">{s.items.map((n) => <li key={n.id} data-kv-not-done-item={n.id}>{t.t(n.key)}</li>)}</ul>
          {s.closing ? <p className="kv-statement" data-kv-statement={s.closing}>{t.t(s.closing)}</p> : null}
          <Gov6Refusals t={t} surface={s.surface} />
        </section>
      ))}
    </>
  );
}

export function Gov6Chain({ t, chain, state }: { t: Tr; chain: Chain6Id; state: string }) {
  const c = chain6ById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {/* PARITY-DECOR: a re-read chain's confirm state has ONE more link, and it IS the re-read of /dashboard. */}
      {c.kind === 'PARITY-DECOR' && state === 'confirm'
        ? <p className="kv-pager"><a className="kv-btn" href={c.back} data-kv-real="reread">{t.t('gov6.chain.reread')}</a></p> : null}
      <Gov6Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><a className="kv-btn kv-btn--muted" href={c.back} data-kv-back={c.back}>{t.t('gov6.chain.back')}</a></p>
    </section>
  );
}
