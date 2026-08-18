// apps/web-admin/src/app/cells/migrations/[id]/page.tsx · W034 (DELTA-012) (PC-56 ADMIN-8b).
//
// One migration, and the four things a person about to take a tenant offline needs in front of them: the preflight, the
// approval, the freeze against its budget, and where the data actually is.
//
// **THE APPROVE CONTROL IS ABSENT FOR THE DRAFTER, NEVER DISABLED** (maker-checker by absence, thirteen sites now). The
// server refuses regardless — `assertSecondPerson` and the constraint both — and rendering a greyed-out button teaches an
// operator that the rule is a UI preference.
//
// **THE WAIVER CONTROL IS ABSENT FOR TWO OF THE FOUR CHECKS.** `no_open_payouts` is unwaivable because moves never race
// money, and an UNKNOWN check cannot be waived at all: waiving a check that did not run is asserting a result nobody has.
// Which is also why an unknown is drawn in danger rather than warning — a failure is a known problem with a next step; an
// unrun guard is a blind one.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin, adminUserId } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { runPreflightAction, approveMigrationAction, advanceMigrationAction } from '../../actions';
import {
  Button, Callout, StatusPill,
} from '@krishalaya/ui';
import {
  checkTone, checkKey, checkState, cleanupKey, dataLocationKey, executorNoticeKey,
  freezeClass, freezeKey, jobTone, jobKey, showWaiver,
} from '../../../../features/cells/residency-migration';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rz.jobs.title'), robots: { index: false, follow: false } };
}

interface Check { check: string; ok: boolean; detail?: string; waivable?: boolean; unknown?: boolean }
interface Job {
  id: string; migratingTenantId: string;
  fromCellId: string; fromShardId: string; toCellId: string; toShardId: string;
  status: string; reason: string | null;
  preflight: { pass: boolean; checks: Check[]; blocking: string[]; unknown: string[] } | null;
  createdByAdminId: string | null; approvedByAdminId: string | null;
  windowStart: string | null; windowEnd: string | null;
  freezeStartedAt: string | null; freezeEndedAt: string | null; freezeBudgetSeconds: number;
  safetyHoldUntil: string | null; sourceCleanedAt: string | null;
  rollbackReason: string | null; failureDetail: string | null; createdAt: string;
  steps: { step: string; outcome: string; detail: string | null; startedAt: string; finishedAt: string | null }[];
  dataHasMoved: boolean; sourceStillHeld: boolean; inWindow: boolean;
  freeze: { kind: string; overBudget: boolean; elapsedSeconds?: number };
  cleanup: { kind: string; daysRemaining?: number };
  safetyHoldDays: number;
  executor: { exists: boolean; owner: string };
}

export default async function MigrationDetailPage({ params, searchParams }: {
  params: { id: string }; searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const me = adminUserId();

  let j: Job | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Job | null>(`cells/migrations/${encodeURIComponent(params.id)}`);
    j = res.data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'rz.restricted.jobs' : 'rz.error.jobs';
  }
  if (!j && !notice) notFound();

  const executorNotice = j ? executorNoticeKey(j.executor.exists) : null;
  // ABSENCE, not disablement. Two conditions, both server-enforced.
  const iAmTheMaker = !!j?.createdByAdminId && j.createdByAdminId === me;
  const canApprove = !!j && j.status === 'queued' && !j.approvedByAdminId && !iAmTheMaker && (j.preflight?.pass ?? false);

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/cells/migrations">{t.t('rz.jobs.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{params.id.slice(0, 8)}</span>
      </nav>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`rz.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`rz.err.${searchParams.error}`)}</Callout> : null}

      {j ? (
        <>
          <header className="kv-page__head">
            <h1>{t.t('rz.job.title', { id: j.id.slice(0, 8) })}</h1>
            <p className="kv-page__sub">
              <StatusPill tone={jobTone(j.status)} label={t.t(jobKey(j.status))} />{' '}
              {/* The most consequential fact on the page: only `done` means the tenant moved. */}
              · {t.t(dataLocationKey(j.status))}
            </p>
          </header>

          {executorNotice ? (
            <Callout tone="warning" live="polite">{t.t(executorNotice, { owner: j.executor.owner })}</Callout>
          ) : null}

          {/* ---------------- THE MOVE ---------------- */}
          <section className="kv-panel" aria-labelledby="rz-move">
            <h2 id="rz-move" className="kv-panel__title">{t.t('rz.job.move')}</h2>
            <dl className="kv-dl">
              <div><dt>{t.t('rz.col.tenant')}</dt><dd>{j.migratingTenantId}</dd></div>
              <div>
                <dt>{t.t('rz.job.from')}</dt>
                <dd><Link href={`/cells/cells/${encodeURIComponent(j.fromCellId)}`}>{j.fromCellId.slice(0, 8)}</Link></dd>
              </div>
              <div>
                <dt>{t.t('rz.job.to')}</dt>
                <dd><Link href={`/cells/cells/${encodeURIComponent(j.toCellId)}`}>{j.toCellId.slice(0, 8)}</Link></dd>
              </div>
              <div><dt>{t.t('rz.col.window')}</dt><dd>
                {j.windowStart ? `${j.windowStart.slice(0, 16).replace('T', ' ')} → ${(j.windowEnd ?? '').slice(11, 16)}` : '—'}
                {j.inWindow ? ` · ${t.t('rz.window.open')}` : ''}
              </dd></div>
              <div><dt>{t.t('rz.job.reason')}</dt><dd>{j.reason ?? '—'}</dd></div>
            </dl>
            {/* A same-country move is the only kind that can exist here; the refused ones are in the residency log. */}
            <Callout>
              {t.t('rz.jobs.residencyNote')}{' '}
              <Link href="/cells/residency/log">{t.t('rz.log.title')}</Link>
            </Callout>
          </section>

          {/* ---------------- THE PREFLIGHT ---------------- */}
          <section className="kv-panel" aria-labelledby="rz-pf">
            <h2 id="rz-pf" className="kv-panel__title">{t.t('rz.pf.title')}</h2>
            {j.preflight === null ? (
              <Callout tone="warning">{t.t('rz.pf.notRun')}</Callout>
            ) : (
              <>
                <Callout tone={j.preflight.pass ? 'success' : 'danger'}>
                  {j.preflight.pass ? t.t('rz.pf.pass') : t.t('rz.pf.fail')}
                </Callout>
                {j.preflight.unknown.length > 0 ? (
                  <Callout tone="danger" live="assertive">
                    {t.t('rz.pf.unknownBlocks', { n: String(j.preflight.unknown.length) })}
                  </Callout>
                ) : null}
                <ul className="kv-list">
                  {j.preflight.checks.map((c) => {
                    const state = checkState(c);
                    return (
                      <li key={c.check}>
                        <StatusPill tone={checkTone(state)} label={t.t(checkKey(c.check))} />{' '}
                        {c.detail ? <small>{c.detail}</small> : null}
                        {/* THE WAIVER CONTROL IS SIMPLY NOT HERE for an unwaivable or an unknown check. */}
                        {showWaiver(c.check, state) ? <><br /><small>{t.t('rz.pf.waivable')}</small></> : null}
                        {state === 'blocked' && !showWaiver(c.check, state)
                          ? <><br /><small>{t.t('rz.pf.unwaivable')}</small></> : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {/* Re-running is always allowed: the inputs are observations and observations go stale. */}
            <form action={runPreflightAction}>
              <input type="hidden" name="id" value={j.id} />
              <p className="kv-field__help">{t.t('rz.pf.inputsHelp')}</p>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="pf-payouts">{t.t('rz.pf.openPayouts')}</label>
                <input className="kv-input" id="pf-payouts" name="openPayouts" type="number" min={0} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="pf-auctions">{t.t('rz.pf.liveAuctions')}</label>
                <input className="kv-input" id="pf-auctions" name="liveAuctions" type="number" min={0} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="pf-outbox">{t.t('rz.pf.outboxPending')}</label>
                <input className="kv-input" id="pf-outbox" name="outboxPending" type="number" min={0} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="pf-bytes">{t.t('rz.pf.estimatedBytes')}</label>
                <input className="kv-input" id="pf-bytes" name="estimatedBytes" type="number" min={0} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="pf-budget">{t.t('rz.pf.windowBudgetBytes')}</label>
                <input className="kv-input" id="pf-budget" name="windowBudgetBytes" type="number" min={0} />
              </div>
              {/* An empty box means "could not be read", which the domain reports as UNKNOWN and never as a pass. */}
              <p className="kv-field__help">{t.t('rz.pf.blankIsUnknown')}</p>
              <Button type="submit">{t.t('rz.pf.run')}</Button>
            </form>
          </section>

          {/* ---------------- THE CHECKER ---------------- */}
          <section className="kv-panel" aria-labelledby="rz-appr">
            <h2 id="rz-appr" className="kv-panel__title">{t.t('rz.job.approval')}</h2>
            {j.approvedByAdminId ? (
              <Callout tone="success">
                {t.t('rz.job.approvedBy', { who: j.approvedByAdminId.slice(0, 8) })}
              </Callout>
            ) : (
              <Callout tone="warning">{t.t('rz.notApproved')}</Callout>
            )}
            {iAmTheMaker && !j.approvedByAdminId ? (
              // The explanation stays even though the control is gone — absence with no reason is just a missing button.
              <Callout>{t.t('rz.job.youDrafted')}</Callout>
            ) : null}
            {!j.preflight?.pass && !j.approvedByAdminId ? (
              <Callout>{t.t('rz.job.needsPreflight')}</Callout>
            ) : null}
            {canApprove ? (
              <form action={approveMigrationAction}>
                <input type="hidden" name="id" value={j.id} />
                <Button type="submit">{t.t('rz.job.approve')}</Button>
              </form>
            ) : null}
          </section>

          {/* ---------------- THE FREEZE ---------------- */}
          <section className="kv-panel" aria-labelledby="rz-freeze">
            <h2 id="rz-freeze" className="kv-panel__title">{t.t('rz.job.freeze')}</h2>
            <p className={freezeClass(j.freeze.kind, j.freeze.overBudget)}>
              {t.t(freezeKey(j.freeze.kind, j.freeze.overBudget))}
            </p>
            <Callout>
              {t.t('rz.job.freezeBudget', {
                budget: String(j.freezeBudgetSeconds),
                elapsed: j.freeze.elapsedSeconds === undefined ? '—' : String(j.freeze.elapsedSeconds),
              })}
            </Callout>
            <Callout>
              {t.t(cleanupKey(j.cleanup.kind))}
              {j.cleanup.kind === 'holding' ? ` (${j.cleanup.daysRemaining}d)` : ''}
              {' — '}{t.t('rz.job.holdWhy', { days: String(j.safetyHoldDays) })}
            </Callout>
          </section>

          {/* ---------------- ADVANCE ---------------- */}
          {j.status !== 'done' && j.status !== 'rolled_back' && j.status !== 'failed' ? (
            <section className="kv-panel" aria-labelledby="rz-adv">
              <h2 id="rz-adv" className="kv-panel__title">{t.t('rz.job.advance')}</h2>
              {/* THE API AN EXECUTOR WOULD CALL, exposed so the state machine is exercised and auditable before the
                  executor exists — every transition checked, and `cutover` additionally requiring a verify that compares
                  row counts and the ledger sum as bigint strings. */}
              <Callout tone="warning">{t.t('rz.job.advanceManual')}</Callout>
              <form action={advanceMigrationAction}>
                <input type="hidden" name="id" value={j.id} />
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="adv-to">{t.t('rz.job.advanceTo')}</label>
                  <select className="kv-input" id="adv-to" name="to" required>
                    <option value="copying">copying</option>
                    <option value="verifying">verifying</option>
                    <option value="cutover">cutover</option>
                    <option value="done">done</option>
                    <option value="rolled_back">rolled_back</option>
                    <option value="failed">failed</option>
                  </select>
                </div>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="adv-sr">{t.t('rz.job.sourceRows')}</label>
                  <input className="kv-input" id="adv-sr" name="sourceRows" type="number" min={0} />
                </div>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="adv-tr">{t.t('rz.job.targetRows')}</label>
                  <input className="kv-input" id="adv-tr" name="targetRows" type="number" min={0} />
                </div>
                {/* MINOR UNITS AS STRINGS (Law 2). A ledger sum crossing as a number is a verify that can pass on a
                    one-paisa difference in a large figure. */}
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="adv-sl">{t.t('rz.job.sourceLedger')}</label>
                  <input className="kv-input" id="adv-sl" name="sourceLedgerMinor" inputMode="numeric" pattern="-?[0-9]{1,19}" />
                </div>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="adv-tl">{t.t('rz.job.targetLedger')}</label>
                  <input className="kv-input" id="adv-tl" name="targetLedgerMinor" inputMode="numeric" pattern="-?[0-9]{1,19}" />
                </div>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="adv-rb">{t.t('rz.job.rollbackReason')}</label>
                  <input className="kv-input" id="adv-rb" name="rollbackReason" maxLength={2000} />
                  <p className="kv-field__help">{t.t('rz.job.rollbackHelp')}</p>
                </div>
                <Button type="submit">{t.t('rz.job.advanceBtn')}</Button>
              </form>
            </section>
          ) : null}

          {/* ---------------- THE STEPS ---------------- */}
          <section className="kv-panel" aria-labelledby="rz-steps">
            <h2 id="rz-steps" className="kv-panel__title">{t.t('rz.job.steps')}</h2>
            {j.steps.length === 0 ? (
              <Callout>{t.t('rz.job.noSteps')}</Callout>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('rz.col.when')}</th>
                    <th scope="col">{t.t('rz.job.step')}</th>
                    <th scope="col">{t.t('rz.col.outcome')}</th>
                    <th scope="col">{t.t('rz.job.detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {j.steps.map((s, i) => (
                    <tr key={`${s.step}-${s.startedAt}-${i}`}>
                      <td>{s.startedAt.slice(0, 16).replace('T', ' ')}</td>
                      <td>{s.step}</td>
                      <td>{s.outcome}</td>
                      <td>{s.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {j.rollbackReason ? <Callout tone="warning">{j.rollbackReason}</Callout> : null}
          {j.failureDetail ? <Callout tone="danger">{j.failureDetail}</Callout> : null}
        </>
      ) : null}
    </main>
  );
}
