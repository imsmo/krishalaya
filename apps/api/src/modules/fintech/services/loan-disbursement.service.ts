// modules/fintech/services/loan-disbursement.service.ts · PC-55 A9. Approved credit → QUEUED money.
// THE GUARDS, in the order they protect a borrower:
//  1. COOLING-OFF IS SACRED (PRD §59.4) — an application inside its window is REFUSED and reported as
//     'cooling_off' with the exact instant it becomes eligible. Money in the account is not a decision a
//     farmer can take back, so the window must fully elapse first. Never rounded in the lender's favour.
//  2. ONE DISBURSAL PER APPLICATION — the 0089 unique item index makes a double disbursal impossible even
//     under two concurrent officers.
//  3. MAKER ≠ CHECKER — confirmedBy is required and must differ from the preparer.
//  4. TOTALS AGREE before anything is written; otherwise abort rather than write a partial ledger.
//  5. NOTHING EXECUTES — payouts land 'queued'; flipping applications → disbursed and creating the `loans`
//     servicing mirror is the separate, KEY-GATED execute step (jobs/loan-disbursement-execute.handler.ts).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { LoanDisbursementRepository } from '../repositories/loan-disbursement.repository';
import { planRun, canConfirmRun, totalsAgree } from '../domain/loan-disbursement.rules';

export interface DisbursementActor { userId: string; canManage: boolean }

@Injectable()
export class LoanDisbursementService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: LoanDisbursementRepository,
    private readonly audit: AuditWriter,
  ) {}
  private assert(a: DisbursementActor) { if (!a.canManage) throw new ForbiddenError('requires loan.manage'); }

  /** DRY RUN — who would be paid, who would be held back, and why. Same planner as the real run. */
  async preview(tenantId: string, a: DisbursementActor, applicationIds?: string[]) {
    this.assert(a);
    const apps = await this.repo.candidates(tenantId, applicationIds);
    const split = planRun(apps, Date.now());
    return {
      candidates: apps.length,
      queued: split.queued.length,
      totalMinor: split.totalMinor,
      skipped: split.skipped,
      lines: split.queued.slice(0, 500),
      note: 'Preview only — nothing has been queued or paid.',
    };
  }

  async run(tenantId: string, a: DisbursementActor, key: string, dto: { confirmedBy: string; applicationIds?: string[] }, ip: string | null) {
    this.assert(a);
    if (!canConfirmRun(a.userId, dto.confirmedBy)) {
      throw new ForbiddenError('maker-checker: the person preparing a disbursement run cannot also confirm it');
    }
    const runId = uuidv7();
    const batchId = uuidv7();
    return this.uow.run(tenantId, async (tx) => {
      const apps = await this.repo.candidates(tenantId, dto.applicationIds);
      const split = planRun(apps, Date.now());
      if (split.queued.length === 0) {
        const held = split.skipped.filter((s) => s.reason === 'cooling_off').length;
        throw new ConflictError(held > 0
          ? `nothing to disburse: ${held} approved loan(s) are still inside their cooling-off window`
          : 'nothing to disburse: no approved application is currently eligible');
      }
      if (!totalsAgree(split)) throw new ConflictError('run totals did not agree — refusing to write a partial batch');

      await this.repo.insertBatch(tx, { id: batchId, tenantId, totalMinor: split.totalMinor, count: split.queued.length });
      const written: typeof split.queued = [];
      const raced: Array<{ applicationId: string; reason: 'already_disbursed' }> = [];
      for (const q of split.queued) {
        const payoutId = uuidv7();
        await this.repo.insertPayout(tx, {
          id: payoutId, tenantId, userId: q.borrowerUserId, bankAccountId: q.bankAccountId,
          runId, applicationId: q.applicationId, amountMinor: q.amountMinor, currencyCode: 'INR', batchId,
        });
        const claimed = await this.repo.insertItem(tx, {
          runId, applicationId: q.applicationId, tenantId, borrowerUserId: q.borrowerUserId,
          amountMinor: q.amountMinor, payoutId,
        });
        if (claimed) written.push(q);
        else raced.push({ applicationId: q.applicationId, reason: 'already_disbursed' });
      }
      if (written.length === 0) throw new ConflictError('every application in this run was already disbursed by another run');
      const writtenTotal = written.reduce((s, w) => s + BigInt(w.amountMinor), 0n).toString();

      const ins = await this.repo.insertRun(tx, {
        id: runId, tenantId, batchId, totalMinor: writtenTotal, loanCount: written.length,
        skippedCount: split.skipped.length + raced.length,
        skippedDetail: [...split.skipped, ...raced], currencyCode: 'INR',
        preparedBy: a.userId, confirmedBy: dto.confirmedBy, idempotencyKey: key,
      });
      if (!ins.ok) throw new ConflictError('this disbursement run was already recorded (idempotency-key replay)');

      await this.audit.write(tx, {
        tenantId, actorUserId: a.userId, action: 'fintech.loan_disbursement_run_created',
        entityType: 'loan_disbursement_run', entityId: runId, oldValue: null,
        newValue: { batchId, queuedTotalMinor: writtenTotal, queuedCount: written.length, skipped: split.skipped.length + raced.length, confirmedBy: dto.confirmedBy },
        reason: 'approved loans queued for disbursal', ip,
      });
      return {
        id: runId, batchId, queuedTotalMinor: writtenTotal, queuedCount: written.length,
        skipped: [...split.skipped, ...raced],
        execution: {
          executed: false,
          note: 'Loans are QUEUED for disbursal. They move only when the payout pipeline runs with live '
              + 'RazorpayX credentials; until then no borrower has been paid, no application is marked '
              + 'disbursed, and no servicing loan record exists.',
        },
      };
    }, { userId: a.userId });
  }

  runs(tenantId: string, a: DisbursementActor, limit = 50) { this.assert(a); return this.repo.listRuns(tenantId, limit); }
  async getRun(tenantId: string, a: DisbursementActor, id: string) {
    this.assert(a);
    const r = await this.repo.getRun(tenantId, id);
    if (!r) throw new NotFoundError('disbursement run not found');
    return r;
  }
}
