// apps/web-tenant/src/app/payouts/batches/[id]/page.tsx · W146 — payout batch approval (PC-56 TENANT-4b).
// Server-first, requireSession-gated, noindex, every string via i18n. The screen that did not exist for the
// control that did not exist: before this wave a cron tick moved money to 42 farmers with no human in the
// path, under a canon promising "money never moves without two humans".
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • WHICH RULE IS IN FORCE for this batch — at or above the tenant's threshold a different person must
//     sign; below it the maker may sign their own. A screen that printed "maker-checker" over a
//     single-signer batch would describe a control that did not run;
//   • the pre-flight with three verdicts, not two: `unverifiable` is not a tick, and the risk-desk line says
//     plainly that no risk desk exists rather than showing a green mark for a check nobody performs;
//   • what the checker SIGNED against, once decided — the evidence stored with the decision, not today's
//     recomputed answer;
//   • the clock: after the cut-off the batch locks and rolls to a new one, so nobody signs a stale list.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { tenantHasPerm } from '../../../../lib/auth';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { DataTable } from '../../../../components/DataTable';
import {
  approveBlockedBy, checkerRuleKey, laneKey, NOTE_FLOOR, preflightIcon, preflightLabelKey,
  refusalKey, rejectBlockedBy, unverifiableCount, windowKey,
} from '../../../../features/payouts/org-console';
import { decideBatchAction } from '../../actions';
import type { PayoutBatchReview } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('po.reviewTitle'), robots: { index: false, follow: false } };
}

export default async function PayoutBatchPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { error?: string; ok?: string };
}) {
  await requireSession(`/payouts/batches/${params.id}`);
  const t = getTranslator();
  const lang = getLang();
  const canApprove = tenantHasPerm('payout.approve');

  let review: PayoutBatchReview | null = null;
  try {
    review = await tenantClient().payoutConsole.review(params.id);
  } catch {
    review = null;
  }
  if (!review) notFound();

  const b = review.batch;
  const approveBlock = approveBlockedBy(
    { status: b.status, window: review.window, viewerIsMaker: review.viewerIsMaker, needsChecker: review.needsChecker, preflight: review.preflight },
    { canApprove },
  );
  const rejectBlock = rejectBlockedBy({ status: b.status, window: review.window }, { canApprove });
  const unverifiable = unverifiableCount(review.preflight.lines);

  return (
    <section>
      <h1>{t.t('po.reviewTitle')}</h1>
      <p className="kv-muted">
        {t.t('po.reviewIntro', {
          type: b.batchType,
          count: String(b.count),
          total: formatMoneyMinor(b.itemsTotalMinor, 'INR', lang),
        })}
      </p>

      {searchParams.error && <p className="kv-error" role="alert">{t.t(refusalKey(searchParams.error))}</p>}
      {searchParams.ok && <p className="kv-success" role="status">{t.t(`po.ok.${searchParams.ok}`)}</p>}

      <div className="kv-cards">
        <div className="kv-card kv-card--money">
          <h2 className="kv-card__title">{t.t('po.itemsTotal')}</h2>
          <p className="kv-card__figure">{formatMoneyMinor(b.itemsTotalMinor, 'INR', lang)}</p>
          {/* The total a checker signs is the SUM OF THE CLAIMED ITEMS, frozen at preparation. The settled
              total below is what has actually moved — 0 until the run executes. Two different numbers, and
              conflating them is what made "sum of items = batch total" uncheckable before this wave. */}
          <p className="kv-field__hint">{t.t('po.itemsTotalHint', { settled: formatMoneyMinor(b.settledTotalMinor, 'INR', lang) })}</p>
        </div>
        <div className="kv-card">
          <h2 className="kv-card__title">{t.t('po.clock')}</h2>
          <p>{t.t(windowKey(review.window))}</p>
          <p className="kv-field__hint">
            {t.t('po.clockDetail', {
              cutOff: b.cutOffAt ? formatDate(b.cutOffAt, lang) : t.t('common.dash'),
              executeAt: b.executeAt ? formatDate(b.executeAt, lang) : t.t('common.dash'),
            })}
          </p>
        </div>
        <div className="kv-card">
          <h2 className="kv-card__title">{t.t('po.signatures')}</h2>
          <p className="kv-field__hint">{t.t('po.maker', { at: b.preparedAt ? formatDate(b.preparedAt, lang) : t.t('common.dash') })}</p>
          <p className="kv-badge">{t.t(`po.status.batch.${b.status}`)}</p>
          {/* The rule ACTUALLY in force for this batch, from the threshold pinned on the row. */}
          <p className="kv-note">{t.t(checkerRuleKey(review.needsChecker), { threshold: b.checkerThresholdMinor ? formatMoneyMinor(b.checkerThresholdMinor, 'INR', lang) : t.t('common.dash') })}</p>
          {b.decidedAt && <p className="kv-field__hint">{t.t('po.decidedAt', { at: formatDate(b.decidedAt, lang) })}</p>}
          {b.decisionNote && <p className="kv-note">{b.decisionNote}</p>}
        </div>
      </div>

      <h2 className="kv-section-title">{t.t('po.preflightTitle')}</h2>
      <ul className="kv-list kv-preflight">
        {review.preflight.lines.map((l) => (
          <li key={l.check} className={`kv-preflight__row kv-preflight__row--${l.state}`}>
            <span aria-hidden="true">{preflightIcon(l.state)}</span>
            <span>{t.t(preflightLabelKey(l.check))}</span>
            <span className="kv-badge">{t.t(`po.preState.${l.state}`)}</span>
            {l.detail && <span className="kv-muted">{l.detail}</span>}
          </li>
        ))}
      </ul>
      {unverifiable > 0 && <p className="kv-note" role="status">{t.t('po.preUnverifiableNote', { count: String(unverifiable) })}</p>}
      {review.signedPreflight != null && <p className="kv-field__hint">{t.t('po.signedEvidence')}</p>}

      <h2 className="kv-section-title">{t.t('po.contents')}</h2>
      <DataTable
        rows={review.items}
        empty={t.t('po.contentsEmpty')}
        columns={[
          { header: t.t('po.colPayee'), cell: (r) => <>{r.payeeName ?? t.t('common.dash')} <span className="kv-muted">{r.payeePhone ?? ''}</span></> },
          { header: t.t('po.colPurpose'), cell: (r) => <span className="kv-badge">{r.purposeCode || t.t('common.dash')}</span> },
          { header: t.t('po.colAmount'), cell: (r) => formatMoneyMinor(r.amountMinor, r.currencyCode, lang) },
          {
            header: t.t('po.colBank'),
            cell: (r) => (
              <>
                {r.bankLast4 ? `••${r.bankLast4}` : t.t('common.dash')}
                {!r.bankVerified && <span className="kv-badge kv-badge--warn">{t.t('po.bankUnverified')}</span>}
              </>
            ),
          },
          { header: t.t('po.colLane'), cell: (r) => t.t(`po.lane.${laneKey(r.lane)}`) },
        ]}
      />

      <h2 className="kv-section-title">{t.t('po.decisionTitle')}</h2>
      {approveBlock === 'youPrepared' && <p className="kv-note" role="status">{t.t('po.youPrepared')}</p>}
      {approveBlock && approveBlock !== 'youPrepared' && <p className="kv-field__hint">{t.t(`po.approveBlocked.${approveBlock}`)}</p>}

      {!approveBlock && (
        <form action={decideBatchAction} className="kv-card">
          <input type="hidden" name="batchId" value={b.id} />
          <input type="hidden" name="decision" value="approved" />
          <p>{t.t('po.approveConfirm', { executeAt: b.executeAt ? formatDate(b.executeAt, lang) : t.t('common.dash'), total: formatMoneyMinor(b.itemsTotalMinor, 'INR', lang) })}</p>
          <label htmlFor="approveNote" className="kv-field__label">{t.t('po.noteOptional')}</label>
          <textarea id="approveNote" name="note" rows={2} maxLength={2000} />
          <button type="submit" className="kv-btn">{t.t('po.approve')}</button>
        </form>
      )}

      {!rejectBlock && (
        <form action={decideBatchAction} className="kv-card">
          <input type="hidden" name="batchId" value={b.id} />
          <input type="hidden" name="decision" value="rejected" />
          {/* A rejection does NOT need the pre-flight to pass — refusing a batch that failed its checks is
              exactly what a checker is for. It does need the reason, at the same floor as every other note. */}
          <label htmlFor="rejectNote" className="kv-field__label">{t.t('po.rejectNote')}</label>
          <textarea id="rejectNote" name="note" rows={3} minLength={NOTE_FLOOR} maxLength={2000} required />
          <p className="kv-field__hint">{t.t('po.rejectNoteHint', { floor: String(NOTE_FLOOR) })}</p>
          <button type="submit" className="kv-btn kv-btn--danger">{t.t('po.reject')}</button>
        </form>
      )}
      {rejectBlock && <p className="kv-field__hint">{t.t(`po.approveBlocked.${rejectBlock}`)}</p>}

      <p className="kv-field__hint">{t.t('po.executionNote')}</p>
      <p className="kv-pager"><Link href="/payouts" className="kv-btn--link">{t.t('po.backToQueue')}</Link></p>
    </section>
  );
}
