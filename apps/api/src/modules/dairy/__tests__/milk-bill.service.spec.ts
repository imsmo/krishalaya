// modules/dairy/__tests__/milk-bill.service.spec.ts · MilkBillService unit tests with fakes.
// Pins THE MONEY PATH: pay() posts a ZERO-SUM wallet transfer tenant 'main' → farmer userMain (txnType
// milk_payment) ONLY when the bill is approved, and moves NO money on a non-approved bill. Real SQL/RLS =
// integration spec.
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBill } from '../domain/milk-bill.entity';
import { DairyMembership } from '../domain/dairy-membership.entity';
import { BillNotPayableError, DeductionConsentRequiredError, DeductionRecoveryDisabledError } from '../domain/dairy.errors';

const membership = DairyMembership.rehydrate({ id: 'mem1', tenantId: 't1', farmerUserId: 'farmer1', mccId: 'm1', memberCode: 'C1', paymentCycle: 'weekly', defaultAnimalType: 'cow', isActive: true });

function harness(bill: MilkBill, opts: { recoveryEnabled?: boolean; consent?: unknown } = {}) {
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
  // [PC-56 TENANT-6c-2] The bill service now reads the tenant's dispute-window length before it can preview a bill,
  // so the cycle repository (this module's home for tenant settings) is a real dependency rather than a convenience.
  const cycles = { disputeWindowHours: jest.fn(async () => 24) };
  const consents = { consentThresholdPct: jest.fn(async () => 25), latestForBill: jest.fn(async () => opts.consent ?? null), insert: jest.fn() };
  const deductions = { applyAll: jest.fn(async () => []) };
  const flags = { isEnabled: jest.fn(async () => opts.recoveryEnabled !== false) };
  const svc = new MilkBillService(uow as any, outbox as any, idem as any, metrics as any, wallet as any, audit as any, bills as any, collections as any, memberships as any, cycles as any,
      // [PC-56 TENANT-6c-4] the deduction's destination: lines, vocabulary, credits, consent, applier, flags.
      { linesForBill: jest.fn(async () => []), insert: jest.fn(), listForUpdate: jest.fn(async () => []), markApplied: jest.fn() } as never,
      { byCode: jest.fn(async () => null), byIds: jest.fn(async () => new Map()) } as never,
      { getForUpdate: jest.fn(async () => null) } as never,
      consents as never, deductions as never, flags as never);
  return { svc, wallet, bills, cycles, deductions, consents, flags };
}
// [PC-56 TENANT-6c-4] A line names the ROW IT PAYS. The old shape — `{type, amountMinor}` in a jsonb array — is the
// defect this wave closed: a label referencing nothing, so the money had nowhere to go.
const line = (type: string, amountMinor: bigint, sourceType: string) =>
  ({ id: `ded-${type}`, type, amountMinor, sourceType, sourceId: `src-${type}`, status: 'pending' as const });

const approvedBill = (deductions: ReturnType<typeof line>[] = []) => {
  const b = MilkBill.generate({ id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-06-01', periodEnd: '2026-06-07', totalLitresMilli: 70000n, grossMinor: 40000n, deductions });
  b.preview(NOW, WINDOW, 'farmer1'); b.approve(); b.pullEvents(); return b;
};
const actor = { userId: 'op1', canManage: true };
/** The window opens when the bill is previewed and the payment waits for it to shut (W169, TENANT-6c-2). */
const NOW = new Date('2026-07-16T04:00:00.000Z');
const WINDOW = new Date('2026-07-17T04:00:00.000Z');
const AFTER_WINDOW = new Date('2026-07-17T04:00:01.000Z');

describe('MilkBillService.pay — the money path', () => {
  it('posts a ZERO-SUM tenant→farmer milk_payment for the NET, then marks paid', async () => {
    const { svc, wallet, bills } = harness(approvedBill());
    const out = await svc.pay('t1', actor, 'b1', 'idem-pay', null, AFTER_WINDOW);
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
  // [PC-56 TENANT-6c-4] AND NOW IT PAYS THE GROSS AND POSTS EACH LINE. The refusal above was 6c-1's honest stopgap;
  // this is the destination it was waiting for. These two tests are what replaced the two that asserted the refusal.
  it('pays the GROSS and hands the lines to the applier, in the same transaction', async () => {
    const h = harness(approvedBill([line('loan_emi', 8000n, 'loan')]));
    const out = await h.svc.pay('t1', actor, 'b1', 'idem-pay', null, AFTER_WINDOW);
    expect(out.status).toBe('paid');
    const arg: any = (h.wallet.post.mock.calls as any[])[0][1];
    // THE GROSS, not the net: the member receives what the milk was worth, and each deduction is then a movement of
    // its own that both sides can see. Paying the net and recording the deduction beside it is the shape that left
    // the withheld money in the cooperative's wallet with nothing to reconcile it against.
    const credit = arg.legs.find((l: any) => l.amountMinor > 0n);
    expect(credit.amountMinor).toBe(40000n);
    expect(h.deductions.applyAll).toHaveBeenCalledTimes(1);
    const applyArgs: any = (h.deductions.applyAll.mock.calls as any[])[0][2];
    expect(applyArgs).toMatchObject({ billId: 'b1', membershipId: 'mem1', memberUserId: 'farmer1' });
  });
  it('REFUSES when the recovery kill-switch is off — which is exactly where 0157 left this path', async () => {
    const h = harness(approvedBill([line('loan_emi', 8000n, 'loan')]), { recoveryEnabled: false });
    await expect(h.svc.pay('t1', actor, 'b1', 'idem-pay', null, AFTER_WINDOW)).rejects.toBeInstanceOf(DeductionRecoveryDisabledError);
    expect(h.wallet.post).not.toHaveBeenCalled();
    expect(h.bills.update).not.toHaveBeenCalled();
    expect(h.deductions.applyAll).not.toHaveBeenCalled();
  });
  it('REFUSES above the threshold with no consent, and moves NO money — W169\'s 25% rule', async () => {
    // 30% of the gross, and nobody has asked the member.
    const h = harness(approvedBill([line('loan_emi', 12000n, 'loan')]));
    await expect(h.svc.pay('t1', actor, 'b1', 'idem-pay', null, AFTER_WINDOW)).rejects.toBeInstanceOf(DeductionConsentRequiredError);
    expect(h.wallet.post).not.toHaveBeenCalled();
    expect(h.deductions.applyAll).not.toHaveBeenCalled();
  });
  it('a deduction AT the threshold is not above it, so it pays without asking', async () => {
    // Exactly 25% of 40,000. W169 says "above 25%", and this one comparison is the difference between asking 40
    // members and asking 41.
    const h = harness(approvedBill([line('loan_emi', 10000n, 'loan')]));
    expect((await h.svc.pay('t1', actor, 'b1', 'idem-pay', null, AFTER_WINDOW)).status).toBe('paid');
  });
  it('refuses to pay a non-approved bill and moves NO money', async () => {
    const draft = MilkBill.generate({ id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-06-01', periodEnd: '2026-06-07', totalLitresMilli: 1n, grossMinor: 1000n });
    const { svc, wallet } = harness(draft);
    await expect(svc.pay('t1', actor, 'b1', 'idem-pay', null, AFTER_WINDOW)).rejects.toBeInstanceOf(BillNotPayableError);
    expect(wallet.post).not.toHaveBeenCalled();
  });
});
