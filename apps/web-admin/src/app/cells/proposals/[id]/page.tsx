// apps/web-admin/src/app/cells/proposals/[id]/page.tsx · W029/W030/W031/W036's checker (PC-56 ADMIN-8).
//
// THE CHECKER THE CANON NAMES FIVE TIMES. W029 "ALL changes are maker-checker + reasoned"; W030's drain dialog "requires
// checker (`cells.approve`) · blocked while is_default=true"; W031 "Weight/status changes need … checker"; W036 "Raising
// capacity_tenants needs … checker (infra cost approval)"; W038 "Set is_default for BD → open for placements (checker)".
// Every one of those writes was one operator with `cells.manage`, applied immediately, and `cells.approve` existed in no
// realm.
//
// MAKER-CHECKER BY ABSENCE. When the viewer proposed the change, Apply is NOT RENDERED — not rendered and disabled. A
// disabled button teaches an operator that they nearly have the right to authorise their own topology change; an absent one
// beside a line naming the rule teaches them to find a colleague.
//
// AND THE STALENESS CHECK IS WHAT MAKES THE SIGNATURE MEAN ANYTHING. The maker recorded what they observed; this page
// re-reads the row and refuses if a field they were looking at has moved. Without it, a checker's approval would land on a
// diff that never existed — overwriting whoever changed the cell in between.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { applyProposalAction, rejectProposalAction, staleProposalAction } from '../../actions';
import {
  actionClass, actionKey, approvalNoticeClass, approvalNoticeKey, diffText, entityKey, fieldIsCritical,
  orderDiff, proposalClass, proposalKey, showApply, showMarkStale, showReject, stalenessKey,
} from '../../../../features/cells/map-approval';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cm.proposal.title'), robots: { index: false, follow: false } };
}

interface Detail {
  id: string; entityType: string; entityId: string; action: string;
  patch: Record<string, unknown>; observed: Record<string, unknown>;
  reason: string; status: string;
  proposedByAdminId: string; proposedAt: string;
  decidedByAdminId: string | null; decidedAt: string | null; decisionNote: string | null;
  appliedChangeId: string | null;
  diff: { field: string; from: unknown; to: unknown }[];
  staleness: { stale: boolean; reason?: string; fields?: string[] };
  approval: { kind: string; status?: string; detail?: unknown };
}

export default async function ProposalPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let d: Detail | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Detail | null>(`cells/proposals/${encodeURIComponent(params.id)}`);
    d = res.data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'cm.restricted.proposal' : 'cm.error.proposal';
  }
  if (!d && !notice) notFound();

  const kind = d?.approval.kind ?? 'already';
  const staleKey = d ? stalenessKey(d.staleness) : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/cells/changes">{t.t('cm.changes.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{params.id.slice(0, 8)}</span>
      </nav>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`cm.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`cm.err.${searchParams.error}`)}</p> : null}

      {d ? (
        <>
          <header className="kv-page__head">
            <h1>{t.t('cm.proposal.title')} — {t.t(entityKey(d.entityType))} {d.entityId.slice(0, 8)}</h1>
            <p className="kv-page__sub">
              <span className={proposalClass(d.status)}>{t.t(proposalKey(d.status))}</span>{' '}
              <span className={actionClass(d.action)}>{t.t(actionKey(d.action))}</span>
              {' · '}{t.t('cm.maker')} {d.proposedByAdminId.slice(0, 8)}
              {' · '}{d.proposedAt.slice(0, 16).replace('T', ' ')}
            </p>
          </header>

          {/* ---------------- THE DIFF ---------------- */}
          <section className="kv-panel" aria-labelledby="cm-diff">
            <h2 id="cm-diff" className="kv-panel__title">{t.t('cm.proposal.diff')}</h2>
            {d.diff.length === 0 ? (
              <p className="kv-note is-warn">{t.t('cm.proposal.noDiff')}</p>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('cm.col.field')}</th>
                    <th scope="col">{t.t('cm.col.from')}</th>
                    <th scope="col">{t.t('cm.col.to')}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Built from `observed` and `patch` so the CHECKER sees it BEFORE deciding. A diff rendered only after
                      the fact is a receipt, not a review. */}
                  {orderDiff(d.diff).map((line) => (
                    <tr key={line.field}>
                      <td>
                        <span className={fieldIsCritical(line.field) ? 'kv-badge is-warn' : 'kv-badge'}>{line.field}</span>
                      </td>
                      <td><code>{diffText(line.from)}</code></td>
                      <td><code>{diffText(line.to)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="kv-pre">{d.reason}</p>
          </section>

          {/* ---------------- STALENESS ---------------- */}
          {staleKey ? (
            <p className="kv-note is-danger" role="alert">
              {t.t(staleKey, { fields: (d.staleness.fields ?? []).join(', ') })}
            </p>
          ) : null}

          {/* ---------------- THE DECISION ---------------- */}
          <section className="kv-panel" aria-labelledby="cm-decide">
            <h2 id="cm-decide" className="kv-panel__title">{t.t('cm.proposal.decision')}</h2>

            {/* The notice is rendered in every non-approvable state — a withheld control without an explanation is just a
                missing button. */}
            {!showApply(kind) ? (
              <p className={approvalNoticeClass(kind)} role="status">
                {t.t(approvalNoticeKey(kind), { status: d.approval.status ?? d.status })}
              </p>
            ) : null}

            {showApply(kind) ? (
              <form action={applyProposalAction}>
                <input type="hidden" name="id" value={d.id} />
                <p>{t.t('cm.proposal.confirm')}</p>
                <button className="kv-btn kv-btn--danger" type="submit">{t.t('cm.proposal.apply')}</button>
              </form>
            ) : null}

            {showReject(kind) ? (
              <form action={rejectProposalAction}>
                <input type="hidden" name="id" value={d.id} />
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="cm-note">{t.t('cm.proposal.rejectReason')}</label>
                  {/* 20 characters, matching 0116's CHECK. The maker is its only reader. */}
                  <textarea className="kv-input" id="cm-note" name="note" minLength={20} maxLength={2000} required
                    aria-describedby="cm-note-help" />
                  <p className="kv-field__help" id="cm-note-help">{t.t('cm.proposal.rejectHelp')}</p>
                </div>
                <button className="kv-btn" type="submit">{t.t('cm.proposal.reject')}</button>
              </form>
            ) : null}

            {/* Mark-stale appears ONLY when the server says the proposal IS stale. It is not a way of dismissing a
                proposal one disagrees with — that is Reject, which requires a reason — and conflating them would let
                somebody bury a colleague's change without writing one. */}
            {showMarkStale(kind) ? (
              <form action={staleProposalAction}>
                <input type="hidden" name="id" value={d.id} />
                <button className="kv-btn" type="submit">{t.t('cm.proposal.markStale')}</button>
              </form>
            ) : null}
          </section>

          {/* ---------------- WHAT HAPPENED ---------------- */}
          {d.decidedAt ? (
            <section className="kv-panel" aria-labelledby="cm-outcome">
              <h2 id="cm-outcome" className="kv-panel__title">{t.t('cm.proposal.outcome')}</h2>
              <p>
                {t.t('cm.proposal.decided', {
                  status: d.status,
                  // A stale outcome has no decider on purpose: staleness is DETECTED rather than decided, and attributing
                  // it to whoever opened the screen would put a decision in somebody's name they did not make.
                  who: d.decidedByAdminId ? d.decidedByAdminId.slice(0, 8) : t.t('cm.decider.none'),
                  at: d.decidedAt.slice(0, 16).replace('T', ' '),
                })}
              </p>
              {d.decisionNote ? <p className="kv-pre">{d.decisionNote}</p> : null}
              {/* THE CHANGE ROW THIS SIGNATURE PRODUCED, by id. What makes "who authorised this routing change" answerable
                  from the trail rather than from an adjacent timestamp. */}
              {d.appliedChangeId ? (
                <p className="kv-note">
                  {t.t('cm.proposal.appliedAs', { id: d.appliedChangeId.slice(0, 8) })}{' '}
                  <Link href="/cells/changes">{t.t('cm.proposal.openHistory')}</Link>
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
