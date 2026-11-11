// apps/web-gov/src/components/gov3/DbtViews.tsx · PC-56 GOV-3a — W332 (`/dbt`) and its chains, presentational (rendered by app/dbt/page.tsx and
// by the render tests). GOV-3 Q1-A, Q2-A and Q4-A (lead-applied; the founder may reopen).
//
// THE PAGE prints ONLY what `GET /v1/gov/overview` returned (E2): per scheme the authority runs, the server's count of applications approved and
// of applications marked disbursed (GOV-1b's one key — E6), the server's totals for both, and the time the server counted. This file computes
// nothing — no sum, share, rate, average or rank — and holds no money helper (E3). No single payment, farmer, organisation, bank detail or
// payment reference exists in what it is given. Q1's, Q2's and Q4's sentences verbatim; "What this console does not do" names W339, W340 and
// W344's features once each, in plain words. No form, no button, no write: the chains are reached by address (the file and the stop are
// DECOR) or by the error state's Retry (the re-read, PARITY-DECOR). All copy via i18n; no inline styles; no physical direction.
//
// GOV-3b (Q3-A, Q5-A lead-applied): two more sections of the same page, built from the registry alone — "PFMS" (W341, W342: Q5's sentence) and
// "Returned payments" (W343: no row, no count; Q3's sentence) — each with its canon features named once as not done, and its refusals BY NAME.
// They take NO data: nothing about a payment, a farmer or a bank is passed to them, so nothing of the kind can be printed. The 3b chains are
// rendered by Gov3Chain like the 3a ones (Back → /dbt).
import type { GovMe, GovOverview } from '@krishalaya/sdk-js';
import { atUtc } from '../../features/gov1/access';
import { ltrOrNull } from '../../features/rtl/span';
import type { DashState } from '../../features/gov1/dashboard';
import { DISBURSED_KEY } from '../../features/gov2/applications';
import { chain3ById, DBT_BACK, GOV3_NOT_DONE, GOV3_NOT_DONE_3B, GOV3_REFUSALS, GOV3_SECTIONS, type Chain3Id, type Gov3Surface, type Tr } from '../../features/gov3/refusals';

const num = (n: number) => String(n);
const APPROVED_KEY = 'gov1.dash.status.approved';

export function Gov3Refusals({ t, surface, titleKey = 'gov3.refused.title' }: { t: Tr; surface: Gov3Surface; titleKey?: string }) {
  const rows = GOV3_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t(titleKey)}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}

export function Gov3Chain({ t, chain, state }: { t: Tr; chain: Chain3Id; state: string }) {
  const c = chain3ById(chain);
  const k = c.key(state);
  return (
    <section className="kv-card kv-chain" data-kv-chain={chain} data-kv-chain-kind={c.kind} data-kv-chain-state={state} role="status">
      <h1>{t.t(`${k}.title`)}</h1>
      <p className="kv-statement" data-kv-statement={c.statement}>{t.t(c.statement)}</p>
      <p>{t.t(`${k}.body`)}</p>
      {/* PARITY-DECOR: the confirm state's one link IS the re-read of the page that opened it. */}
      {c.kind === 'PARITY-DECOR' && state === 'confirm'
        ? <p className="kv-pager"><a className="kv-btn" href={DBT_BACK} data-kv-real="reread">{t.t('gov3.chain.rereadLink')}</a></p> : null}
      <Gov3Refusals t={t} surface={c.surface} />
      <p className="kv-pager"><a className="kv-btn kv-btn--muted" href={DBT_BACK} data-kv-back={DBT_BACK}>{t.t('gov3.chain.back')}</a></p>
    </section>
  );
}

/** GOV-3b · `/dbt`'s sections "PFMS" (W341, W342) and "Returned payments" (W343): sentences only — no prop carries data. */
export function Gov3Sections({ t }: { t: Tr }) {
  return (
    <>
      {GOV3_SECTIONS.map((sec) => (
        <section key={sec.id} className="kv-card" data-kv-section={sec.id} data-kv-files={sec.files.join(' ')} aria-labelledby={`kv-section-${sec.id}`}>
          <h2 id={`kv-section-${sec.id}`} className="kv-card__title">{t.t(sec.titleKey)}</h2>
          {sec.bodyKey ? <p className="kv-muted" data-kv-empty={sec.id}>{t.t(sec.bodyKey)}</p> : null}
          <p className="kv-statement" data-kv-statement={sec.statement}>{t.t(sec.statement)}</p>
          <ul>{GOV3_NOT_DONE_3B.filter((n) => n.section === sec.id).map((n) => <li key={n.id} data-kv-not-done-item={n.id}>{t.t(n.key)}</li>)}</ul>
          <Gov3Refusals t={t} surface={sec.surface} titleKey="gov3.refused.sectionTitle" />
        </section>
      ))}
    </>
  );
}

export function DbtView({ t, state, me, overview, lang = 'en' }: { t: Tr; state: DashState; me: GovMe | null; overview: GovOverview | null; lang?: string }) {
  const o = state === 'ok' || state === 'no_scheme' ? overview : null;
  return (
    <section data-kv-page="dbt" data-kv-state={state}>
      <h1>{t.t('gov3.dbt.title')}</h1>
      {me ? <p className="kv-muted" data-kv-signed-in="">{t.t('gov1.dash.signedIn', { authority: me.authority?.name ?? t.t('common.dash') })}</p> : null}
      <p className="kv-statement" data-kv-statement="gov3.q1">{t.t('gov3.q1')}</p>
      <p className="kv-statement" data-kv-statement="gov3.q2">{t.t('gov3.q2')}</p>
      {state === 'off' ? <p className="kv-notice" data-kv-notice="off">{t.t('gov1.login.off')}</p> : null}
      {state === 'forbidden' ? <p className="kv-notice" data-kv-notice="forbidden">{t.t('gov1.dash.forbidden')}</p> : null}
      {state === 'error' ? (
        <div className="kv-notice" data-kv-notice="error">
          <p>{t.t('gov1.dash.error')}</p>
          <p className="kv-pager"><a className="kv-btn" href="/dbt?do=reread&act=confirm" data-kv-retry="">{t.t('common.retry')}</a></p>
        </div>
      ) : null}
      {o ? (
        <>
          <p className="kv-muted" data-kv-window={o.window.kind}>{t.t('gov1.dash.window')}</p>
          <p className="kv-muted" data-kv-computed-at={o.computedAt}>{t.t('gov1.dash.computedAt', { at: ltrOrNull(atUtc(o.computedAt), lang) ?? t.t('common.dash') })}</p>
          {state === 'no_scheme' ? <p className="kv-muted" data-kv-empty="no-scheme">{t.t('gov1.dash.noScheme')}</p> : null}
          {o.byScheme.length > 0 ? (
            <>
              <h2 className="kv-card__title">{t.t('gov3.dbt.counts.title')}</h2>
              <table className="kv-table" data-kv-dbt-counts={o.byScheme.length}>
                <thead><tr>
                  <th scope="col">{t.t('gov1.dash.col.scheme')}</th>
                  <th scope="col">{t.t(APPROVED_KEY)}</th>
                  <th scope="col">{t.t(DISBURSED_KEY)}</th>
                </tr></thead>
                <tbody>
                  {o.byScheme.map((r) => (
                    <tr key={r.scheme.code} data-kv-scheme={r.scheme.code}>
                      <th scope="row">{r.scheme.name}</th>
                      <td data-kv-status="approved">{num(r.byStatus.approved ?? 0)}</td>
                      <td data-kv-status="disbursed">{num(r.byStatus.disbursed ?? 0)}</td>
                    </tr>
                  ))}
                  <tr data-kv-totals="">
                    <th scope="row">{t.t('gov3.dbt.allSchemes')}</th>
                    <td data-kv-status="approved">{num(o.totals.byStatus.approved ?? 0)}</td>
                    <td data-kv-status="disbursed">{num(o.totals.byStatus.disbursed ?? 0)}</td>
                  </tr>
                </tbody>
              </table>
              {(o.totals.byStatus.disbursed ?? 0) > 0
                ? <p className="kv-muted" data-kv-fact="disbursed-before">{t.t('gov3.dbt.disbursedBefore')}</p>
                : <p className="kv-muted" data-kv-empty="none-marked">{t.t('gov3.dbt.noneMarked')}</p>}
            </>
          ) : null}
        </>
      ) : null}
      <p className="kv-statement" data-kv-statement="gov3.q4">{t.t('gov3.q4')}</p>
      <section className="kv-card" data-kv-not-done="" aria-labelledby="kv-not-done">
        <h2 id="kv-not-done" className="kv-card__title">{t.t('gov3.notDone.title')}</h2>
        <ul>{GOV3_NOT_DONE.map((n) => <li key={n.id} data-kv-not-done-item={n.id}>{t.t(n.key)}</li>)}</ul>
      </section>
      <Gov3Sections t={t} />
      <Gov3Refusals t={t} surface="dbt" />
    </section>
  );
}
