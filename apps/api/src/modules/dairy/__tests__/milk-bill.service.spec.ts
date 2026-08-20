// modules/dairy/__tests__/milk-bill.service.spec.ts · MilkBillService unit tests with fakes.
// Pins THE MONEY PATH: pay() posts a ZERO-SUM wallet transfer tenant 'main' → farmer userMain (txnType
// milk_payment) ONLY when the bill is approved, and moves NO money on a non-approved bill. Real SQL/RLS =
// integration spec.
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBill } from '../domain/milk-bill.entity';
import { DairyMembership } from '../domain/dairy-membership.entity';
import { BillNotPayableError, DeductionHasNoDestinationError } from '../domain/dairy.errors';

const membership = DairyMembership.rehydrate({ id: 'mem1', tenantId: 't1', farmerUserId: 'farmer1', mccId: 'm1', memberCode: 'C1', paymentCycle: 'weekly', defaultAnimalType: 'cow', isActive: true });

function harness(bill: MilkBill) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const audit = { write: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 't', alreadyApplied: false })), balanceMinor: jest.fn() };
  const bills = { getForUpdate: jest.fn(async () => bill), update: jest.fn(), getById: jest.fn(), listFor: jest.fn(), insert: jest.fn() };
  const collections = { aggregateUnbilledForUpdate: jest.fn(), attachToBill: jest.fn() };
  const memberships = { getById: jest.fn(async () => membership), listFor: jest.fn() };
  const svc = new MilkBillService(uow as any, outbox as any, idem as any, metrics as any, wallet as any, audit as any, bills as any, collections as any, memberships as any);
  return { svc, wallet, bills };
}
/** An approved bill with NO deductions — the only kind this platform can honestly pay (see below). */
const approvedBill = (deductions: { type: string; amountMinor: bigint }[] = []) => {
  const b = MilkBill.generate({ id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-06-01', periodEnd: '2026-06-07', totalLitresMilli: 70000n, grossMinor: 40000n, deductions });
  b.preview(); b.approve(); b.pullEvents(); return b;
};
const actor = { userId: 'op1', canManage: true };

describe('MilkBillService.pay — the money path', () => {
  it('posts a ZERO-SUM tenant→farmer milk_payment for the NET, then marks paid', async () => {
    const { svc, wallet, bills } = harness(approvedBill());
    const out = await svc.pay('t1', actor, 'b1', 'idem-pay', null);
    expect(out.status).toBe('paid');
    expect(wallet.post).toHaveBeenCalledTimes(1);
    const arg: any = (wallet.post.mock.calls as any[])[0][1];
    expect(arg.txnType).toBe('milk_payment'); expect(arg.idempotencyKey).toBe('milkbill:b1');
    expect(arg.legs.reduce((a: bigint, l: any) => a + l.amountMinor, 0n)).toBe(0n);             // ZERO-SUM
    const debit = arg.legs.find((l: any) => l.amountMinor < 0n); const credit = arg.legs.find((l: any) => l.amountMinor > 0n);
    expect(debit.account.kind).toBe('tenant'); expect(debit.amountMinor).toBe(-40000n);          // tenant main debited NET
    expect(credit.account.kind).toBe('user'); expect(credit.account.userId).toBe('farmer1'); expect(credit.amountMinor).toBe(40000n); // farmer credited
    expect(bills.update).toHaveBeenCalledTimes(1);
  });
  // [PC-56 TENANT-6c-1] THIS TEST USED TO ASSERT THE DEFECT.
  //
  // It generated a bill with `{ type: 'feed', amountMinor: 8000n }` against a gross of 48,000, paid it, and asserted
  // that 40,000 moved — i.e. it pinned, as correct behaviour, a member being docked Rs 80 that was posted to no
  // account anywhere. `deductions.type` is a free-typed string with no reference to the feed credit, loan or policy it
  // names, and `pay()` posts exactly one movement (the net), so the deducted amount is not paid to the member and not
  // paid to anything else: it stays in the cooperative's wallet with no ledger row to find it by, and a `loan_emi`
  // line leaves the loan untouched so the family pays that instalment twice.
  //
  // The money path now fails CLOSED — the same ruling COLLECTION_STAMP_LOST made for a lost bill-attach. The gross is
  // 40,000 above so the surviving zero-sum assertions still describe a real payment, and the deducted case is asserted
  // for what it now is: a refusal.
  it('REFUSES a bill carrying deductions — there is nowhere to post them — and moves NO money', async () => {
    const { svc, wallet, bills } = harness(approvedBill([{ type: 'loan_emi', amountMinor: 8000n }]));
    await expect(svc.pay('t1', actor, 'b1', 'idem-pay', null)).rejects.toBeInstanceOf(DeductionHasNoDestinationError);
    expect(wallet.post).not.toHaveBeenCalled();
    expect(bills.update).not.toHaveBeenCalled();          // and it is NOT marked paid
  });
  it('names the deduction types it refused, so an operator can see what is stuck', async () => {
    const { svc } = harness(approvedBill([{ type: 'loan_emi', amountMinor: 8000n }, { type: 'feed_credit', amountMinor: 2000n }]));
    await expect(svc.pay('t1', actor, 'b1', 'idem-pay', null)).rejects.toMatchObject({
      code: 'DEDUCTION_HAS_NO_DESTINATION',
      details: { billId: 'b1', deductionsMinor: '10000', types: ['loan_emi', 'feed_credit'] },
    });
  });
  it('refuses to pay a non-approved bill and moves NO money', async () => {
    const draft = MilkBill.generate({ id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-06-01', periodEnd: '2026-06-07', totalLitresMilli: 1n, grossMinor: 1000n });
    const { svc, wallet } = harness(draft);
    await expect(svc.pay('t1', actor, 'b1', 'idem-pay', null)).rejects.toBeInstanceOf(BillNotPayableError);
    expect(wallet.post).not.toHaveBeenCalled();
  });
});
