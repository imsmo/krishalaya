// modules/memberships/services/coop-payout.service.ts · PC-55 A8. An activated vote becomes money owed.
// THE FIVE GUARDS (this is a co-op's own money being split between its members):
//  1. ONLY AN ACTIVATED dividend/patronage resolution pays — a draft or an open vote has decided nothing.
//  2. MAKER ≠ CHECKER — whoever prepares the run cannot be the one who confirms it.
//  3. ONE RUN PER RESOLUTION — enforced by the 0088 unique index, so one vote can never pay twice.
//  4. THE SUM MUST EQUAL THE POT, exactly, before a single payout row is written (largest-remainder split);
//     if that invariant fails we abort rather than write a nearly-right ledger.
//  5. NOTHING EXECUTES — rows land in payouts as 'queued' behind the existing pipeline; the response says
//     plainly that RazorpayX keys are what turns queued into paid.
// Members with no penny-verified bank account are SKIPPED BY NAME (payouts.bank_account_id is NOT NULL), never
// silently dropped, so the co-op can chase them.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { CoopPayoutRepository } from '../repositories/coop-payout.repository';
import { parseFormula, allocate, allocationsSumTo, canConfirmRun, resolutionPayable } from '../domain/coop-payout.rules';

export interface CoopPayoutActor { userId: string; canManage: boolean }

@Injectable()
export class CoopPayoutService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: CoopPayoutRepository,
    private readonly audit: AuditWriter,
  ) {}
  private assert(a: CoopPayoutActor) { if (!a.canManage) throw new ForbiddenError('requires tenant.settings'); }

  /** DRY RUN: what would each member get? Same arithmetic, zero writes — a board should always be able to
   *  look before it pays. */
  async preview(tenantId: string, a: CoopPayoutActor, resolutionId: string) {
    this.assert(a);
    const { formula, members, allocations, skipped, purpose, title } = await this.compute(tenantId, resolutionId);
    return {
      resolution: { id: resolutionId, title, purpose },
      formula,
      totalMinor: formula.potMinor,
      payable: allocations.filter((x) => BigInt(x.amountMinor) > 0n).length,
      zeroShare: allocations.filter((x) => BigInt(x.amountMinor) === 0n).length,
      memberCount: members.length,
      skipped,
      lines: allocations.slice(0, 500),
      note: 'Preview only — nothing has been queued or paid.',
    };
  }

  /** THE RUN. preparedBy is the caller; confirmedBy must be a DIFFERENT human (passed as confirmedBy). */
  async run(tenantId: string, a: CoopPayoutActor, resolutionId: string, key: string, dto: { confirmedBy: string }, ip: string | null) {
    this.assert(a);
    if (!canConfirmRun(a.userId, dto.confirmedBy)) {
      throw new ForbiddenError('maker-checker: the person preparing a co-op payout run cannot also confirm it');
    }
    const runId = uuidv7();
    const batchId = uuidv7();
    return this.uow.run(tenantId, async (tx) => {
      const res = await this.repo.lockResolution(tx, tenantId, resolutionId);
      if (!res) throw new NotFoundError('resolution not found');
      const payable = resolutionPayable(res.status, res.resolution_type);
      if (!payable.ok) throw new ConflictError(payable.error);
      const parsed = parseFormula(res.payload ?? {});
      if (!parsed.ok) throw new BadRequestError(parsed.error);
      const formula = parsed.value;

      const members = await this.repo.payableMembers(tenantId);
      if (members.length === 0) throw new ConflictError('this co-op has no active members to pay');
      const allocations = allocate(formula, members.map((m) => ({ userId: m.userId, basisMinor: m.basisMinor })));

      // GUARD 4 — refuse to write a nearly-right ledger.
      if (!allocationsSumTo(allocations, formula.potMinor)) {
        throw new ConflictError('allocation did not sum to the resolution pot — refusing to write a partial run');
      }

      const bankByUser = new Map(members.map((m) => [m.userId, m.bankAccountId]));
      const skipped: Array<{ userId: string; reason: string }> = [];
      const queued: Array<{ userId: string; amountMinor: string; bankAccountId: string }> = [];
      for (const alloc of allocations) {
        if (BigInt(alloc.amountMinor) === 0n) { skipped.push({ userId: alloc.userId, reason: 'zero_share' }); continue; }
        const bank = bankByUser.get(alloc.userId) ?? null;
        if (!bank) { skipped.push({ userId: alloc.userId, reason: 'skipped_no_bank_account' }); continue; }
        queued.push({ userId: alloc.userId, amountMinor: alloc.amountMinor, bankAccountId: bank });
      }
      if (queued.length === 0) throw new ConflictError('no member could be queued (no verified bank accounts) — nothing was written');

      const queuedTotal = queued.reduce((s, q) => s + BigInt(q.amountMinor), 0n).toString();
      await this.repo.insertBatch(tx, { id: batchId, tenantId, batchType: `coop_${payable.purpose}`, totalMinor: queuedTotal, count: queued.length });
      for (const q of queued) {
        await this.repo.insertPayout(tx, {
          id: uuidv7(), tenantId, userId: q.userId, bankAccountId: q.bankAccountId, purposeCode: payable.purpose,
          runId, amountMinor: q.amountMinor, currencyCode: 'INR', batchId,
        });
      }
      const ins = await this.repo.insertRun(tx, {
        id: runId, tenantId, resolutionId, batchId, purposeCode: payable.purpose,
        formulaSnapshot: { ...formula, basis: formula.mode === 'patronage_pro_rata' ? 'paid_milk_bills_365d' : 'equal' },
        totalMinor: queuedTotal, memberCount: queued.length, skippedCount: skipped.length, skippedDetail: skipped,
        currencyCode: 'INR', preparedBy: a.userId, confirmedBy: dto.confirmedBy, idempotencyKey: key,
      });
      if (!ins.ok) {
        throw new ConflictError(ins.conflict === 'replay'
          ? 'this payout run was already recorded (idempotency-key replay)'
          : 'this resolution already has a payout run — one vote pays once');
      }
      await this.audit.write(tx, {
        tenantId, actorUserId: a.userId, action: 'governance.coop_payout_run_created', entityType: 'coop_payout_run', entityId: runId,
        oldValue: null,
        newValue: { resolutionId, purpose: payable.purpose, potMinor: formula.potMinor, queuedTotalMinor: queuedTotal, queuedCount: queued.length, skippedCount: skipped.length, batchId, confirmedBy: dto.confirmedBy },
        reason: `${payable.purpose} run from resolution '${res.title}'`, ip,
      });
      return {
        id: runId, batchId, purpose: payable.purpose, potMinor: formula.potMinor, queuedTotalMinor: queuedTotal,
        queuedCount: queued.length, skipped,
        execution: {
          executed: false,
          note: 'Payouts are QUEUED. They move only when the platform payout pipeline runs with live RazorpayX '
              + 'credentials; until then no money has left the co-op and no member has been paid.',
        },
      };
    }, { userId: a.userId });
  }

  runs(tenantId: string, a: CoopPayoutActor, limit = 50) { this.assert(a); return this.repo.listRuns(tenantId, limit); }
  async getRun(tenantId: string, a: CoopPayoutActor, id: string) {
    this.assert(a);
    const r = await this.repo.getRun(tenantId, id);
    if (!r) throw new NotFoundError('payout run not found');
    return r;
  }

  /** Shared arithmetic for preview and run (one code path, so a preview can never differ from the real split). */
  private async compute(tenantId: string, resolutionId: string) {
    const runRead = await this.uow.run(tenantId, async (tx) => {
      const res = await this.repo.lockResolution(tx, tenantId, resolutionId);
      if (!res) throw new NotFoundError('resolution not found');
      return res;
    }, { userId: 'system' });
    const payable = resolutionPayable(runRead.status, runRead.resolution_type);
    if (!payable.ok) throw new ConflictError(payable.error);
    const parsed = parseFormula(runRead.payload ?? {});
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    const members = await this.repo.payableMembers(tenantId);
    const allocations = allocate(parsed.value, members.map((m) => ({ userId: m.userId, basisMinor: m.basisMinor })));
    const skipped = members.filter((m) => !m.bankAccountId).map((m) => ({ userId: m.userId, reason: 'skipped_no_bank_account' }));
    return { formula: parsed.value, members, allocations, skipped, purpose: payable.purpose, title: runRead.title };
  }
}
