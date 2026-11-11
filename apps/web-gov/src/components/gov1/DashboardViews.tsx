// apps/web-gov/src/components/gov1/DashboardViews.tsx · PC-56 GOV-1b — W325 (`/dashboard`) and W358 (`/canon/chrome`), presentational (rendered
// by the pages and by the render tests). GOV-1 Q1-A and Q3-A (lead-applied 2026-11-10; the founder may reopen), Q2-A carried.
//
// THE DASHBOARD prints ONLY what `GET /v1/gov/overview` returned: every number is the server's, counted in SQL over the whole set (all time,
// drafts not counted), with the time it counted. This file computes nothing — no total, share, rate, average or rank — and holds no money
// helper. No application id, organisation, applicant or place exists in what it is given. Q1-A's sentence is NOT printed (the government
// axis cannot read credits); Q3-A's is, verbatim, with the fact that this page opens no application.
// THE CHROME CANON states the rules this console keeps; it shows no emblem (none is ever shown) and no image of any kind.
// PC-56 GOV-6a: the dashboard also carries the sections "Analytics" (W333) and "Reports" (W357) — components/gov6/DashboardSections.tsx,
// given ONLY the translator (never the overview), so nothing on this page is summed, relabelled or derived.
// All copy via i18n; no inline styles; no physical direction.
import type { GovMe, GovOverview } from '@krishalaya/sdk-js';
import { Gov1Refusals } from './Gov1Chain';
import { atUtc } from '../../features/gov1/access';
import { DASH_STATUSES, statusKey, type DashState } from '../../features/gov1/dashboard';
import type { Tr } from '../../features/gov1/refusals';
import { ltrOrNull } from '../../features/rtl/span';
import { Gov6DashboardSections } from '../gov6/DashboardSections';

const num = (n: number) => String(n);

export function DashboardView({ t, state, me, overview, lang = 'en' }: { t: Tr; state: DashState; me: GovMe | null; overview: GovOverview | null; lang?: string }) {
  const o = state === 'ok' || state === 'no_scheme' ? overview : null;
  return (
    <section data-kv-page="dashboard" data-kv-state={state}>
      <h1>{t.t('gov1.dash.title')}</h1>
      {me ? <p className="kv-muted" data-kv-signed-in="">{t.t('gov1.dash.signedIn', { authority: me.authority?.name ?? t.t('common.dash') })}</p> : null}
      <p className="kv-statement" data-kv-statement="gov1.dash.q3">{t.t('gov1.dash.q3')}</p>
      <p className="kv-muted" data-kv-fact="counts-only">{t.t('gov1.dash.countsOnly')}</p>
      {state === 'off' ? <p className="kv-notice" data-kv-notice="off">{t.t('gov1.login.off')}</p> : null}
      {state === 'forbidden' ? <p className="kv-notice" data-kv-notice="forbidden">{t.t('gov1.dash.forbidden')}</p> : null}
      {state === 'error' ? (
        <div className="kv-notice" data-kv-notice="error">
          <p>{t.t('gov1.dash.error')}</p>
          <p className="kv-pager"><a className="kv-btn" href="/dashboard?act=confirm&do=reread" data-kv-retry="">{t.t('common.retry')}</a></p>
        </div>
      ) : null}
      {o ? (
        <>
          <p className="kv-muted" data-kv-window={o.window.kind}>{t.t('gov1.dash.window')}</p>
          <p className="kv-muted" data-kv-computed-at={o.computedAt}>{t.t('gov1.dash.computedAt', { at: ltrOrNull(atUtc(o.computedAt), lang) ?? t.t('common.dash') })}</p>
          <ul className="kv-facts">
            <li data-kv-count="schemes">{t.t('gov1.dash.schemes', { n: num(o.schemes.count) })}</li>
            <li data-kv-count="applications">{t.t('gov1.dash.applications', { n: num(o.totals.total) })}</li>
          </ul>
          {state === 'no_scheme' ? <p className="kv-muted" data-kv-empty="no-scheme">{t.t('gov1.dash.noScheme')}</p> : null}
          {state === 'ok' && o.totals.total === 0 ? <p className="kv-muted" data-kv-empty="no-application">{t.t('gov1.dash.noApplications')}</p> : null}
          <h2 className="kv-card__title">{t.t('gov1.dash.queues.title')}</h2>
          <table className="kv-table" data-kv-queues="">
            <thead><tr>
              <th scope="col">{t.t('gov1.dash.col.queue')}</th><th scope="col">{t.t('gov1.dash.col.count')}</th><th scope="col">{t.t('gov1.dash.col.oldest')}</th>
            </tr></thead>
            <tbody>
              {o.queues.map((q) => (
                <tr key={q.status} data-kv-queue={q.status}>
                  <td>{t.t(statusKey(q.status))}</td>
                  <td data-kv-n={q.count}>{num(q.count)}</td>
                  <td>{q.oldestDays === null ? t.t('common.dash') : t.t('gov1.dash.oldestDays', { n: num(q.oldestDays) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {o.byScheme.length > 0 ? (
            <>
              <h2 className="kv-card__title">{t.t('gov1.dash.byScheme.title')}</h2>
              <table className="kv-table" data-kv-by-scheme={o.byScheme.length}>
                <thead><tr>
                  <th scope="col">{t.t('gov1.dash.col.scheme')}</th>
                  {DASH_STATUSES.map((s) => <th scope="col" key={s}>{t.t(statusKey(s))}</th>)}
                  <th scope="col">{t.t('gov1.dash.col.total')}</th>
                </tr></thead>
                <tbody>
                  {o.byScheme.map((r) => (
                    <tr key={r.scheme.code} data-kv-scheme={r.scheme.code}>
                      <th scope="row">{r.scheme.name}</th>
                      {DASH_STATUSES.map((s) => <td key={s} data-kv-status={s}>{num(r.byStatus[s] ?? 0)}</td>)}
                      <td data-kv-total="">{num(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      ) : null}
      {/* GOV-6a: W333 "Analytics" and W357 "Reports" — given only the translator, in every state (they print no number). */}
      <Gov6DashboardSections t={t} />
      <p className="kv-muted" data-kv-decor="define">
        <a className="kv-link" href="/dashboard?do=define&act=review">{t.t('gov1.dash.define')}</a>{' '}{t.t('gov1.dash.defineRefused')}
      </p>
      <Gov1Refusals t={t} surface="dashboard" />
    </section>
  );
}

/** W358 — the rules this console keeps. Reads nothing beyond the session; shows no image. */
export function ChromeCanonView({ t, me }: { t: Tr; me: GovMe | null }) {
  return (
    <section data-kv-page="chrome-canon">
      <h1>{t.t('gov1.chrome.title')}</h1>
      <p className="kv-statement" data-kv-statement="gov1.chrome.lead">{t.t('gov1.chrome.lead')}</p>
      <ul className="kv-rules">
        <li data-kv-rule="identity">{t.t('gov1.chrome.identity', { authority: me?.authority?.name ?? t.t('gov1.nav.authority') })}</li>
        <li data-kv-rule="mark">{t.t('gov1.chrome.mark')}</li>
        <li data-kv-rule="no-theme">{t.t('gov1.chrome.noTheme')}</li>
        <li data-kv-rule="language">{t.t('gov1.chrome.language')}</li>
        <li data-kv-rule="accessibility">{t.t('gov1.chrome.accessibility')}</li>
      </ul>
      <Gov1Refusals t={t} surface="chrome_canon" />
    </section>
  );
}
