// modules/payments/__tests__/dispute-refund.handler.spec.ts · unit: the disputes.dispute_resolved → wallet reversal.
// PC-56 HOTFIX-7 · D3 (founder Q3): REWRITTEN for the one refund rule. The buyer's leg is no longer `escrow → user:<buyer>:main` posted here: the
// refund goes BACK TO THE SOURCE through PaymentService.refundForResolution (its own kv_app transaction — mocked here; its legs are proven live in
// store5-hotfix7-money-trace), and the handler (through ResolutionMoneyService) posts only the CLAWBACK (an already-settled order) and the KEPT
// REMAINDER (`dispute-remainder:<id>`, escrow −remainder → seller) on the relay tx. Asserts: the refund is asked for the right amount BEFORE any
// relay leg; remainder legs zero-sum (split OFF and ON — priced in the organisation's country); the clawback zero-sum then the line deleted; the
// statement / no-seller / clawback-short refusals move NOTHING (the refund is not asked); the cap; the flag / branch / COD no-ops; a replay
// (remainder key booked) books nothing.
import { DisputeResolvedHandler } from '../events/handlers/dispute-resolved.handler';
import { ResolutionMoneyService } from '../services/resolution-money.service';
import { InfraError } from '../../../shared/errors/app-error';

const tenantId = 't1', disputeId = 'dsp1', orderId = 'o1', buyer = 'buyer1', seller = 'seller1';
const evt = (over: any = {}) => ({ id: '1', tenantId, aggregateType: 'dispute', aggregateId: disputeId, eventType: 'disputes.dispute_resolved', payload: { v: 1, disputeId, orderId, resolutionType: 'refund_full', raisedBy: buyer, againstUser: seller, ...over } });

function harness(opts: { flags?: Record<string, boolean>; payment?: any; line?: any; booked?: Record<string, string>; balance?: bigint } = {}) {
  const flagMap = opts.flags ?? { dispute_refunds: true };
  const booked = opts.booked ?? {};
  const wallet = { post: jest.fn().mockResolvedValue({ txnId: 'txnR', alreadyApplied: false }), balanceMinor: jest.fn().mockResolvedValue(opts.balance ?? 10_000_000n) } as any;
  const flags = { isEnabled: jest.fn((key: string) => Promise.resolve(flagMap[key] ?? false)) } as any;
  const payment = 'payment' in opts ? opts.payment : { userId: buyer, amountMinor: 100000n, refundedMinor: 0n };
  const repo = { capturedForOrderTx: jest.fn().mockResolvedValue(payment), ledgerTxnIdByKeyTx: jest.fn(async (_tx: unknown, k: string) => booked[k] ?? null) } as any;
  const lines = { findByOrder: jest.fn().mockResolvedValue(opts.line ?? null), deleteByOrder: jest.fn().mockResolvedValue(1), insert: jest.fn().mockResolvedValue(undefined) } as any;
  // PC-56 TENANT-SW-a: the remainder is priced from the ORDER's FROZEN rule — `frozenForOrder` then `quoteFrozen`, never a live resolve
  const snapshot = { v: 1, ruleId: 'rule-1', scope: 'platform', rateBps: 350, fixedMinor: '0', capMinor: null, platformShareBps: 1000, chargedTo: 'seller', resolvedOn: '2026-10-01' };
  const pricing = { frozenForOrder: jest.fn().mockResolvedValue({ snapshot, buyerCommissionMinor: 0n, recordedNow: false }),
    quoteFrozen: jest.fn().mockResolvedValue({ sellerNetMinor: 54000n, tenantCommissionMinor: 5000n, gstOnCommissionMinor: 900n, tdsMinor: 100n, platformShareMinor: 0n, commissionMinor: 5000n }) } as any;
  const settlement = { countryFor: jest.fn().mockResolvedValue('NP') } as any;
  const order: string[] = [];
  const payments = { refundForResolution: jest.fn(async () => { order.push('refund'); return { outcome: 'refunded', paymentId: 'p1', ledgerTxnId: 'txnRefund', alreadyBooked: false }; }) } as any;
  wallet.post.mockImplementation(async (_tx: unknown, i: { idempotencyKey: string }) => { order.push(i.idempotencyKey); return { txnId: `txn:${i.idempotencyKey}`, alreadyApplied: false }; });
  const outbox = { write: jest.fn().mockResolvedValue(undefined) } as any;
  const metrics = { inc: jest.fn() } as any;
  // HOTFIX-2: the payment + rule reads run in kv_app's unit of work; the fake hands them their own mocked executor
  const uow = { run: jest.fn((_t: string, fn: (tx: any) => Promise<unknown>) => fn({ query: jest.fn() })) } as any;
  const money = new ResolutionMoneyService(wallet, flags, repo, lines, pricing, settlement, payments, uow);
  return { h: new DisputeResolvedHandler(flags, money, outbox, metrics), wallet, flags, repo, lines, pricing, settlement, payments, outbox, metrics, uow, order, tx: { query: jest.fn() } as any };
}
const callFor = (wallet: any, key: string) => wallet.post.mock.calls.find((c: any[]) => c[1].idempotencyKey === key)?.[1] as { legs: Array<{ account: any; amountMinor: bigint }>; txnType: string } | undefined;
const sum = (legs: Array<{ amountMinor: bigint }>) => legs.reduce((s, l) => s + l.amountMinor, 0n);

describe('DisputeResolvedHandler (HOTFIX-7: refund to source + remainder + clawback)', () => {
  it('refund_full (not settled): the refund is asked of PaymentService for the gross; NO relay leg (no buyer-wallet leg); emits dispute_refunded with the refund txn', async () => {
    const { h, wallet, payments, outbox, metrics, tx } = harness();
    await h.handle(evt() as any, tx);
    expect(payments.refundForResolution).toHaveBeenCalledWith(tenantId, orderId, { referenceType: 'dispute', referenceId: disputeId, amountMinor: 100000n });
    expect(wallet.post).not.toHaveBeenCalled();                    // no clawback (line null), no remainder (full)
    expect(outbox.write.mock.calls.find((c: any[]) => c[1].eventType === 'payments.dispute_refunded')![1].payload).toMatchObject({ disputeId, txnId: 'txnRefund', refundedMinor: '100000', remainderMinor: '0' });
    expect(metrics.inc).toHaveBeenCalledWith('payments.dispute_refund', { tenant: tenantId, type: 'refund_full' });
  });

  it('refund_partial (split OFF): refund 40,000 to source; the remainder 60,000 escrow → seller under dispute-remainder:<id> (zero-sum), AFTER the refund', async () => {
    const { h, wallet, lines, payments, order, tx } = harness({ flags: { dispute_refunds: true, commission_split: false } });
    await h.handle(evt({ resolutionType: 'refund_partial', resolutionAmountMinor: '40000' }) as any, tx);
    expect(payments.refundForResolution.mock.calls[0][2]).toMatchObject({ amountMinor: 40000n });
    const rem = callFor(wallet, `dispute-remainder:${disputeId}`)!;
    expect(rem.txnType).toBe('refund');
    expect(sum(rem.legs)).toBe(0n);
    expect(rem.legs.find((l) => l.account.accountCode === 'escrow')!.amountMinor).toBe(-60000n);
    expect(rem.legs.find((l) => l.account.userId === seller)!.amountMinor).toBe(60000n);
    expect(rem.legs.find((l) => l.account.userId === buyer)).toBeUndefined();                     // the buyer is never credited here
    expect(lines.insert).toHaveBeenCalled();
    expect(order).toEqual(['refund', `dispute-remainder:${disputeId}`]);
  });

  it('refund_partial (split ON): the remainder through the frozen rule, priced in the ORGANISATION\'s country (never a literal), zero-sum', async () => {
    const { h, wallet, pricing, settlement, tx } = harness({ flags: { dispute_refunds: true, commission_split: true } });
    await h.handle(evt({ resolutionType: 'refund_partial', resolutionAmountMinor: '40000' }) as any, tx);
    expect(settlement.countryFor).toHaveBeenCalledWith(tenantId, expect.anything(), 'dispute_remainder');
    expect(pricing.quoteFrozen).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ grossMinor: 60000n, countryCode: 'NP' }));
    const rem = callFor(wallet, `dispute-remainder:${disputeId}`)!;
    expect(sum(rem.legs)).toBe(0n);
    expect(rem.legs.find((l) => l.account.userId === seller)!.amountMinor).toBe(54000n);         // seller NET of the remainder
  });

  it('already settled → refund to source, then the CLAWBACK reverses the line (zero-sum, escrow +gross) and the line is deleted', async () => {
    const line = { sellerUserId: seller, grossMinor: 90000n, commissionMinor: 5000n, gstMinor: 900n, tdsMinor: 100n, netMinor: 84000n, tenantCommissionMinor: 5000n, platformFeesMinor: 10000n, statementId: null };
    const { h, wallet, lines, order, tx } = harness({ line });
    await h.handle(evt() as any, tx);
    const claw = callFor(wallet, `dispute-clawback:${disputeId}`)!;
    expect(sum(claw.legs)).toBe(0n);
    expect(claw.legs.find((l) => l.account.accountCode === 'escrow')!.amountMinor).toBe(100000n);
    expect(claw.legs.find((l) => l.account.userId === seller)!.amountMinor).toBe(-84000n);
    expect(lines.deleteByOrder).toHaveBeenCalledWith(tx, tenantId, orderId);
    expect(order).toEqual(['refund', `dispute-clawback:${disputeId}`]);
  });

  it('refusals move NOTHING — the refund is never asked: a line in a paid statement, a seller who already withdrew (CLAWBACK_SHORT), no nameable seller', async () => {
    const stmt = harness({ line: { sellerUserId: seller, netMinor: 90000n, tenantCommissionMinor: 0n, gstMinor: 0n, tdsMinor: 0n, platformFeesMinor: 10000n, statementId: 'stmt1' } });
    await expect(stmt.h.handle(evt() as any, stmt.tx)).rejects.toMatchObject({ code: 'DISPUTE_REFUND_AFTER_STATEMENT' });
    expect(stmt.payments.refundForResolution).not.toHaveBeenCalled();
    const short = harness({ balance: 1000n, line: { sellerUserId: seller, netMinor: 84000n, tenantCommissionMinor: 0n, gstMinor: 0n, tdsMinor: 0n, platformFeesMinor: 16000n, statementId: null } });   // sums to the gross
    await expect(short.h.handle(evt() as any, short.tx)).rejects.toMatchObject({ code: 'DISPUTE_CLAWBACK_SHORT' });
    expect(short.payments.refundForResolution).not.toHaveBeenCalled(); expect(short.wallet.post).not.toHaveBeenCalled();
    // a line that re-settled an EARLIER resolution's remainder (its legs sum to 60,000, not the 100,000 gross) cannot be clawed back to the gross
    const reset = harness({ line: { sellerUserId: seller, netMinor: 60000n, tenantCommissionMinor: 0n, gstMinor: 0n, tdsMinor: 0n, platformFeesMinor: 0n, statementId: null } });
    await expect(reset.h.handle(evt() as any, reset.tx)).rejects.toMatchObject({ code: 'DISPUTE_REFUND_AFTER_RESETTLEMENT' });
    expect(reset.payments.refundForResolution).not.toHaveBeenCalled(); expect(reset.wallet.post).not.toHaveBeenCalled();
    const anon = harness({ flags: { dispute_refunds: true } });
    await expect(anon.h.handle(evt({ resolutionType: 'refund_partial', resolutionAmountMinor: '1000', raisedBy: 'x', againstUser: 'y' }) as any, anon.tx)).rejects.toBeInstanceOf(InfraError);
    expect(anon.payments.refundForResolution).not.toHaveBeenCalled();
  });

  it('caps the refund at gross; no-ops on flag OFF / rejected / no captured payment (COD); a replay (remainder key booked) books nothing', async () => {
    const cap = harness(); await cap.h.handle(evt({ resolutionType: 'refund_partial', resolutionAmountMinor: '999999' }) as any, cap.tx);
    expect(cap.payments.refundForResolution.mock.calls[0][2]).toMatchObject({ amountMinor: 100000n });
    const off = harness({ flags: { dispute_refunds: false } }); await off.h.handle(evt() as any, off.tx); expect(off.payments.refundForResolution).not.toHaveBeenCalled();
    const rej = harness(); await rej.h.handle(evt({ resolutionType: 'rejected' }) as any, rej.tx); expect(rej.payments.refundForResolution).not.toHaveBeenCalled();
    const cod = harness({ payment: null }); await cod.h.handle(evt() as any, cod.tx); expect(cod.payments.refundForResolution).not.toHaveBeenCalled(); expect(cod.outbox.write).not.toHaveBeenCalled();
    const again = harness({ booked: { [`dispute-refund:${disputeId}`]: 'tR', [`dispute-remainder:${disputeId}`]: 'tM' }, payment: { userId: buyer, amountMinor: 100000n, refundedMinor: 40000n } });
    await again.h.handle(evt({ resolutionType: 'refund_partial', resolutionAmountMinor: '40000' }) as any, again.tx);
    expect(again.payments.refundForResolution).not.toHaveBeenCalled(); expect(again.wallet.post).not.toHaveBeenCalled();
    expect(again.metrics.inc).not.toHaveBeenCalled();
    // a refund booked by the PRE-HOTFIX-7 handler (its key booked, the payment row never moved for it) is recognised: nothing again
    const legacy = harness({ booked: { [`dispute-refund:${disputeId}`]: 'tOld' } });
    await legacy.h.handle(evt() as any, legacy.tx);
    expect(legacy.payments.refundForResolution).not.toHaveBeenCalled(); expect(legacy.wallet.post).not.toHaveBeenCalled();
  });
});
