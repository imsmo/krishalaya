// apps/web-tenant/src/app/twin/scenarios/results/page.tsx · W422 · SCENARIO RESULTS — BAND-FIRST, OR "TOO FEW RUNS" · PC-56 TENANT-12.
//
// The canon prints four P10/P50/P90 bands "of 500 runs" (yield 14.2 / 16.1 / 17.8 qtl/ha …; income −₹9,300 / −₹6,700 / −₹4,100 …)
// and a baseline of 19.4 qtl/ha. No model is registered and no run has happened, so EVERY band cell says "Too few runs — no
// registered model" — never a number, never an AI badge. The one figure that IS a recorded fact — actual yield, last full season,
// qtl/ha — prints only where the yield unit AND the parcel area unit convert, over at least the platform's minimum group size
// (twin.min_group_size, said on screen); otherwise the page says which of those is missing. "Send as proposal to governance" says
// "no run to cite" (a proposal must carry a receipt — coop_resolutions.source_ref, 0190). Route = the canon route comment
// (`twin/scenarios/results`); the catalog's `…/compare` is noted (F-17). States: No comparison selected · content · Loading ·
// Flagged off (404) · Restricted (403) · Couldn't load (Retry is a page load; the chosen pair stays in the URL).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { TwinResults, TwinScenarioPage } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { RESULTS_HREF, SCENARIOS_HREF, TWIN_HREF, bandShown, cellKey, factLine, isUuid, resultsHref, seasonKey, statusKey, twinState } from '../../../../features/twin/twin';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('twin.results.title'), robots: { index: false, follow: false } };
}

export default async function TwinResultsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(RESULTS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const fmt = (n: number) => formatNumber(n, lang);
  const a = isUuid(searchParams.a) ? searchParams.a : null;
  const b = isUuid(searchParams.b) && searchParams.b !== a ? searchParams.b : null;
  const c = tenantClient();

  let list: TwinScenarioPage | null = null; let r: TwinResults | null = null; let state: string | null = null;
  try { list = await c.twin.scenarios({ limit: 100 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status); }
  if (list && a) {
    try { r = await c.twin.results(a, b ?? undefined); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = err?.status === 404 ? 'notFound' : twinState(err?.code, err?.status); }
  }

  return (
    <section>
      <nav aria-label={t.t('twin.breadcrumb.label')} className="kv-field__hint">
        {t.t('twin.breadcrumb.area')} › <Link href={SCENARIOS_HREF} className="kv-btn--link">{t.t('twin.scenarios.crumb')}</Link> › {t.t('twin.results.crumb')}
      </nav>
      <h1>{t.t('twin.results.title')}{r ? ` — ${r.pair.map((p) => p.scenario.name).join(' · ')}` : ''}</h1>
      <p>{t.t('twin.results.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(state === 'flaggedOff' ? 'twin.state.resultsOff.title' : `twin.state.${state}.title`)}</strong>
          <p>{t.t(state === 'flaggedOff' ? 'twin.state.resultsOff.body' : state === 'error' ? 'twin.state.compareError.body' : `twin.state.${state}.body`)}</p>
          {state === 'flaggedOff' && <p><Link href={TWIN_HREF} className="kv-btn--link">{t.t('twin.state.toLocked')}</Link></p>}
          {state === 'error' && a && <p><Link href={resultsHref(a, b)} className="kv-btn--link">{t.t('twin.state.retry')}</Link></p>}
        </div>
      )}

      {list && (
        <form action={RESULTS_HREF} method="get" className="kv-card kv-inline-form" aria-label={t.t('twin.results.pick')}>
          <label className="kv-field" htmlFor="tw-a"><span>{t.t('twin.results.first')}</span>
            <select id="tw-a" name="a" className="kv-select" defaultValue={a ?? ''} required>
              <option value="">{t.t('twin.results.choose')}</option>
              {list.items.map((s) => <option key={s.id} value={s.id}>{s.name} · {t.t(statusKey(s.status))}</option>)}
            </select></label>
          <label className="kv-field" htmlFor="tw-b"><span>{t.t('twin.results.second')}</span>
            <select id="tw-b" name="b" className="kv-select" defaultValue={b ?? ''}>
              <option value="">{t.t('twin.results.none')}</option>
              {list.items.map((s) => <option key={s.id} value={s.id}>{s.name} · {t.t(statusKey(s.status))}</option>)}
            </select></label>
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('twin.results.compare')}</button>
        </form>
      )}

      {list && !a && <div className="kv-empty-state" role="status"><strong>{t.t('twin.results.empty.title')}</strong><p>{t.t('twin.results.empty.body')}</p></div>}

      {r && (
        <>
          {(['yield', 'income'] as const).map((metric) => (
            <div className="kv-card" key={metric}>
              <h2>{t.t(`twin.results.${metric}`)}</h2>
              {metric === 'yield' && r!.pair.map((p) => { const l = factLine(p.fact, fmt); return (
                <p key={`f-${p.scenario.id}`} className={p.fact.state === 'shown' ? '' : 'kv-field__hint'}>
                  <strong>{t.t('twin.results.baseline')}</strong> {t.t(l.key, { ...l.vars, ...(l.vars.season ? { season: t.t(seasonKey(l.vars.season)) } : {}) })}{p.scenario.productName ? ` · ${p.scenario.productName}` : ''}
                </p>
              ); })}
              <table className="kv-table">
                <caption className="kv-sr-only">{t.t(`twin.results.${metric}`)}</caption>
                <thead><tr><th scope="col">{t.t('twin.scenarios.col.scenario')}</th><th scope="col">{t.t('twin.results.band')}</th></tr></thead>
                <tbody>{r!.pair.map((p) => (
                  <tr key={p.scenario.id}>
                    <th scope="row">{p.scenario.name}<div className="kv-field__hint">{t.t('twin.scenarios.attempts', { n: fmt(p.attempts) })}</div></th>
                    <td>{bandShown(p.cells[metric]) ? t.t('twin.cell.band') : <strong>{t.t(cellKey(p.cells[metric]))}</strong>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          <div className="kv-card" role="note">
            <p>{t.t('twin.results.aggregate', { n: fmt(r.minGroupSize) })}</p>
            <p>{r.proposal.available ? t.t('twin.results.proposalReady') : t.t('twin.results.noRunToCite')}</p>
            <p className="kv-field__hint">{t.t('twin.results.proposalButton')} — {t.t('twin.results.noRunToCite')}</p>
            <p><em>{t.t('twin.quote.band')}</em></p>
            <p><em>{t.t('twin.quote.dispose')}</em></p>
            <p className="kv-field__hint">{t.t('twin.byName.districtDrill')}</p>
          </div>
        </>
      )}
    </section>
  );
}
