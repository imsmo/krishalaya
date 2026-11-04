// modules/fintech/services/servicing.service.ts · PC-54 W54-8. Post-disbursal servicing (loan.manage):
// DPD/collections reads; KCC drawl ledger (SIGNED entries: +drawl/+interest, −repayment; running balance
// computed in ONE tx under the loan lock — never client-supplied; drawn balance can never go negative);
// restructures (maker-checker — the CHECKER must differ from the PROPOSER, checked against the server-recorded
// `proposed_by`); write-off (refused by name, below).
//
// CORRECTED BY PC-56 PARTNER-5a (survey_partner5.md C-5): this header used to say a write-off was "audited via the outbox trail on the
// audit service upstream". It was not, and nothing here is: this file imports no audit writer and no outbox writer, `FintechEventType`
// has no restructure or write-off event, and there is no audit interceptor upstream (the global providers are the backpressure,
// response and impersonation interceptors and the auditor read-only guard). The only trace a servicing write leaves of who did it is an
// `idempotency_keys` row whose memory is 24 hours. "Borrower-accept OTP stays a recorded status" was untrue too: nothing ever writes it.
//
// PC-56 PARTNER-5a · THE FOUR NAMED REFUSALS (founder 5a-1 / 5a-2 / 5a-3, 2026-11-04; survey F-1, F-2) — in the REFUSING direction only:
//   • `activated` → RESTRUCTURE_ACTIVATION_NOT_LIVE (409). Activation's only effect was `loans.status = 'restructured'`, a state outside the
//     loan machine: the loan could no longer be repaid by either rail, the milk deduction skipped it, it left every arrears figure, no agreed
//     term reached it — and, because the loan was neither locked nor re-read, a loan repaid or written off since the draft was reopened as a
//     frozen debt. The loan-status write is REMOVED from this file, not left unreachable (the unit spec scans the source).
//   • `accepted` → RESTRUCTURE_ACCEPTANCE_NOT_LIVE (409). It was a desk click that stamped `accepted_at` against the borrower's name; she has
//     no screen to accept on (P5-B4). CONSEQUENCE, said plainly: no restructure can progress past `mediation` today.
//   • `writeOff` → WRITE_OFF_NOT_LIVE (409), first. It was one person's click that validated a reason and threw it away; the status write
//     is REMOVED too (P5-B1 + P4-B12 ship the record and the second person together, in the money wave).
// `RESTRUCTURE_FLOW` keeps every row: the machine's VOCABULARY is unchanged, and two of its transitions are refused by name before any lock
// or write. `draft → mediation | rejected`, `mediation → rejected | expired`, and `accepted → checker_approved | rejected` (reachable only
// for a row already in `accepted` on some database) all stay — so the one real two-person rule, at `checker_approved`, stays exercised.
// Loans already `restructured` on any database are left exactly as they are.
//
// PC-56 PARTNER-4a · P4-B0 (founder 4a-1, survey F-11): the four WRITES here are idempotent on the caller's key —
// `remember(key, …)` returns the first result for a replay instead of acting twice, so a double-submitted drawl no
// longer writes two entries and doubles a farmer's drawn balance. The reads (dpd, collections, the ledger, the
// restructure list) take no key: they write nothing. The whole controller is now behind the `fintech` flag.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { ServicingRepository } from '../repositories/servicing.repository';
import { RestructureAcceptanceNotLiveError, RestructureActivationNotLiveError, WriteOffNotLiveError } from '../domain/fintech.errors';

export const RESTRUCTURE_FLOW: Record<string, string[]> = {
  draft: ['mediation', 'rejected'], mediation: ['accepted', 'rejected', 'expired'],
  accepted: ['checker_approved', 'rejected'], checker_approved: ['activated', 'rejected'],
  activated: [], rejected: [], expired: [],
};
export interface FinActor { userId: string; canManage: boolean }

@Injectable()
export class ServicingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: ServicingRepository,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
  ) {}
  private assertManager(a: FinActor) { if (!a.canManage) throw new ForbiddenError('requires loan.manage'); }

  dpd(tenantId: string, a: FinActor) { this.assertManager(a); return this.repo.dpdBuckets(tenantId); }
  collections(tenantId: string, a: FinActor, limit = 100) { this.assertManager(a); return this.repo.collectionsQueue(tenantId, Math.min(limit, 200)); }

  async kccEntry(tenantId: string, a: FinActor, loanId: string, dto: { entryKind: 'drawl' | 'repayment' | 'interest'; amountMinor: string; narrative: string; destinationKind?: string; repaymentChannel?: string }, idemKey: string) {
    this.assertManager(a);
    if (!/^\d{1,15}$/.test(dto.amountMinor) || dto.amountMinor === '0') throw new BadRequestError('amountMinor must be a positive integer string');
    return this.idem.remember(idemKey, a.userId, 'fintech.servicing.kccEntry', () => this.uow.run(tenantId, async (tx) => {
      const loan = await this.repo.lockLoan(tx, tenantId, loanId);
      if (!loan) throw new NotFoundError('loan not found');
      if (!['active', 'overdue', 'restructured'].includes(loan.status)) throw new ConflictError('loan is not serviceable');
      const signed = dto.entryKind === 'repayment' ? -BigInt(dto.amountMinor) : BigInt(dto.amountMinor);
      const balance = (await this.repo.lastKccBalance(tx, tenantId, loanId)) + signed;
      if (balance < 0n) throw new ConflictError('repayment exceeds the drawn balance');
      await this.repo.insertKccEntry(tx, { tenantId, loanId, entryKind: dto.entryKind, amountMinor: signed, balanceAfterMinor: balance, narrative: dto.narrative, destinationKind: dto.destinationKind, repaymentChannel: dto.repaymentChannel, createdBy: a.userId });
      return { loanId, balanceAfterMinor: balance.toString() };
    }, { userId: a.userId }));
  }
  kccLedger(tenantId: string, a: FinActor, loanId: string) { this.assertManager(a); return this.repo.kccLedger(tenantId, loanId); }

  async proposeRestructure(tenantId: string, a: FinActor, loanId: string, dto: { caseRef?: string; reasonCode: 'weather_distress' | 'other'; evidenceMediaId?: string; oldInstalmentMinor: string; newInstalmentMinor: string; oldTenorMonths: number; newTenorMonths: number; rateAprBps: number; holidayMonths?: number; holidayStartsOn?: string; penalInterestWaived?: boolean; totalInterestDeltaMinor: string }, idemKey: string) {
    this.assertManager(a);
    return this.idem.remember(idemKey, a.userId, 'fintech.servicing.proposeRestructure', async () => {
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
    });
  }
  listRestructures(tenantId: string, a: FinActor, loanId: string) { this.assertManager(a); return this.repo.listRestructures(tenantId, loanId); }

  async transitionRestructure(tenantId: string, a: FinActor, id: string, to: string, idemKey: string) {
    this.assertManager(a);
    // PC-56 PARTNER-5a (founder 5a-1 / 5a-2): refused BY NAME, before the idempotency record, before the lock and before any write.
    if (to === 'activated') throw new RestructureActivationNotLiveError();
    if (to === 'accepted') throw new RestructureAcceptanceNotLiveError();
    return this.idem.remember(idemKey, a.userId, 'fintech.servicing.transitionRestructure', () => this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.getRestructureForUpdate(tx, tenantId, id);
      if (!r) throw new NotFoundError('restructure not found');
      if (!(RESTRUCTURE_FLOW[r.status] ?? []).includes(to)) throw new ConflictError(`cannot move ${r.status}→${to}`);
      if (to === 'checker_approved' && r.proposedBy === a.userId) throw new ForbiddenError('maker-checker: the checker must differ from the proposer');
      await this.repo.setRestructureStatus(tx, tenantId, id, to, { checkerId: a.userId });
      return { id, status: to };
    }, { userId: a.userId }));
  }

  /**
   * PC-56 PARTNER-5a (founder 5a-3) — REFUSED BY NAME, FIRST: no lock, no read, no write, no idempotency record. The route, its permission
   * and its Idempotency-Key requirement are unchanged (the controller still answers 400 without a key, so the contract stays uniform), and
   * every argument is kept so the day the money wave ships the record and the second person, the signature does not move.
   */
  async writeOff(_tenantId: string, _a: FinActor, _loanId: string, _reason: string, _idemKey: string): Promise<never> {
    throw new WriteOffNotLiveError();
  }
}
