// apps/web-gov/src/components/gov6/AccessSections.tsx · PC-56 GOV-6b — W334 ("The record") and W351–W354 ("Outside bodies") as sections of
// `/access` (W359's page, GOV-1a; beside GOV-4b's "Sign-ins"), presentational (rendered by components/gov1/AccessViews.tsx and the render
// tests). GOV-6 Q2-A and Q3-A (lead-applied; the founder may reopen); Q4-A's sentence (GOV-6a's key) printed ONCE on /access, here.
//
// THE SECTIONS take NOTHING but the translator: they are given no member, no record row, no reader, no name, no time, no figure — so no
// opening, step, official, outside body or digest can reach the markup. Q2's sentence, what this console does not do, Q4's sentence ("The
// record"); Q3's sentence and what this console does not do ("Outside bodies"); the refusals BY NAME. No list of data, table, count, form,
// button or link; the chains are reached by address only (components/gov6/DashboardSections.tsx Gov6Chain). All copy via i18n; no inline
// styles; no physical direction.
import { GOV6_SECTIONS_6B, type Tr } from '../../features/gov6/refusals';
import { Gov6Refusals } from './DashboardSections';

/** /access's sections "The record" (W334) and "Outside bodies" (W351–W354): the same words in every state of the page. */
export function Gov6AccessSections({ t }: { t: Tr }) {
  return (
    <>
      {GOV6_SECTIONS_6B.map((s) => (
        <section key={s.id} className="kv-card" data-kv-section={s.id} aria-labelledby={`kv-section-${s.id}`}>
          <h2 id={`kv-section-${s.id}`} className="kv-card__title">{t.t(s.title)}</h2>
          <p className="kv-statement" data-kv-statement={s.statement}>{t.t(s.statement)}</p>
          <h3 className="kv-card__title">{t.t(s.listTitle)}</h3>
          <ul data-kv-not-done="">{s.items.map((n) => <li key={n.id} data-kv-not-done-item={n.id}>{t.t(n.key)}</li>)}</ul>
          {s.closing ? <p className="kv-statement" data-kv-statement={s.closing}>{t.t(s.closing)}</p> : null}
          <Gov6Refusals t={t} surface={s.surface} />
        </section>
      ))}
    </>
  );
}
