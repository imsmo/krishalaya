// apps/web-admin/src/app/recon/payouts/[id]/page.tsx · W067, the payout batch detail (PC-56 ADMIN-6b).
//
// THE MONEY DOOR. "Approve & execute PB-0713-02? · 214 payouts totalling ₹4,82,120 leave escrow for farmer bank accounts
// via RazorpayX · This action is recorded · maker Priya S. ≠ checker (you) enforced."
//
// Before this wave every clause of that dialog was false. There was no approval column on `payout_batches`, no approve
// endpoint in any app, and `payout-execution.cadence-job.ts` disbursed every queued payout on a five-minute timer
// without ever reading a batch — so an operator pressing Approve would have been confirming a decision the timer had
// already made. 0114 adds the columns, the tenth maker-checker constraint and a BEFORE UPDATE trigger that refuses to
// let a batched payout leave `queued` unless its batch is approved.
//
// MAKER-CHECKER BY ABSENCE. When the viewer opened the batch, the Approve control is NOT RENDERED — not rendered and
// disabled. A disabled button teaches an operator that they nearly have the right to authorise their own disbursement;
// an absent one beside a line naming the rule teaches them to find a colleague.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { approveBatchAction, returnBatchAction, preflightBatchAction } from '../actions';
import { Button, Callout, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  approvalNoticeClass, approvalNoticeKey, bankCell, driftKey, failureKey, formatMinor, laneKey,
  payableDiffers, payoutStatusTone, phaseTone, phaseKey, preflightTone, preflightKey, preflightVerdict,
  showApprove, showReturn, shortfallKey, type ApprovalKind, type Phase,
} from '../../../../features/payouts/payouts';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('po.batch.title'), robots: { index: false, follow: false } };
}

interface Detail {
  id: string; tenantId: string | null; batchType: string; status: string; phase: Phase; count: number;
  requestedMinor: string; settledMinor: string; shortfall: boolean; shortfallMinor: string;
  openedByAdminId: string | null; approvedByAdminId: string | null; approvedAt: string | null;
  returnedByAdminId: string | null; returnedAt: string | null; returnReason: string | null;
  executedAt: string | null; createdAt: string;
  preflight: { pass: boolean; checked: number; blocked: number; payableMinor: string; totalMinor: string; byFailure: Record<string, number> } | null;
  preflightOverLimit: { limit: number } | null;
  recordedPreflight: Record<string, unknown> | null;
  recordedPreflightAt: string | null;
  drift: { drifted: boolean; reason?: string } | null;
  approval: { kind: ApprovalKind; status?: string; blocked?: number };
  payouts: {
    id: string; userId: string | null; purposeCode: string | null; bankLast4: string | null; bankIfsc: string | null;
    amountMinor: string; status: string; priority: number; failureCode: string | null; preflightFailures: string[];
    createdAt: string;
  }[];
  nextCursor: string | null;
}

export default async function PayoutBatchPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { cursor?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let d: Detail | null = null; let notice: string | undefined;
  try {
    const q = searchParams.cursor ? `?cursor=${encodeURIComponent(searchParams.cursor)}` : '';
    const res = await adminGet<Detail | null>(`payouts/batches/${encodeURIComponent(params.id)}${q}`);
    d = res.data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'po.restricted.batch' : 'po.error.batch';
  }
  if (!d && !notice) notFound();

  const verdict = d ? preflightVerdict(d.preflight, d.preflightOverLimit) : 'not_run';
  const drift = d ? driftKey(d.drift) : null;
  const kind = d?.approval.kind ?? 'no_preflight';

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/recon">{t.t('nav.recon')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/recon/payouts">{t.t('po.batches.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{params.id.slice(0, 8)}</span>
      </nav>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`po.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`po.err.${searchParams.error}`)}</Callout> : null}

      {d ? (
        <>
          <header className="kv-page__head">
            <h1>{t.t('po.batch.title')} {d.id.slice(0, 8)}</h1>
            <p className="kv-page__sub">
              <StatusPill tone={phaseTone(d.phase)} label={t.t(phaseKey(d.phase))} />{' '}
              {d.batchType} · {t.t('po.awaiting.count', { n: String(d.count) })} ·{' '}
              {/* REQUESTED, not "total". The figure under review is the Σ of the payouts inside the batch; `total_minor`
                  is what the run has SETTLED so far and is 0 until it executes. Two different numbers, both shown, each
                  labelled — a screen that showed one under the other's heading is how "₹4,82,120 executed" comes to
                  mean "₹4,82,120 attempted". */}
              {t.t('po.requested')}: {formatMinor(d.requestedMinor)}
              {d.phase === 'executed' || d.phase === 'failed'
                ? ` · ${t.t('po.settled')}: ${formatMinor(d.settledMinor)}` : ''}
            </p>
            {d.shortfall ? (
              <Callout tone="danger" live="assertive">
                {t.t(shortfallKey(true) ?? 'po.batch.shortfall', { amount: formatMinor(d.shortfallMinor) })}
              </Callout>
            ) : null}
          </header>

          {/* ---------------- THE PREFLIGHT PANEL ---------------- */}
          <section className="kv-panel" aria-labelledby="po-pf">
            <h2 id="po-pf" className="kv-panel__title">{t.t('po.pf.title')}</h2>
            <p>
              <StatusPill tone={preflightTone(verdict)} label={t.t(preflightKey(verdict))} />
              {d.preflight ? (
                <> {t.t('po.pf.checked', { n: String(d.preflight.checked), blocked: String(d.preflight.blocked) })}</>
              ) : null}
            </p>
            {d.preflightOverLimit ? (
              <Callout tone="danger">
                {t.t('po.pf.overLimit', { limit: String(d.preflightOverLimit.limit) })}
              </Callout>
            ) : null}
            {d.preflight && payableDiffers(d.preflight.payableMinor, d.preflight.totalMinor) ? (
              <Callout tone="danger">
                {t.t('po.pf.payable', {
                  payable: formatMinor(d.preflight.payableMinor), total: formatMinor(d.preflight.totalMinor),
                })}
              </Callout>
            ) : null}
            {d.preflight && Object.keys(d.preflight.byFailure).length > 0 ? (
              <ul>
                {Object.entries(d.preflight.byFailure).map(([f, n]) => (
                  <li key={f}>{n} × {t.t(failureKey(f))}</li>
                ))}
              </ul>
            ) : null}
            {/* WHAT THE CHECKER ACTUALLY SIGNED, beside what is true now. A screen showing only the live figure would
                silently redraw a signed decision; one showing only the stored figure would hide a wallet frozen five
                minutes ago. */}
            {d.recordedPreflightAt ? (
              <Callout tone="info">{t.t('po.pf.recorded', { at: d.recordedPreflightAt.slice(0, 16).replace('T', ' ') })}</Callout>
            ) : null}
            {drift ? <Callout tone="danger" live="assertive">{t.t(drift)}</Callout> : null}

            {/* Re-running the preflight is itself recorded, including a FAILING result — which is the evidence that
                somebody looked. */}
            {d.status === 'open' ? (
              <form action={preflightBatchAction}>
                <input type="hidden" name="id" value={d.id} />
                <Button type="submit">{t.t('po.pf.run')}</Button>
              </form>
            ) : null}
          </section>

          {/* ---------------- WHO DECIDED ---------------- */}
          <section className="kv-panel" aria-labelledby="po-who">
            <h2 id="po-who" className="kv-panel__title">{t.t('po.who.title')}</h2>
            <dl className="kv-stat-row">
              <div>
                <dt>{t.t('po.maker')}</dt>
                {/* Ids, not names. There is no `users` row behind an admin id — the realm-identity finding for the fifth
                    time — and rendering a display name would mean inventing an identity or joining to the wrong table. */}
                <dd>{d.openedByAdminId ? d.openedByAdminId.slice(0, 8) : t.t('po.maker.unknown')}</dd>
              </div>
              <div>
                <dt>{t.t('po.checker')}</dt>
                <dd>{d.approvedByAdminId ? `${d.approvedByAdminId.slice(0, 8)} · ${(d.approvedAt ?? '').slice(0, 16).replace('T', ' ')}` : '—'}</dd>
              </div>
              {d.returnedAt ? (
                <div>
                  <dt>{t.t('po.returned')}</dt>
                  <dd>{`${(d.returnedByAdminId ?? '').slice(0, 8)} · ${d.returnedAt.slice(0, 16).replace('T', ' ')}`}</dd>
                </div>
              ) : null}
            </dl>
            {d.returnReason ? <p className="kv-pre">{d.returnReason}</p> : null}
          </section>

          {/* ---------------- THE DECISION ---------------- */}
          <section className="kv-panel" aria-labelledby="po-decide">
            <h2 id="po-decide" className="kv-panel__title">{t.t('po.decide.title')}</h2>

            {/* The notice is rendered in EVERY non-approvable state, including the approvable one's absence — the
                control's absence without an explanation is just a missing button. */}
            {!showApprove(kind) ? (
              <p className={approvalNoticeClass(kind)} role="status">
                {t.t(approvalNoticeKey(kind), {
                  status: d.approval.status ?? d.status,
                  blocked: String(d.approval.blocked ?? d.preflight?.blocked ?? 0),
                })}
              </p>
            ) : null}

            {showApprove(kind) ? (
              <form action={approveBatchAction}>
                <input type="hidden" name="id" value={d.id} />
                {/* Every consequence stated here is now true: the money leaves, the audit row records who authorised it
                    with the preflight they signed, and the farmer is notified on success (0114 seeds the
                    `payout.credited` templates the platform had never had a producer for). */}
                <p>{t.t('po.confirm.body', {
                  n: String(d.preflight?.checked ?? d.count),
                  amount: formatMinor(d.preflight?.payableMinor ?? d.requestedMinor),
                })}</p>
                <Callout tone="info">{t.t('po.confirm.recorded')}</Callout>
                <Button type="submit" variant="danger">{t.t('po.approve')}</Button>
              </form>
            ) : null}

            {showReturn(kind) ? (
              <form action={returnBatchAction}>
                <input type="hidden" name="id" value={d.id} />
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="po-reason">{t.t('po.return.reason')}</label>
                  {/* 20 characters, matching 0114's CHECK. The maker is the only reader of this sentence and "no" is not
                      a review. */}
                  <textarea className="kv-input" id="po-reason" name="reason" minLength={20} maxLength={2000} required
                    aria-describedby="po-reason-help" />
                  <p className="kv-field__help" id="po-reason-help">{t.t('po.return.help')}</p>
                </div>
                <Button type="submit">{t.t('po.return')}</Button>
              </form>
            ) : null}
          </section>

          {/* ---------------- THE LINES ---------------- */}
          <table className="kv-table">
            <caption className="kv-table__caption">{t.t('po.lines.caption', { n: String(d.count) })}</caption>
            <thead>
              <tr>
                <th scope="col">{t.t('po.col.payout')}</th>
                <th scope="col">{t.t('po.col.payee')}</th>
                <th scope="col">{t.t('po.col.purpose')}</th>
                <th scope="col">{t.t('po.col.bank')}</th>
                <th scope="col">{t.t('po.col.amount')}</th>
                <th scope="col">{t.t('po.col.status')}</th>
                <th scope="col">{t.t('po.col.lane')}</th>
                <th scope="col">{t.t('po.col.preflight')}</th>
              </tr>
            </thead>
            <tbody>
              {d.payouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.id.slice(0, 8)}</td>
                  <td>{p.userId ? p.userId.slice(0, 8) : t.t('po.noPayee')}</td>
                  <td>{p.purposeCode ?? '—'}</td>
                  <td>{bankCell(p.bankLast4, p.bankIfsc)}</td>
                  <td>{formatMinor(p.amountMinor)}</td>
                  <td><StatusPill tone={payoutStatusTone(p.status)} label={p.status} /></td>
                  <td>{t.t(laneKey(p.priority))}</td>
                  {/* [QA-FIX 2026-08-15] was hardcoded tone="neutral" by the Callout/static-literal sweep,
                      discarding the original `kv-badge is-danger` modifier — preflight failures are a
                      money-blocking condition and must render danger, not a neutral/grey pill. */}
                  <td>
                    {p.preflightFailures.length === 0 ? '—' : (
                      <StatusPill tone="danger" icon={false} label={p.preflightFailures.map((f) => t.t(failureKey(f))).join(', ')} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {d.payouts.length === 0 ? (
            <EmptyState variant="empty" title={t.t('po.lines.empty.title')} body={t.t('po.lines.empty.body')} />
          ) : null}

          {d.nextCursor ? (
            <nav className="kv-pager" aria-label={t.t('common.pagination')}>
              <Button as={Link} href={`/recon/payouts/${encodeURIComponent(d.id)}?cursor=${encodeURIComponent(d.nextCursor)}`}>
                {t.t('common.next')}
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
