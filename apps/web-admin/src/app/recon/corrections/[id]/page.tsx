// apps/web-admin/src/app/recon/corrections/[id]/page.tsx · W068, the manual correction (PC-56 ADMIN-5e).
//
// **THE SCARIEST SCREEN ON THE PLATFORM.** Every other money movement on Krishalaya is produced by a machine from a
// business event and is balanced by construction. This one is a person typing amounts because a webhook died, and
// it is the only path by which a farmer's balance changes for a reason that exists nowhere but in somebody's head.
//
// Five controls, all refusals, and the console draws each of them as an ABSENCE rather than a disabled button:
//   • Submit is not offered until the legs balance, and the Σ readout prints the real shortfall.
//   • Approve is not offered to the maker — a different operator with `ledger.correct` posts.
//   • Above ₹50,000 the checker must confirm the founder was told. The platform cannot page anybody, so that
//     confirmation is a person saying they did it, and the screen says so rather than implying a page went out.
//   • A posted correction cannot be withdrawn. There is no delete.
//   • The idempotency key is shown, because "re-posting with this key is a no-op" is the reassurance that makes a
//     retry safe after a timeout, and an operator who cannot see it will phone somebody instead.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin, adminUserId } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { approveCorrectionAction, rejectCorrectionAction, submitCorrectionAction, withdrawCorrectionAction } from '../actions';
import {
  statusClass, balanceClass, balanceText, stepOf, submitBlockedKey, approveBlockedKey, aboveFounderThreshold,
  type BalanceView, type LegView, type DraftStatus, type SubmitState, type ApproveState,
} from '../../../../features/audit/audit-console';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cor.title'), robots: { index: false, follow: false } };
}

interface Draft {
  id: string; investigationId: string; tenantId: string | null; status: DraftStatus; currencyCode: string;
  reason: string; sourceDocument: string | null; idempotencyKey: string;
  makerId: string; submittedAt: string | null;
  checkerId: string | null; checkedAt: string | null; checkerNote: string | null;
  postedTxnId: string | null; postedAt: string | null;
  legs: LegView[]; balance: BalanceView;
  submitState: SubmitState; approveState: ApproveState; approveOfferable: boolean;
  aboveFounderThreshold: boolean; founderThresholdText: string; reasonMin: number;
}

const OK = new Set(['submitted', 'posted', 'rejected', 'withdrawn', 'legsSaved']);
const ERR = new Set(['unbalanced', 'tooFewLegs', 'noReason', 'notDrafting', 'yourOwn', 'founder', 'postFailed', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function CorrectionPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId();

  let d: Draft | undefined; let notice: string | undefined;
  try { d = (await adminGet<Draft>(`ledger/corrections/${encodeURIComponent(params.id)}`)).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  if (!d) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/recon/corrections">{t.t('cor.back')}</Link></p>
        <h1>{t.t('cor.heading')}</h1>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const step = stepOf(d.status, d.balance.balanced);
  const submitBlocked = submitBlockedKey(d.submitState);
  const approveBlocked = approveBlockedKey(d.approveState, d.makerId, viewer);
  const isMaker = !!viewer && viewer === d.makerId;
  const needsFounder = aboveFounderThreshold(d.balance.grossMinor);

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon/corrections">{t.t('cor.back')}</Link></p>
      <h1>{t.t('cor.headingFor', { case: d.investigationId })}</h1>
      <p className="kv-muted">{t.t('cor.lead')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`cor.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cor.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('cor.status')}</dt><dd><span className={statusClass(d.status)}>{t.t(`cor.state.${d.status}`)}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('cor.step')}</dt><dd>{step === null ? t.t('cor.stepDone') : t.t(`cor.step.${step}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cor.case')}</dt><dd><Link href={`/recon/investigations`}>{d.investigationId}</Link></dd></div>
        <div className="kv-facts__row"><dt>{t.t('cor.maker')}</dt><dd>{d.makerId}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cor.checker')}</dt><dd>{d.checkerId ?? t.t('cor.awaitingSecond')}</dd></div>
        {/* Shown deliberately — "re-posting with this key is a no-op" is what makes a retry safe after a timeout. */}
        <div className="kv-facts__row"><dt>{t.t('cor.idempotencyKey')}</dt><dd><code>{d.idempotencyKey}</code></dd></div>
        {d.postedTxnId && <div className="kv-facts__row"><dt>{t.t('cor.txn')}</dt><dd><code>{d.postedTxnId}</code> · {d.postedAt}</dd></div>}
      </dl>

      <h2>{t.t('cor.legsHeading')}</h2>
      <table className="kv-table">
        <thead><tr><th>{t.t('cor.col.account')}</th><th>{t.t('cor.col.minor')}</th><th>{t.t('cor.col.amount')}</th><th>{t.t('cor.col.note')}</th></tr></thead>
        <tbody>
          {d.legs.map((l, i) => (
            <tr key={`${l.accountCode}-${i}`}>
              <td>{t.t(`cor.owner.${l.ownerKind}`)} · {l.accountCode}{l.ownerId ? ` · ${l.ownerId}` : ''}</td>
              {/* The raw minor units are shown next to the formatted figure. On the one screen where a person types
                  money, the unrounded integer is the value of record and the pretty one is the courtesy. */}
              <td><code>{l.amountMinor}</code></td>
              <td>{l.amountText}</td>
              <td>{l.legNote ?? t.t('common.dash')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.legs.length === 0 && <p className="kv-empty">{t.t('cor.noLegs')}</p>}
      <p className={balanceClass(d.balance)}>{balanceText(d.balance)}</p>
      {!d.balance.balanced && d.legs.length > 0 && <p className="kv-error" role="alert">{t.t('cor.unbalanced', { sum: d.balance.sumText })}</p>}
      <p className="kv-detail__muted">{t.t('cor.size', { gross: d.balance.grossText })}</p>

      <h2>{t.t('cor.reasonHeading')}</h2>
      {/* Recorded verbatim. This sentence is the artefact an auditor reads in five years. */}
      <blockquote className="kv-note">{d.reason}</blockquote>
      {d.sourceDocument && <p className="kv-detail__muted">{t.t('cor.sourceDoc', { doc: d.sourceDocument })}</p>}
      {d.checkerNote && <p className="kv-detail__muted">{t.t('cor.checkerNote', { note: d.checkerNote })}</p>}

      {/* ---------------- MAKER ACTIONS ---------------- */}
      {d.status === 'drafting' && isMaker && (
        <>
          <h2>{t.t('cor.submitHeading')}</h2>
          {submitBlocked ? (
            // ABSENT, not disabled — with the reason, because each one has a different next move.
            <p className="kv-error" role="alert">{t.t(`cor.submitBlocked.${submitBlocked}`)}</p>
          ) : (
            <form action={submitCorrectionAction}>
              <input type="hidden" name="id" value={d.id} />
              <button type="submit" className="kv-btn">{t.t('cor.submit')}</button>
            </form>
          )}
        </>
      )}
      {(d.status === 'drafting' || d.status === 'awaiting_checker') && isMaker && !d.checkerId && (
        <form action={withdrawCorrectionAction} className="kv-form">
          <input type="hidden" name="id" value={d.id} />
          <label htmlFor="wnote" className="kv-field__label">{t.t('cor.withdrawReason')}</label>
          <input id="wnote" name="note" className="kv-input" required maxLength={2000} />
          <button type="submit" className="kv-btn">{t.t('cor.withdraw')}</button>
        </form>
      )}

      {/* ---------------- CHECKER ACTIONS ---------------- */}
      {d.status === 'awaiting_checker' && (
        <>
          <h2>{t.t('cor.decideHeading')}</h2>
          {approveBlocked ? (
            <p className="kv-error" role="alert">{t.t(`cor.approveBlocked.${approveBlocked}`)}</p>
          ) : (
            <form action={approveCorrectionAction} className="kv-form">
              <input type="hidden" name="id" value={d.id} />
              <label htmlFor="note" className="kv-field__label">{t.t('cor.approvalNote')}</label>
              <textarea id="note" name="note" className="kv-input" required minLength={1} maxLength={2000} />
              {needsFounder && (
                <>
                  {/* NOT a "the founder has been paged" tick. Nothing on this platform can page anybody, so this is
                      the checker stating they informed the founder out of band, and the audit row records it as a
                      claim by a named person. A weaker control than paging, and an honest one. */}
                  <p className="kv-error" role="alert">{t.t('cor.founderRequired', { threshold: d.founderThresholdText, gross: d.balance.grossText })}</p>
                  <label htmlFor="fi" className="kv-field__label">
                    <input id="fi" name="founderInformed" type="checkbox" value="yes" required className="kv-check" />
                    {' '}{t.t('cor.founderConfirm')}
                  </label>
                </>
              )}
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('cor.approve')}</button>
            </form>
          )}
          <form action={rejectCorrectionAction} className="kv-form">
            <input type="hidden" name="id" value={d.id} />
            <label htmlFor="rnote" className="kv-field__label">{t.t('cor.rejectReason')}</label>
            <input id="rnote" name="note" className="kv-input" required maxLength={2000} />
            <button type="submit" className="kv-btn">{t.t('cor.reject')}</button>
          </form>
        </>
      )}

      <p className="kv-detail__muted">{t.t('cor.noDelete')}</p>
    </section>
  );
}
