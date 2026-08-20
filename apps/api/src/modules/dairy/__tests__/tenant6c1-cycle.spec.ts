// modules/dairy/__tests__/tenant6c1-cycle.spec.ts · PC-56 TENANT-6c-1 · W169 (Dairy payout cycles).
//
// W169 is a screen about a CYCLE, and this platform had no cycle: `milk_bills` carried a bare (period_start,
// period_end) pair per member and nothing recorded that 312 of those pairs are one fortnight with one close instant,
// one payday and one state. And the job that was supposed to build those bills — `MilkBillCycleCloseJob` — was
// registered NOWHERE, in a module whose own header said apps/worker instantiated it.
//
// These tests pin, in order: the cycle calendar (one mechanism, shared with TENANT-6a's counter board), the cycle's
// state machine and its refusals, the SQL that resolves the close instant in the TENANT's timezone rather than the
// process's, the generation run's honesty about what it skipped versus what it failed, the bill mapper's repaired
// date and litre reads, and the cadence job's scale and isolation behaviour.
import { DairyBillCycle } from '../domain/dairy-bill-cycle.entity';
import {
  CYCLE_STATUSES, IllegalCycleTransitionError, assertTransition, canTransition, dayBefore,
  previousCycleWindow, windowsToEnsure,
} from '../domain/dairy-cycle';
import { cycleWindow } from '../domain/dairy-counter';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';
import { DairyCycleCloseCadenceJob } from '../jobs/dairy-cycle-close.cadence-job';
import { BillCycleNotFoundError, CycleNotClosableError } from '../domain/dairy.errors';
import { MilkBill } from '../domain/milk-bill.entity';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { PaymentCycle } from '../domain/dairy.events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';

const fakeReplica = () => {
  const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
  return { provider: { forTenant: () => exec } as never, exec };
};
const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };

const CLOSES = new Date('2026-07-15T18:30:00.000Z');   // 16 Jul 00:00 Asia/Kolkata — the exclusive close
function cycle(over: Partial<Parameters<typeof DairyBillCycle.rehydrate>[0]> = {}) {
  return DairyBillCycle.rehydrate({
    id: 'cyc1', tenantId: 'tA', paymentCycle: 'fortnightly',
    periodStart: '2026-07-01', periodEnd: '2026-07-15',
    closesAt: CLOSES, payday: '2026-07-17', status: 'open', closedAt: null,
    billsGeneratedAt: null, billsGenerated: null, billsSkipped: null, billsFailed: null,
    // [PC-56 TENANT-6c-2] the preview act's own stamps; [6c-3] the second signature's
    previewedAt: null, previewedBy: null, billsPreviewed: null,
    approvedAt: null, approvedBy: null, billsApproved: null, ...over,
  });
}

/* ----------------------------------------------------------------------------------------------------------- */
describe('the cycle calendar — ONE mechanism, shared with the counter board', () => {
  it('previousCycleWindow is the window that ended, for every cadence', () => {
    expect(previousCycleWindow('2026-07-13', 'fortnightly')).toMatchObject({ from: '2026-06-16', to: '2026-06-30' });
    expect(previousCycleWindow('2026-07-20', 'fortnightly')).toMatchObject({ from: '2026-07-01', to: '2026-07-15' });
    expect(previousCycleWindow('2026-07-13', 'monthly')).toMatchObject({ from: '2026-06-01', to: '2026-06-30' });
    expect(previousCycleWindow('2026-07-13', 'daily')).toMatchObject({ from: '2026-07-12', to: '2026-07-12' });
    // 13 Jul 2026 is a Monday, so the week that ended is Mon 6 – Sun 12.
    expect(previousCycleWindow('2026-07-13', 'weekly')).toMatchObject({ from: '2026-07-06', to: '2026-07-12' });
  });

  it('a SUNDAY looks back six days, not forward one — the ISO-week rule the counter board owns', () => {
    // 12 Jul 2026 is a Sunday and belongs to the week starting Mon 6th, so the PREVIOUS week is Mon 29 Jun – Sun 5 Jul.
    expect(cycleWindow('2026-07-12', 'weekly')).toMatchObject({ from: '2026-07-06', to: '2026-07-12' });
    expect(previousCycleWindow('2026-07-12', 'weekly')).toMatchObject({ from: '2026-06-29', to: '2026-07-05' });
  });

  it('the previous window ENDS the day before the current one starts, always', () => {
    // The property that matters: no day of milk falls between two cycles, and no day is in both. Asserted across a
    // full year and every cadence rather than at hand-picked boundaries — February, month ends and the 15th/16th
    // fortnight split are exactly where an off-by-one would hide.
    const kinds: PaymentCycle[] = ['daily', 'weekly', 'fortnightly', 'monthly'];
    for (let i = 0; i < 400; i++) {
      const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      for (const k of kinds) {
        const cur = cycleWindow(day, k);
        const prev = previousCycleWindow(day, k);
        expect(dayBefore(cur.from)).toBe(prev.to);
        expect(prev.from <= prev.to).toBe(true);
      }
    }
  });

  it('spans a leap-year February and a year boundary without special-casing either', () => {
    expect(previousCycleWindow('2028-03-05', 'monthly')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(previousCycleWindow('2028-03-05', 'fortnightly')).toMatchObject({ from: '2028-02-16', to: '2028-02-29' });
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(previousCycleWindow('2027-01-10', 'monthly')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('windowsToEnsure returns the ended window FIRST, then the running one', () => {
    const [prev, cur] = windowsToEnsure('2026-07-13', 'fortnightly');
    expect(prev.to).toBe('2026-06-30');
    expect(cur).toMatchObject({ from: '2026-07-01', to: '2026-07-15' });
    // W169's first tile is a cycle mid-flight ("Current cycle 01–15 Jul · accrued to 13 Jul"), so the running window
    // gets a row too — a screen that could only show a shut cycle would be blank thirteen days out of fourteen.
    expect(prev.from < cur.from).toBe(true);
  });

  it('carries the derivation BASIS through, so a screen can say where the window came from', () => {
    expect(previousCycleWindow('2026-07-13', 'fortnightly').basis).toBe('derived_from_membership_preference');
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the cycle state machine (Law 5)', () => {
  it('admits ONLY the states this programme can reach', () => {
    // 6c-1 shipped `open|closed`; 6c-2 added `previewed` (W169's header button); 6c-3 adds `approved` (the second
    // signature). A status is only ever added here BECAUSE THE ACT ARRIVED. `paid` is still absent: it needs a payout
    // batch this platform does not have (`payout_id` has never been written) and a bill carrying a deduction still
    // cannot be paid at all, so it would be a state nothing could move a cycle into. The database CHECK tracks this
    // list exactly.
    expect([...CYCLE_STATUSES]).toEqual(['open', 'closed', 'previewed', 'approved']);
    expect([...CYCLE_STATUSES]).not.toContain('paid');
  });
  it('open → closed → previewed, and previewed is where a cycle waits for its members', () => {
    expect(canTransition('open', 'closed')).toBe(true);
    expect(canTransition('closed', 'previewed')).toBe(true);
    expect(canTransition('closed', 'closed')).toBe(false);
    expect(canTransition('closed', 'open')).toBe(false);
    // Not reachable in one step: a cycle still collecting milk cannot show a member a bill for half a fortnight.
    expect(canTransition('open', 'previewed')).toBe(false);
    expect(canTransition('previewed', 'closed')).toBe(false);
    expect(() => assertTransition('closed', 'open')).toThrow(IllegalCycleTransitionError);
    expect(() => assertTransition('open', 'previewed')).toThrow(IllegalCycleTransitionError);
  });
});

describe('DairyBillCycle — the refusals', () => {
  it('closes at its close instant and records it', () => {
    const c = cycle();
    c.close(CLOSES);
    expect(c.status).toBe('closed');
    expect(c.toProps().closedAt).toEqual(CLOSES);
    const [e] = c.pullEvents();
    expect(e.type).toBe('dairy.cycle_closed');
    expect(e.payload).toMatchObject({ cycleId: 'cyc1', periodStart: '2026-07-01', periodEnd: '2026-07-15', payday: '2026-07-17' });
  });

  it('REFUSES to close early — a fortnight billed at day eight pays for half the milk', () => {
    const c = cycle();
    const oneMsEarly = new Date(CLOSES.getTime() - 1);
    expect(() => c.close(oneMsEarly)).toThrow(CycleNotClosableError);
    expect(c.status).toBe('open');
    expect(c.pullEvents()).toHaveLength(0);          // and publishes nothing
  });

  it('the boundary is inclusive of the close instant itself', () => {
    const c = cycle();
    expect(() => c.close(new Date(CLOSES.getTime()))).not.toThrow();
  });

  it('cannot be closed twice — two ticks must not both publish dairy.cycle_closed', () => {
    const c = cycle({ status: 'closed', closedAt: CLOSES });
    expect(() => c.close(new Date(CLOSES.getTime() + 60_000))).toThrow(IllegalCycleTransitionError);
  });

  it('refuses to record a generation run on an OPEN cycle', () => {
    const c = cycle();
    expect(() => c.recordGeneration(new Date(), { generated: 1, skipped: 0, failed: 0 })).toThrow(CycleNotClosableError);
  });

  it('records the run and stops needing bills — unless the run left failures behind', () => {
    const c = cycle({ status: 'closed', closedAt: CLOSES });
    expect(c.needsBills).toBe(true);
    c.recordGeneration(new Date('2026-07-16T01:00:00Z'), { generated: 309, skipped: 3, failed: 0 });
    expect(c.needsBills).toBe(false);
    const [e] = c.pullEvents();
    expect(e.type).toBe('dairy.cycle_bills_generated');
    expect(e.payload).toMatchObject({ generated: 309, skipped: 3, failed: 0 });

    const stuck = cycle({ status: 'closed', closedAt: CLOSES, billsGeneratedAt: new Date(), billsGenerated: 300, billsSkipped: 3, billsFailed: 9 });
    expect(stuck.needsBills).toBe(true);            // retried; generate is idempotent per (membership, period)
  });

  it('an OPEN cycle never needs bills, however long ago its window started', () => {
    expect(cycle().needsBills).toBe(false);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('DairyBillCycleRepository — the SQL that resolves a cooperative\'s own close and payday', () => {
  const win = { from: '2026-07-01', to: '2026-07-15', cycle: 'fortnightly' as PaymentCycle, basis: 'derived_from_membership_preference' as const };

  it('resolves closes_at from tenants.timezone, NOT from the process timezone', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new DairyBillCycleRepository(fakeReplica().provider).ensure(tx as never, 'tA', win).catch(() => undefined);
    const [sql] = tx.query.mock.calls[0];
    // The whole point: the instant a fortnight shuts is 23:59 WHERE THE COOPERATIVE IS. Deriving it in TypeScript
    // derives it in whatever zone Node happens to run in — the defect class TENANT-6b-1 spent a wave removing.
    expect(sql).toMatch(/AT TIME ZONE co\.timezone/);
    expect(sql).toMatch(/\(\$5::date \+ 1\)::timestamp/);   // EXCLUSIVE: first instant of the day after period_end
    expect(sql).toMatch(/FROM tenants t/);
    // Via the country, because there IS no tenants.timezone column — exact for every launch market, and a cap that is
    // named rather than papered over with a dead column (see the repository's own doc).
    expect(sql).toMatch(/JOIN countries co ON co\.code = t\.country_code/);
  });

  it('resolves payday from the tenant setting with the DEFAULT read from setting_definitions (Law 6)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new DairyBillCycleRepository(fakeReplica().provider).ensure(tx as never, 'tA', win).catch(() => undefined);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN tenant_settings ts/);
    expect(sql).toMatch(/COALESCE\(ts\.value, d\.default_value\) #>> '\{\}'/);   // works for jsonb 2 AND jsonb "2"
    expect(params).toContain('dairy.cycle_payday_offset_days');
    // A hardcoded "+2 days" would be exactly the string Law 6 exists to stop: Friday is this cooperative's habit.
    expect(sql).not.toMatch(/\+ 2\)/);
  });

  it('ensure is idempotent and re-reads — it never fabricates a cycle it did not create', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const repo = new DairyBillCycleRepository(fakeReplica().provider);
    // Second call (the read-back) returns no row: a tenant that does not exist, or the payday definition missing.
    await expect(repo.ensure(tx as never, 'tA', win)).rejects.toBeInstanceOf(BillCycleNotFoundError);
    expect(tx.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(tenant_id, payment_cycle, period_start, period_end\) DO NOTHING/);
    expect(tx.query.mock.calls[1][0]).toMatch(/tenant_id=\$1 AND payment_cycle=\$2/);
  });

  it('updateState writes ONLY the columns 0157 grants — never the window, the close instant or the payday', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const c = cycle({ status: 'closed', closedAt: CLOSES });
    await new DairyBillCycleRepository(fakeReplica().provider).updateState(tx as never, c);
    const [sql] = tx.query.mock.calls[0];
    expect(sql).toMatch(/SET status=\$3, closed_at=\$4, bills_generated_at=\$5, bills_generated=\$6, bills_skipped=\$7, bills_failed=\$8/);
    for (const forbidden of ['period_start=', 'period_end=', 'closes_at=', 'payday=', 'payment_cycle=']) {
      expect(sql).not.toContain(forbidden);
    }
    expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2/);
  });

  it('updateState FAILS CLOSED on a zero-row update', async () => {
    // The COLLECTION_STAMP_LOST / SHIPMENT_UPDATE_LOST ruling: a cycle the caller believes it closed, whose row did
    // not move, leaves the next tick re-closing it forever while the first close's events are already in the outbox.
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await expect(new DairyBillCycleRepository(fakeReplica().provider).updateState(tx as never, cycle({ status: 'closed', closedAt: CLOSES })))
      .rejects.toBeInstanceOf(BillCycleNotFoundError);
  });

  it('the claim queries are tenant-bound, bounded, and each names its own condition', async () => {
    const repo = new DairyBillCycleRepository(fakeReplica().provider);
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await repo.dueToClose(tx as never, 'tA', CLOSES, 50);
    expect(tx.query.mock.calls[0][0]).toMatch(/tenant_id=\$1 AND status='open' AND closes_at <= \$2/);
    expect(tx.query.mock.calls[0][0]).toMatch(/LIMIT \$3/);

    await repo.needingBills(tx as never, 'tA', 20);
    const sql = tx.query.mock.calls[1][0];
    // [PC-56 TENANT-6c-2] This read `status='closed'` when `closed` was the only state past `open`, and became a bug the
    // moment `previewed` existed: a bill VOIDED after preview released its pours and would never have been rebuilt,
    // because this query stopped looking at that cycle. Phrased against the PROPERTY the status stood for.
    expect(sql).toMatch(/closed_at IS NOT NULL/);
    expect(sql).not.toMatch(/status='closed'/);
    expect(sql).toMatch(/bills_generated_at IS NULL OR coalesce\(bills_failed, 0\) > 0/);
    expect(sql).toMatch(/LIMIT \$2/);
  });

  it('activePaymentCycles reads the column the cadence is actually driven by', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ payment_cycle: 'fortnightly' }, { payment_cycle: 'monthly' }], rowCount: 2 }) };
    const got = await new DairyBillCycleRepository(fakeReplica().provider).activePaymentCycles(tx as never, 'tA');
    expect(got).toEqual(['fortnightly', 'monthly']);
    // A cooperative genuinely runs two cadences at once (a fortnightly village route and a monthly bulk supplier).
    // TENANT-6a had to take the MODE of this column to guess ONE window for a whole screen; every value gets a cycle.
    expect(tx.query.mock.calls[0][0]).toMatch(/tenant_id=\$1 AND is_active = true AND deleted_at IS NULL/);
  });

  it('listFor is tenant-bound and orders by the newest window', async () => {
    const { provider, exec } = fakeReplica();
    await new DairyBillCycleRepository(provider).listFor('tA', { limit: 20 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/);
    expect(sql).toMatch(/ORDER BY period_start DESC, payment_cycle/);
    expect(sql).not.toMatch(/OFFSET/i);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('DairyBillCycleService — what a generation run says happened', () => {
  function harness(opts: {
    members?: string[];
    /** What the claim query returns on the SECOND ask (after the pass) — i.e. who still has unbilled pours. */
    remaining?: string[];
    generate?: jest.Mock;
    needing?: DairyBillCycle[];
    due?: DairyBillCycle[];
    kinds?: PaymentCycle[];
    getForUpdate?: jest.Mock;
  } = {}) {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const outbox = { write: jest.fn() };
    const cycles = {
      today: jest.fn(async () => '2026-07-20'),
      activePaymentCycles: jest.fn(async () => opts.kinds ?? ['fortnightly']),
      ensure: jest.fn(async () => cycle()),
      dueToClose: jest.fn(async () => opts.due ?? []),
      needingBills: jest.fn(async () => opts.needing ?? []),
      getForUpdate: opts.getForUpdate ?? jest.fn(async () => cycle({ status: 'closed', closedAt: CLOSES })),
      updateState: jest.fn(),
    };
    // The claim query is asked TWICE per cycle: once to drive the pass, once afterwards to measure stranded milk.
    // Modelled here as "the pours got stamped", which is what the real query reports once bills exist.
    let asked = 0;
    const collections = { membershipsToBillForCycle: jest.fn(async () => (asked++ === 0 ? (opts.members ?? []) : (opts.remaining ?? []))) };
    const bills = { generate: opts.generate ?? jest.fn(async () => ({ id: 'b1' })) };
    // [PC-56 TENANT-6c-2] the ctor grew: an idempotency service for the route-level preview, and the bill repository +
    // membership repository the preview pass needs.
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
    // [PC-56 TENANT-6c-2] the generation pass now reads how many bills each member has ALREADY had for this window, so
    // the idempotency key identifies the attempt rather than the pair (a rebuild after a void must not replay).
    const billRepo = { draftsForCycle: jest.fn(async () => []), statusCountsForCycle: jest.fn(async () => ({})), billAttemptsByMembership: jest.fn(async () => new Map()) };
    const memberships = { getById: jest.fn(async () => ({ farmerUserId: 'farmer1' })) };
    const svc = new DairyBillCycleService(uow as never, outbox as never, metrics as never, idem as never,
      cycles as never, collections as never, bills as never, billRepo as never, memberships as never);
    return { svc, cycles, collections, bills, outbox, uow, billRepo, idem };
  }

  it('ensures the ended AND the running window, for every cadence the members use', async () => {
    const { svc, cycles } = harness({ kinds: ['fortnightly', 'monthly'] });
    expect(await svc.ensureCycles('tA')).toBe(4);
    const windows = cycles.ensure.mock.calls.map((c: any[]) => `${c[2].cycle}:${c[2].from}..${c[2].to}`);
    expect(windows).toEqual([
      'fortnightly:2026-07-01..2026-07-15', 'fortnightly:2026-07-16..2026-07-31',
      'monthly:2026-06-01..2026-06-30', 'monthly:2026-07-01..2026-07-31',
    ]);
  });

  it('takes "today" from the DATABASE, not from the process clock', async () => {
    const { svc, cycles } = harness();
    await svc.ensureCycles('tA');
    expect(cycles.today).toHaveBeenCalled();
    // The same discipline TENANT-6a set for the counter board: a job asked for "today" must not disagree with the day
    // SQL `current_date` stamped on the pours it is about to bill.
  });

  it('re-reads FOR UPDATE before closing, so two pods cannot both publish the close', async () => {
    const open = cycle();
    const { svc, cycles, outbox } = harness({ due: [open], getForUpdate: jest.fn(async () => cycle()) });
    expect(await svc.closeDue('tA', CLOSES)).toBe(1);
    expect(cycles.getForUpdate).toHaveBeenCalledWith(expect.anything(), 'tA', 'cyc1');
    expect(cycles.updateState).toHaveBeenCalledTimes(1);
    expect(outbox.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      aggregateType: 'dairy_bill_cycle', eventType: 'dairy.cycle_closed',
    }));
  });

  it('does nothing, QUIETLY, when the re-read shows the cycle already closed', async () => {
    const { svc, cycles, outbox } = harness({ due: [cycle()], getForUpdate: jest.fn(async () => cycle({ status: 'closed', closedAt: CLOSES })) });
    // [MUTATION GAP] Dropping the `status !== 'open'` re-check left every assertion below intact: `close()` throws
    // IllegalCycleTransition, the catch logs it, and the counts are the same. The DIFFERENCE is the log — a cycle that
    // has been closed for a fortnight would raise an error EVERY HOUR, forever, on every pod, and an alert channel that
    // cries wolf hourly is one nobody reads when the real failure arrives (Law 12).
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      expect(await svc.closeDue('tA', CLOSES)).toBe(0);
      expect(cycles.updateState).not.toHaveBeenCalled();
      expect(outbox.write).not.toHaveBeenCalled();
      expect(logged).not.toHaveBeenCalled();
    } finally { logged.mockRestore(); }
  });

  it('generates through MilkBillService — no second aggregation, and the CYCLE id travels with the bill', async () => {
    const generate = jest.fn(async () => ({ id: 'b1' }));
    const closed = cycle({ status: 'closed', closedAt: CLOSES });
    const { svc } = harness({ members: ['mem1', 'mem2'], generate, needing: [closed] });
    const out = await svc.buildBills('tA');
    expect(out).toMatchObject({ cyclesBilled: 1, generated: 2, skipped: 0, failed: 0 });
    const [, actor, idemKey, dto, cycleId] = generate.mock.calls[0] as any[];
    expect(actor).toEqual({ userId: 'system', canManage: true });
    expect(idemKey).toBe('dairycycle:cyc1:mem1:0');  // cycle + member + ATTEMPT: a re-run replays, a rebuild does not
    expect(dto).toEqual({ membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15', deductions: [] });
    expect(cycleId).toBe('cyc1');
    // No deductions are invented by the job: `deductions.type` has no destination to post to (see
    // DEDUCTION_HAS_NO_DESTINATION), so a cadence that filled it in would build 312 unpayable bills.
    expect(dto.deductions).toEqual([]);
  });

  it('counts ALL_POURS_HELD as SKIPPED, not FAILED — a held pour is the system working', async () => {
    // The orphaned job's skip list was EMPTY_BILL / BILL_NOT_PAYABLE only, so every member whose pours were all under
    // a quality hold — the state TENANT-6b-1 built on purpose — would have paged somebody as a failure.
    const generate = jest.fn(async (_t: string, _a: unknown, key: string) => {
      const code = { mem1: 'ALL_POURS_HELD', mem2: 'EMPTY_BILL', mem3: 'BILL_NOT_PAYABLE', mem4: 'SOMETHING_ELSE' }[key.split(':')[2] as string];
      const e: any = new Error(code); e.code = code; throw e;
    });
    const { svc, cycles } = harness({ members: ['mem1', 'mem2', 'mem3', 'mem4'], generate, needing: [cycle({ status: 'closed', closedAt: CLOSES })] });
    const out = await svc.buildBills('tA');
    expect(out).toMatchObject({ generated: 0, skipped: 3, failed: 1 });
    expect(cycles.updateState).toHaveBeenCalled();     // and the run is recorded either way
  });

  it('a member STILL CLAIMED after the pass is STRANDED — measured from the fact, not from an error code', async () => {
    // A pour entered after its window was billed has nowhere to go: the bill exists, UNIQUE(membership, period) forbids
    // a second one, and the next window does not contain the pour's date. Detected by re-asking the claim query rather
    // than by catching BILL_NOT_PAYABLE, because on the likely path that error NEVER FIRES — the idempotency key is per
    // (cycle, membership), so the second pass replays the first bill's stored response and reports "generated 1" while
    // the late pour sits there. A live test caught exactly that.
    const generate = jest.fn(async () => ({ id: 'b1' }));            // a cheerful replay
    const { svc } = harness({ members: ['mem1'], remaining: ['mem1'], generate, needing: [cycle({ status: 'closed', closedAt: CLOSES })] });
    expect(await svc.buildBills('tA')).toMatchObject({ generated: 1, skipped: 0, stranded: 1, failed: 0 });
  });

  it('a member whose bill FAILED is not called stranded — that is a different fact', async () => {
    const generate = jest.fn(async () => { throw Object.assign(new Error('boom'), { code: 'WHATEVER' }); });
    const { svc } = harness({ members: ['mem1'], remaining: ['mem1'], generate, needing: [cycle({ status: 'closed', closedAt: CLOSES })] });
    expect(await svc.buildBills('tA')).toMatchObject({ failed: 1, stranded: 0 });
  });

  it('an EMPTY_BILL or a held pour is NOT stranded — nothing is owed', async () => {
    const generate = jest.fn(async (_t: string, _a: unknown, key: string) => {
      const code = key.includes(':mem1') ? 'EMPTY_BILL' : 'ALL_POURS_HELD';
      throw Object.assign(new Error(code), { code });
    });
    const { svc } = harness({ members: ['mem1', 'mem2'], generate, needing: [cycle({ status: 'closed', closedAt: CLOSES })] });
    expect(await svc.buildBills('tA')).toMatchObject({ skipped: 2, stranded: 0, failed: 0 });
  });

  it('one member failing does NOT stop the rest — per-member isolation', async () => {
    const generate = jest.fn(async (_t: string, _a: unknown, key: string) => {
      if (key.includes(':mem2:')) throw Object.assign(new Error('boom'), { code: 'WHATEVER' });
      return { id: 'b' };
    });
    const { svc } = harness({ members: ['mem1', 'mem2', 'mem3'], generate, needing: [cycle({ status: 'closed', closedAt: CLOSES })] });
    expect(await svc.buildBills('tA')).toMatchObject({ generated: 2, failed: 1 });
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('records the run even when it generated nothing, so the next tick does not sweep again', async () => {
    const recorded = cycle({ status: 'closed', closedAt: CLOSES });
    const { svc, cycles, outbox } = harness({ members: [], needing: [cycle({ status: 'closed', closedAt: CLOSES })], getForUpdate: jest.fn(async () => recorded) });
    await svc.buildBills('tA');
    expect(cycles.updateState).toHaveBeenCalledTimes(1);
    expect(recorded.toProps().billsGeneratedAt).not.toBeNull();
    expect(outbox.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'dairy.cycle_bills_generated' }));
  });

  it('tickForTenant ensures, closes and bills in ONE pass', async () => {
    // A cooperative switched on the morning after a fortnight ended must not wait two ticks for its bills.
    const generate = jest.fn(async () => ({ id: 'b1' }));
    // The FOR UPDATE re-read sees the cycle open when it is being closed and closed when its run is recorded — the
    // real sequence, since `close()` commits before `buildBills` re-reads.
    let seen = 0;
    const getForUpdate = jest.fn(async () => (seen++ === 0 ? cycle() : cycle({ status: 'closed', closedAt: CLOSES })));
    const { svc } = harness({ due: [cycle()], needing: [cycle({ status: 'closed', closedAt: CLOSES })], members: ['mem1'], generate, getForUpdate });
    const out = await svc.tickForTenant('tA', CLOSES);
    expect(out).toMatchObject({ ensured: 2, closed: 1, cyclesBilled: 1, generated: 1 });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('DairyCycleCloseCadenceJob — the registration whose absence made "312 bills" mean zero', () => {
  function jobHarness(opts: { tenants?: string[]; enabled?: (t: string) => boolean; tick?: jest.Mock } = {}) {
    const pool = { query: jest.fn(async (sql: string) => ({ sql, rows: (opts.tenants ?? ['t1']).map((id) => ({ id })), rowCount: 1 })) };
    const tick = opts.tick ?? jest.fn(async () => ({ ensured: 2, closed: 1, cyclesBilled: 1, generated: 3, skipped: 0, stranded: 0, failed: 0 }));
    const flags = { isEnabled: jest.fn(async (_k: string, ctx: any) => (opts.enabled ? opts.enabled(ctx.tenantId) : true)) };
    const job = new DairyCycleCloseCadenceJob(60 * 60_000, { tickForTenant: tick } as never, flags as never);
    return { job, pool, tick, flags };
  }

  it('is a ScheduledJob with a name and an interval — the two things the runner needs', () => {
    const { job } = jobHarness();
    expect(job.name).toBe('dairy-cycle-close');
    expect(job.intervalMs).toBe(3_600_000);
  });

  it('drives off tenants that HAVE dairy members, not off every live tenant', async () => {
    const { job, pool } = jobHarness();
    await job.run(pool as never);
    const [sql] = pool.query.mock.calls[0];
    // A platform with ten thousand tenants and twelve cooperatives must not do ten thousand flag lookups an hour
    // (Law 12: work proportional to work outstanding).
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM dairy_memberships m/);
    expect(sql).toMatch(/t\.status IN \('trial','active','grace'\)/);
    expect(sql).toMatch(/m\.is_active = true AND m\.deleted_at IS NULL/);
  });

  it('asks the flag PER TENANT and skips the ones that are off (Law 10 kill-switch)', async () => {
    const { job, pool, tick, flags } = jobHarness({ tenants: ['t1', 't2', 't3'], enabled: (t) => t === 't2' });
    await job.run(pool as never);
    expect(flags.isEnabled).toHaveBeenCalledTimes(3);
    expect(flags.isEnabled).toHaveBeenCalledWith('dairy_cycle_close', { tenantId: 't1' });
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledWith('t2', expect.any(Date));
  });

  it('one tenant throwing does not stop the others', async () => {
    const tick = jest.fn(async (t: string) => {
      if (t === 't1') throw new Error('boom');
      return { ensured: 0, closed: 0, cyclesBilled: 0, generated: 0, skipped: 0, stranded: 0, failed: 0 };
    });
    const { job, pool } = jobHarness({ tenants: ['t1', 't2'], tick });
    await expect(job.run(pool as never)).resolves.toBeUndefined();
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('passes ONE instant to every tenant in a tick', async () => {
    const { job, pool, tick } = jobHarness({ tenants: ['t1', 't2'] });
    await job.run(pool as never);
    expect(tick.mock.calls[0][1]).toBe(tick.mock.calls[1][1]);   // a cycle must not close for t1 and not for t2
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('the claim query\'s deliberate omission', () => {
  it('does NOT filter on is_active — a leaving member\'s last fortnight is still owed', async () => {
    // [MUTATION GAP] Adding `m.is_active = true` here survived every test in this wave, and it is the single most
    // plausible edit a reviewer would suggest. A member the cooperative deactivated on the 10th still poured milk on
    // the 1st through the 9th. Filtering on the flag is precisely how a leaving member's last fortnight becomes money
    // that is never paid and never noticed — so the OMISSION is asserted, not left to a comment.
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MilkCollectionRepository(fakeReplica().provider)
      .membershipsToBillForCycle(tx as never, 'tA', 'fortnightly', '2026-07-01', '2026-07-15', 500);
    const [sql] = tx.query.mock.calls[0];
    expect(sql).not.toMatch(/is_active/);
    expect(sql).toMatch(/m\.deleted_at IS NULL/);     // a DELETED membership is a different fact from an inactive one
  });
});

describe('MilkBillRepository — the mapper repairs', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'b1', tenant_id: 'tA', membership_id: 'mem1', cycle_id: 'cyc1',
    period_start: new Date(2026, 6, 1), period_end: new Date(2026, 6, 15),
    total_litres: '204.526', gross_minor: '84400', deductions: [], deductions_minor: '0', net_minor: '84400',
    status: 'draft', dispute_window_ends: null, payout_id: null, created_at: new Date(), ...over,
  });

  async function read(r: Record<string, unknown>) {
    const exec = { query: jest.fn().mockResolvedValue({ rows: [r], rowCount: 1 }) };
    const repo = new MilkBillRepository({ forTenant: () => exec } as never);
    const bill = await repo.getById('tA', 'b1');
    return bill!.toJSON();
  }

  it('reads period_start/period_end as CALENDAR days, in any timezone', async () => {
    // The contract, asserted without depending on the host zone (process.env.TZ cannot be changed once jest resolved
    // its environment — TENANT-6b-1's finding): a Date carrying local Y-M-D must map to those components even when
    // toISOString/toString are lying. `toISOString().slice(0,10)` — the line this replaces — was a day early in every
    // zone ahead of UTC, i.e. in the launch market.
    const d = new Date(2026, 6, 1);
    Object.defineProperty(d, 'toISOString', { value: () => '1999-01-01T00:00:00.000Z' });
    Object.defineProperty(d, 'toString', { value: () => 'Xxx Xxx 99 1999' });
    const out = await read(row({ period_start: d }));
    expect(out.periodStart).toBe('2026-07-01');
    expect(out.periodEnd).toBe('2026-07-15');
  });

  it('reads total_litres exactly, at the scale 0157 widened the column to', async () => {
    const out = await read(row({ total_litres: '204.526' }));
    expect(out.totalLitres).toBe('204.526');
    // The old mapper was BigInt(Math.round(Number(total_litres) * 1000)) against a numeric(10,2) column, so the bill's
    // own litres could not equal the sum of the pours it settled — on the first number a member checks.
  });

  it('carries the cycle through the mapper and the INSERT', async () => {
    const out = await read(row());
    expect(out.cycleId).toBe('cyc1');
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const bill = MilkBill.generate({ id: 'b1', tenantId: 'tA', membershipId: 'mem1', cycleId: 'cyc1', periodStart: '2026-07-01', periodEnd: '2026-07-15', totalLitresMilli: 204_526n, grossMinor: 84_400n });
    await new MilkBillRepository(fakeReplica().provider).insert(tx as never, bill);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO milk_bills \(id, tenant_id, membership_id, cycle_id,/);
    expect(params[3]).toBe('cyc1');
    expect(params[6]).toBe('204.526');              // written at the column's scale, never Number(x)/1000
  });

  it('a bill generated outside any cycle is NULL, not a guess', async () => {
    const out = await read(row({ cycle_id: null }));
    expect(out.cycleId).toBeNull();
  });

  it('the mapper does not reach for an INSTANT anywhere in the file', async () => {
    // [MUTATION GAP] The TZ-independent assertion above stubs `toISOString` on the Date it is handed — and a mutant
    // that writes `new Date(r.period_start).toISOString()` constructs a FRESH Date, sidesteps the stub, and survives on
    // any UTC runner (which is every CI box). `process.env.TZ` cannot be changed once jest has resolved its
    // environment, so no value-level assertion can catch it. A source-level guard can: in a file whose entire job is
    // mapping `date` columns, an instant conversion is always the defect. Comments are stripped so the file may keep
    // saying the word.
    const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const rel of ['repositories/milk-bill.repository.ts', 'repositories/dairy-bill-cycle.repository.ts']) {
      expect(code(rel)).not.toMatch(/toISOString/);
      expect(code(rel)).toMatch(/pgDate\(/);
    }
  });

  it('listFor filters on cycle_id, not on the period pair', async () => {
    const { provider, exec } = fakeReplica();
    await new MilkBillRepository(provider).listFor('tA', { cycleId: 'cyc1', limit: 50 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/cycle_id=\$2/);
    expect(params).toEqual(['tA', 'cyc1', 50]);
    // Two cycles of different length can share a boundary, and a member who moved from weekly to fortnightly
    // mid-month would appear in both if this filtered on (period_start, period_end).
    expect(sql).not.toMatch(/period_start=/);
  });
});
