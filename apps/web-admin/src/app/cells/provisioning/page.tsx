// apps/web-admin/src/app/cells/provisioning/page.tsx · W038 (PC-56 ADMIN-8b).
//
// "The 'enter Bangladesh' flow: infra (Terraform tfvars) → shards → residency profile → default flag → smoke test → open
// for placements."
//
// **THIS CONSOLE NEVER APPLIES INFRASTRUCTURE, AND W038 SAYS SO ITSELF:** "Terraform plan runs in CI; apply is a
// founder-approved pipeline step — this console never holds cloud credentials." A console that could apply infrastructure
// would be a console holding cloud credentials, which is the one thing the screen states it must not be. So there is no
// Apply button here and there never should be.
//
// WHAT IS BUILDABLE IS THE CHECKLIST AND THE GATE, and W038 frames it exactly right: "the console enforces the checklist,
// humans enforce the law." Two rules are now database facts rather than screen promises:
//   • A CELL MAY NOT OPEN WITHOUT A PASSED SMOKE TEST (`ck_cpr_open_needs_smoke`) — W038's own failure state says
//     "Synthetic order could not complete payout leg — cell stays closed."
//   • A DRAFT DATA-PROTECTION PROFILE IS NOT A PROFILE. Provisioning under one would mean the residency lock enforcing a
//     rule nobody has ratified, and the refusal is recorded in the residency log.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { startProvisioningAction, recordSmokeAction } from '../actions';
import {
  canOpenCell, gateClass, provisioningClass, provisioningKey, smokeClass, smokeKey, stepKey,
  PROVISIONING_STEPS,
} from '../../../features/cells/residency-migration';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rz.prov.title'), robots: { index: false, follow: false } };
}

interface Provisioning {
  runs: {
    id: string; targetCode: string; countryCode: string; status: string;
    steps: Record<string, unknown>; createdCellId: string | null;
    smokeOutcome: string | null; smokeAt: string | null;
    createdByAdminId: string | null; openedByAdminId: string | null; openedAt: string | null; createdAt: string;
  }[];
  countries: { code: string; name: string; canProvision: { ok: boolean; reason?: string } }[];
  infra: { appliedByConsole: boolean; note: string };
}

export default async function ProvisioningPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let p: Provisioning | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Provisioning>('cells/provisioning');
    p = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rz.restricted.prov' : 'rz.error.prov';
  }

  const openable = p?.countries.filter((c) => c.canProvision.ok) ?? [];

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('rz.prov.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('rz.prov.title')}</h1>
        <p className="kv-page__sub">{t.t('rz.prov.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`rz.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`rz.err.${searchParams.error}`)}</p> : null}

      {p ? (
        <>
          {/* **NO APPLY BUTTON, AND THE ABSENCE IS THE POINT.** */}
          <p className="kv-note is-warn">{t.t('rz.prov.noApply')}</p>

          {/* ---------------- THE MARKET-ENTRY GATE ---------------- */}
          <section className="kv-panel" aria-labelledby="rz-gate">
            <h2 id="rz-gate" className="kv-panel__title">{t.t('rz.prov.gate')}</h2>
            <ul>
              {p.countries.map((c) => (
                <li key={c.code} className={gateClass(c.canProvision.ok)}>
                  <strong>{c.code}</strong> {c.name} —{' '}
                  {c.canProvision.ok ? t.t('rz.prov.gateOpen') : c.canProvision.reason}
                </li>
              ))}
            </ul>
            <p className="kv-note">{t.t('rz.prov.gateNote')}</p>
          </section>

          {/* ---------------- THE RUNS ---------------- */}
          {p.runs.length === 0 ? (
            <div className="kv-empty">
              <h2>{t.t('rz.prov.empty.title')}</h2>
              <p>{t.t('rz.prov.empty.body')}</p>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-table__caption">{t.t('rz.prov.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('rz.col.target')}</th>
                  <th scope="col">{t.t('rz.col.country')}</th>
                  <th scope="col">{t.t('rz.col.status')}</th>
                  <th scope="col">{t.t('rz.col.checklist')}</th>
                  <th scope="col">{t.t('rz.col.smoke')}</th>
                  <th scope="col">{t.t('rz.col.opened')}</th>
                </tr>
              </thead>
              <tbody>
                {p.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.targetCode}</td>
                    <td>{r.countryCode}</td>
                    <td><span className={provisioningClass(r.status)}>{t.t(provisioningKey(r.status))}</span></td>
                    <td>
                      {/* The six steps in W038's order, so the checklist reads the same way every time. */}
                      {PROVISIONING_STEPS.map((s) => (
                        <span key={s} className={r.steps[s] ? 'kv-badge is-ok' : 'kv-badge'}>
                          {t.t(stepKey(s))}
                        </span>
                      ))}
                    </td>
                    <td>
                      <span className={smokeClass(r.smokeOutcome)}>{t.t(smokeKey(r.smokeOutcome))}</span>
                      {/* A cell nobody has proved works is not a cell in an unknown state — it is a cell that must not
                          open, which is why "not run" is a warning rather than neutral. */}
                      {canOpenCell(r.smokeOutcome, r.status)
                        ? <><br /><small>{t.t('rz.prov.readyToOpen')}</small></>
                        : null}
                    </td>
                    <td>
                      {r.openedAt
                        ? `${(r.openedByAdminId ?? '').slice(0, 8)} · ${r.openedAt.slice(0, 10)}`
                        : t.t('rz.prov.notOpen')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ---------------- START A RUN ---------------- */}
          <section className="kv-panel" aria-labelledby="rz-start">
            <h2 id="rz-start" className="kv-panel__title">{t.t('rz.prov.start')}</h2>
            {openable.length === 0 ? (
              // The honest empty state: no country's profile is ratified, so there is nowhere a cell may lawfully go.
              <p className="kv-note is-warn">{t.t('rz.prov.noEligibleCountry')}</p>
            ) : (
              <form action={startProvisioningAction}>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="rz-code">{t.t('rz.col.target')}</label>
                  <input className="kv-input" id="rz-code" name="targetCode" maxLength={40} required
                    pattern="[a-z][a-z0-9-]{1,39}" aria-describedby="rz-code-help" />
                  <p className="kv-field__help" id="rz-code-help">{t.t('rz.prov.codeHelp')}</p>
                </div>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="rz-country">{t.t('rz.col.country')}</label>
                  <select className="kv-input" id="rz-country" name="countryCode" required>
                    {openable.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                  </select>
                </div>
                <button className="kv-btn" type="submit">{t.t('rz.prov.startBtn')}</button>
              </form>
            )}
          </section>

          {/* ---------------- RECORD A SMOKE RESULT ---------------- */}
          {p.runs.some((r) => r.status !== 'open' && r.status !== 'abandoned') ? (
            <section className="kv-panel" aria-labelledby="rz-smoke">
              <h2 id="rz-smoke" className="kv-panel__title">{t.t('rz.prov.smokeTitle')}</h2>
              <p className="kv-note">{t.t('rz.prov.smokeWhat')}</p>
              <form action={recordSmokeAction}>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="rz-run">{t.t('rz.prov.run')}</label>
                  <select className="kv-input" id="rz-run" name="id" required>
                    {p.runs.filter((r) => r.status !== 'open' && r.status !== 'abandoned').map((r) => (
                      <option key={r.id} value={r.id}>{r.targetCode}</option>
                    ))}
                  </select>
                </div>
                <button className="kv-btn" type="submit" name="outcome" value="passed">{t.t('rz.prov.smokePassed')}</button>
                <button className="kv-btn kv-btn--danger" type="submit" name="outcome" value="failed">{t.t('rz.prov.smokeFailed')}</button>
              </form>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
