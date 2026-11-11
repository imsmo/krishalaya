// apps/web-gov/src/components/gov4/VerificationViews.tsx · PC-56 GOV-4a — W335 (`/verification`, "Field visits") and its chains, presentational
// (rendered by app/verification/page.tsx and by the render tests). Gov4Chain also renders GOV-4b's /access chains (Back → /access). GOV-4 Q1-A, Q2-A, Q3-A and Q5-A (lead-applied; the founder may reopen).
//
// THE PAGE takes NO data but the signed-in authority's name (`me`, the shell's own read): there is nothing about a field visit, a farm, a
// farmer, an officer or a payment that it could print. Q2's, Q1's, Q3's and Q5's sentences verbatim and the download sentence; "What this
// console does not do" names W335's acts and W336, W337 and W338's features once each, in plain words; the refusals BY NAME. No list, table,
// count, form, button or write; the chains are reached by address only (all DECOR). All copy via i18n; no inline styles; no physical direction.
import type { GovMe } from '@krishalaya/sdk-js';
import { chain4ById, GOV4_NOT_DONE, GOV4_REFUSALS, type Chain4Id, type Gov4Surface, type Tr } from '../../features/gov4/refusals';

/** The page's sentences, in the order printed (Q2 first: what this page is about). */
export const GOV4_STATEMENTS = ['gov4.q2', 'gov4.q1', 'gov4.q3', 'gov4.q5'] as const;

export function Gov4Refusals({ t, surface }: { t: Tr; surface: Gov4Surface }) {
  const rows = GOV4_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('gov4.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Gov4Chain({ t, chain, state }: { t: Tr; chain: Chain4Id; state: string }) {
  const c = chain4ById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {/* GOV-4b · PARITY-DECOR: the re-read chain's confirm state has ONE more link, and it IS the re-read of the page that opened it. */}
      {c.kind === 'PARITY-DECOR' && state === 'confirm'
        ? <p className="kv-pager"><a className="kv-btn" href={c.back} data-kv-real="reread">{t.t('gov4.chain.reread')}</a></p> : null}
      <Gov4Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><a className="kv-btn kv-btn--muted" href={c.back} data-kv-back={c.back}>{t.t(c.backKey)}</a></p>
    </section>
  );
}

export function VerificationView({ t, me }: { t: Tr; me: GovMe | null }) {
  return (
    <section data-kv-page="verification">
      <h1>{t.t('gov4.verification.title')}</h1>
      {me ? <p className="kv-muted" data-kv-signed-in="">{t.t('gov1.dash.signedIn', { authority: me.authority?.name ?? t.t('common.dash') })}</p> : null}
      {GOV4_STATEMENTS.map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
      <section className="kv-card" data-kv-not-done="" aria-labelledby="kv-not-done">
        <h2 id="kv-not-done" className="kv-card__title">{t.t('gov4.notDone.title')}</h2>
        <ul>{GOV4_NOT_DONE.map((n) => <li key={n.id} data-kv-not-done-item={n.id}>{t.t(n.key)}</li>)}</ul>
      </section>
      <p className="kv-statement" data-kv-statement="gov4.download">{t.t('gov4.download')}</p>
      <Gov4Refusals t={t} surface="verification" />
    </section>
  );
}
