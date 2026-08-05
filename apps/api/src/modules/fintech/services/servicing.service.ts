// modules/fintech/services/servicing.service.ts · PC-54 W54-8. Post-disbursal servicing (loan.manage):
// DPD/collections reads; KCC drawl ledger (SIGNED entries: +drawl/+interest, −repayment; running balance
// computed in ONE tx under the loan lock — never client-supplied; drawn balance can never go negative);
// restructures (canon W220 doctrine: rate unchanged, maker-checker — the CHECKER must differ from the
// PROPOSER; borrower-accept OTP stays a recorded status); write-off only from overdue, with a reason (audited
// via the outbox trail on the audit service upstream — here the status guard is the law).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { ServicingRepository } from '../repositories/servicing.repository';

const RESTRUCTURE_FLOW: Record<string, string[]> = {
  draft: ['mediation', 'rejected'], mediation: ['accepted', 'rejected', 'expired'],
  accepted: ['checker_approved', 'rejected'], checker_approved: ['activated', 'rejected'],
  activated: [], rejected: [], expired: [],
};
export interface FinActor { userId: string; canManage: boolean }

@Injectable()
export class ServicingService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly repo: ServicingRepository) {}
  private assertManager(a: FinActor) { if (!a.canManage) throw new ForbiddenError('requires loan.manage'); }

  dpd(tenantId: string, a: FinActor) { this.assertManager(a); return this.repo.dpdBuckets(tenantId); }
  collections(tenantId: string, a: FinActor, limit = 100) { this.assertManager(a); return this.repo.collectionsQueue(tenantId, Math.min(limit, 200)); }

  async kccEntry(tenantId: string, a: FinActor, loanId: string, dto: { entryKind: 'drawl' | 'repayment' | 'interest'; amountMinor: string; narrative: string; destinationKind?: string; repaymentChannel?: string }) {
    this.assertManager(a);
    if (!/^\d{1,15}$/.test(dto.amountMinor) || dto.amountMinor === '0') throw new BadRequestError('amountMinor must be a positive integer string');
    return this.uow.run(tenantId, async (tx) => {
      const loan = await this.repo.lockLoan(tx, tenantId, loanId);
      if (!loan) throw new NotFoundError('loan not found');
      if (!['active', 'overdue', 'restructured'].includes(loan.status)) throw new ConflictError('loan is not serviceable');
      const signed = dto.entryKind === 'repayment' ? -BigInt(dto.amountMinor) : BigInt(dto.amountMinor);
      const balance = (await this.repo.lastKccBalance(tx, tenantId, loanId)) + signed;
      if (balance < 0n) throw new ConflictError('repayment exceeds the drawn balance');
      await this.repo.insertKccEntry(tx, { tenantId, loanId, entryKind: dto.entryKind, amountMinor: signed, balanceAfterMinor: balance, narrative: dto.narrative, destinationKind: dto.destinationKind, repaymentChannel: dto.repaymentChannel, createdBy: a.userId });
      return { loanId, balanceAfterMinor: balance.toString() };
    }, { userId: a.userId });
  }
  kccLedger(tenantId: string, a: FinActor, loanId: string) { this.assertManager(a); return this.repo.kccLedger(tenantId, loanId); }

  async proposeRestructure(tenantId: string, a: FinActor, loanId: string, dto: { caseRef?: string; reasonCode: 'weather_distress' | 'other'; evidenceMediaId?: string; oldInstalmentMinor: string; newInstalmentMinor: string; oldTenorMonths: number; newTenorMonths: number; rateAprBps: number; holidayMonths?: number; holidayStartsOn?: string; penalInterestWaived?: boolean; totalInterestDeltaMinor: string }) {
    this.assertManager(a);
    const id = uuidv7();
    await this.uow.run(tenantId, async (tx) => {
      const loan = await this.repo.lockLoan(tx, tenantId, loanId);
      if (!loan) throw new NotFoundError('loan not found');
      if (!['active', 'overdue'].includes(loan.status)) throw new ConflictError('only an active/overdue loan can be restructured');
      await this.repo.insertRestructure(tx, {
        id, tenantId, loanId, caseRef: dto.caseRef, reasonCode: dto.reasonCode, evidenceMediaId: dto.evidenceMediaId,
        oldInstalmentMinor: BigInt(dto.oldInstalmentMinor), newInstalmentMinor: BigInt(dto.newInstalmentMinor),
        oldTenorMonths: dto.oldTenorMonths, newTenorMonths: dto.newTenorMonths, rateAprBps: dto.rateAprBps,
        holidayMonths: dto.holidayMonths ?? 0, holidayStartsOn: dto.holidayStartsOn, penalInterestWaived: dto.penalInterestWaived ?? false,
        totalInterestDeltaMinor: BigInt(dto.totalInterestDeltaMinor), proposedBy: a.userId,
      });
    }, { userId: a.userId });
    return { id, status: 'draft' as const };
  }
  listRestructures(tenantId: string, a: FinActor, loanId: string) { this.assertManager(a); return this.repo.listRestructures(tenantId, loanId); }

  async transitionRestructure(tenantId: string, a: FinActor, id: string, to: string) {
    this.assertManager(a);
    return this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.getRestructureForUpdate(tx, tenantId, id);
      if (!r) throw new NotFoundError('restructure not found');
      if (!(RESTRUCTURE_FLOW[r.status] ?? []).includes(to)) throw new ConflictError(`cannot move ${r.status}→${to}`);
      if (to === 'checker_approved' && r.proposedBy === a.userId) throw new ForbiddenError('maker-checker: the checker must differ from the proposer');
      await this.repo.setRestructureStatus(tx, tenantId, id, to, { checkerId: a.userId });
      if (to === 'activated') await this.repo.setLoanStatus(tx, tenantId, r.loanId, 'restructured');
      return { id, status: to };
    }, { userId: a.userId });
  }

  async writeOff(tenantId: string, a: FinActor, loanId: string, reason: string) {
    this.assertManager(a);
    if (!reason || reason.trim().length < 3) throw new BadRequestError('a written reason is required');
    return this.uow.run(tenantId, async (tx) => {
      const loan = await this.repo.lockLoan(tx, tenantId, loanId);
      if (!loan) throw new NotFoundError('loan not found');
      if (loan.status !== 'overdue') throw new ConflictError('only an overdue loan can be written off');
      await this.repo.setLoanStatus(tx, tenantId, loanId, 'written_off');
      return { loanId, status: 'written_off' as const, outstandingMinor: loan.outstandingMinor.toString() };
    }, { userId: a.userId });
  }
}
