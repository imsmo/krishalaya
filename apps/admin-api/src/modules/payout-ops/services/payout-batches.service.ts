// apps/admin-api/src/modules/payout-ops/services/payout-batches.service.ts · W066 + W067 (PC-56 ADMIN-6b).
//
// THE MONEY DOOR. This is the first code on the platform that can stop a disbursement, and until 0114 the door had no
// hinge: `payout-execution.cadence-job.ts` claimed every queued payout on a five-minute timer with no reference to a
// batch, so approving one would have gated nothing at all.
import { Injectable, Logger } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { PayoutOpsRepository } from '../repositories/payout-ops.repository';
import {
  approvalState, assertApprovable, assertReturnable, batchMoney, batchPhase,
} from '../domain/batch-approval';
import { preflight, preflightForStorage, preflightDrift, PreflightResult } from '../domain/preflight-view';
import { InvalidPayoutOpsError } from '../domain/payout-ops.errors';

export interface AdminActor { adminId: string; permissions: Set<string>; ip: string | null }

/** A hard ceiling on how many payouts one preflight will examine.
 *
 *  W067 shows 214 and the canon's largest batch is 1,842 milk bills. 5,000 is above both and below the point where a
 *  console request becomes a report — a batch larger than this is a signal that the batching itself has gone wrong, and
 *  the honest response is to say the preflight could not cover it rather than to time out or to check a prefix and call
 *  it a pass. THE PARTIAL CASE IS AN EXPLICIT REFUSAL, not a silently truncated list: a preflight over the first 5,000
 *  of 9,000 payouts that reported PASS would be the most dangerous output this module could produce.
 */
export const PREFLIGHT_LIMIT = 5_000;

@Injectable()
export class PayoutBatchesService {
  private readonly log = new Logger(PayoutBatchesService.name);

  constructor(
    private readonly pool: AdminPool,
    private readonly repo: PayoutOpsRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* READS                                                                  */
  /* ---------------------------------------------------------------------- */

  async list(q: { status?: string; batchType?: string; tenantId?: string; cursor?: string; limit: number }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await this.repo.listBatches({ ...q, cursor, limit: q.limit });
    const last = rows[rows.length - 1];
    return {
      items: rows.map((b) => ({
        id: b.id,
        tenantId: b.tenantId,
        batchType: b.batchType,
        count: b.count,
        status: b.status,
        phase: batchPhase(b.status),
        // `total_minor` only accumulates as disbursements SUCCEED, so it is 0 on an open batch. The list shows it and
        // the detail shows both figures — see `batchMoney`. A list column labelled "Total" that showed 0 for every
        // batch awaiting approval would read as "nothing to approve".
        settledMinor: b.totalMinor.toString(),
        openedByAdminId: b.openedByAdminId,
        approvedByAdminId: b.approvedByAdminId,
        approvedAt: b.approvedAt,
        returnedAt: b.returnedAt,
        returnReason: b.returnReason,
        executedAt: b.executedAt,
        createdAt: b.createdAt,
      })),
      nextCursor: rows.length === q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
      // W067's alert strip, read across EVERY open batch rather than this page.
      awaitingChecker: (await this.repo.awaitingChecker()).map((a) => ({
        id: a.id, batchType: a.batchType, count: a.count,
        requestedMinor: a.totalMinor.toString(), openedByAdminId: a.openedByAdminId, createdAt: a.createdAt,
      })),
      // The size of what the gate is holding. A silent gate needs a published number — 0113's lesson, where the recon
      // staleness alarm could never fire because its gauge was a hardcoded 0.
      held: await this.heldSummary(),
    };
  }

  private async heldSummary() {
    const h = await this.repo.awaitingApprovalTotal();
    return h ? { count: h.count, totalMinor: h.totalMinor.toString() } : null;
  }

  /** W067. Returns the batch, its payouts, and a FRESH preflight beside the recorded one. */
  async detail(actor: AdminActor, id: string, opts: { cursor?: string; limit: number }) {
    const b = await this.repo.getBatch(id);
    if (!b) return null;

    const requestedMinor = await this.repo.batchRequestedMinor(id);
    const money = batchMoney(b.status, requestedMinor, b.totalMinor);

    const subjects = await this.repo.preflightSubjects(id, PREFLIGHT_LIMIT + 1);
    // See PREFLIGHT_LIMIT: a truncated preflight is reported as unusable rather than as a verdict over a prefix.
    const overLimit = subjects.length > PREFLIGHT_LIMIT;
    const fresh = overLimit ? null : preflight(subjects);

    const cursor = decodeLinesCursor(opts.cursor);
    const lines = await this.repo.listBatchPayouts(id, { cursor, limit: opts.limit });
    const lastLine = lines[lines.length - 1];

    // Which payouts the preflight blocked, so the line table can mark them. Only computed when the preflight ran.
    const blocked = new Map((fresh?.lines ?? []).filter((l) => !l.ok).map((l) => [l.payoutId, l.failures]));

    return {
      id: b.id,
      tenantId: b.tenantId,
      batchType: b.batchType,
      status: b.status,
      phase: batchPhase(b.status),
      count: b.count,
      requestedMinor: money.requestedMinor.toString(),
      settledMinor: money.settledMinor.toString(),
      shortfall: money.shortfall,
      shortfallMinor: money.shortfallMinor.toString(),
      openedByAdminId: b.openedByAdminId,
      approvedByAdminId: b.approvedByAdminId,
      approvedAt: b.approvedAt,
      returnedByAdminId: b.returnedByAdminId,
      returnedAt: b.returnedAt,
      returnReason: b.returnReason,
      executedAt: b.executedAt,
      createdAt: b.createdAt,
      preflight: fresh ? serialisePreflight(fresh) : null,
      preflightOverLimit: overLimit ? { limit: PREFLIGHT_LIMIT } : null,
      /** What was recorded at approval time, and whether it still agrees with the world. A console that showed only the
       *  live figure would silently redraw what a checker signed; one that showed only the stored figure would hide a
       *  wallet frozen five minutes ago. */
      recordedPreflight: b.preflight,
      recordedPreflightAt: b.preflightAt,
      drift: fresh && b.status !== 'open' ? preflightDrift(b.preflight, fresh) : null,
      approval: approvalState({
        status: b.status,
        count: b.count,
        openedByAdminId: b.openedByAdminId,
        viewerAdminId: actor.adminId,
        preflight: fresh ? { pass: fresh.pass, checked: fresh.checked, blocked: fresh.blocked } : null,
      }),
      payouts: lines.map((l) => ({
        id: l.id,
        userId: l.userId,
        purposeCode: l.purposeCode,
        // Four digits and an IFSC. Enough for a checker to recognise a destination, and not an account number.
        bankLast4: l.bankLast4,
        bankIfsc: l.bankIfsc,
        amountMinor: l.amountMinor.toString(),
        status: l.status,
        priority: l.priority,
        failureCode: l.failureCode,
        preflightFailures: blocked.get(l.id) ?? [],
        createdAt: l.createdAt,
      })),
      nextCursor: lines.length === opts.limit && lastLine
        ? Buffer.from(`${lastLine.priority}|${lastLine.createdAt}|${lastLine.id}`).toString('base64') : null,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* THE TWO WRITES                                                         */
  /* ---------------------------------------------------------------------- */

  /** Approve a batch, which is the act that lets money leave.
   *
   *  THE PREFLIGHT IS RE-RUN HERE AND NOT TAKEN FROM THE REQUEST. The console displayed one; a client that could supply
   *  the verdict could supply `pass: true`, and this is the single most valuable field on the platform to forge. Same
   *  rule as ADMIN-5f computing value-at-stake server-side because it gates a maker-checker.
   */
  async approve(actor: AdminActor, id: string) {
    // ONE TRANSACTION FOR THE WHOLE DECISION (Law 4). The batch row is locked, the preflight is re-run against that
    // locked state, the two-person rule is asserted, the status moves and the audit row is written — all or nothing. An
    // approval that committed without its audit row would be an authorisation nobody can be shown to have given, on the
    // one act in this console that cannot be undone.
    const result = await this.pool.withTx(async (c) => {
      const b = await this.repo.getBatchForUpdate(c, id);
      if (!b) throw new InvalidPayoutOpsError('no such payout batch');

      const fresh = await this.freshPreflight(id);
      assertApprovable({
        status: b.status,
        count: b.count,
        openedByAdminId: b.openedByAdminId,
        approverAdminId: actor.adminId,
        preflight: { pass: fresh.pass, checked: fresh.checked, blocked: fresh.blocked },
      });

      const moved = await this.repo.approveBatch(c, id, actor.adminId, preflightForStorage(fresh));
      if (!moved) {
        // Reachable despite FOR UPDATE only if the row changed status before the lock was taken. The loser must be told
        // the truth rather than shown a success page for somebody else's signature.
        throw new InvalidPayoutOpsError(
          'this batch was decided by another operator while you were reviewing it — reload to see who and when');
      }

      // The recorded value is the preflight the approver actually signed. "Approved" without the checks behind it is
      // precisely the claim-with-nothing-behind-it this wave exists to remove.
      await this.audit.write(c, {
        actorUserId: actor.adminId,
        action: 'payout.batch.approved',
        entityType: 'payout_batch',
        entityId: id,
        newValue: {
          batchType: b.batchType, count: b.count,
          payableMinor: fresh.payableMinor.toString(), checked: fresh.checked,
        },
        ip: actor.ip,
      });
      return { id, status: 'approved' as const, payableMinor: fresh.payableMinor.toString(), checked: fresh.checked };
    });

    // Logged AFTER the commit, deliberately: a log line about an approval that rolled back would be the same kind of
    // false record as the status columns this programme keeps finding, one layer down.
    this.log.warn(`payout batch ${id} approved by ${actor.adminId}: ${result.checked} payouts, ${result.payableMinor} minor units`);
    return result;
  }

  /** Return a batch to its maker with a reason.
   *
   *  NOT SUBJECT TO THE TWO-PERSON RULE — see `returnNeedsSecondPerson` for the argument. Refusing your own batch is
   *  noticing your own mistake, and requiring a colleague to help you stop a payment run at 02:00 would make the safe
   *  action the expensive one.
   */
  async returnToMaker(actor: AdminActor, id: string, reason: string) {
    return this.pool.withTx(async (c) => {
      const b = await this.repo.getBatchForUpdate(c, id);
      if (!b) throw new InvalidPayoutOpsError('no such payout batch');
      assertReturnable({ status: b.status, reason, returnerAdminId: actor.adminId });

      const moved = await this.repo.returnBatch(c, id, actor.adminId, reason);
      if (!moved) {
        throw new InvalidPayoutOpsError(
          'this batch was decided by another operator while you were reviewing it — reload to see who and when');
      }
      await this.audit.write(c, {
        actorUserId: actor.adminId,
        action: 'payout.batch.returned',
        entityType: 'payout_batch',
        entityId: id,
        // The reason IS the record here — it is the only thing the maker will read, and an audit row for a refusal that
        // did not carry the refusal would be a note that somebody said no.
        newValue: { reason: reason.trim(), batchType: b.batchType, count: b.count },
        ip: actor.ip,
      });
      return { id, status: 'returned' as const };
    });
  }

  /** Run the preflight without approving, and RECORD IT — including a failing result, which is the evidence that
   *  somebody looked. W067's panel is refreshable and a checker who runs the checks then walks away has still
   *  established something worth keeping. */
  async runPreflight(actor: AdminActor, id: string) {
    const b = await this.repo.getBatch(id);
    if (!b) throw new InvalidPayoutOpsError('no such payout batch');
    const fresh = await this.freshPreflight(id);
    return this.pool.withTx(async (c) => {
      await this.repo.recordPreflight(c, id, preflightForStorage(fresh));
      await this.audit.write(c, {
        actorUserId: actor.adminId,
        action: 'payout.batch.preflight',
        entityType: 'payout_batch',
        entityId: id,
        newValue: { pass: fresh.pass, checked: fresh.checked, blocked: fresh.blocked },
        ip: actor.ip,
      });
      return serialisePreflight(fresh);
    });
  }

  private async freshPreflight(id: string): Promise<PreflightResult> {
    const subjects = await this.repo.preflightSubjects(id, PREFLIGHT_LIMIT + 1);
    if (subjects.length > PREFLIGHT_LIMIT) {
      throw new InvalidPayoutOpsError(
        `this batch holds more than ${PREFLIGHT_LIMIT} payouts, which is more than one preflight can examine. `
        + 'A batch that large is itself a signal — split it rather than approving a set nobody has checked in full.');
    }
    return preflight(subjects);
  }
}

function serialisePreflight(r: PreflightResult) {
  return {
    pass: r.pass,
    checked: r.checked,
    blocked: r.blocked,
    payableMinor: r.payableMinor.toString(),
    totalMinor: r.totalMinor.toString(),
    byFailure: r.byFailure,
  };
}

function decodeCursor(c?: string): { c: string; id: string } | undefined {
  if (!c) return undefined;
  const [ts, id] = Buffer.from(c, 'base64').toString('utf8').split('|');
  return ts && id ? { c: ts, id } : undefined;
}

function decodeLinesCursor(c?: string): { pr: number; c: string; id: string } | undefined {
  if (!c) return undefined;
  const [pr, ts, id] = Buffer.from(c, 'base64').toString('utf8').split('|');
  const n = Number(pr);
  // A non-finite priority in a cursor is a corrupt cursor, and starting the page from priority 0 would silently show
  // the operator the top of the queue as though it were their next page.
  return Number.isFinite(n) && ts && id ? { pr: n, c: ts, id } : undefined;
}
