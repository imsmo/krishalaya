// apps/web-admin/src/app/cells/plan/page.tsx · W037 (DELTA-013) (PC-56 ADMIN-8b).
//
// "15,000 tenants by Y3 (PRD) — what the cell map must become, planned ahead of demand."
//
// **THE PLAN IS BUILT AND THE FORECAST IS NOT, AND THAT LINE IS THE WHOLE SPLIT.** W037's banner defers "forecast
// analytics (growth model per cell)", and its own footnote concedes the rest: "statuses are planning labels, not schema
// enums." ADMIN-8 already built the observed RATE — a count over `cell_map_changes` — and flagged cells past the 70%
// trigger. What was missing is a place to record the steps an operator commits to.
//
// A STEP'S TRIGGER IS A CONDITION, NOT A DATE. "When in-west-1 reaches 70%, add two shards" survives a slow quarter; a
// calendar entry goes stale and quietly stops being a plan. The projection chart W037 draws needs a growth model to
// predict WHEN a condition fires, and that remains ADMIN-8b-Q2.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { addPlanStepAction } from '../actions';
import { planStatusClass, planStatusKey, triggerKey } from '../../../features/cells/residency-migration';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rz.plan.title'), robots: { index: false, follow: false } };
}

interface Plan {
  steps: {
    id: string; cellId: string | null; targetCode: string | null; action: string;
    addsCapacity: number | null; triggerSpec: Record<string, unknown>; status: string;
    gateReason: string | null; notes: string | null; createdAt: string;
  }[];
  forecast: { available: boolean; delta: string; owner: string };
  note: string;
}

export default async function ScalePlanPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let p: Plan | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Plan>('cells/plan');
    p = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rz.restricted.plan' : 'rz.error.plan';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('rz.plan.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('rz.plan.title')}</h1>
        <p className="kv-page__sub">{t.t('rz.plan.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`rz.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`rz.err.${searchParams.error}`)}</p> : null}

      {p ? (
        <>
          {/* **NO PROJECTION CHART, AND THE ABSENCE IS NAMED.** A line drawn from no growth model would be a plan
              somebody could act on. */}
          <p className="kv-note is-warn">{t.t('rz.plan.noForecast', { delta: p.forecast.delta })}</p>
          <p className="kv-note">
            {t.t('rz.plan.rateNote')}{' '}
            <Link href="/cells/capacity">{t.t('rz.plan.openCapacity')}</Link>
          </p>

          {p.steps.length === 0 ? (
            <div className="kv-empty">
              <h2>{t.t('rz.plan.empty.title')}</h2>
              <p>{t.t('rz.plan.empty.body')}</p>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-table__caption">{t.t('rz.plan.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('rz.col.subject')}</th>
                  <th scope="col">{t.t('rz.col.action')}</th>
                  <th scope="col">{t.t('rz.col.adds')}</th>
                  <th scope="col">{t.t('rz.col.trigger')}</th>
                  <th scope="col">{t.t('rz.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {p.steps.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.cellId
                        ? <Link href={`/cells/cells/${encodeURIComponent(s.cellId)}`}>{s.cellId.slice(0, 8)}</Link>
                        : s.targetCode}
                    </td>
                    <td>{t.t(`rz.action.${s.action}`)}</td>
                    <td>{s.addsCapacity === null ? '—' : s.addsCapacity.toLocaleString('en-IN')}</td>
                    {/* A CONDITION rendered as a sentence, never as raw jsonb — JSON in a planning table teaches an
                        operator to stop reading the column. */}
                    <td>{t.t(triggerKey(s.triggerSpec), s.triggerSpec as Record<string, string>)}</td>
                    <td>
                      <span className={planStatusClass(s.status)}>{t.t(planStatusKey(s.status))}</span>
                      {/* "gated" with no reason would be a status recording a decision nobody wrote down; the constraint
                          forbids it and the column shows it. */}
                      {s.gateReason ? <><br /><small>{s.gateReason}</small></> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <section className="kv-panel" aria-labelledby="rz-addstep">
            <h2 id="rz-addstep" className="kv-panel__title">{t.t('rz.plan.add')}</h2>
            <form action={addPlanStepAction}>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rz-action">{t.t('rz.col.action')}</label>
                <select className="kv-input" id="rz-action" name="action" defaultValue="add_shards">
                  <option value="add_shards">add_shards</option>
                  <option value="provision_cell">provision_cell</option>
                  <option value="raise_capacity">raise_capacity</option>
                  <option value="retire_cell">retire_cell</option>
                </select>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rz-cell">{t.t('rz.plan.cellId')}</label>
                <input className="kv-input" id="rz-cell" name="cellId" />
                <p className="kv-field__help">{t.t('rz.plan.cellIdHelp')}</p>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rz-target">{t.t('rz.plan.targetCode')}</label>
                <input className="kv-input" id="rz-target" name="targetCode" maxLength={40} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rz-trigkind">{t.t('rz.col.trigger')}</label>
                <select className="kv-input" id="rz-trigkind" name="triggerKind" defaultValue="utilisation">
                  <option value="utilisation">utilisation</option>
                  <option value="market_entry">market_entry</option>
                  <option value="manual">manual</option>
                </select>
                <input className="kv-input" name="triggerValue" placeholder="70" maxLength={40} />
                <p className="kv-field__help">{t.t('rz.plan.triggerHelp')}</p>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rz-adds">{t.t('rz.col.adds')}</label>
                <input className="kv-input" id="rz-adds" name="addsCapacity" type="number" min={0} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rz-pstatus">{t.t('rz.col.status')}</label>
                <select className="kv-input" id="rz-pstatus" name="status" defaultValue="draft">
                  <option value="draft">draft</option>
                  <option value="planned">planned</option>
                  <option value="gated">gated</option>
                </select>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rz-gate">{t.t('rz.plan.gateReason')}</label>
                <input className="kv-input" id="rz-gate" name="gateReason" maxLength={2000} />
                <p className="kv-field__help">{t.t('rz.plan.gateHelp')}</p>
              </div>
              <button className="kv-btn" type="submit">{t.t('rz.plan.addBtn')}</button>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}
