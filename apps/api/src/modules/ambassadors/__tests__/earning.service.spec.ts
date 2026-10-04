// modules/ambassadors/__tests__/earning.service.spec.ts · AmbassadorEarningService unit tests with fakes.
// Pins: accrue is idempotent (existsFor guard) + skips when no plan / zero amount; PC-56 TENANT-SW-b: a confirmed run posts ONE zero-sum
// 'ambassador_run' transfer per line (TENANT Main → ambassador userMain — never platform Fees), stamps payout_id = the line id.
// PC-56 TENANT-10a pins (each fails on 9743e8b):
//   F-1  a stamp count that differs from the locked count THROWS (inside the tx — the wallet leg rolls back with it);
//        the wallet key is derived from the locked earning set, never from the call;
//   F-3  the actor is the caller (initiatedBy, idempotency owner, unit of work), the audit row is written, reason required;
//   F-5  plan conditions refuse an accrual (cap per farmer, referral window, unknown key).
import { AmbassadorEarningService, payoutWalletKey, requireReason } from '../services/ambassador-earning.service';
import { CommissionPlan } from '../domain/commission-plan.entity';
import { AmbassadorEarning } from '../domain/ambassador-earning.entity';
import { AmbassadorProfile } from '../domain/ambassador-profile.entity';
import { ReasonRequiredError } from '../domain/ambassadors.errors';
import { PayoutRunService } from '../services/payout-run.service';

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

// PC-56 TENANT-SW-b · the 10a `payoutAmbassador` / `runPayouts` (platform Fees → ambassador, one admin) are GONE — the money path is
// PayoutRunService (tenant Main → ambassador, maker-checker). The 10a guarantees are re-pinned against it here, with fakes.
describe('PayoutRunService — the money path (tenant Main, set-derived stamp, reason, no TS maker-checker)', () => {
  const earning = (amt: bigint, id = `e-${amt}`) => AmbassadorEarning.rehydrate({ id, tenantId: 't1', ambassadorId: 'a1', planId: 'p1', eventCode: 'x', referenceType: null, referenceId: null, amountMinor: amt, payoutId: null, createdAt: new Date(), createdAtRaw: '2026-10-02 10:00:00.123456+05:30' });
  const actor = { userId: '01a0c000-0000-7000-8000-0000000000aa' };
  const run = { id: 'run1', tenantId: 't1', kind: 'weekly', ambassadorId: null, periodStart: null, periodEnd: '2026-10-01T17:30:00.000Z', payDate: '2026-10-02', status: 'prepared',
    preparedBy: '01a0c000-0000-7000-8000-0000000000bb', preparedAt: '', prepareReason: 'r', confirmedBy: null, confirmedAt: null, confirmReason: null, refusedBy: null, refusedAt: null, refuseReason: null,
    totalCommissionMinor: '7500', totalStipendMinor: '0', lineCount: 1, fundingCheck: {}, lastPayCheck: null, paidMinor: '0', lastPaidAt: null, createdAt: '', createdAtRaw: '' };
  const line = (status = 'pending') => ({ id: 'l1', runId: 'run1', ambassadorId: 'a1', ambassadorUserId: 'ambUser', commissionMinor: 7500n, earningCount: 2, stipendMinor: 0n, stipendMonth: null, status,
    shortfallMinor: null, failureCode: null, attempts: 0, payoutId: null, txnId: null, paidAt: null, displayName: null, phoneMasked: null });
  function runHarness(opts: { stamped?: number; balance?: bigint; locked?: AmbassadorEarning[] } = {}) {
    const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
    const wallet = { post: jest.fn(async () => ({ txnId: 'tx1', alreadyApplied: false })), balanceMinor: jest.fn(async () => opts.balance ?? 1_000_000n) };
    const audit = { write: jest.fn() };
    const lines = [line()];
    const runs = {
      runForUpdate: jest.fn(async () => ({ ...run })), confirm: jest.fn(async () => 1), linesForUpdate: jest.fn(async () => lines),
      markLinePaid: jest.fn(async () => { lines[0] = { ...lines[0], status: 'paid' }; }), markLineUnfunded: jest.fn(async (_tx: unknown, _t: string, _id: string, short: bigint) => { lines[0] = { ...lines[0], status: 'unfunded', shortfallMinor: short.toString() } as any; }),
      markLineFailed: jest.fn(async () => { lines[0] = { ...lines[0], status: 'failed' }; }), recordPayAttempt: jest.fn(), insertStipendPayment: jest.fn(),
    };
    const earnings = { lockUnpaidUpTo: jest.fn(async () => opts.locked ?? [earning(5000n), earning(2500n)]), markPaid: jest.fn(async (_tx: unknown, _t: string, keys: unknown[]) => opts.stamped ?? keys.length) };
    const svc = new PayoutRunService(uow as any, { write: jest.fn() } as any, idem as any, { inc: jest.fn() } as any, wallet as any, audit as any, runs as any, earnings as any, {} as any);
    return { svc, tx, wallet, runs, earnings, audit, idem, uow };
  }
  it('A1 · confirm pays ONE zero-sum txn per line: tenant Main −total → ambassador Main +total (NEVER platform Fees), keyed ambrun:<run>:<ambassador>', async () => {
    const h = runHarness();
    const out = await h.svc.confirm('t1', actor, 'run1', 'checked the lines', 'idem-1');
    expect(out).toMatchObject({ paid: 1, unfunded: 0, failed: 0, status: 'paid', paidMinor: '7500' });
    const arg: any = (h.wallet.post.mock.calls as any[])[0][1];
    expect(arg.txnType).toBe('ambassador_run');
    expect(arg.idempotencyKey).toBe('ambrun:run1:a1');
    expect(arg.legs.reduce((s: bigint, l: any) => s + l.amountMinor, 0n)).toBe(0n);                              // ZERO-SUM
    expect(arg.legs).toEqual([{ account: { kind: 'tenant', tenantId: 't1', accountCode: 'main', currencyCode: 'INR' }, amountMinor: -7500n },
      { account: { kind: 'user', userId: 'ambUser', accountCode: 'main', currencyCode: 'INR' }, amountMinor: 7500n }]);
    expect(arg.legs.some((l: any) => l.account.kind === 'platform')).toBe(false);                                // the 10a Fees leg is REPLACED
    // the stamp is bound by the RAW microsecond text (10a F-1), payout_id = the line id
    expect((h.earnings.markPaid.mock.calls as any[])[0][2]).toEqual([{ id: 'e-5000', createdAtRaw: '2026-10-02 10:00:00.123456+05:30' }, { id: 'e-2500', createdAtRaw: '2026-10-02 10:00:00.123456+05:30' }]);
    expect((h.earnings.markPaid.mock.calls as any[])[0][3]).toBe('l1');
  });
  it('A1 · maker ≠ checker is NOT checked in TypeScript — the confirm is issued even for the preparer (trg_apr_moves is the wall; the integration spec pins it)', async () => {
    const h = runHarness();
    await h.svc.confirm('t1', { userId: run.preparedBy }, 'run1', 'checked the lines', 'idem-1');
    expect(h.runs.confirm).toHaveBeenCalledWith(h.tx, 't1', 'run1', run.preparedBy, 'checked the lines');
  });
  it('F-1 · a stamp that misses a locked row rolls the LINE back to its savepoint and names it failed (nothing paid for it)', async () => {
    const h = runHarness({ stamped: 1 });
    const out = await h.svc.confirm('t1', actor, 'run1', 'checked the lines', 'idem-1');
    expect(out).toMatchObject({ paid: 0, failed: 1, status: 'partially_paid' });
    const sql = (h.tx.query.mock.calls as any[]).map((c) => c[0]);
    expect(sql).toContain('SAVEPOINT amb_run_line'); expect(sql).toContain('ROLLBACK TO SAVEPOINT amb_run_line');
    expect(h.runs.markLineFailed).toHaveBeenCalledWith(h.tx, 't1', 'l1', 'PAYOUT_MARK_MISMATCH');
    expect(h.runs.markLinePaid).not.toHaveBeenCalled();
  });
  it('an unfunded tenant: the line is `unfunded` with the shortfall and NOTHING is posted; the run is `unfunded`', async () => {
    const h = runHarness({ balance: 1000n });
    const out = await h.svc.confirm('t1', actor, 'run1', 'checked the lines', 'idem-1');
    expect(out).toMatchObject({ paid: 0, unfunded: 1, status: 'unfunded' });
    expect(h.wallet.post).not.toHaveBeenCalled();
    expect(h.runs.markLineUnfunded).toHaveBeenCalledWith(h.tx, 't1', 'l1', 6500n);
  });
  it('the earnings changed after prepare → the line refuses (EARNINGS_CHANGED), nothing posted', async () => {
    const h = runHarness({ locked: [earning(5000n)] });
    const out = await h.svc.confirm('t1', actor, 'run1', 'checked the lines', 'idem-1');
    expect(out.failed).toBe(1); expect(h.wallet.post).not.toHaveBeenCalled();
    expect(h.runs.markLineFailed).toHaveBeenCalledWith(h.tx, 't1', 'l1', 'EARNINGS_CHANGED');
  });
  it('F-3 · no reason, no confirm; the actor is the caller everywhere', async () => {
    const h = runHarness();
    await expect(h.svc.confirm('t1', actor, 'run1', 'ok', 'idem-1')).rejects.toBeInstanceOf(ReasonRequiredError);
    expect(h.wallet.post).not.toHaveBeenCalled();
    await h.svc.confirm('t1', actor, 'run1', '  checked  ', 'idem-2');
    expect((h.idem.remember.mock.calls as any[])[0][1]).toBe(actor.userId);
    expect(((h.wallet.post.mock.calls as any[])[0][1]).initiatedBy).toBe(actor.userId);
    expect((h.uow.run.mock.calls as any[])[0][2]).toEqual({ userId: actor.userId });
    expect(() => requireReason('', 'x')).toThrow(ReasonRequiredError);
    expect(requireReason(' paid for July ', 'x')).toBe('paid for July');
  });
  it('10a · the legacy set-derived key helper is still order-free (kept for its callers)', () => {
    expect(payoutWalletKey('a1', ['e-a', 'e-b'])).toBe(payoutWalletKey('a1', ['e-b', 'e-a']));
    expect(payoutWalletKey('a1', ['e-a'])).toMatch(/^ambpayout:a1:[0-9a-f]{64}$/);
  });
});
