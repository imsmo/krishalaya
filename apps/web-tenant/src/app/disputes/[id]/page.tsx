// apps/web-tenant/src/app/disputes/[id]/page.tsx · tenant dispute detail + moderation. Server-first,
// requireSession-gated. disputes.get(id) → notFound() on a missing/foreign id (the API is tenant-scoped = the
// IDOR guard). Surfaces only LEGAL moderation actions for the current status (features/disputes/manage.ts,
// unit-tested): take-under-review / escalate / resolve (with a decision + optional amount). Money via
// formatMoneyMinor; all copy via i18n; noindex.
//
// PC-22 (2026-08-04 — former SDK-gap flag CLOSED): the SDK now exposes disputes.respond() (party-only
// seller_responded transition, server-asserted) + disputes.postMessage()/messages() (append-only evidence
// thread). The respond button shows only when the CALLER is the against-party AND the transition is legal
// (features/disputes/manage.canRespond — reflect, never grant; the API re-asserts the party on every call).
// The thread renders with derived roles (complainant/respondent/moderator — ids only, PII-minimal contract).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { canReview, canEscalate, canResolve, canRespond, messageAuthorRole, RESOLUTION_TYPES } from '../../../features/disputes/manage';
import { reviewDisputeAction, escalateDisputeAction, resolveDisputeAction, respondDisputeAction, postDisputeMessageAction, proposeRefundAction, decideRefundAction } from '../actions';
import { moneyBasisKey, gateView, canSign, disputedValue } from '../../../features/disputes/console';
import { tenantHasPerm } from '../../../lib/auth';
import type { Dispute, DisputeMessage, DisputeMoneyState, RefundApproval } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('disputeDetail.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['review', 'escalate', 'resolve', 'type', 'amount', 'illegal', 'respond', 'message', 'notparty',
  // PC-56 TENANT-3b: every refusal the refund gate can produce is translated by NAME. A generic "something went
  // wrong" on a refund is the message that makes an operator press the button again.
  'needsChecker', 'awaitingChecker', 'rejectedByChecker', 'amountChanged', 'alreadyApplied', 'checkerIsMaker',
  'noteTooShort', 'refundPerm', 'proposalDuplicate', 'propose', 'decide']);
const OK = new Set(['review', 'escalate', 'resolve', 'respond', 'message', 'proposed', 'approved', 'rejected']);

export default async function DisputeDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/disputes/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let dispute: Dispute;
  try { dispute = await tenantClient().disputes.get(params.id); }
  catch { notFound(); }

  // Caller identity (for the party-only respond gate) + thread — each degrades independently (Law 12).
  let meId: string | null = null;
  try { meId = (await tenantClient().auth.me()).id; } catch { meId = null; }
  let thread: DisputeMessage[] = []; let threadFailed = false;
  try { thread = (await tenantClient().disputes.messages(params.id, { limit: 50 })).items; }
  catch { threadFailed = true; }

  // W141's money card + the refund gate + the approval history. Each degrades on its own (Law 12) — and the money
  // card degrades to SILENCE rather than to zeroes: a card that cannot read the ledger must not print a figure.
  const canResolvePerm = tenantHasPerm('dispute.resolve');
  const canRefundPerm = tenantHasPerm('order.refund');
  let moneyBox: DisputeMoneyState | null = null;
  let moneyFailed = false;
  try { moneyBox = await tenantClient().disputes.money(params.id); } catch { moneyFailed = true; }

  // The amount a refund would be for: the recorded scope, else the resolution already recorded, else nothing — and
  // where there is nothing the gate is not consulted at all, because a gate needs a figure to compare (the same
  // bypass the API closed on the resolve path).
  const scope = disputedValue({ disputedAmountMinor: dispute.disputedAmountMinor ?? null });
  const gateAmount = scope.kind === 'amount' ? scope.minor : (moneyBox?.maxRefundableMinor ?? null);
  let gate: { gate: string; approvalId: string | null; thresholdMinor: string; usedDefaultThreshold: boolean } | null = null;
  if (canResolvePerm && gateAmount) {
    try { gate = await tenantClient().disputes.refundState(params.id, gateAmount); } catch { gate = null; }
  }
  const gv = gate ? gateView(gate.gate) : null;
  let approvals: RefundApproval[] = [];
  if (canResolvePerm) {
    try { approvals = await tenantClient().refundApprovals.history('dispute', params.id); } catch { approvals = []; }
  }
  const openProposal = approvals.find((a) => a.status === 'pending') ?? null;

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const facts: Array<[string, string]> = [
    [t.t('disputeDetail.status'), dispute.status],
    [t.t('disputeDetail.order'), dispute.orderId],
    [t.t('disputeDetail.description'), dispute.description ?? t.t('common.dash')],
    [t.t('disputeDetail.resolution'), dispute.resolutionType ?? t.t('common.dash')],
    [t.t('disputeDetail.resolutionAmount'), dispute.resolutionAmountMinor ? formatMoneyMinor(dispute.resolutionAmountMinor, 'INR', lang) : t.t('common.dash')],
    [t.t('disputeDetail.sla'), dispute.slaDueAt ? formatDate(dispute.slaDueAt, lang) : t.t('common.dash')],
    // W141's "disputed value ₹12,820 (2 of 10 qtl)". An unrecorded scope says so — it is not zero, and it is not the
    // whole order (0139 never backfills the column).
    [t.t('dsp.disputedValue'), scope.kind === 'amount'
      ? formatMoneyMinor(scope.minor, moneyBox?.currencyCode ?? 'INR', lang)
        + (dispute.disputedQuantity ? ` (${dispute.disputedQuantity})` : '')
      : t.t('dsp.scopeNotRecorded')],
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('disputeDetail.heading')}</h1>
        <Link href="/disputes" className="kv-btn--link">← {t.t('disputes.title')}</Link>
      </div>

      {okKey && <p className="kv-success" role="status">{t.t('disputeDetail.done')}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`disputeDetail.error.${errorKey}`)}</p>}

      <dl className="kv-facts">
        {facts.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      {(canReview(dispute.status) || canEscalate(dispute.status)) && (
        <div className="kv-actions">
          {canReview(dispute.status) && (
            <form action={reviewDisputeAction} className="kv-inline-form">
              <input type="hidden" name="id" value={dispute.id} />
              <button type="submit" className="kv-btn">{t.t('disputeDetail.review')}</button>
            </form>
          )}
          {canEscalate(dispute.status) && (
            <form action={escalateDisputeAction} className="kv-inline-form">
              <input type="hidden" name="id" value={dispute.id} />
              <button type="submit" className="kv-btn kv-btn--muted">{t.t('disputeDetail.escalate')}</button>
            </form>
          )}
        </div>
      )}

      {canResolve(dispute.status) && (
        <form action={resolveDisputeAction} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('disputeDetail.resolve')}</h2>
          <input type="hidden" name="id" value={dispute.id} />
          <label htmlFor="resolutionType" className="kv-field__label">{t.t('disputeDetail.resolutionType')}</label>
          <select id="resolutionType" name="resolutionType" className="kv-select" defaultValue="refund_full">
            {RESOLUTION_TYPES.map((r) => <option key={r} value={r}>{t.t(`disputeDetail.resType.${r}`)}</option>)}
          </select>
          <label htmlFor="amountMajor" className="kv-field__label">{t.t('disputeDetail.amount')}</label>
          <input id="amountMajor" name="amountMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" />
          <p className="kv-field__hint">{t.t('disputeDetail.amountHint')}</p>
          <label htmlFor="note" className="kv-field__label">{t.t('disputeDetail.note')}</label>
          <textarea id="note" name="note" className="kv-textarea" rows={3} maxLength={2000} />
          <button type="submit" className="kv-btn">{t.t('disputeDetail.resolveBtn')}</button>
        </form>
      )}

      {canRespond(dispute.status, dispute.againstUser, meId) && (
        <form action={respondDisputeAction} className="kv-inline-form">
          <input type="hidden" name="id" value={dispute.id} />
          <button type="submit" className="kv-btn">{t.t('disputeDetail.respondBtn')}</button>
          <p className="kv-field__hint">{t.t('disputeDetail.respondHint')}</p>
        </form>
      )}

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('dsp.moneyState')}</h2>
        {moneyFailed || !moneyBox ? (
          <p className="kv-muted">{t.t('dsp.moneyUnreadable')}</p>
        ) : (
          <>
            <p>{t.t(`dsp.basis.${moneyBasisKey(moneyBox.basis)}`)}</p>
            <dl className="kv-facts">
              <div className="kv-facts__row">
                <dt>{t.t('dsp.heldNow')}</dt>
                <dd>{moneyBox.heldMinor ? formatMoneyMinor(moneyBox.heldMinor, moneyBox.currencyCode ?? 'INR', lang) : t.t('common.dash')}</dd>
              </div>
              {moneyBox.scopeRecorded && moneyBox.undisputedMinor && (
                <div className="kv-facts__row">
                  <dt>{t.t('dsp.undisputed')}</dt>
                  <dd>{formatMoneyMinor(moneyBox.undisputedMinor, moneyBox.currencyCode ?? 'INR', lang)}</dd>
                </div>
              )}
              {moneyBox.resolutionTxnId && (
                <div className="kv-facts__row"><dt>{t.t('dsp.refundTxn')}</dt><dd className="kv-mono">{moneyBox.resolutionTxnId}</dd></div>
              )}
            </dl>
            {/* THE SENTENCE THE CANON DOES NOT HAVE. W141 shows the undisputed part "already paid out on schedule";
                on this platform escrow holds the whole order until the dispute closes, and the operator is told so
                rather than being left to infer it from a figure. */}
            {moneyBox.undisputedHeldToo && <p className="kv-notice" role="note">{t.t('dsp.undisputedHeldToo')}</p>}
          </>
        )}
      </div>

      {canResolvePerm && (
        <div className="kv-card">
          <h2 className="kv-card__title">{t.t('dsp.refundGate')}</h2>
          {!gateAmount ? (
            <p className="kv-muted">{t.t('dsp.gateNoAmount')}</p>
          ) : !gate || !gv ? (
            <p className="kv-muted">{t.t('dsp.gateUnreadable')}</p>
          ) : (
            <>
              <p>{t.t(`dsp.gate.${gv.key}`, {
                amount: formatMoneyMinor(gateAmount, moneyBox?.currencyCode ?? 'INR', lang),
                threshold: formatMoneyMinor(gate.thresholdMinor, moneyBox?.currencyCode ?? 'INR', lang),
              })}</p>
              {gate.usedDefaultThreshold && <p className="kv-field__hint">{t.t('dsp.thresholdDefault')}</p>}

              {gv.canPropose && (
                <form action={proposeRefundAction} className="kv-form">
                  <input type="hidden" name="id" value={dispute.id} />
                  <input type="hidden" name="amountMinor" value={gateAmount} />
                  <label className="kv-field__label" htmlFor="proposalNote">{t.t('dsp.proposalNote')}</label>
                  <textarea id="proposalNote" name="note" className="kv-textarea" rows={2} minLength={20} maxLength={2000} required />
                  <p className="kv-field__hint">{t.t('dsp.proposalNoteHint')}</p>
                  <button type="submit" className="kv-btn">{t.t('dsp.proposeCta')}</button>
                </form>
              )}

              {gv.canDecide && openProposal && (
                canSign(openProposal.proposedBy, meId, canRefundPerm) ? (
                  <form action={decideRefundAction} className="kv-form">
                    <input type="hidden" name="id" value={dispute.id} />
                    <input type="hidden" name="approvalId" value={openProposal.id} />
                    <p>{t.t('dsp.proposalBy', { amount: formatMoneyMinor(openProposal.amountMinor, moneyBox?.currencyCode ?? 'INR', lang) })}</p>
                    <p className="kv-review__body">{openProposal.proposalNote}</p>
                    <label className="kv-field__label" htmlFor="decisionNote">{t.t('dsp.decisionNote')}</label>
                    <textarea id="decisionNote" name="note" className="kv-textarea" rows={2} maxLength={2000} />
                    <button type="submit" name="decision" value="approved" className="kv-btn">{t.t('dsp.approveCta')}</button>
                    <button type="submit" name="decision" value="rejected" className="kv-btn kv-btn--muted">{t.t('dsp.rejectCta')}</button>
                  </form>
                ) : (
                  /* The maker may not be the checker, so the person who proposed sees WHY there is no button here
                     instead of a control that would 403 (0139's CHECK says the same thing at the bottom). */
                  <p className="kv-notice" role="note">{t.t(canRefundPerm ? 'dsp.youProposed' : 'dsp.needsRefundPerm')}</p>
                )
              )}
            </>
          )}
          {approvals.length > 0 && (
            <ul className="kv-thread">
              {approvals.map((a) => (
                <li key={a.id} className="kv-thread__item">
                  <span className="kv-badge">{t.t(`dsp.approval.${a.status}`)}</span>
                  <span>{formatMoneyMinor(a.amountMinor, moneyBox?.currencyCode ?? 'INR', lang)}</span>
                  <span className="kv-muted">{formatDate(a.proposedAt, lang)}</span>
                  {a.decisionNote && <p className="kv-review__body">{a.decisionNote}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h2 className="kv-section-title">{t.t('disputeDetail.thread')}</h2>
      {threadFailed ? (
        <p className="kv-error" role="alert">{t.t('disputeDetail.threadError')}</p>
      ) : thread.length === 0 ? (
        <p className="kv-muted">{t.t('disputeDetail.threadEmpty')}</p>
      ) : (
        <ul className="kv-thread">
          {thread.map((m) => (
            <li key={m.id} className="kv-thread__item">
              <span className="kv-badge">{t.t(`disputeDetail.role.${messageAuthorRole(m.authorUserId, dispute)}`)}</span>
              <p className="kv-thread__body">{m.body}</p>
              <span className="kv-muted">{formatDate(m.createdAt, lang)}</span>
            </li>
          ))}
        </ul>
      )}

      <form action={postDisputeMessageAction} className="kv-form kv-card">
        <h2 className="kv-card__title">{t.t('disputeDetail.addMessage')}</h2>
        <input type="hidden" name="id" value={dispute.id} />
        <label htmlFor="body" className="kv-field__label">{t.t('disputeDetail.messageLabel')}</label>
        <textarea id="body" name="body" className="kv-textarea" rows={3} maxLength={4000} required />
        <p className="kv-field__hint">{t.t('disputeDetail.messageHint')}</p>
        <button type="submit" className="kv-btn">{t.t('disputeDetail.messageBtn')}</button>
      </form>
    </section>
  );
}
