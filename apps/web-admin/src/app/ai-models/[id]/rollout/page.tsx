// apps/web-admin/src/app/ai-models/[id]/rollout/page.tsx · W088 + W087's threshold half (PC-56 ADMIN-7).
//
// "shadow → canary → production. Each gate has hard criteria; regression auto-rolls back to v2.0."
//
// WHAT EXISTED: `ai_models.status` as a bare varchar with a four-value comment, and a state machine permitting every
// transition between them. No traffic share — so "canary 10%" on four canon screens was a number in a mockup, because
// nothing stored a split and nothing read one. No shadow duration, no gate criteria, no rollback record, no checker.
//
// AND THE PROMOTION HAD NO FAIRNESS GATE, which is the whole reason this page exists. `promote()` was a legality check, an
// UPDATE and an audit row: one person could put a model that had never been audited for district or gender skew into
// production, deciding whether a farmer's produce grades FAQ or B.
//
// THE UNMEASURED GATES ARE SHOWN AS UNMEASURED. W088 lists MAPE, accuracy, p95 latency and a district gap; this platform
// records none of them. Four green ticks over two real measurements would be exactly the defect this programme keeps
// finding, so the rows are drawn with what nobody checks named at the moment of decision.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { approveTransitionAction, proposeTransitionAction, withdrawTransitionAction, runAuditAction } from '../../actions';
import { Button, Callout, StatusPill } from '@krishalaya/ui';
import {
  adviceClass, adviceKey, formatGap, formatRate, formatThreshold, gateTone, gateKey, gateStatusTone,
  gateStatusKey, legacyKey, nextStepKey, rollbackClass, rollbackKey, showApproveTransition, showWithdraw,
} from '../../../../features/ai-governance/ai-governance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ai.rollout.title'), robots: { index: false, follow: false } };
}

interface GateStatus { kind: string; value?: number; limit?: number; have?: number; need?: number; metric?: string; why?: string }

interface Rollout {
  model: {
    id: string; code: string; version: string; status: string; confidenceThreshold: number | null; createdAt: string;
    proposedStatus: string | null; proposedByAdminId: string | null; proposedAt: string | null; proposalReason: string | null;
    legacyFairnessColumn: { kind: string };
  };
  canaryPercent: number | null;
  nextCanaryStep: number | null;
  gates: { shadowDuration: GateStatus; overrideRate: GateStatus; unmeasured: { metric: string; why: string }[]; measurablePass: boolean };
  advice: { advice: string; reason?: string; unmeasured?: string[] };
  fairnessGate: { open: boolean; reason?: string; refusal: string | null; auditId?: string; maxGapPp?: number; auditedAt?: string };
  rollback: { signal: { fires: boolean; reason?: string; rate?: number; limit?: number; have?: number; need?: number }; enforced: boolean; note: string };
  window: { from: string; to: string; decisions: number; overridden: number };
  provenance: { auditId: string | null; promotedAt: string | null; promotedByAdminId: string | null; canaryPercent: number | null } | null;
  awaitingChecker: { id: string; code: string; version: string; proposedStatus: string; proposedByAdminId: string | null; proposedAt: string }[];
  canApprove: boolean;
}

export default async function RolloutPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let r: Rollout | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Rollout>(`ai/models/${encodeURIComponent(params.id)}/rollout`);
    r = res.data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'ai.restricted.rollout' : 'ai.error.rollout';
  }
  if (!r && !notice) notFound();

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/ai-models">{t.t('nav.aiModels')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href={`/ai-models/${encodeURIComponent(params.id)}`}>{r ? `${r.model.code} ${r.model.version}` : params.id.slice(0, 8)}</Link>{' '}
        <span aria-hidden="true">/</span> <span>{t.t('ai.rollout.title')}</span>
      </nav>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`ai.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`ai.err.${searchParams.error}`)}</Callout> : null}

      {r ? (
        <>
          <header className="kv-page__head">
            <h1>{t.t('ai.rollout.title')} — {r.model.code} {r.model.version}</h1>
            <p className="kv-page__sub">
              {r.model.status}
              {r.canaryPercent !== null ? ` · ${t.t('ai.canary.at', { pct: String(r.canaryPercent) })}` : ''}
              {' · '}{t.t('ai.threshold')}: {formatThreshold(r.model.confidenceThreshold)}
            </p>
          </header>

          {/* ---------------- THE FAIRNESS GATE ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-gate">
            <h2 id="ai-gate" className="kv-panel__title">{t.t('ai.gate.title')}</h2>
            <p>
              <StatusPill tone={gateTone(r.fairnessGate.open)}
                label={t.t(gateKey(r.fairnessGate.open, r.fairnessGate.reason))} />
              {r.fairnessGate.open && r.fairnessGate.maxGapPp !== undefined
                ? <> {formatGap(r.fairnessGate.maxGapPp)} · {(r.fairnessGate.auditedAt ?? '').slice(0, 10)}</>
                : null}
            </p>
            {/* The refusal in words the operator can act on: run an audit, close a gap, gather more data, re-audit, or get
                the DPO to sign off the slice definitions. Each reason has a different next step. */}
            {r.fairnessGate.refusal ? (
              <Callout tone="danger" live="assertive">{r.fairnessGate.refusal}</Callout>
            ) : null}
            {/* What the OLD column holds, for a reader who remembers it existing. */}
            <Callout>{t.t('ai.gate.legacyNote')} {t.t(legacyKey(r.model.legacyFairnessColumn.kind))}</Callout>
            <form action={runAuditAction}>
              <input type="hidden" name="id" value={r.model.id} />
              <Button type="submit">{t.t('ai.audit.run')}</Button>
            </form>
            <Callout>
              <Link href="/ai-models/fairness">{t.t('ai.gate.board')}</Link>
            </Callout>
          </section>

          {/* ---------------- THE LADDER'S GATES ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-gates">
            <h2 id="ai-gates" className="kv-panel__title">{t.t('ai.gates.title')}</h2>
            <table className="kv-table">
              <caption className="kv-table__caption">
                {t.t('ai.gates.caption', {
                  from: r.window.from.slice(0, 10), to: r.window.to.slice(0, 10),
                  n: r.window.decisions.toLocaleString('en-IN'),
                })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('ai.col.gateName')}</th>
                  <th scope="col">{t.t('ai.col.observed')}</th>
                  <th scope="col">{t.t('ai.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t.t('ai.gate.shadowDuration')}</td>
                  <td>{r.gates.shadowDuration.value ?? r.gates.shadowDuration.have ?? '—'}</td>
                  <td>
                    <StatusPill tone={gateStatusTone(r.gates.shadowDuration.kind)}
                      label={t.t(gateStatusKey(r.gates.shadowDuration.kind))} />
                  </td>
                </tr>
                <tr>
                  <td>{t.t('ai.gate.overrideRate')}</td>
                  <td>
                    {r.gates.overrideRate.kind === 'insufficient'
                      ? t.t('ai.gate.sample', { have: String(r.gates.overrideRate.have ?? 0), need: String(r.gates.overrideRate.need ?? 0) })
                      : formatRate(r.gates.overrideRate.value)}
                  </td>
                  <td>
                    <StatusPill tone={gateStatusTone(r.gates.overrideRate.kind)}
                      label={t.t(gateStatusKey(r.gates.overrideRate.kind))} />
                  </td>
                </tr>
                {/* THE ROWS W088 ASKS FOR THAT NOTHING MEASURES. Shown rather than omitted, because omitting them would
                    hide that the canon asked — and shown as UNMEASURED rather than as ticks, because a tick would be a
                    lie about a metric this platform does not record. */}
                {r.gates.unmeasured.map((u) => (
                  <tr key={u.metric}>
                    <td>{u.metric}</td>
                    <td><small>{u.why}</small></td>
                    <td><StatusPill tone={gateStatusTone('unmeasured')} label={t.t(gateStatusKey('unmeasured'))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={adviceClass(r.advice.advice)} role="status">
              {t.t(adviceKey(r.advice.advice))}
              {r.advice.reason ? ` — ${r.advice.reason}` : ''}
              {r.advice.unmeasured?.length ? ` (${r.advice.unmeasured.join(', ')})` : ''}
            </p>
          </section>

          {/* ---------------- AUTO-ROLLBACK ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-rollback">
            <h2 id="ai-rollback" className="kv-panel__title">{t.t('ai.rollback.title')}</h2>
            {/* W088: "Auto-rollback armed · rollbacks are recorded, never silent." IT IS ARMED BY POLICY AND BY NO RUNNING
                CODE, and this says so — promising an automatic rollback nothing performs would be the fifth
                status-claiming-an-act-nobody-does on this platform. */}
            <p className={rollbackClass(r.rollback.enforced, r.rollback.signal.fires)} role={r.rollback.signal.fires ? 'alert' : 'status'}>
              {t.t(rollbackKey(r.rollback.enforced, r.rollback.signal.fires))}
            </p>
            <Callout>{r.rollback.note}</Callout>
          </section>

          {/* ---------------- THE DECISION ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-transition">
            <h2 id="ai-transition" className="kv-panel__title">{t.t('ai.transition.title')}</h2>

            {r.model.proposedStatus ? (
              <>
                <p>
                  {t.t('ai.transition.proposed', {
                    to: r.model.proposedStatus,
                    who: r.model.proposedByAdminId ? r.model.proposedByAdminId.slice(0, 8) : t.t('ai.maker.unknown'),
                    at: (r.model.proposedAt ?? '').slice(0, 16).replace('T', ' '),
                  })}
                </p>
                {r.model.proposalReason ? <p className="kv-pre">{r.model.proposalReason}</p> : null}

                {/* MAKER-CHECKER BY ABSENCE. Not drawn when this viewer proposed it, or when the gate is shut. */}
                {showApproveTransition(r.canApprove) ? (
                  <form action={approveTransitionAction}>
                    <input type="hidden" name="id" value={r.model.id} />
                    <p>{t.t('ai.transition.confirm', { to: r.model.proposedStatus })}</p>
                    <Button type="submit" variant="danger">{t.t('ai.transition.approve')}</Button>
                  </form>
                ) : (
                  <Callout tone="warning" live="polite">{t.t('ai.transition.cannotApprove')}</Callout>
                )}

                {/* Withdraw IS shown to the maker: withdrawing your own proposal is noticing your own mistake, and
                    needing a colleague to stop a promotion would make the safe action the expensive one. */}
                {showWithdraw(r.model.proposedStatus) ? (
                  <form action={withdrawTransitionAction}>
                    <input type="hidden" name="id" value={r.model.id} />
                    <Button type="submit">{t.t('ai.transition.withdraw')}</Button>
                  </form>
                ) : null}
              </>
            ) : (
              <form action={proposeTransitionAction}>
                <input type="hidden" name="id" value={r.model.id} />
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="ai-to">{t.t('ai.transition.to')}</label>
                  <select className="kv-input" id="ai-to" name="to" defaultValue="canary">
                    <option value="canary">canary</option>
                    <option value="production">production</option>
                    <option value="shadow">shadow</option>
                    <option value="retired">retired</option>
                  </select>
                </div>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="ai-pct">{t.t('ai.transition.canaryPct')}</label>
                  {/* A FIXED LADDER, not a free number. An operator typing 37% is making an unreviewable decision, and
                      the value of a canary is comparing like with like across models and weeks. */}
                  <select className="kv-input" id="ai-pct" name="canaryPercent" defaultValue={String(r.nextCanaryStep ?? 10)}>
                    <option value="10">10%</option>
                    <option value="50">50%</option>
                  </select>
                  <p className="kv-field__help">{t.t(nextStepKey(r.nextCanaryStep))}</p>
                </div>
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="ai-reason">{t.t('ai.transition.reason')}</label>
                  <textarea className="kv-input" id="ai-reason" name="reason" minLength={20} maxLength={2000} required
                    aria-describedby="ai-reason-help" />
                  <p className="kv-field__help" id="ai-reason-help">{t.t('ai.transition.reasonHelp')}</p>
                </div>
                <Button type="submit">{t.t('ai.transition.propose')}</Button>
              </form>
            )}
          </section>

          {/* ---------------- PROVENANCE ---------------- */}
          {r.provenance?.auditId ? (
            <section className="kv-panel" aria-labelledby="ai-prov">
              <h2 id="ai-prov" className="kv-panel__title">{t.t('ai.prov.title')}</h2>
              {/* THE AUDIT BY ID. "Why is this model in production" is answerable with a row rather than with a column's
                  current value — which is the whole reason the gate points at a record instead of reading a jsonb field. */}
              <p>{t.t('ai.prov.body', {
                audit: r.provenance.auditId.slice(0, 8),
                who: r.provenance.promotedByAdminId ? r.provenance.promotedByAdminId.slice(0, 8) : '—',
                at: (r.provenance.promotedAt ?? '').slice(0, 16).replace('T', ' '),
              })}</p>
            </section>
          ) : null}

          {/* W088's alert strip, read across the whole registry rather than this model. */}
          {r.awaitingChecker.length > 0 ? (
            <section className="kv-panel is-warn" aria-labelledby="ai-awaiting">
              <h2 id="ai-awaiting" className="kv-panel__title">{t.t('ai.awaiting.title')}</h2>
              <ul>
                {r.awaitingChecker.map((a) => (
                  <li key={a.id}>
                    <Link href={`/ai-models/${encodeURIComponent(a.id)}/rollout`}>{a.code} {a.version}</Link>
                    {' → '}{a.proposedStatus}
                    {a.proposedByAdminId ? ` · ${t.t('ai.maker')} ${a.proposedByAdminId.slice(0, 8)}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
