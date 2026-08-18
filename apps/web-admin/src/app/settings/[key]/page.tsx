// apps/web-admin/src/app/settings/[key]/page.tsx · W103's pending-change panel (PC-56 ADMIN-11).
//
// One setting: what is serving, what was shipped, who set it, the blast radius of changing it, and the history.
//
// **THE DIRECT SET FORM IS ABSENT FOR A MONEY-PATH OR SECURITY KEY, NEVER DISABLED.** Those need a named proposer and a
// different approver — W103: "money-path settings require founder-level checker" — so a direct form would be a control
// that always refuses. The proposer field is offered instead, which turns a 403 into an instruction.
//
// **THE DRY RUN IS COMPUTED WHEN THIS PAGE LOADS, NEVER STORED.** W103 shows one, and a stored dry run is a number that
// ages: approving on Thursday from Monday's counts would describe a world that has moved.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { revertSettingAction, setSettingValueAction } from '../actions';
import { Button, Callout, StatusPill } from '@krishalaya/ui';
import {
  canRevert, canSetDirectly, checkerNoticeKey, effectiveValue, overridesKey, provenanceTone, provenanceKey,
  radiusClass, radiusKey, riskTone, riskKey, type BlastRadius, type SettingRow,
} from '../../../features/settings/setting';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('st11.detail'), robots: { index: false, follow: false } };
}

interface Detail extends SettingRow {
  description: string | null;
  platformSetAt: string | null;
  platformSetByAdminId: string | null;
  platformReason: string | null;
  proposedByAdminId: string | null;
  approvedByAdminId: string | null;
  dryRun: BlastRadius;
  history: {
    action: string; oldValue: unknown; newValue: unknown; reason: string;
    actorAdminId: string; checkerAdminId: string | null; tenantsAffected: number | null; createdAt: string;
  }[];
}

const show = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

export default async function SettingDetailPage({ params, searchParams }: {
  params: { key: string }; searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let s: Detail | null = null; let notice: string | undefined;
  try {
    s = (await adminGet<Detail>(`settings/${encodeURIComponent(params.key)}`)).data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'st11.restricted.settings' : 'st11.error.setting';
  }
  if (!s && !notice) notFound();

  const checkerNotice = s ? checkerNoticeKey(s) : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/settings">{t.t('st11.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span className="kv-mono">{params.key}</span>
      </nav>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`st11.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`st11.err.${searchParams.error}`)}</Callout> : null}

      {s ? (
        <>
          <header className="kv-page__head">
            <h1 className="kv-mono">{s.key}</h1>
            <p className="kv-page__sub">
              <StatusPill tone={riskTone(s.riskClass)} label={t.t(riskKey(s.riskClass))} />{' '}
              <StatusPill tone={provenanceTone(s)} label={t.t(provenanceKey(s))} />{' '}
              · {s.valueType} · {t.t(overridesKey(s), { n: String(s.overrideCount) })}
            </p>
            {s.description ? <p>{s.description}</p> : null}
          </header>

          <section className="kv-panel" aria-labelledby="st11-vals">
            <h2 id="st11-vals" className="kv-panel__title">{t.t('st11.values')}</h2>
            <dl className="kv-dl">
              <div><dt>{t.t('st11.col.serving')}</dt><dd className="kv-mono">{show(effectiveValue(s))}</dd></div>
              {/* THE SHIPPED DEFAULT, kept for ever — it is the only thing a revert has to revert TO. */}
              <div><dt>{t.t('st11.col.shipped')}</dt><dd className="kv-mono">{show(s.defaultValue)}</dd></div>
              <div><dt>{t.t('st11.setBy')}</dt><dd>
                {s.platformSetByAdminId
                  ? `${s.platformSetByAdminId.slice(0, 8)} · ${(s.platformSetAt ?? '').slice(0, 10)}`
                  : t.t('st11.neverSet')}
              </dd></div>
              {s.platformReason ? <div><dt>{t.t('st11.col.reason')}</dt><dd>{s.platformReason}</dd></div> : null}
              {s.approvedByAdminId ? (
                <div><dt>{t.t('st11.approvedBy')}</dt><dd>
                  {s.approvedByAdminId.slice(0, 8)}
                  {s.proposedByAdminId ? ` · ${t.t('st11.proposedBy', { who: s.proposedByAdminId.slice(0, 8) })}` : ''}
                </dd></div>
              ) : null}
            </dl>
            {s.lockNote ? <Callout tone="warning">{s.lockNote}</Callout> : null}
          </section>

          {/* THE DRY RUN — the affected count leads, because that is what the decision turns on and it is NOT the tenant
              count whenever an override exists. */}
          <section className="kv-panel" aria-labelledby="st11-dry">
            <h2 id="st11-dry" className="kv-panel__title">{t.t('st11.dryRun')}</h2>
            <p className={radiusClass(s.dryRun)}>
              {t.t(radiusKey(s.dryRun), {
                affected: s.dryRun.tenantsAffected.toLocaleString('en-IN'),
                total: s.dryRun.tenantsTotal.toLocaleString('en-IN'),
                shadowed: s.dryRun.overridesShadowing.toLocaleString('en-IN'),
              })}
            </p>
          </section>

          <section className="kv-panel" aria-labelledby="st11-change">
            <h2 id="st11-change" className="kv-panel__title">{t.t('st11.change')}</h2>
            {checkerNotice ? <Callout tone="warning">{t.t(checkerNotice)}</Callout> : null}

            <form action={setSettingValueAction}>
              <input type="hidden" name="key" value={s.key} />
              <input type="hidden" name="valueType" value={s.valueType} />
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="st11-newval">{t.t('st11.newValue')}</label>
                {s.valueType === 'bool' ? (
                  <select className="kv-input" id="st11-newval" name="value" defaultValue="true">
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input className="kv-input" id="st11-newval" name="value" required
                    inputMode={s.valueType === 'int' || s.valueType === 'decimal' ? 'numeric' : undefined} />
                )}
              </div>
              {/* THE PROPOSER FIELD, present only where a second person is required — so the form matches the rule the
                  server enforces rather than failing at it. */}
              {!canSetDirectly(s) ? (
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="st11-proposer">{t.t('st11.proposer')}</label>
                  <input className="kv-input" id="st11-proposer" name="proposedByAdminId" required
                    aria-describedby="st11-proposer-help" />
                  <p className="kv-field__help" id="st11-proposer-help">{t.t('st11.proposerHelp')}</p>
                </div>
              ) : null}
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="st11-reason2">{t.t('st11.col.reason')}</label>
                <input className="kv-input" id="st11-reason2" name="reason" required minLength={20} maxLength={2000} />
                <p className="kv-field__help">{t.t('st11.reasonHelp')}</p>
              </div>
              <Button type="submit">{t.t('st11.setValue')}</Button>
            </form>

            {/* A REVERT IS ONLY OFFERED WHEN SOMETHING IS SET — otherwise it would be a button whose success message
                describes a change that did not happen. */}
            {canRevert(s) ? (
              <form action={revertSettingAction}>
                <input type="hidden" name="key" value={s.key} />
                {!canSetDirectly(s) ? (
                  <div className="kv-field">
                    <label className="kv-field__label" htmlFor="st11-rproposer">{t.t('st11.proposer')}</label>
                    <input className="kv-input" id="st11-rproposer" name="proposedByAdminId" required />
                  </div>
                ) : null}
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="st11-rreason">{t.t('st11.revertReason')}</label>
                  <input className="kv-input" id="st11-rreason" name="reason" required minLength={20} maxLength={2000} />
                </div>
                <Button type="submit">
                  {t.t('st11.revert', { value: show(s.defaultValue) })}
                </Button>
              </form>
            ) : <Callout tone="info">{t.t('st11.alreadyShipped')}</Callout>}
          </section>

          <section className="kv-panel" aria-labelledby="st11-hist">
            <h2 id="st11-hist" className="kv-panel__title">{t.t('st11.history')}</h2>
            {s.history.length === 0 ? (
              <Callout tone="info">{t.t('st11.noHistory')}</Callout>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('st11.col.when')}</th>
                    <th scope="col">{t.t('st11.col.action')}</th>
                    <th scope="col">{t.t('st11.col.change')}</th>
                    <th scope="col">{t.t('st11.col.who')}</th>
                    <th scope="col">{t.t('st11.col.reach')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.history.map((h, i) => (
                    <tr key={`${h.createdAt}-${i}`}>
                      <td>{h.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td>{t.t(`st11.action.${h.action}`)}</td>
                      <td className="kv-mono">{show(h.oldValue)} → {show(h.newValue)}</td>
                      <td>
                        {h.actorAdminId.slice(0, 8)}
                        {/* The second name, where there was one. A reviewer scans this column for the rows that have
                            none on a key that should have required one. */}
                        {h.checkerAdminId ? <><br /><small>{t.t('st11.withChecker', { who: h.checkerAdminId.slice(0, 8) })}</small></> : null}
                      </td>
                      {/* THE REACH AT THE TIME. Recomputing it now would describe today's tenant list, not the one the
                          decision was made against. */}
                      <td>{h.tenantsAffected === null ? '—' : h.tenantsAffected.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
