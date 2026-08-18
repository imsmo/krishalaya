// modules/payments/services/payout-approval.service.ts · W146's maker-checker over a payout run
// (PC-56 TENANT-4b). prepare (maker) → decide (checker) → the executor obeys the decision.
//
// This is the FOURTH maker-checker site inside a tenant's own console (0139 refunds, 0140 credit notes
// riding that plane, 0141 charge changes) and the first one where the thing being signed is a LIST rather
// than an amount: the checker is approving 42 destinations, not one figure, so the pre-flight evidence is
// stored WITH the decision and the items are frozen into the batch before anybody is asked to sign.
import { Injectable } from '@nestjs/common';
import { UnitOfWork, type TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DomainError, ForbiddenError } from '../../../shared/errors/app-error';
import { PayoutBatchRepository, type PayoutBatchApprovalRow } from '../repositories/payout-batch.repository';
import { OrgWalletReadModel } from '../read-models/org-wallet.read-model';
import { kycVerdictFor } from '../domain/payout-kyc';
import { mapProviderFailureCode } from '../domain/payout-failure-reason.map';
import {
  DEFAULT_CHECKER_THRESHOLD_MINOR, DEFAULT_CUT_OFF_MINUTES, NOTE_FLOOR,
  approvalRefusal, batchWindow, needsChecker, preflight, rejectionRefusal, retryPlan,
  type PreflightVerdict,
} from '../domain/payout-approval';

const THRESHOLD_KEY = 'payouts.batch_checker_threshold_minor';
const CUT_OFF_KEY = 'payouts.batch_cut_off_minutes';
const MAX_BATCH_ITEMS = 1_000;

export class PayoutBatchError extends DomainError {}

export interface PrepareInput { batchType: string; executeAt: Date; maxPriority?: number | null; limit?: number }
export interface PrepareResult { batchId: string; claimed: number; itemsTotalMinor: string; cutOffAt: string; executeAt: string; checkerThresholdMinor: string; needsChecker: boolean }
export interface DecideResult { batchId: string; status: 'approved' | 'rejected'; preflight: PreflightVerdict; releasedClaims: number }

@Injectable()
export class PayoutApprovalService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: PayoutBatchRepository,
    private readonly wallet: OrgWalletReadModel,
  ) {}

  /** THE THRESHOLD IN FORCE. An unreadable setting falls back to the domain's default, which is the
   *  STRICTER of the two readings — failing open on a money control is a hole, not a degradation. */
  private async intSetting(tx: TxContext, tenantId: string, key: string, fallback: number | bigint): Promise<bigint> {
    try {
      const raw = await this.repo.settingValue(tx, tenantId, key);
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : null;
      if (n === null || !Number.isFinite(n) || n < 0) return BigInt(fallback);
      return BigInt(Math.trunc(n));
    } catch {
      return BigInt(fallback);
    }
  }

  /** W146's batch, prepared. Claims this tenant's queued payouts into a `pending_approval` batch and
   *  freezes the item total, so the checker signs against a list that cannot change under them. */
  async prepare(tenantId: string, makerUserId: string, input: PrepareInput, now = new Date()): Promise<PrepareResult> {
    const batchId = uuidv7();
    const limit = Math.min(Math.max(input.limit ?? MAX_BATCH_ITEMS, 1), MAX_BATCH_ITEMS);

    return this.uow.run(tenantId, async (tx) => {
      const threshold = await this.intSetting(tx, tenantId, THRESHOLD_KEY, DEFAULT_CHECKER_THRESHOLD_MINOR);
      const cutMins = Number(await this.intSetting(tx, tenantId, CUT_OFF_KEY, DEFAULT_CUT_OFF_MINUTES));
      const win = batchWindow(input.executeAt, cutMins, now);
      try {
        await this.repo.insertPending(tx, {
          id: batchId, tenantId, batchType: input.batchType, preparedBy: makerUserId,
          cutOffAt: win.cutOffAt, executeAt: win.executeAt, checkerThresholdMinor: threshold,
        });
      } catch (e) {
        // 0143's uq_payout_batch_pending: one batch per (tenant, type) may await or hold a signature. Two
        // makers preparing the same queue and two checkers approving both would pay every farmer twice.
        if (String((e as { code?: string }).code) === '23505') {
          throw new PayoutBatchError('PAYOUT_BATCH_ALREADY_PENDING', 'a batch of this type is already awaiting approval', 409, { batchType: input.batchType });
        }
        throw e;
      }
      const claimed = await this.repo.claimTenantQueuedIntoBatch(tx, tenantId, batchId, { limit, maxPriority: input.maxPriority ?? null });
      // The server's own sum, not the sum of what we just returned — see sumClaimed's note.
      const sum = await this.repo.sumClaimed(tx, tenantId, batchId);
      await this.repo.setItemsTotal(tx, tenantId, batchId, sum.sumMinor, sum.count);
      return {
        batchId, claimed: claimed.length, itemsTotalMinor: sum.sumMinor.toString(),
        cutOffAt: win.cutOffAt.toISOString(), executeAt: win.executeAt.toISOString(),
        checkerThresholdMinor: threshold.toString(), needsChecker: needsChecker(sum.sumMinor, threshold),
      };
    }, { userId: makerUserId });
  }

  /** The pre-flight, computed fresh. Called for the review screen AND again inside the decision tx, so a
   *  checker cannot approve a batch whose evidence changed between reading and signing. */
  async runPreflight(tenantId: string, batch: PayoutBatchApprovalRow): Promise<PreflightVerdict> {
    const funds = await this.availableMinor(tenantId);
    const { server, kyc } = await this.uow.run(tenantId, async (tx) => ({
      server: await this.repo.sumClaimed(tx, tenantId, batch.id),
      kyc: await this.batchKycAndFrozen(tx, tenantId, batch.id),
    }));
    return preflight({
      itemCount: server.count,
      itemsTotalMinor: batch.itemsTotalMinor,
      kycVerifiedCount: kyc.verified,
      serverSumMinor: server.sumMinor,
      availableMinor: funds,
      frozenPayeeCount: kyc.frozen,
    });
  }

  /** The tenant's `main` available balance, from TENANT-4a's ledger read. `null` when it cannot be read —
   *  which the pre-flight reports as `unverifiable`, never as "enough". */
  private async availableMinor(tenantId: string): Promise<bigint | null> {
    try {
      const ov = await this.wallet.overview(tenantId);
      const main = ov.accounts.find((a) => a.code === 'main');
      return main ? BigInt(main.minor) : null;
    } catch {
      return null;
    }
  }

  /** How many of the batch's payees are fully KYC-verified WITH a verified destination, and how many sit
   *  behind a frozen wallet. Aggregating what domain/payout-kyc.ts has always decided per payout. */
  private async batchKycAndFrozen(tx: TxContext, tenantId: string, batchId: string): Promise<{ verified: number; frozen: number }> {
    const rows = await this.repo.batchPayeeGateRows(tx, tenantId, batchId);
    const roleMap = await this.repo.purposeRoles(tx, [...new Set(rows.map((r) => r.purposeCode).filter(Boolean))]);
    let verified = 0;
    let frozen = 0;
    for (const row of rows) {
      if (row.walletFrozen) frozen += 1;
      // The SAME gate the executor applies per payout (TENANT-1's per-ROLE rule), plus W146's second half:
      // "with verified bank accounts". A verified person paying into an unverified destination is not a pass.
      const verdict = kycVerdictFor(roleMap[row.purposeCode] ?? [], row.roles);
      if (verdict.allowed && row.bankVerified) verified += 1;
    }
    return { verified, frozen };
  }

  /** W146's "Approve — execute at 18:00" / "Reject with reason (maker notified)". The refusal names come
   *  from the domain, so the API, the screen and the schema all say the same thing. */
  async decide(
    tenantId: string,
    actorUserId: string,
    batchId: string,
    input: { decision: 'approved' | 'rejected'; note?: string },
    now = new Date(),
  ): Promise<DecideResult> {
    const head = await this.repo.getApprovalById(tenantId, batchId);
    if (!head) throw new PayoutBatchError('PAYOUT_BATCH_NOT_FOUND', 'batch not found', 404);
    const pre = await this.runPreflight(tenantId, head);

    return this.uow.run(tenantId, async (tx) => {
      // Re-read UNDER LOCK: everything above was a read, and two checkers can arrive together.
      const b = await this.repo.getPendingForUpdate(tx, tenantId, batchId);
      if (!b) throw new PayoutBatchError('PAYOUT_BATCH_NOT_FOUND', 'batch not found', 404);

      const note = (input.note ?? '').trim();
      const refusal = input.decision === 'approved'
        ? approvalRefusal(b, actorUserId, now, pre)
        : rejectionRefusal(b, note, now);
      if (refusal) {
        throw refusal === 'PAYOUT_BATCH_CHECKER_IS_MAKER'
          ? new ForbiddenError('You prepared this batch — a different person must approve it', { code: refusal })
          : new PayoutBatchError(refusal, refusal, 409, { batchId, noteFloor: NOTE_FLOOR });
      }

      const ok = await this.repo.recordDecision(tx, tenantId, batchId, {
        status: input.decision, decidedBy: actorUserId,
        note: note.length >= NOTE_FLOOR ? note : null,
        preflight: pre,
      });
      if (!ok) throw new PayoutBatchError('PAYOUT_BATCH_NOT_PENDING', 'this batch was already decided', 409, { batchId });

      // A rejected run must not keep a farmer's money pinned to it: the claims go back to the free queue
      // so the next prepared batch can carry them.
      const released = input.decision === 'rejected' ? await this.repo.releaseClaims(tx, tenantId, batchId) : 0;
      return { batchId, status: input.decision, preflight: pre, releasedClaims: released };
    }, { userId: actorUserId });
  }

  /** W145's "Retry" on a failed row, and W2443–W2445's confirm/success/failure chain. The BACKOFF is the
   *  domain's (15m → 1h → 4h → 24h, four attempts), and a bank rejection of the destination itself is NOT
   *  retried: it would fail identically forever while telling a farmer "retrying" every hour. */
  async retryPayout(tenantId: string, actorUserId: string, payoutId: string, now = new Date()): Promise<{ payoutId: string; plan: ReturnType<typeof retryPlan> }> {
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.getPayoutForRetry(tx, tenantId, payoutId);
      if (!p) throw new PayoutBatchError('PAYOUT_NOT_FOUND', 'payout not found', 404);
      if (p.status !== 'failed') throw new PayoutBatchError('PAYOUT_NOT_FAILED', 'only a failed payout can be retried', 409, { status: p.status });
      // One mapper (PC-54's), one rule (the domain's): the bucket decides whether a machine may try again.
      const plan = retryPlan(mapProviderFailureCode(p.failureCode), p.autoAttempts, now);
      if (plan.kind !== 'retry_at') {
        throw new PayoutBatchError(
          plan.kind === 'needs_human' ? 'PAYOUT_RETRY_NEEDS_HUMAN' : 'PAYOUT_RETRY_EXHAUSTED',
          plan.kind === 'needs_human' ? 'the destination account must be fixed first' : 'every automatic attempt is spent',
          409, { plan },
        );
      }
      const ok = await this.repo.requeueFailed(tx, tenantId, payoutId, plan.at);
      if (!ok) throw new PayoutBatchError('PAYOUT_NOT_FAILED', 'this payout is no longer failed', 409, { payoutId });
      return { payoutId, plan };
    }, { userId: actorUserId });
  }
}

