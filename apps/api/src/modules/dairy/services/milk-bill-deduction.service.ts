// modules/dairy/services/milk-bill-deduction.service.ts · PC-56 TENANT-6c-4 · where a deduction's money GOES.
//
// W169: *"Deductions this cycle ₹1,84,300 — feed credit + loan EMI + insurance — each line itemised"* and
// *"member sees every pour + every deduction"*.
//
// THE COMPOSITION, and why it is this way round. The member is paid the GROSS, and then each line is posted from the
// member to the cooperative in the SAME transaction. The alternative — pay the net and record the deduction beside it
// — is what 0157 refused to ship, because it produces exactly one ledger movement and leaves the withheld amount
// sitting in the cooperative's wallet with nothing to reconcile it against: the loan is not reduced, the feed is not
// paid for, and the family's passbook shows a number smaller than their bill with no entry explaining it.
//
// Paying the gross first makes every rupee a real, itemised, reversible movement that both sides can see:
//   `tenant main → member main   9,414`      (the bill's gross — what the milk was worth)
//   `member main → tenant main     500`      (feed credit #A — the receivable falls to zero)
//   `member main → tenant main     740`      (loan #B — the outstanding falls, a repayment row appears)
// The member's own wallet history becomes the itemisation W169 promises, and the net they keep is identical.
//
// It cannot overdraw anybody: the wallet refuses any leg that would take a non-platform account below zero
// (`wallet.client.inprocess.ts`), the gross lands before any line is taken, and the bill's own invariant is
// `net = gross − Σ lines ≥ 0`. So the arithmetic that protects the member is enforced twice, in two layers, by
// accident of good design rather than by a comment.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { AccountRef, TenantAccount, userMain } from '../../../core/wallet/account-codes';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { LoanService } from '../../fintech/services/loan.service';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { MilkBillDeduction } from '../domain/milk-bill-deduction.entity';
import { DairyEventType, DomainEvent } from '../domain/dairy.events';
import { DeductionSourceInvalidError, DeductionTypeUnsupportedError } from '../domain/dairy.errors';

const tenantMain = (tenantId: string): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Main, currencyCode: 'INR' });

export interface AppliedLine { deductionId: string; typeCode: string; amountMinor: string; sourceType: string; sourceId: string; walletTxnId: string }

@Injectable()
export class MilkBillDeductionService {
  constructor(
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly lines: MilkBillDeductionRepository,
    private readonly credits: DairyMemberCreditRepository,
    private readonly types: DairyDeductionTypeRepository,
    // The fintech module's PUBLIC service. Not its repositories — the loan's invariants stay with the loan.
    private readonly loans: LoanService,
  ) {}

  /**
   * Apply every pending line on this bill, in the caller's transaction.
   *
   * Returns what it moved, so the payment's audit entry and its event carry the itemisation rather than a total.
   * Throws on the FIRST line it cannot post, and the caller's transaction takes the whole payment down with it —
   * including the gross. That is the only honest failure mode: a bill half-settled would leave a member paid the gross
   * with a loan still outstanding, and no partial state here is better than the refusal 0157 already ships.
   */
  async applyAll(tx: TxContext, tenantId: string, input: {
    billId: string; membershipId: string; memberUserId: string; initiatedBy: string; now: Date;
  }): Promise<AppliedLine[]> {
    const pending = await this.lines.listForUpdate(tx, tenantId, input.billId);
    if (pending.length === 0) return [];
    const typeById = await this.types.byIds(tx, pending.map((l) => l.toProps().typeId));
    const applied: AppliedLine[] = [];

    for (const line of pending) {
      if (line.isApplied) continue;   // a resumed payment finds fewer lines; it must not move money twice
      const p = line.toProps();
      const type = typeById.get(p.typeId);
      // A line whose type row has gone inactive is not a line this platform can post: the vocabulary is the
      // authority on where money may go, and "it was allowed when the line was written" is not a destination.
      if (!type) throw new DeductionTypeUnsupportedError(input.billId, p.typeCode, 'this deduction type is no longer active in the milk_deduction vocabulary');
      if (type.destination === 'none') throw new DeductionTypeUnsupportedError(input.billId, type.code, type.unsupportedReason ?? 'no destination');
      if (type.sourceType && p.sourceType !== type.sourceType) {
        throw new DeductionSourceInvalidError(p.sourceType, p.sourceId, `a ${type.code} line must point at a ${type.sourceType}`);
      }

      const walletTxnId = type.destination === 'member_credit'
        ? await this.applyMemberCredit(tx, tenantId, line, input)
        : await this.applyLoan(tx, tenantId, line, input);

      line.apply(input.now, walletTxnId);
      await this.lines.markApplied(tx, line);
      await this.flush(tx, tenantId, line.id, line.pullEvents());
      applied.push({ deductionId: p.id, typeCode: type.code, amountMinor: p.amountMinor.toString(), sourceType: p.sourceType, sourceId: p.sourceId, walletTxnId });
    }
    return applied;
  }

  /** Feed / mineral mix / medicine: the receivable falls, and the member pays the cooperative for the goods. */
  private async applyMemberCredit(tx: TxContext, tenantId: string, line: MilkBillDeduction, input: { billId: string; membershipId: string; memberUserId: string; initiatedBy: string }): Promise<string> {
    const p = line.toProps();
    const credit = await this.credits.getForUpdate(tx, tenantId, p.sourceId);
    if (!credit) throw new DeductionSourceInvalidError(p.sourceType, p.sourceId, 'no such member credit');
    // A line on Suresh's bill must not recover Savita's feed. The membership is the join, and it is checked here
    // rather than trusted from the line, because the line was written by a different act at a different time.
    if (credit.membershipId !== input.membershipId) throw new DeductionSourceInvalidError(p.sourceType, p.sourceId, 'this credit belongs to another member');
    const before = credit.recoveredMinor;
    credit.recover(p.amountMinor, input.billId);       // refuses an over-recovery; closes the credit at zero
    await this.credits.updateRecovered(tx, credit, before);
    const txn = await this.wallet.post(tx, {
      tenantId, txnType: 'milk_payment', idempotencyKey: `milkdeduct:${p.id}`,
      referenceType: 'dairy_member_credit', referenceId: credit.id, initiatedBy: input.initiatedBy,
      legs: [{ account: userMain(input.memberUserId), amountMinor: -p.amountMinor }, { account: tenantMain(tenantId), amountMinor: p.amountMinor }],
    });
    await this.flush(tx, tenantId, credit.id, credit.pullEvents());
    return txn.txnId;
  }

  /** The loan: through the fintech module's own public, transaction-taking service. */
  private async applyLoan(tx: TxContext, tenantId: string, line: MilkBillDeduction, input: { billId: string; memberUserId: string; initiatedBy: string }): Promise<string> {
    const p = line.toProps();
    const out = await this.loans.applyMilkBillDeduction(tx, tenantId, {
      loanId: p.sourceId, borrowerUserId: input.memberUserId, amountMinor: p.amountMinor,
      billId: input.billId, deductionId: p.id, initiatedBy: input.initiatedBy,
    });
    return out.walletTxnId;
  }

  private async flush(tx: TxContext, tenantId: string, aggregateId: string, events: DomainEvent[]): Promise<void> {
    for (const e of events) {
      await this.outbox.write(tx, {
        tenantId,
        aggregateType: e.type === DairyEventType.BillDeductionApplied ? 'milk_bill_deduction' : 'dairy_member_credit',
        aggregateId, eventType: e.type, payload: { v: 1, ...e.payload },
      });
    }
  }
}
