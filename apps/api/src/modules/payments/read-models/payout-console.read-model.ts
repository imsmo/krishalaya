// modules/payments/read-models/payout-console.read-model.ts · W145's queue and W146's review (PC-56
// TENANT-4b). Read-only, tenant-scoped in every query, replica-served (Law 12).
//
// THE SUBJECT IS THE ORGANISATION. `PayoutService.list` (the endpoint behind the old screen) is the
// caller's OWN withdrawals; this is the FPO's outbound queue — 42 farmers, the wage lane, the milk-bill
// cycle. TENANT-4a named that defect class (right-shaped figure, wrong subject) and this is its second
// instance, so the two live in different files with different names and cannot be confused again.
import { Injectable } from '@nestjs/common';
import { PayoutBatchRepository } from '../repositories/payout-batch.repository';
import { PayoutApprovalService } from '../services/payout-approval.service';
import {
  PAYOUT_TABS, laneOf, retryPlan, tabOf, windowState,
  type PreflightVerdict,
} from '../domain/payout-approval';
import { mapProviderFailureCode } from '../domain/payout-failure-reason.map';

export interface PayoutQueueRow {
  id: string;
  payeeName: string | null;
  payeePhone: string | null;         // masked by the presenter; never a raw number on a list
  purposeCode: string;
  referenceType: string | null;
  referenceId: string | null;
  amountMinor: string;
  currencyCode: string;
  status: string;
  tab: string | null;
  lane: 'wage_priority' | 'standard' | 'wage_not_promoted';
  bankLast4: string | null;
  bankVerified: boolean;
  failureBucket: string | null;
  /** W145: "Failures state the real reason and the exact retry time." Null when the row is not failed. */
  retry: ReturnType<typeof retryPlan> | null;
  batchId: string | null;
  createdAt: string;
}

export interface PayoutQueuePage {
  items: PayoutQueueRow[];
  nextCursor: string | null;
  counts: Record<string, number>;
  /** Every status the machine can hold, so a tab cannot silently omit one (see `unmappedCount`). */
  tabs: string[];
  unmappedCount: number;
}

export interface BatchReviewView {
  batch: {
    id: string; batchType: string; status: string;
    itemsTotalMinor: string; settledTotalMinor: string; count: number;
    preparedBy: string | null; preparedAt: string | null;
    decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
    cutOffAt: string | null; executeAt: string | null;
    checkerThresholdMinor: string | null;
  };
  window: ReturnType<typeof windowState>;
  needsChecker: boolean;
  /** Whether THIS viewer may sign it — computed here so the screen never draws a button that would fail. */
  viewerIsMaker: boolean;
  preflight: PreflightVerdict;
  /** The evidence stored WITH the decision, if one was made. A recomputed panel cannot tell an auditor what
   *  the checker actually signed against; this can. */
  signedPreflight: unknown;
  items: PayoutQueueRow[];
}

const encodeCursor = (iso: string, id: string) => Buffer.from(`${iso}|${id}`).toString('base64');

@Injectable()
export class PayoutConsoleReadModel {
  constructor(
    private readonly repo: PayoutBatchRepository,
    private readonly approvals: PayoutApprovalService,
  ) {}

  /** W145's five tabs + the queue. Keyset only — no page numbers over a queue that changes every tick. */
  async queue(tenantId: string, opts: { tab?: string; cursor?: { c: string; id: string }; limit: number }): Promise<PayoutQueuePage> {
    const statuses = opts.tab && PAYOUT_TABS[opts.tab] ? [...PAYOUT_TABS[opts.tab]] : undefined;
    const [rows, counts] = await Promise.all([
      this.repo.listTenantPayouts({ tenantId, statuses, cursor: opts.cursor, limit: opts.limit + 1 }),
      this.repo.countsByStatus(tenantId),
    ]);
    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    // A status the tabs do not cover would otherwise be invisible on the screen that claims to show every
    // payout. Counted, and the screen prints the count.
    const unmappedCount = Object.entries(counts)
      .filter(([status]) => tabOf(status) === null)
      .reduce((n, [, c]) => n + c, 0);

    return {
      items: page.map((r) => this.toRow(r)),
      nextCursor: rows.length > opts.limit && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
      counts,
      tabs: Object.keys(PAYOUT_TABS),
      unmappedCount,
    };
  }

  /** W146 whole. The pre-flight is recomputed on every read: a checker must see today's answer, not the one
   *  cached when the batch was prepared. */
  async batchReview(tenantId: string, viewerUserId: string, batchId: string): Promise<BatchReviewView | null> {
    const b = await this.repo.getApprovalById(tenantId, batchId);
    if (!b) return null;
    const [pre, items] = await Promise.all([
      this.approvals.runPreflight(tenantId, b),
      this.repo.listTenantPayouts({ tenantId, limit: 200 }).then((rows) => rows.filter((r) => r.batchId === batchId)),
    ]);
    const threshold = b.checkerThresholdMinor;
    return {
      batch: {
        id: b.id, batchType: b.batchType, status: b.status,
        itemsTotalMinor: b.itemsTotalMinor.toString(), settledTotalMinor: b.totalMinor.toString(), count: b.count,
        preparedBy: b.preparedBy, preparedAt: b.preparedAt ? b.preparedAt.toISOString() : null,
        decidedBy: b.decidedBy, decidedAt: b.decidedAt ? b.decidedAt.toISOString() : null,
        decisionNote: b.decisionNote,
        cutOffAt: b.cutOffAt ? b.cutOffAt.toISOString() : null,
        executeAt: b.executeAt ? b.executeAt.toISOString() : null,
        checkerThresholdMinor: threshold === null ? null : threshold.toString(),
      },
      window: windowState({ cutOffAt: b.cutOffAt, executeAt: b.executeAt }, new Date()),
      needsChecker: threshold !== null && b.itemsTotalMinor >= threshold,
      viewerIsMaker: !!b.preparedBy && b.preparedBy === viewerUserId,
      preflight: pre,
      signedPreflight: b.preflight,
      items: items.map((r) => this.toRow(r)),
    };
  }

  private toRow(r: Awaited<ReturnType<PayoutBatchRepository['listTenantPayouts']>>[number]): PayoutQueueRow {
    const bucket = r.status === 'failed' ? mapProviderFailureCode(r.failureCode) : null;
    return {
      id: r.id,
      payeeName: r.payeeName,
      // A phone number on a money list is a data-minimisation question, not a formatting one: last four only.
      payeePhone: r.payeePhone ? `••${r.payeePhone.slice(-4)}` : null,
      purposeCode: r.purposeCode,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      amountMinor: r.amountMinor,
      currencyCode: r.currencyCode,
      status: r.status,
      tab: tabOf(r.status),
      lane: laneOf(r.priority, r.purposeCode),
      bankLast4: r.bankLast4,
      bankVerified: r.bankVerified,
      failureBucket: bucket,
      retry: bucket ? retryPlan(bucket, r.autoAttempts, r.nextRetryAt ?? r.createdAt) : null,
      batchId: r.batchId,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
