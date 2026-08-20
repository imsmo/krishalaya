// modules/fintech/services/loan.service.ts · loan SERVICING — repayment (the money-in path).
// repay: the borrower pays toward the loan — borrower userMain → tenant 'main' (txnType 'loan_repayment',
// zero-sum + idempotent — Law 2); the outstanding is reduced (exact bigint) and the loan CLOSES at zero. A
// loan_repayment row is recorded (partitioned). Every write: one ACID tx (UoW), state via the machine
// (Law 5), outbox in-tx (Law 4), idempotent money mutation (Law 3), authz THROWS (Law 6). FOR UPDATE lock.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, TenantAccount } from '../../../core/wallet/account-codes';
import { AccountRef } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { LoanRepayment } from '../domain/loan-repayment.entity';
import { DomainEvent } from '../domain/fintech.events';
import { LoanRepository } from '../repositories/loan.repository';
import { LoanRepaymentRepository } from '../repositories/loan-repayment.repository';
import { RepayLoanDto } from '../dto/create-loan-repayment.dto';
import { LoanNotFoundError, FintechForbiddenError } from '../domain/fintech.errors';
import { FintechActor } from './loan-application.service';

const tenantMain = (tenantId: string): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Main, currencyCode: 'INR' });

@Injectable()
export class LoanService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly loans: LoanRepository,
    private readonly repayments: LoanRepaymentRepository,
  ) {}

  async repay(tenantId: string, actor: FintechActor, loanId: string, idemKey: string, dto: RepayLoanDto, ip: string | null) {
    if (!actor.canBorrow && !actor.canManage) throw new FintechForbiddenError('requires loan.borrow');
    return this.idem.remember(idemKey, actor.userId, 'fintech.loan.repay', () =>
      timed(this.metrics, 'fintech.loan.repay', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const loan = await this.loans.getForUpdate(tx, tenantId, loanId);
          if (!loan) throw new LoanNotFoundError(loanId);
          if (loan.borrowerUserId !== actor.userId && !actor.canManage) throw new FintechForbiddenError('only the borrower may repay this loan');
          const amount = BigInt(dto.amountMinor);
          loan.repay(amount, new Date());   // throws OverRepayment / not-servicing; closes at zero
          await this.loans.update(tx, loan);
          const now = new Date();
          const rep = LoanRepayment.record({ id: uuidv7(), loanId, tenantId, dueDate: now.toISOString().slice(0, 10), amountDueMinor: amount, amountPaidMinor: amount, paidAt: now, channel: dto.channel });
          await this.repayments.insert(tx, rep);
          // Borrower repays into the FPO/tenant lending pool — a balanced, idempotent transfer (Law 2).
          await this.wallet.post(tx, { tenantId, txnType: 'loan_repayment', idempotencyKey: `loan-repay:${rep.id}`, referenceType: 'loan', referenceId: loanId, initiatedBy: actor.userId,
            legs: [{ account: userMain(loan.borrowerUserId), amountMinor: -amount }, { account: tenantMain(tenantId), amountMinor: amount }] });
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'fintech.loan.repaid', entityType: 'loan', entityId: loanId, newValue: { amountMinor: amount.toString(), outstandingMinor: loan.outstandingMinor.toString() }, ip });
          await this.flush(tx, tenantId, loanId, loan.pullEvents());
          return { ...loan.toJSON(), repaymentId: rep.id };
        }, { userId: actor.userId })));
  }

  /**
   * [PC-56 TENANT-6c-4] REPAY A LOAN OUT OF A MILK BILL, inside the dairy payment's own transaction.
   *
   * THE PROMISE THIS KEEPS WAS MADE TWICE, IN THIS MODULE, AND NOTHING IMPLEMENTED IT:
   *   * `fintech/domain/fintech.events.ts`: `REPAYMENT_STYLES = ['emi','bullet','harvest_aligned','milk_bill_deduction']`
   *   * `0011_fintech_schemes.sql`, on `loan_repayments.channel`: `-- upi|milk_bill_deduction|harvest_settlement|cash_partner`
   * So a loan could be sold to a dairy farmer on the understanding that it comes out of her milk cheque, and the dairy
   * module had never heard of it. W169's *"−₹1,240 loan EMI + insurance"* line was the other half of the same gap.
   *
   * WHY THIS SHAPE. It takes the CALLER'S transaction (`tx`) rather than opening its own, exactly as
   * `MilkBillService.voidLoaded` does and for the same reason TENANT-6c-2 learned the hard way: the dairy payment has
   * already locked the bill and posted the gross, and a self-transacting call would ask a second connection for a lock
   * the first one holds and wait on itself. It is a public method on this module's SERVICE, never a repository handed
   * across a module boundary (CLAUDE.md: *"No module imports another module's repositories — only its public service
   * or events"*), so the loan's own invariants — status, ownership, over-repayment, the closing transition — are
   * enforced by the module that owns them and cannot be reimplemented differently by the dairy side.
   *
   * NO PERMISSION CHECK, and that is deliberate rather than an omission: this is not a person acting on a loan, it is
   * a settlement the cooperative and the borrower both already agreed to, and the authorisation lives where the
   * decision was made — `dairy.manage` + `settlement.close` + the checker on the cycle (TENANT-6c-3), plus the
   * member's own fresh consent above the threshold (W169's 25% rule). What IS checked here is that the loan belongs
   * to this tenant AND to the member being paid: a deduction line naming somebody else's loan would take one family's
   * milk money to pay another family's debt, which is the worst thing this file could be made to do.
   *
   * THERE IS NO EMI SCHEDULE ON THIS PLATFORM (`loan-repayment.entity.ts` says so: *"a pre-generated EMI schedule is
   * deferred"*), so this cannot verify that `amountMinor` IS the instalment due. It verifies what it can — the amount
   * is positive, the loan is servicing, and it does not exceed the outstanding — and the caller's own consent gate is
   * what stands between a member and an amount they did not agree to. The schedule is named, not faked.
   */
  async applyMilkBillDeduction(tx: TxContext, tenantId: string, input: {
    loanId: string; borrowerUserId: string; amountMinor: bigint; billId: string; deductionId: string; initiatedBy: string;
  }): Promise<{ loanId: string; repaymentId: string; outstandingMinor: string; walletTxnId: string }> {
    const loan = await this.loans.getForUpdate(tx, tenantId, input.loanId);
    if (!loan) throw new LoanNotFoundError(input.loanId);
    // 404, not 403: a loan id that is not this member's must not be confirmable by probing the error.
    if (loan.borrowerUserId !== input.borrowerUserId) throw new LoanNotFoundError(input.loanId);
    const now = new Date();
    loan.repay(input.amountMinor, now);          // throws OverRepayment / not-servicing; closes the loan at zero
    await this.loans.update(tx, loan);
    const rep = LoanRepayment.record({
      id: uuidv7(), loanId: input.loanId, tenantId, dueDate: now.toISOString().slice(0, 10),
      amountDueMinor: input.amountMinor, amountPaidMinor: input.amountMinor, paidAt: now,
      // The channel `0011` named and nothing ever wrote.
      channel: 'milk_bill_deduction',
    });
    await this.repayments.insert(tx, rep);
    const txn = await this.wallet.post(tx, {
      tenantId, txnType: 'loan_repayment',
      // Keyed on the DEDUCTION LINE, not on the loan or the bill: one bill can carry a line for each of a member's
      // loans, and a rebuilt bill (TENANT-6c-2's void) presents new lines for the same loan. The line is the attempt.
      idempotencyKey: `milkdeduct:${input.deductionId}`,
      referenceType: 'loan', referenceId: input.loanId, initiatedBy: input.initiatedBy,
      legs: [{ account: userMain(loan.borrowerUserId), amountMinor: -input.amountMinor }, { account: tenantMain(tenantId), amountMinor: input.amountMinor }],
    });
    await this.audit.write(tx, { tenantId, actorUserId: input.initiatedBy, action: 'fintech.loan.repaid_from_milk_bill',
      entityType: 'loan', entityId: input.loanId,
      newValue: { amountMinor: input.amountMinor.toString(), outstandingMinor: loan.outstandingMinor.toString(), billId: input.billId, deductionId: input.deductionId },
      ip: null });
    await this.flush(tx, tenantId, input.loanId, loan.pullEvents());
    return { loanId: input.loanId, repaymentId: rep.id, outstandingMinor: loan.outstandingMinor.toString(), walletTxnId: txn.txnId };
  }

  /**
   * [PC-56 TENANT-6c-5] THE LOANS A MILK BILL MAY RECOVER AGAINST, for one borrower, oldest debt first.
   *
   * The reader for `loan_products.repayment_style = 'milk_bill_deduction'` — a style that has existed since this
   * module was written, that 0011's own comment on `loan_repayments.channel` names, and that **nothing has ever
   * selected on**. TENANT-6c-4 built the repayment mechanism and named this gap; this closes it, so a loan sold to a
   * farmer against her milk cheque is actually recovered from it instead of waiting for somebody to type a line.
   *
   * A READ, in the caller's transaction, returning this module's own aggregates — the dairy assembler decides nothing
   * about a loan, it asks which loans are eligible and how much is outstanding. No permission check, for the reason
   * `applyMilkBillDeduction` gives: this is a settlement the borrower already agreed to, and the authorisation lives
   * where the decision was made (the standing instruction, plus 6c-3's two keys and checker on the cycle).
   */
  async milkDeductibleLoans(tx: TxContext, tenantId: string, borrowerUserId: string, limit = 50) {
    const loans = await this.loans.listMilkDeductible(tx, tenantId, borrowerUserId, limit);
    return loans.map((l) => {
      const p = l.toProps();
      return { id: p.id, outstandingMinor: p.outstandingMinor, disbursedAt: p.disbursedAt, status: p.status };
    });
  }

  async getById(tenantId: string, actor: FintechActor, id: string) {
    const l = await this.loans.getById(tenantId, id);
    if (!l) throw new LoanNotFoundError(id);
    if (l.borrowerUserId !== actor.userId && !actor.canManage) throw new LoanNotFoundError(id); // 404, no IDOR
    return l.toJSON();
  }
  async list(tenantId: string, actor: FintechActor, q: { box: 'mine' | 'all'; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all' && !actor.canManage) throw new FintechForbiddenError('requires loan.manage');
    const rows = await this.loans.listFor(tenantId, { borrowerUserId: q.box === 'mine' ? actor.userId : undefined, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((l) => l.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  async listRepayments(tenantId: string, actor: FintechActor, loanId: string) {
    const loan = await this.loans.getById(tenantId, loanId);
    if (!loan) throw new LoanNotFoundError(loanId);
    if (loan.borrowerUserId !== actor.userId && !actor.canManage) throw new LoanNotFoundError(loanId); // 404, no IDOR
    return (await this.repayments.listForLoan(tenantId, loanId)).map((r) => r.toJSON());
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'loan', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
