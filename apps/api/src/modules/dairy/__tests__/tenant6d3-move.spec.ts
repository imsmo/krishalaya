// modules/dairy/__tests__/tenant6d3-move.spec.ts · PC-56 TENANT-6d-3 · W171's move — unit.
//
// *"Moving house? The membership moves centres without losing history — the member_code changes, the person's record
// never resets."*
//
// The move is four lines of code. THE PROMISE is the wave, so most of these tests are about the reads that would have
// started lying the moment a membership could move, and about the two ways a route history stops being able to answer
// its own question: an overlap, and a period that contradicts a printed slip.
import {
  assertDay, billCentres, billSpansCentres, daysBetween, earliestEffectiveFrom, moveRows, moveVerdict, nextDay,
  preferenceSurvivesMove, preferenceVersioning, previousDay, routeAsOf, routeGaps, routeTrail,
} from '../domain/dairy-membership-move';
import { DairyMembership } from '../domain/dairy-membership.entity';
import { DairyEventType } from '../domain/dairy.events';
import { DairyMembershipMoveService } from '../services/dairy-membership-move.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyCounterRepository } from '../repositories/dairy-counter.repository';
import { DairyQualityRepository } from '../repositories/dairy-quality.repository';
import { DairyCycleConsoleRepository } from '../repositories/dairy-cycle-console.repository';
import { MembershipMoveRefusedError, DairyForbiddenError, MembershipNotFoundError } from '../domain/dairy.errors';
import { MccController } from '../controllers/v1/mcc.controller';
import { PATH_METADATA } from '@nestjs/common/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MIG = fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0164_dairy_membership_routes.sql'), 'utf8');

const R = (mccId: string, memberCode: string, validFrom: string, validTo: string | null = null) =>
  ({ mccId, memberCode, validFrom, validTo });

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · whole days, because a pour is dated and a card is handed over in the morning', () => {
  it('refuses a day that is not one', () => {
    expect(assertDay('2026-08-21')).toBe('2026-08-21');
    expect(() => assertDay('2026-02-30')).toThrow(/no such calendar day/);
    expect(() => assertDay('21-08-2026')).toThrow(/not a calendar day/);
    expect(() => assertDay('2026-13-01')).toThrow();
  });

  it('steps a day across a month, a year and a leap February', () => {
    expect(nextDay('2026-08-31')).toBe('2026-09-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(daysBetween('2026-08-01', '2026-08-21')).toBe(20);
    expect(daysBetween('2026-08-21', '2026-08-01')).toBe(-20);
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · which centre and which card, on a day', () => {
  const routes = [R('c1', 'AND1-0019', '2025-04-01', '2026-06-13'), R('c2', 'AND2-0104', '2026-06-14')];

  it('answers the day of the move as the NEW route, and the day before as the old one', () => {
    // Inclusive at both ends, matching 0164's `daterange(…, '[]')`. A half-open convention here and an inclusive one
    // in the constraint would leave one day a year attributable to two centres.
    expect(routeAsOf(routes, '2026-06-13')).toMatchObject({ mccId: 'c1', memberCode: 'AND1-0019' });
    expect(routeAsOf(routes, '2026-06-14')).toMatchObject({ mccId: 'c2', memberCode: 'AND2-0104' });
    expect(routeAsOf(routes, '2026-08-21')).toMatchObject({ mccId: 'c2' });
  });

  it('answers NOTHING for a day before the record begins, rather than the earliest route', () => {
    // A back-dated pour predates the history. Attributing it to the first route would invent a fact about where a
    // member was standing, which is the whole class of error this wave exists to remove.
    expect(routeAsOf(routes, '2025-03-31')).toBeNull();
  });

  it('resolves an OVERLAP to the later period, deterministically', () => {
    // 0164's exclusion constraint forbids overlaps, so this cannot arise through the service — which is exactly why the
    // function must still be deterministic: a row that got there another way must not make the answer depend on the
    // order the rows came back in.
    const overlapping = [R('c1', 'A', '2026-01-01', '2026-06-30'), R('c2', 'B', '2026-06-01', '2026-12-31')];
    expect(routeAsOf(overlapping, '2026-06-15')).toMatchObject({ mccId: 'c2' });
    expect(routeAsOf([...overlapping].reverse(), '2026-06-15')).toMatchObject({ mccId: 'c2' });
  });

  it('sorts a trail oldest first and reports a GAP without filling it', () => {
    expect(routeTrail([routes[1], routes[0]]).map((r) => r.mccId)).toEqual(['c1', 'c2']);
    expect(routeGaps(routes)).toEqual([]);
    // A membership dormant between two centres is a real state; the database permits it and the screen must say
    // "not recorded" rather than choose the nearer neighbour.
    const withGap = [R('c1', 'A', '2025-04-01', '2026-05-31'), R('c2', 'B', '2026-06-14')];
    expect(routeGaps(withGap)).toEqual([{ after: '2026-05-31', before: '2026-06-14' }]);
    expect(routeAsOf(withGap, '2026-06-05')).toBeNull();
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · what refuses a move, and from when it could happen', () => {
  const base = {
    flagOn: true, canManage: true, membershipActive: true,
    current: R('c1', 'AND1-0019', '2025-04-01'),
    toMccId: 'c2', destinationActive: true,
    newMemberCode: 'AND2-0104', codeTakenNow: false, codeHeldInPeriod: false,
    effectiveFrom: '2026-08-21', lastPourAtCurrent: null,
    openCycleCovers: false, unbilledAtCurrent: 0, liveDebts: 0,
  };

  it('refuses in the order nobody-can → you-cannot → not-this → not-yet', () => {
    expect(moveVerdict({ ...base, flagOn: false, canManage: false }).refusal).toBe('FLAG_OFF');
    expect(moveVerdict({ ...base, canManage: false, membershipActive: false }).refusal).toBe('NO_MANAGE');
    expect(moveVerdict({ ...base, membershipActive: false }).refusal).toBe('MEMBERSHIP_INACTIVE');
    expect(moveVerdict({ ...base, current: null }).refusal).toBe('NO_CURRENT_ROUTE');
    expect(moveVerdict({ ...base, toMccId: 'c1' }).refusal).toBe('SAME_CENTRE');
    expect(moveVerdict({ ...base, destinationActive: false }).refusal).toBe('CENTRE_INACTIVE');
    expect(moveVerdict({ ...base, codeTakenNow: true }).refusal).toBe('CODE_TAKEN');
    expect(moveVerdict({ ...base, codeHeldInPeriod: true }).refusal).toBe('CODE_HELD_AT_DESTINATION');
  });

  it('REFUSES A DATE THE SLIP CONTRADICTS, and says the earliest one that does not', () => {
    // She poured at the old centre this morning. A move effective today would make the route say Bhesan on a day the
    // printed slip says Vanthali.
    const v = moveVerdict({ ...base, lastPourAtCurrent: '2026-08-21' });
    expect(v.refusal).toBe('BEFORE_LAST_POUR');
    expect(v.earliestFrom).toBe('2026-08-22');
    // …and tomorrow is fine.
    expect(moveVerdict({ ...base, lastPourAtCurrent: '2026-08-21', effectiveFrom: '2026-08-22' }).can).toBe(true);
  });

  it('refuses a date before the current route even started', () => {
    expect(moveVerdict({ ...base, effectiveFrom: '2025-03-31' }).refusal).toBe('BEFORE_ROUTE_START');
  });

  it('carries the earliest possible date on EVERY verdict, including an allowed one', () => {
    // "You cannot move her today, you can from tomorrow" is the only useful form of this answer at a counter.
    expect(moveVerdict(base).earliestFrom).toBe('2025-04-01');
    expect(moveVerdict({ ...base, codeTakenNow: true }).earliestFrom).toBe('2025-04-01');
    expect(moveVerdict({ ...base, current: null }).earliestFrom).toBeNull();
  });

  it('allows the move with the caution that costs most to get wrong FIRST', () => {
    expect(moveVerdict({ ...base, openCycleCovers: true, unbilledAtCurrent: 3, liveDebts: 2 }).caution).toBe('SPLITS_OPEN_CYCLE');
    expect(moveVerdict({ ...base, unbilledAtCurrent: 3, liveDebts: 2 }).caution).toBe('UNBILLED_POURS_AT_OLD_CENTRE');
    // A debt follows the person, not the village. Saying so out loud stops somebody assuming a move clears it.
    expect(moveVerdict({ ...base, liveDebts: 2 }).caution).toBe('DEBT_FOLLOWS_MEMBER');
    expect(moveVerdict(base)).toMatchObject({ can: true, refusal: null, caution: null });
  });

  it('computes the earliest date from the pour, never from the clock', () => {
    expect(earliestEffectiveFrom(R('c1', 'A', '2025-04-01'), null)).toBe('2025-04-01');
    expect(earliestEffectiveFrom(R('c1', 'A', '2025-04-01'), '2026-08-21')).toBe('2026-08-22');
    // A pour BEFORE the route started (a back-dated slip) must not drag the earliest date backwards.
    expect(earliestEffectiveFrom(R('c1', 'A', '2026-01-01'), '2025-12-01')).toBe('2026-01-01');
    expect(earliestEffectiveFrom(null, '2026-08-21')).toBeNull();
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · the two rows a move writes', () => {
  it('closes the old period the DAY BEFORE and opens the new one on the day of the move', () => {
    const rows = moveRows(R('c1', 'AND1-0019', '2025-04-01'), 'c2', 'AND2-0104', '2026-06-14');
    // This one subtraction is what makes 0164's inclusive exclusion constraint hold.
    expect(rows.close).toEqual({ validTo: '2026-06-13' });
    expect(rows.open).toEqual({ mccId: 'c2', memberCode: 'AND2-0104', validFrom: '2026-06-14' });
  });

  it('refuses to close a period before it started', () => {
    expect(() => moveRows(R('c1', 'A', '2026-06-14'), 'c2', 'B', '2026-06-14')).toThrow(/before it started/);
  });

  it('lets a move happen the day AFTER a route opened, leaving a one-day period behind', () => {
    // A member who arrives and moves the next day is unusual and legal; the old period is one day long and the
    // register can still say where the pour happened.
    const rows = moveRows(R('c1', 'A', '2026-06-14'), 'c2', 'B', '2026-06-15');
    expect(rows.close.validTo).toBe('2026-06-14');
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · the aggregate keeps the person and changes the card', () => {
  const props = {
    id: 'm1', tenantId: 't1', farmerUserId: 'u9', mccId: 'c1', memberCode: 'AND1-0019',
    paymentCycle: 'weekly' as const, defaultAnimalType: 'buffalo' as const, isActive: true,
  };

  it('moves the same ROW, keeps the person and the preference, and announces both cards', () => {
    const m = DairyMembership.rehydrate({ ...props });
    m.moveTo('c2', 'AND2-0104', '2026-06-14');
    const p = m.toProps();
    // "The person's record never resets": same membership id, same farmer, same payment preference.
    expect(p).toMatchObject({ id: 'm1', farmerUserId: 'u9', paymentCycle: 'weekly', mccId: 'c2', memberCode: 'AND2-0104' });
    expect(m.pullEvents()[0]).toMatchObject({
      type: DairyEventType.MembershipMoved,
      payload: {
        membershipId: 'm1', farmerUserId: 'u9',
        fromMccId: 'c1', toMccId: 'c2', fromMemberCode: 'AND1-0019', toMemberCode: 'AND2-0104',
        effectiveFrom: '2026-06-14',
      },
    });
  });

  it('refuses a move to the same centre and a move with no card', () => {
    const m = DairyMembership.rehydrate({ ...props });
    expect(() => m.moveTo('c1', 'AND1-0020', '2026-06-14')).toThrow(/already routed/);
    expect(() => m.moveTo('c2', '   ', '2026-06-14')).toThrow(/needs the card/);
  });

  it('keeps the payment preference across a move, explicitly', () => {
    expect(preferenceSurvivesMove('monthly')).toBe('monthly');
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · a bill\'s centre comes from its own pours', () => {
  it('names the biggest first, and both when the member moved mid-fortnight', () => {
    const cs = billCentres([{ mccId: 'c2', code: 'MCC-AND-02', pours: 5 }, { mccId: 'c1', code: 'MCC-AND-01', pours: 9 }]);
    expect(cs.map((c) => c.code)).toEqual(['MCC-AND-01', 'MCC-AND-02']);
    expect(billSpansCentres(cs)).toBe(true);
  });

  it('breaks a tie by code, so the register does not reorder itself between page loads', () => {
    const cs = billCentres([{ mccId: 'c2', code: 'MCC-AND-02', pours: 7 }, { mccId: 'c1', code: 'MCC-AND-01', pours: 7 }]);
    expect(cs.map((c) => c.code)).toEqual(['MCC-AND-01', 'MCC-AND-02']);
  });

  it('has NO centre for a bill with no collections, and does not borrow one', () => {
    expect(billCentres([])).toEqual([]);
    expect(billSpansCentres([])).toBe(false);
    expect(billSpansCentres(billCentres([{ mccId: 'c1', code: 'A', pours: 1 }]))).toBe(false);
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · the repaired reads say so in their SQL', () => {
  function spy(rows: unknown[] = []) {
    const sql: string[] = [];
    const x = { query: jest.fn(async (q: string) => { sql.push(q); return { rows, rowCount: rows.length }; }) };
    return { x, sql, last: () => sql[sql.length - 1] };
  }

  it('the COUNTER ROLL is counted from the route history, bounded by the board\'s own day', async () => {
    const { x, last } = spy();
    await new DairyCounterRepository({ forTenant: () => x } as never).centreShiftRows('t1', '2026-07-13', 'morning');
    expect(last()).toContain('FROM dairy_membership_routes r');
    expect(last()).toContain('r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to >= $2::date)');
  });

  it('the QUALITY DESK resolves the card AS OF the pour, and reports when it could not', async () => {
    const { x, last } = spy([{ asof_code: 'AND2-0087', member_code: 'AND3-0104', mcc_code: 'MCC-AND-02' }]);
    const repo = new DairyQualityRepository({ forTenant: () => x } as never);
    const ctx = await repo.reviewContext('t1', 'm1', 'c2', '2026-06-10');
    expect(last()).toContain('dairy_route_asof($1, $2, $4::date)');
    // The card that was carried, not today's.
    expect(ctx).toEqual({ memberCode: 'AND2-0087', mccCode: 'MCC-AND-02', codeIsCurrent: false });

    const { x: x2 } = spy([{ asof_code: null, member_code: 'AND3-0104', mcc_code: 'MCC-AND-02' }]);
    const fallback = await new DairyQualityRepository({ forTenant: () => x2 } as never).reviewContext('t1', 'm1', 'c2', '2020-01-01');
    // The history does not reach that day. The current card is shown AND flagged as current, because an identifier an
    // operator cannot match to the slip in their hand must not look authoritative.
    expect(fallback).toEqual({ memberCode: 'AND3-0104', mccCode: 'MCC-AND-02', codeIsCurrent: true });
  });

  it('the REGISTER reads the bill\'s OWN pours, bounded to the bill and to its window', async () => {
    const { x, last } = spy();
    await new DairyCycleConsoleRepository({ forTenant: () => x } as never).bills('t1', 'cy1', { limit: 10 });
    const sql = last();
    // The centres come from the collections, not from the membership's current route.
    expect(sql).toContain('FROM milk_collections c');
    expect(sql).toContain('JOIN mcc_centres cc ON cc.id = c.mcc_id');
    // BOTH window bounds, so partitions are pruned AND a neighbouring cycle's pours cannot leak in…
    expect(sql).toContain('AND c.collected_on >= b.period_start AND c.collected_on <= b.period_end');
    // …and the bill's own milk, exactly.
    expect(sql).toContain('AND c.milk_bill_id = b.id');
    // The card AS OF the day this fortnight closed, with the fallback REPORTED rather than hidden.
    expect(sql).toContain('dairy_route_asof(b.tenant_id, b.membership_id, b.period_end)');
    expect(sql).toContain('coalesce(asof.member_code, m.member_code) AS member_code');
    expect(sql).toContain('(asof.member_code IS NULL) AS member_code_is_current');
    // …and it must not have gone back to the membership's current centre.
    expect(sql).not.toContain('LEFT JOIN mcc_centres mc ON mc.id = m.mcc_id');
  });

  it('lets a member RETURN to a village and carry their old card again', async () => {
    const { x, last } = spy();
    const repo = new DairyMembershipRouteRepository({ forTenant: () => x } as never);
    await repo.codeHeldInPeriod(x as never, 't1', 'c1', 'AND1-0019', '2026-08-21', 'm1');
    // The check excludes the membership's OWN history: a member coming back to Vanthali may legitimately be handed the
    // card they had, and refusing that would be the platform inventing a rule the cooperative never made.
    expect(last()).toContain('membership_id <> $5');
  });

  it('the ROUTE reads go through 0164\'s function and order newest-last for a trail', async () => {
    const { x, sql } = spy();
    const repo = new DairyMembershipRouteRepository({ forTenant: () => x } as never);
    await repo.asOf(x as never, 't1', 'm1', '2026-06-14');
    expect(sql[0]).toContain('dairy_route_asof($1, $2, $3::date)');
    await repo.trail(x as never, 't1', 'm1', 50);
    // A trail is a story: oldest first.
    expect(sql[1]).toContain('ORDER BY valid_from, id LIMIT $3');
    await repo.rollAsOf(x as never, 't1', '2026-07-13');
    expect(sql[2]).toContain('GROUP BY r.mcc_id');
  });

  it('is FAIL-CLOSED on closing a route period and on moving a membership\'s card', async () => {
    const zero = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    // A silent no-op here leaves the old period open, the exclusion constraint then refuses the new one, and the
    // visible symptom is that this member can never be moved again.
    await expect(new DairyMembershipRouteRepository({} as never).close(zero as never, 't1', 'r1', '2026-06-13', 'desk'))
      .rejects.toThrow(/could not be closed/);
    const m = DairyMembership.rehydrate({
      id: 'm1', tenantId: 't1', farmerUserId: 'u9', mccId: 'c2', memberCode: 'AND2-0104',
      paymentCycle: 'weekly', defaultAnimalType: null, isActive: true,
    });
    await expect(new DairyMembershipRepository({} as never).updateRoute(zero as never, m, 'desk'))
      .rejects.toThrow(/matched no row/);
  });

  it('writes ONLY the route and the card — a move cannot change a preference or a farmer', async () => {
    const cap: string[] = [];
    const tx = { query: jest.fn(async (q: string) => { cap.push(q); return { rows: [], rowCount: 1 }; }) };
    const m = DairyMembership.rehydrate({
      id: 'm1', tenantId: 't1', farmerUserId: 'u9', mccId: 'c2', memberCode: 'AND2-0104',
      paymentCycle: 'weekly', defaultAnimalType: null, isActive: true,
    });
    await new DairyMembershipRepository({} as never).updateRoute(tx as never, m, 'desk');
    expect(cap[0]).toContain('SET mcc_id=$3, member_code=$4');
    for (const col of ['payment_cycle', 'farmer_user_id', 'is_active']) expect(cap[0]).not.toContain(`${col}=`);
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · the service, and one decision function for the button and the act', () => {
  function harness(over: Record<string, unknown> = {}) {
    const membership = DairyMembership.rehydrate({
      id: 'm1', tenantId: 't1', farmerUserId: 'u9', mccId: 'c1', memberCode: 'AND1-0019',
      paymentCycle: 'weekly', defaultAnimalType: null, isActive: true,
    });
    const memberships = {
      getForUpdate: jest.fn().mockResolvedValue(membership),
      getById: jest.fn().mockResolvedValue(membership),
      codeTakenAt: jest.fn().mockResolvedValue(false),
      updateRoute: jest.fn().mockResolvedValue(undefined),
    };
    const routes = {
      current: jest.fn().mockResolvedValue({ id: 'r1', mccId: 'c1', memberCode: 'AND1-0019', validFrom: '2025-04-01', validTo: null }),
      close: jest.fn().mockResolvedValue(undefined),
      open: jest.fn().mockResolvedValue({ id: 'r2' }),
      codeHeldInPeriod: jest.fn().mockResolvedValue(false),
      trail: jest.fn().mockResolvedValue([]),
    };
    const centres = { getById: jest.fn().mockResolvedValue({ toProps: () => ({ isActive: true }) }) };
    const collections = { lastPourDayAt: jest.fn().mockResolvedValue(null), unbilledPoursAt: jest.fn().mockResolvedValue(0) };
    const cycles = { findCoveringDay: jest.fn().mockResolvedValue(null) };
    const instructions = { countActiveFor: jest.fn().mockResolvedValue(0) };
    // A DATE THAT IS DELIBERATELY NOT TODAY. Asserting the process clock's own date would pass by coincidence on the
    // day the test was written and fail the next morning — and would not distinguish the two sources at all.
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn(async () => ({ rows: [{ d: '2025-06-11' }] })) })) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => fn()) };
    const flags = { isEnabled: jest.fn().mockResolvedValue(true) };
    Object.assign(memberships, over.memberships ?? {});
    Object.assign(routes, over.routes ?? {});
    Object.assign(collections, over.collections ?? {});
    Object.assign(flags, over.flags ?? {});
    const svc = new DairyMembershipMoveService(uow as never, { write: jest.fn() } as never, idem as never,
      { inc: jest.fn(), observe: jest.fn() } as never, { write: jest.fn() } as never, flags as never,
      memberships as never, routes as never, centres as never, collections as never, cycles as never, instructions as never);
    return { svc, memberships, routes, collections, flags, membership };
  }
  const desk = { userId: 'desk', canManage: true } as never;
  const input = { toMccId: 'c2', newMemberCode: 'AND2-0104' };

  it('closes and opens at ONE boundary, and moves the membership\'s own row', async () => {
    const h = harness();
    await h.svc.move('t1', desk, 'k1', 'm1', { ...input, effectiveFrom: '2026-06-14', reason: 'moved to Bhesan' }, null);
    expect(h.routes.close).toHaveBeenCalledWith(expect.anything(), 't1', 'r1', '2026-06-13', 'desk');
    expect((h.routes.open.mock.calls[0][1] as { validFrom: string }).validFrom).toBe('2026-06-14');
    expect((h.routes.open.mock.calls[0][1] as { reason: string }).reason).toBe('moved to Bhesan');
    expect(h.memberships.updateRoute).toHaveBeenCalledTimes(1);
    expect(h.membership.toProps()).toMatchObject({ mccId: 'c2', memberCode: 'AND2-0104' });
  });

  it('defaults the effective day to the DATABASE\'s today, never the process clock', async () => {
    const h = harness();
    const r: any = await h.svc.move('t1', desk, 'k1', 'm1', input, null);
    expect(r.effectiveFrom).toBe('2025-06-11');
    expect((h.routes.open.mock.calls[0][1] as { validFrom: string }).validFrom).toBe('2025-06-11');
    // …and it is not the process's own idea of today.
    expect(r.effectiveFrom).not.toBe(new Date().toISOString().slice(0, 10));
  });

  it('refuses the ACT with exactly the verdict the button would have shown', async () => {
    const h = harness({ collections: { lastPourDayAt: jest.fn().mockResolvedValue('2026-08-21') } });
    const preview = await h.svc.preview('t1', desk, 'm1', input);
    expect(preview).toMatchObject({ can: false, refusal: 'BEFORE_LAST_POUR', earliestFrom: '2026-08-22' });
    await expect(h.svc.move('t1', desk, 'k1', 'm1', input, null)).rejects.toBeInstanceOf(MembershipMoveRefusedError);
    // Nothing was written on the refusal.
    expect(h.routes.close).not.toHaveBeenCalled();
    expect(h.memberships.updateRoute).not.toHaveBeenCalled();
  });

  it('refuses the move when the flag is off for this tenant, before touching anything', async () => {
    const h = harness({ flags: { isEnabled: jest.fn().mockResolvedValue(false) } });
    await expect(h.svc.move('t1', desk, 'k1', 'm1', input, null)).rejects.toMatchObject({ details: { refusal: 'FLAG_OFF' } });
    expect(h.routes.open).not.toHaveBeenCalled();
  });

  it('refuses every path without the dairy desk', async () => {
    const h = harness();
    const nope = { userId: 'x', canManage: false } as never;
    await expect(h.svc.move('t1', nope, 'k', 'm1', input, null)).rejects.toBeInstanceOf(DairyForbiddenError);
    await expect(h.svc.preview('t1', nope, 'm1', input)).rejects.toBeInstanceOf(DairyForbiddenError);
    expect(h.memberships.getForUpdate).not.toHaveBeenCalled();
  });

  it('lets a MEMBER read their own trail and nobody else\'s', async () => {
    const h = harness();
    await expect(h.svc.trail('t1', { userId: 'u9', canManage: false } as never, 'm1', 50)).resolves.toEqual([]);
    // A 404, not a 403: a membership id must not be probeable.
    await expect(h.svc.trail('t1', { userId: 'stranger', canManage: false } as never, 'm1', 50))
      .rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  it('treats an EMPTY card as taken, so a blank field is a refusal and not an insert', async () => {
    const h = harness();
    const v = await h.svc.preview('t1', desk, 'm1', { toMccId: 'c2', newMemberCode: '   ' });
    expect(v.refusal).toBe('CODE_TAKEN');
    expect(h.memberships.codeTakenAt).not.toHaveBeenCalled();
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · ENROLMENT opens a membership\'s first route period', () => {
  /**
   * [LIVE FINDING] Migration 0164 backfilled a route for every membership that existed when it ran, and the move
   * writes every one after that — and NOTHING wrote the FIRST route of a membership enrolled afterwards. Every new
   * membership would have had no route at all, so every as-of read (the register's card, the quality desk's card, the
   * counter board's roll) would have found nothing and fallen back to today's values or to zero.
   *
   * A history table is only a history if the thing that CREATES the record writes to it. The migration could not show
   * this; the first live test that enrolled somebody did, immediately.
   */
  it('writes the route in the same transaction as the membership, on the DATABASE\'s today', async () => {
    const routes = { open: jest.fn().mockResolvedValue({ id: 'r1' }) };
    const repo = { insert: jest.fn().mockResolvedValue(undefined) };
    const mccs = { getById: jest.fn().mockResolvedValue({ id: 'c1' }) };
    const tx = { query: jest.fn(async () => ({ rows: [{ d: '2025-06-11' }] })) };
    const uow = { run: jest.fn(async (_t: string, fn: (t: unknown) => unknown) => fn(tx)) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => fn()) };
    const svc = new DairyMembershipService(uow as never, { write: jest.fn() } as never, idem as never,
      { inc: jest.fn(), observe: jest.fn() } as never, repo as never, mccs as never, routes as never);

    await svc.create('t1', { userId: 'desk', canManage: true } as never, 'k1', {
      farmerUserId: 'u9', mccId: 'c1', memberCode: 'AND1-0019', paymentCycle: 'weekly',
    } as never);

    expect(routes.open).toHaveBeenCalledTimes(1);
    expect(routes.open.mock.calls[0][1]).toMatchObject({
      tenantId: 't1', mccId: 'c1', memberCode: 'AND1-0019', validFrom: '2025-06-11', movedBy: 'desk',
    });
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · the route order trap, for the fourth time', () => {
  it('declares both literal `memberships/:id/...` routes before `memberships/:id`', () => {
    const proto = MccController.prototype as unknown as Record<string, unknown>;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((k) => k !== 'constructor' && typeof Reflect.getMetadata(PATH_METADATA, proto[k] as object) === 'string')
      .map((k) => Reflect.getMetadata(PATH_METADATA, proto[k] as object) as string);
    const at = (p: string) => paths.indexOf(p);
    expect(at('memberships/:id/move')).toBeGreaterThanOrEqual(0);
    expect(at('memberships/:id/route')).toBeGreaterThanOrEqual(0);
    expect(at('memberships/:id')).toBeGreaterThanOrEqual(0);
    expect(at('memberships/:id/move')).toBeLessThan(at('memberships/:id'));
    expect(at('memberships/:id/route')).toBeLessThan(at('memberships/:id'));
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-3 · what migration 0164 promises in writing', () => {
  it('keeps ONE current route per membership and forbids two claiming the same day', () => {
    expect(MIG).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_dairy_route_current[\s\S]*?WHERE valid_to IS NULL AND deleted_at IS NULL/);
    // The partial index stops two OPEN rows; the exclusion constraint stops the subtler corruption — a CLOSED row
    // overlapping the next — which is what makes "where was this member on 14 June" a question with one answer.
    expect(MIG).toContain('ADD CONSTRAINT ex_dairy_route_no_overlap EXCLUDE USING gist (');
    // INCLUSIVE at both ends, in BOTH constraints. A half-open range in one of them and an inclusive one in the
    // as-of function would leave the boundary day — the day of a move — claimed twice or by nobody.
    expect(MIG.match(/daterange\(valid_from, valid_to, '\[\]'\) WITH &&/g) ?? []).toHaveLength(2);
    expect(MIG).not.toContain("daterange(valid_from, valid_to, '[)')");
  });

  it('forbids one card at one counter twice over, in history as well as now', () => {
    expect(MIG).toContain('ADD CONSTRAINT ex_dairy_route_card_once EXCLUDE USING gist (');
    expect(MIG).toContain('    member_code WITH =,');
  });

  it('makes the route history append-only except for its closing date', () => {
    expect(MIG).toContain('GRANT UPDATE (valid_to, updated_at, updated_by) ON dairy_membership_routes TO kv_app;');
    expect(MIG).toContain('REVOKE UPDATE, DELETE ON dairy_membership_routes FROM kv_app;');
    expect(MIG).toContain('REVOKE ALL ON dairy_membership_routes FROM kv_relay;');
  });

  it('answers the as-of question with ONE inclusive boundary rule, as a function', () => {
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION dairy_route_asof(p_tenant uuid, p_membership uuid, p_on date)');
    expect(MIG).toContain('AND (r.valid_to IS NULL OR r.valid_to >= p_on)');
    // The LATEST covering period, so a row that reached the table another way cannot make the answer arbitrary.
    expect(MIG).toContain('ORDER BY r.valid_from DESC');
    expect(MIG).toContain('LANGUAGE sql STABLE');
  });

  it('backfills exactly one open route per membership, and says what it does not know', () => {
    const insert = MIG.slice(MIG.indexOf('INSERT INTO dairy_membership_routes (tenant_id'));
    const stmt = insert.slice(0, insert.indexOf(';'));
    expect(stmt).toContain('m.created_at::date');
    expect(stmt).toContain('NOT EXISTS (SELECT 1 FROM dairy_membership_routes r');
    // The reason is part of the record: no future reader should mistake the backfill for evidence.
    expect(stmt).toContain('opened by migration 0164');
  });

  it('ships the move OFF, and says the repaired reads do not depend on the flag', () => {
    expect(MIG).toMatch(/'dairy_membership_transfer'[\s\S]*?false, 100, 'experiment'/);
    expect(MIG).toContain('The three repaired READS do not depend on this flag');
  });

  it('names what it refuses: no centre column on a bill, no versioned preference, no cross-tenant move', () => {
    expect(MIG).toContain('It does not stamp a centre onto `milk_bills`');
    expect(MIG).toContain('It does not touch `default_animal_type` or `payment_cycle`');
    expect(MIG).toContain('No transfer of a membership between TENANTS');
  });

  it('names the preference as unversioned in code as well as in the migration', () => {
    const v = preferenceVersioning();
    expect(v.versioned).toBe(false);
    expect(v.affects.some((a) => a.includes('membershipsToBillForCycle'))).toBe(true);
  });
});
