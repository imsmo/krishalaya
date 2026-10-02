// modules/ambassadors/__tests__/earning.service.spec.ts · AmbassadorEarningService unit tests with fakes.
// Pins: accrue is idempotent (existsFor guard) + skips when no plan / zero amount; payout posts ONE zero-sum
// 'commission' transfer (platform Fees → ambassador userMain), stamps payout_id, throws when nothing to pay.
// PC-56 TENANT-10a pins (each fails on 9743e8b):
//   F-1  a stamp count that differs from the locked count THROWS (inside the tx — the wallet leg rolls back with it);
//        the wallet key is derived from the locked earning set, never from the call;
//   F-3  the actor is the caller (initiatedBy, idempotency owner, unit of work), the audit row is written, reason required;
//   F-5  plan conditions refuse an accrual (cap per farmer, referral window, unknown key).
import { AmbassadorEarningService, payoutWalletKey, requireReason } from '../services/ambassador-earning.service';
import { CommissionPlan } from '../domain/commission-plan.entity';
import { AmbassadorEarning } from '../domain/ambassador-earning.entity';
import { AmbassadorProfile } from '../domain/ambassador-profile.entity';
import { NothingToPayoutError, PayoutMarkMismatchError, ReasonRequiredError } from '../domain/ambassadors.errors';

const plan = (conditions: Record<string, unknown> = {}) => CommissionPlan.rehydrate({ id: 'p1', tenantId: null, eventCode: 'first_sale_facilitated', amountMinor: null, rateBps: 100, capMinor: 10000n, conditions, isActive: true });
const profile = () => AmbassadorProfile.rehydrate({ id: 'a1', userId: 'ambUser', tenantId: 't1', clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: 0n, lastActivityAt: null, isActive: true });

function harness(opts: { exists?: boolean; planFound?: boolean; unpaid?: AmbassadorEarning[]; stamped?: number; conditions?: Record<string, unknown>; prior?: number } = {}) {
  const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 'tx1', alreadyApplied: false })) };
  const audit = { write: jest.fn() };
  const plans = { resolveEffective: jest.fn(async () => (opts.planFound === false ? null : plan(opts.conditions))) };
  const earnings = {
    insert: jest.fn(), existsFor: jest.fn(async () => opts.exists ?? false), lockUnpaid: jest.fn(async () => opts.unpaid ?? []),
    markPaid: jest.fn(async (_tx: unknown, _t: string, keys: unknown[]) => opts.stamped ?? keys.length), listForAmbassador: jest.fn(),
    countForSubject: jest.fn(async () => opts.prior ?? 0), ambassadorsWithUnpaid: jest.fn(async () => ['a1']),
  };
  const profiles = { getById: jest.fn(async () => profile()) };
  const svc = new AmbassadorEarningService(uow as any, outbox as any, idem as any, metrics as any, wallet as any, audit as any, plans as any, earnings as any, profiles as any);
  return { svc, tx, wallet, earnings, audit, idem, uow, metrics };
}
const accrueIn = (over: Record<string, unknown> = {}) => ({ tenantId: 't1', ambassadorId: 'a1', eventCode: 'first_sale_facilitated', referenceType: 'order', referenceId: 'o1', baseMinor: 500000n, subjectUserId: 'farmer1', referralCreatedAt: new Date(), ...over });

describe('accrue', () => {
  it('inserts an earning when a plan resolves + not duplicate, naming the farmer', async () => {
    const h = harness();
    const out = await h.svc.accrue(h.tx as any, accrueIn());
    expect(out).not.toBeNull(); expect(out!.amountMinor).toBe(5000n); expect(h.earnings.insert).toHaveBeenCalledTimes(1);
    expect(out!.toProps().subjectUserId).toBe('farmer1');
  });
  it('skips (no insert) when already credited (idempotent)', async () => {
    const h = harness({ exists: true });
    expect(await h.svc.accrue(h.tx as any, accrueIn())).toBeNull(); expect(h.earnings.insert).not.toHaveBeenCalled();
  });
  it('skips when no plan', async () => {
    const h = harness({ planFound: false });
    expect(await h.svc.accrue(h.tx as any, accrueIn({ eventCode: 'nope', baseMinor: 1n }))).toBeNull();
  });
  it('F-5 · max_sales_per_farmer: the 6th sale on one farmer accrues nothing; the count is taken under an advisory lock', async () => {
    const h = harness({ conditions: { max_sales_per_farmer: 5 }, prior: 5 });
    expect(await h.svc.accrue(h.tx as any, accrueIn())).toBeNull();
    expect(h.earnings.insert).not.toHaveBeenCalled();
    expect((h.tx.query.mock.calls as any[])[0][0]).toMatch(/pg_advisory_xact_lock/);
    expect(h.earnings.countForSubject).toHaveBeenCalledWith(h.tx, 't1', 'a1', 'first_sale_facilitated', 'farmer1');
    const ok = harness({ conditions: { max_sales_per_farmer: 5 }, prior: 4 });
    expect(await ok.svc.accrue(ok.tx as any, accrueIn())).not.toBeNull();
  });
  it('F-5 · within_days: a referral older than the window accrues nothing', async () => {
    const h = harness({ conditions: { within_days: 30 } });
    expect(await h.svc.accrue(h.tx as any, accrueIn({ referralCreatedAt: new Date(Date.now() - 31 * 86_400_000) }))).toBeNull();
    const ok = harness({ conditions: { within_days: 30 } });
    expect(await ok.svc.accrue(ok.tx as any, accrueIn({ referralCreatedAt: new Date(Date.now() - 29 * 86_400_000) }))).not.toBeNull();
  });
  it('F-5 · an unknown condition key refuses (a typo never becomes money)', async () => {
    const h = harness({ conditions: { max_salez: 5 } });
    expect(await h.svc.accrue(h.tx as any, accrueIn())).toBeNull();
    expect(h.metrics.inc).toHaveBeenCalledWith('ambassadors.accrue.condition_refused', expect.objectContaining({ reason: 'unknown_condition' }));
  });
});

describe('payoutAmbassador — the money path', () => {
  const earning = (amt: bigint, id = `e-${amt}`) => AmbassadorEarning.rehydrate({ id, tenantId: 't1', ambassadorId: 'a1', planId: 'p1', eventCode: 'x', referenceType: null, referenceId: null, amountMinor: amt, payoutId: null, createdAt: new Date(), createdAtRaw: '2026-10-02 10:00:00.123456+05:30' });
  const actor = { userId: '01a0c000-0000-7000-8000-0000000000aa' };
  it('posts ONE zero-sum platform→ambassador commission transfer + stamps payout_id', async () => {
    const h = harness({ unpaid: [earning(5000n), earning(2500n)] });
    const out = await h.svc.payoutAmbassador('t1', actor, 'a1', 'idem-1', 'weekly run');
    expect(out.paidMinor).toBe('7500'); expect(out.earningCount).toBe(2);
    expect(h.wallet.post).toHaveBeenCalledTimes(1);
    const arg: any = (h.wallet.post.mock.calls as any[])[0][1];
    expect(arg.txnType).toBe('commission');
    expect(arg.legs.reduce((s: bigint, l: any) => s + l.amountMinor, 0n)).toBe(0n);   // ZERO-SUM
    expect(arg.legs.find((l: any) => l.amountMinor > 0n).account.userId).toBe('ambUser');
    expect(h.earnings.markPaid).toHaveBeenCalledTimes(1);
    // the stamp is bound by the RAW microsecond text, never a JS Date
    expect((h.earnings.markPaid.mock.calls as any[])[0][2]).toEqual([{ id: 'e-5000', createdAtRaw: '2026-10-02 10:00:00.123456+05:30' }, { id: 'e-2500', createdAtRaw: '2026-10-02 10:00:00.123456+05:30' }]);
  });
  it('F-1 · a stamp that does not cover every locked row THROWS (the wallet leg rolls back with the tx)', async () => {
    const h = harness({ unpaid: [earning(5000n), earning(2500n)], stamped: 0 });
    await expect(h.svc.payoutAmbassador('t1', actor, 'a1', 'idem-1', 'weekly run')).rejects.toBeInstanceOf(PayoutMarkMismatchError);
    // the throw happens inside uow.run → the real unit of work rolls back the wallet.post issued on the same tx
    expect(h.uow.run).toHaveBeenCalledTimes(1);
    expect(h.audit.write).not.toHaveBeenCalled();
  });
  it('F-1 · the wallet key is a function of the locked earning SET (order-free), not of the call', async () => {
    const h = harness({ unpaid: [earning(5000n, 'e-b'), earning(2500n, 'e-a')] });
    await h.svc.payoutAmbassador('t1', actor, 'a1', 'idem-ONE', 'weekly run');
    const key = ((h.wallet.post.mock.calls as any[])[0][1]).idempotencyKey;
    expect(key).toBe(payoutWalletKey('a1', ['e-a', 'e-b']));
    expect(key).toBe(payoutWalletKey('a1', ['e-b', 'e-a']));
    expect(key).toMatch(/^ambpayout:a1:[0-9a-f]{64}$/);
    expect(key.length).toBeLessThanOrEqual(120);            // ledger_transactions.idempotency_key varchar(120)
  });
  it('F-3 · the actor is the caller everywhere and the payout is audited with the reason', async () => {
    const h = harness({ unpaid: [earning(5000n)] });
    await h.svc.payoutAmbassador('t1', actor, 'a1', 'idem-1', '  weekly run  ');
    expect((h.idem.remember.mock.calls as any[])[0][1]).toBe(actor.userId);
    expect(((h.wallet.post.mock.calls as any[])[0][1]).initiatedBy).toBe(actor.userId);
    expect((h.uow.run.mock.calls as any[])[0][2]).toEqual({ userId: actor.userId });
    const a = (h.audit.write.mock.calls as any[])[0][1];
    expect(a).toMatchObject({ action: 'ambassador.payout.run', actorUserId: actor.userId, reason: 'weekly run', oldValue: { unpaidMinor: '5000', unpaidCount: 1 } });
    expect(a.newValue).toMatchObject({ ambassadorId: 'a1', totalMinor: '5000', count: 1, reason: 'weekly run' });
  });
  it('F-3 · no reason, no payout (and no wallet move)', async () => {
    const h = harness({ unpaid: [earning(5000n)] });
    await expect(h.svc.payoutAmbassador('t1', actor, 'a1', 'idem-1', 'ok')).rejects.toBeInstanceOf(ReasonRequiredError);
    expect(h.wallet.post).not.toHaveBeenCalled();
    expect(() => requireReason('', 'x')).toThrow(ReasonRequiredError);
    expect(requireReason(' paid for July ', 'x')).toBe('paid for July');
  });
  it('throws NothingToPayout when no unpaid earnings (no wallet move)', async () => {
    const h = harness({ unpaid: [] });
    await expect(h.svc.payoutAmbassador('t1', actor, 'a1', 'idem-2', 'weekly run')).rejects.toBeInstanceOf(NothingToPayoutError);
    expect(h.wallet.post).not.toHaveBeenCalled();
  });
  it('A13 · runPayouts: one transaction per ambassador, a batch audit row, idempotent on the caller key', async () => {
    const h = harness({ unpaid: [earning(5000n)] });
    const out = await h.svc.runPayouts('t1', actor, 'batch-1', 'weekly run');
    expect(out).toMatchObject({ attempted: 1, paid: 1, failed: 0, nothingToPay: 0, totalPaidMinor: '5000' });
    expect(h.uow.run).toHaveBeenCalledTimes(2);                       // the ambassador's own tx + the batch audit tx
    expect((h.idem.remember.mock.calls as any[])[0].slice(0, 3)).toEqual(['batch-1', actor.userId, 'ambassadors.payout.batch']);
    const actions = (h.audit.write.mock.calls as any[]).map((c) => c[1].action);
    expect(actions).toEqual(['ambassador.payout.run', 'ambassador.payout.batch']);
  });
  it('A13 · one ambassador failing never stops the run; nothing-to-pay is named, not failed', async () => {
    const h = harness({ unpaid: [] });
    const out = await h.svc.runPayouts('t1', actor, 'batch-2', 'weekly run');
    expect(out.lines).toEqual([{ ambassadorId: 'a1', outcome: 'nothing_to_pay' }]);
    expect(out.failed).toBe(0);
  });
});
