// modules/payments/__tests__/dispute-refund.handler.spec.ts · unit: the disputes.dispute_resolved →
// wallet reversal. Mocks wallet/flags/repos/pricing/outbox. Asserts: zero-sum legs, escrow → buyer,
// refund_partial re-settles the remainder, post-settlement CLAWBACK reverses the line, the
// already-statemented guard, the cap, and the flag/branch no-ops.
import { DisputeResolvedHandler } from '../events/handlers/dispute-resolved.handler';
import { InfraError } from '../../../shared/errors/app-error';

const tenantId = 't1', disputeId = 'dsp1', orderId = 'o1', buyer = 'buyer1', seller = 'seller1';
const evt = (over: any = {}) => ({ id: '1', tenantId, aggregateType: 'dispute', aggregateId: disputeId, eventType: 'disputes.dispute_resolved', payload: { v: 1, disputeId, orderId, resolutionType: 'refund_full', raisedBy: buyer, againstUser: seller, ...over } });

function harness(opts: { flags?: Record<string, boolean>; payment?: any; line?: any } = {}) {
  const flagMap = opts.flags ?? { dispute_refunds: true };
  const wallet = { post: jest.fn().mockResolvedValue({ txnId: 'txn1', alreadyApplied: false }) } as any;
  const flags = { isEnabled: jest.fn((key: string) => Promise.resolve(flagMap[key] ?? false)) } as any;
  const repo = { findSuccessByOrder: jest.fn().mockResolvedValue('payment' in opts ? opts.payment : { userId: buyer, amountMinor: 100000n }) } as any;
  const lines = { findByOrder: jest.fn().mockResolvedValue(opts.line ?? null), deleteByOrder: jest.fn().mockResolvedValue(1), insert: jest.fn().mockResolvedValue(undefined) } as any;
  // PC-56 TENANT-SW-a: the remainder is priced from the ORDER's FROZEN rule — `frozenForOrder` then `quoteFrozen`, never a live resolve
  const snapshot = { v: 1, ruleId: 'rule-1', scope: 'platform', rateBps: 350, fixedMinor: '0', capMinor: null, platformShareBps: 1000, chargedTo: 'seller', resolvedOn: '2026-10-01' };
  const pricing = { frozenForOrder: jest.fn().mockResolvedValue({ snapshot, buyerCommissionMinor: 0n, recordedNow: false }),
    quoteFrozen: jest.fn().mockResolvedValue({ sellerNetMinor: 54000n, tenantCommissionMinor: 5000n, gstOnCommissionMinor: 900n, tdsMinor: 100n, platformShareMinor: 0n, commissionMinor: 5000n }) } as any;
  const outbox = { write: jest.fn().mockResolvedValue(undefined) } as any;
  const metrics = { inc: jest.fn() } as any;
  // HOTFIX-2: the payment + rule reads run in kv_app's unit of work; the fake hands them their own mocked executor
  const uow = { run: jest.fn((_t: string, fn: (tx: any) => Promise<unknown>) => fn({ query: jest.fn() })) } as any;
  return { h: new DisputeResolvedHandler(wallet, flags, repo, lines, pricing, outbox, metrics, uow), wallet, flags, repo, lines, pricing, outbox, uow, tx: { query: jest.fn() } as any };
}
const lastLegs = (wallet: any) => wallet.post.mock.calls[wallet.post.mock.calls.length - 1][1].legs as Array<{ account: any; amountMinor: bigint }>;
const sum = (legs: Array<{ amountMinor: bigint }>) => legs.reduce((s, l) => s + l.amountMinor, 0n);

describe('DisputeResolvedHandler (wallet reversal + remainder + clawback)', () => {
  it('refund_full (not settled): escrow → buyer, zero-sum; emits dispute_refunded', async () => {
    const { h, wallet, lines, outbox, tx } = harness();
    await h.handle(evt() as any, tx);
    expect(lines.findByOrder).toHaveBeenCalled();
    expect(wallet.post).toHaveBeenCalledTimes(1);                  // no clawback (line null)
    const legs = lastLegs(wallet);
    expect(sum(legs)).toBe(0n);
    expect(legs.find((l) => l.account.accountCode === 'escrow')!.amountMinor).toBe(-100000n);
    expect(legs.find((l) => l.account.kind === 'user' && l.account.userId === buyer)!.amountMinor).toBe(100000n);
    expect(outbox.write.mock.calls.find((c: any[]) => c[1].eventType === 'payments.dispute_refunded')![1].payload).toMatchObject({ disputeId, txnId: 'txn1', refundedMinor: '100000' });
  });

  it('refund_partial (not settled, split OFF): refunds the partial, re-settles the remainder to the seller (zero-sum)', async () => {
    const { h, wallet, lines, tx } = harness({ flags: { dispute_refunds: true, commission_split: false } });
    await h.handle(evt({ resolutionType: 'refund_partial', resolutionAmountMinor: '40000' }) as any, tx);
    const legs = lastLegs(wallet);
    expect(sum(legs)).toBe(0n);
    expect(legs.find((l) => l.account.accountCode === 'escrow')!.amountMinor).toBe(-100000n);   // full gross out
    expect(legs.find((l) => l.account.userId === buyer)!.amountMinor).toBe(40000n);
    expect(legs.find((l) => l.account.userId === seller)!.amountMinor).toBe(60000n);            // remainder to seller
    expect(lines.insert).toHaveBeenCalled();                                                    // remainder settlement line
  });

  it('refund_partial (split ON): remainder routed through the commission engine, zero-sum', async () => {
    const { h, wallet, pricing, tx } = harness({ flags: { dispute_refunds: true, commission_split: true } });
    await h.handle(evt({ resolutionType: 'refund_partial', resolutionAmountMinor: '40000' }) as any, tx);
    expect(pricing.quoteFrozen).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ grossMinor: 60000n }));
    expect(pricing.frozenForOrder).toHaveBeenCalled();
    const legs = lastLegs(wallet);
    expect(sum(legs)).toBe(0n);
    expect(legs.find((l) => l.account.userId === buyer)!.amountMinor).toBe(40000n);
    expect(legs.find((l) => l.account.userId === seller)!.amountMinor).toBe(54000n);            // seller NET of the remainder
  });

  it('already settled → CLAWBACK reverses the line (zero-sum) then refunds; deletes the line', async () => {
    const line = { sellerUserId: seller, grossMinor: 90000n, commissionMinor: 5000n, gstMinor: 900n, tdsMinor: 100n, netMinor: 84000n, tenantCommissionMinor: 5000n, platformFeesMinor: 10000n, statementId: null };
    const { h, wallet, lines, tx } = harness({ line });
    await h.handle(evt() as any, tx);   // refund_full, settled
    expect(wallet.post).toHaveBeenCalledTimes(2);             // clawback + refund
    const clawback = wallet.post.mock.calls[0][1].legs as Array<{ account: any; amountMinor: bigint }>;
    expect(sum(clawback)).toBe(0n);                            // reversal is zero-sum
    expect(clawback.find((l) => l.account.accountCode === 'escrow')!.amountMinor).toBe(100000n);   // escrow restored to gross
    expect(clawback.find((l) => l.account.userId === seller)!.amountMinor).toBe(-84000n);          // seller net clawed back
    expect(lines.deleteByOrder).toHaveBeenCalledWith(tx, tenantId, orderId);
    expect(sum(lastLegs(wallet))).toBe(0n);                    // the refund is zero-sum too
  });

  it('refuses a clawback once the line is in a paid statement (→ DLQ)', async () => {
    const line = { sellerUserId: seller, grossMinor: 90000n, commissionMinor: 0n, gstMinor: 0n, tdsMinor: 0n, netMinor: 90000n, tenantCommissionMinor: 0n, platformFeesMinor: 10000n, statementId: 'stmt1' };
    const { h, tx } = harness({ line });
    await expect(h.handle(evt() as any, tx)).rejects.toBeInstanceOf(InfraError);
  });

  it('caps the refund at gross; no-ops on flag OFF / rejected / no payment', async () => {
    const cap = harness(); await cap.h.handle(evt({ resolutionType: 'refund_partial', resolutionAmountMinor: '999999' }) as any, cap.tx);
    expect(lastLegs(cap.wallet).find((l) => l.account.userId === buyer)!.amountMinor).toBe(100000n);
    const off = harness({ flags: { dispute_refunds: false } }); await off.h.handle(evt() as any, off.tx); expect(off.wallet.post).not.toHaveBeenCalled();
    const rej = harness(); await rej.h.handle(evt({ resolutionType: 'rejected' }) as any, rej.tx); expect(rej.wallet.post).not.toHaveBeenCalled();
    const cod = harness({ payment: null }); await cod.h.handle(evt() as any, cod.tx); expect(cod.wallet.post).not.toHaveBeenCalled();
  });
});
