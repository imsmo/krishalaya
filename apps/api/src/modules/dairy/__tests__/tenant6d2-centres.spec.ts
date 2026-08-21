// modules/dairy/__tests__/tenant6d2-centres.spec.ts · PC-56 TENANT-6d-2 · W171 (MCC centres) — unit.
//
// WHAT THESE TESTS ARE FOR, in the order the wave found the defects:
//
//   1. **the hours TENANT-6a refused to invent** — and the refusal itself, which must survive as a CONDITION rather
//      than as a constant, because a screen that keeps refusing after the thing was built is the same defect as one
//      that claims something untrue;
//   2. **custody is a record, not a column** — including the two states that exist only because the column came first:
//      an operator the platform cannot verify, and a column that disagrees with the register;
//   3. **the footer's tick is earned** — summed rows against an independently counted total;
//   4. **a preference is honoured or pending** — never "honoured" over a cadence no cycle has opened for;
//   5. **the operator is no longer defaulted to whoever created the centre**, and cannot be somebody from another
//      cooperative;
//   6. **flags compose** — a route's flag must not cancel its controller's, which is where the dairy module's
//      kill-switch had been failing since the cycle preview shipped.
import {
  centreTank, custodyDays, custodyVerdict, hhmm, minutesOfDay, preferenceMix, preferencesHonoured, reconcile,
  shiftOpenState, shiftWindows, tankNeedsAttention,
} from '../domain/mcc-console';
import { shiftClockVerdict } from '../domain/dairy-counter';
import { MccCentre } from '../domain/mcc-centre.entity';
import { DairyEventType } from '../domain/dairy.events';
import { MccCentreService } from '../services/mcc-centre.service';
import { MccOperatorNotInTenantError, MccCentreInvalidError, DairyForbiddenError } from '../domain/dairy.errors';
import { DairyCentresReadModel } from '../read-models/dairy-centres.read-model';
import { MccController } from '../controllers/v1/mcc.controller';
import { BmcController } from '../controllers/v1/bmc.controller';
import { DairyCounterController } from '../controllers/v1/dairy-counter.controller';
import { DairyQualityController } from '../controllers/v1/dairy-quality.controller';
import { FEATURE_FLAG_KEY } from '../../../core/feature-flags/flags.guard';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MccConsoleRepository } from '../repositories/mcc-console.repository';
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyCounterRepository } from '../repositories/dairy-counter.repository';
import { PATH_METADATA } from '@nestjs/common/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MIG = fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0163_dairy_centres_console.sql'), 'utf8');

const base = {
  id: 'c1', tenantId: 't1', code: 'MCC-AND-01', defaultName: 'Vanthali', regionId: null,
  lat: null, lng: null, operatorUserId: null, capacityLitresShift: '1200.00',
  analyzerModel: 'Lactoscan SP', analyzerSerial: 'LS-000412',
};

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · the hours a farmer walks to', () => {
  it('normalises a pg `time` to the HH:MM a screen prints, and refuses the seconds it could not print', () => {
    expect(hhmm('06:00:00')).toBe('06:00');
    expect(hhmm('17:30')).toBe('17:30');
    expect(hhmm(null)).toBeNull();
    // 0163's CHECK forbids seconds precisely so this can be a refusal rather than a silent rounding: a displayed
    // opening time thirty seconds earlier than the real one is the quiet inaccuracy this codebase does not ship.
    expect(() => hhmm('06:00:30')).toThrow(/seconds/);
    expect(() => hhmm('not a time')).toThrow(/wall-clock/);
  });

  it('reads a window only when BOTH ends are there — half a window is unrecorded, never repaired', () => {
    expect(shiftWindows({ morningOpensAt: '06:00', morningClosesAt: '09:00', eveningOpensAt: null, eveningClosesAt: null }))
      .toEqual({ morning: { opens: '06:00', closes: '09:00' }, evening: null });
    // A row that reached this code with one end missing bypassed `ck_mcc_shift_morning`; inventing the other end is
    // how a screen sends a farmer to a closed door.
    expect(shiftWindows({ morningOpensAt: '06:00', morningClosesAt: null, eveningOpensAt: null, eveningClosesAt: null }).morning).toBeNull();
  });

  it('opens on the opening minute and is shut ON the closing one', () => {
    const w = { opens: '06:00', closes: '09:00' };
    expect(shiftOpenState(w, '05:59')).toBe('before');
    expect(shiftOpenState(w, '06:00')).toBe('open');
    expect(shiftOpenState(w, '08:59')).toBe('open');
    // The boundary 0157 chose for a cycle's close, for the same reason: "09:00 counts as open" is the minute an
    // operator argues about with a farmer who arrived on time.
    expect(shiftOpenState(w, '09:00')).toBe('after');
    expect(shiftOpenState(null, '09:00')).toBe('not_recorded');
  });

  it('refuses a wall clock outside a day', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('23:59')).toBe(1439);
    expect(() => minutesOfDay('24:00')).toThrow(/out of range/);
    expect(() => minutesOfDay('06:60')).toThrow();
  });

  it('KEEPS TENANT-6a\'s refusal, and makes it conditional on the board', () => {
    expect(shiftClockVerdict('evening', [null, null])).toEqual({
      kind: 'not_recorded', missing: ['mcc_centres.evening_opens_at', 'mcc_centres.evening_closes_at'],
    });
    expect(shiftClockVerdict('evening', [{ opens: '17:00', closes: '20:00' }, { opens: '17:00', closes: '20:00' }]))
      .toEqual({ kind: 'recorded', opens: '17:00', closes: '20:00', centres: 2 });
    // Three villages, three evenings — no tenant-level hour, because a single one over centres that disagree is the
    // sentence TENANT-6a refused to print.
    expect(shiftClockVerdict('evening', [{ opens: '17:00', closes: '20:00' }, { opens: '17:30', closes: '20:30' }]).kind).toBe('mixed');
    expect(shiftClockVerdict('morning', [{ opens: '06:00', closes: '09:00' }, null]).kind).toBe('mixed');
  });

  it('the aggregate refuses half a window and one that wraps past midnight', () => {
    const c = MccCentre.create({ ...base });
    expect(() => c.setShiftWindow('evening', { opens: '20:00', closes: '17:00' })).toThrow(/closes at or before it opens/);
    expect(() => c.setShiftWindow('evening', { opens: '17:00', closes: '17:00' })).toThrow(/closes at or before it opens/);
    c.setShiftWindow('evening', { opens: '17:00', closes: '20:00' });
    expect(c.windows().evening).toEqual({ opens: '17:00', closes: '20:00' });
    // CLEARING IS LEGITIMATE and returns the counter board to TENANT-6a's honest refusal.
    c.setShiftWindow('evening', null);
    expect(c.windows().evening).toBeNull();
    expect(c.pullEvents().filter((e) => e.type === DairyEventType.MccShiftWindowsSet)).toHaveLength(2);
  });

  it('refuses half a window AT CREATE — the only path that can express one', () => {
    // `setShiftWindow` takes a whole window or null, so a half can only arrive through the constructor: a caller
    // sending `morningOpensAt` alone. The aggregate refuses it there for the same reason 0163's CHECK does — "opens
    // 06:00, closes unknown" reads as knowledge and answers nothing an operator needs.
    expect(() => MccCentre.create({ ...base, morningOpensAt: '06:00' } as never))
      .toThrow(/both an opening and a closing time/);
    expect(() => MccCentre.create({ ...base, eveningClosesAt: '20:00' } as never))
      .toThrow(/both an opening and a closing time/);
    // …and one that wraps past midnight.
    expect(() => MccCentre.create({ ...base, eveningOpensAt: '20:00', eveningClosesAt: '17:00' } as never))
      .toThrow(/closes at or before it opens/);
  });

  it('announces an hours change with its before and after — three systems derive from those times', () => {
    const c = MccCentre.create({ ...base, morningOpensAt: '06:00', morningClosesAt: '09:00' } as never);
    c.pullEvents();
    c.setShiftWindow('morning', { opens: '05:30', closes: '09:00' });
    const [e] = c.pullEvents();
    expect(e).toMatchObject({
      type: DairyEventType.MccShiftWindowsSet,
      payload: { shift: 'morning', before: { opens: '06:00', closes: '09:00' }, after: { opens: '05:30', closes: '09:00' } },
    });
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · custody of member milk', () => {
  it('names a holder only when the column and the open register row agree', () => {
    const at = new Date('2026-03-14T05:00:00Z');
    expect(custodyVerdict({ operatorUserId: 'u1' }, { operatorUserId: 'u1', assignedAt: at }))
      .toEqual({ state: 'held', operatorUserId: 'u1', since: at, columnUserId: 'u1' });
  });

  it('reports NOBODY when nobody holds it, which is a real state and not an error', () => {
    expect(custodyVerdict({ operatorUserId: null }, null))
      .toEqual({ state: 'nobody', operatorUserId: null, since: null, columnUserId: null });
  });

  it('reports UNRECORDED for a centre whose stored operator has no custody row', () => {
    // The pre-0163 world, and the rows 0163.3's backfill deliberately SKIPPED: an operator with no active role in the
    // cooperative gets no custody written, because writing it would be standing behind a stranger.
    expect(custodyVerdict({ operatorUserId: 'u9' }, null))
      .toEqual({ state: 'unrecorded', operatorUserId: 'u9', since: null, columnUserId: 'u9' });
  });

  it('reports DISAGREES and names NOBODY when the column and the register contradict each other', () => {
    const at = new Date('2026-03-14T05:00:00Z');
    const v = custodyVerdict({ operatorUserId: 'u1' }, { operatorUserId: 'u2', assignedAt: at });
    expect(v.state).toBe('disagrees');
    // Choosing one of two answers about who is answerable for 108 families' milk would hide the bug worth finding.
    expect(v.operatorUserId).toBeNull();
    expect(v.columnUserId).toBe('u1');
  });

  it('counts a tenure in whole days and never negative', () => {
    const since = new Date('2026-03-14T05:00:00Z');
    expect(custodyDays(since, new Date('2026-03-14T23:00:00Z'))).toBe(0);
    expect(custodyDays(since, new Date('2026-03-24T05:00:00Z'))).toBe(10);
    expect(custodyDays(since, new Date('2026-03-01T05:00:00Z'))).toBe(0);
    expect(custodyDays(null, new Date())).toBeNull();
  });

  it('refuses to re-assign the same person, which would split one tenure in two', () => {
    const c = MccCentre.create({ ...base, operatorUserId: 'u1' });
    expect(() => c.assignOperator('u1')).toThrow(/already holds/);
  });

  it('carries BOTH people in a handover event, and refuses to release what nobody holds', () => {
    const c = MccCentre.create({ ...base, operatorUserId: 'u1' });
    c.pullEvents();
    c.assignOperator('u2');
    expect(c.pullEvents()[0]).toMatchObject({
      type: DairyEventType.MccOperatorAssigned,
      // "Who was holding it yesterday" is the question a shortfall investigation opens with.
      payload: { operatorUserId: 'u2', releasedUserId: 'u1' },
    });
    c.releaseOperator();
    expect(c.pullEvents()[0]).toMatchObject({ type: DairyEventType.MccOperatorReleased, payload: { releasedUserId: 'u2' } });
    expect(() => c.releaseOperator()).toThrow(/no custody to release/);
  });

  it('does NOT expose the analyzer serial through the browse getter', () => {
    // `GET /dairy/mccs/:id` carries no permission. A device serial number identifies a specific analyzer in a specific
    // village, and putting it on an unpermissioned getter turns a browse route into an equipment inventory. The board
    // reads it behind `dairy.manage`, masked.
    const json = MccCentre.create({ ...base }).toJSON() as Record<string, unknown>;
    expect(json.analyzerSerial).toBeUndefined();
    expect(json.shiftWindows).toEqual({ morning: null, evening: null });
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · the tank, as a centre sees it', () => {
  const unit = { id: 'u1', minDeci: 0, targetDeci: 40, toleranceDeci: 5 };
  const now = new Date('2026-08-21T06:00:00Z');

  it('has no opinion when there is no cooler', () => {
    expect(centreTank(null, now, 15)).toEqual({ condition: 'no_unit', band: null, tempDeci: null, telemetry: null, unitId: null });
  });

  it('calls a warm tank warm, using TENANT-6d-1\'s band arithmetic and not a second rule', () => {
    const t = centreTank({ ...unit, lastTempDeci: 69, lastAt: new Date('2026-08-21T05:58:00Z') }, now, 15);
    expect(t.condition).toBe('above_band');
    expect(t.band).toEqual({ minDeci: 0, targetDeci: 40, maxDeci: 45 });
    expect(tankNeedsAttention(t)).toBe(true);
    // The canon's own boundary: 4.5 in a 4.0/0.5 band is IN range.
    expect(centreTank({ ...unit, lastTempDeci: 45, lastAt: new Date('2026-08-21T05:58:00Z') }, now, 15).condition).toBe('in_range');
  });

  it('NEVER reports a stale sensor as a temperature, and a stale tank needs no walk to the tank', () => {
    const t = centreTank({ ...unit, lastTempDeci: 69, lastAt: new Date('2026-08-21T05:00:00Z') }, now, 15);
    expect(t.condition).toBe('stale');
    expect(t.telemetry?.ageMinutes).toBe(60);
    // A gap is a connectivity problem. Sending somebody to a working cooler on a 60-minute-old number is the badge
    // rule TENANT-6d-1 set, kept here.
    expect(tankNeedsAttention(t)).toBe(false);
  });

  it('distinguishes a cooler that has never reported from one that is cold', () => {
    expect(centreTank({ ...unit, lastTempDeci: null, lastAt: null }, now, 15).condition).toBe('never');
    expect(centreTank({ ...unit, lastTempDeci: -5, lastAt: new Date('2026-08-21T05:58:00Z') }, now, 15).condition).toBe('below_min');
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · the footer\'s tick', () => {
  it('ticks only when the rows add up to the independently counted total', () => {
    expect(reconcile([108, 104, 100], 312)).toEqual({ centres: 3, shown: 312, total: 312, reconciles: true, unaccounted: 0 });
  });

  it('names the shortfall instead of shrinking the total', () => {
    // Deactivating a centre does not move its members anywhere, so those twelve are real people on a route this board
    // is not showing.
    expect(reconcile([108, 104, 88], 312)).toMatchObject({ shown: 300, total: 312, reconciles: false, unaccounted: 12 });
  });

  it('never prints a negative shortfall, and still shows both figures', () => {
    // More shown than the tenant has is a DOUBLE COUNT, not a negative gap — the contradiction stays visible.
    const r = reconcile([200, 200], 312);
    expect(r).toMatchObject({ shown: 400, total: 312, reconciles: false, unaccounted: 0 });
  });

  it('a tenant with no centres and no members reconciles at zero', () => {
    expect(reconcile([], 0)).toEqual({ centres: 0, shown: 0, total: 0, reconciles: true, unaccounted: 0 });
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · the preference mix, told from the cycles that exist', () => {
  const counts = [
    { paymentCycle: 'weekly', members: 214 }, { paymentCycle: 'fortnightly', members: 64 },
    { paymentCycle: 'monthly', members: 22 }, { paymentCycle: 'daily', members: 12 },
  ];

  it('prints this cooperative\'s OWN window and payday, not the canon\'s Friday', () => {
    const rows = preferenceMix(counts, [
      { paymentCycle: 'weekly', periodStart: '2026-08-17', periodEnd: '2026-08-23', payday: '2026-08-25', status: 'open' },
    ]);
    const weekly = rows.find((r) => r.paymentCycle === 'weekly')!;
    expect(weekly.state).toBe('honoured');
    expect(weekly.window).toEqual({ from: '2026-08-17', to: '2026-08-23', payday: '2026-08-25', status: 'open' });
    expect(weekly.shareBp).toBe(6859); // 214 / 312, to a basis point — an integer, never a float
  });

  it('calls a preference PENDING when no cycle has opened for it, and never "honoured"', () => {
    const rows = preferenceMix(counts, []);
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
    expect(rows.every((r) => r.window === null)).toBe(true);
    // The claim W171 makes — "their choice, honoured" — with the answer a secretary needs when it is false: WHICH
    // households are waiting.
    expect(preferencesHonoured(rows)).toEqual({ all: false, pending: ['weekly', 'fortnightly', 'monthly', 'daily'] });
  });

  it('ignores a preference nobody has chosen when deciding whether the promise is kept', () => {
    const rows = preferenceMix([{ paymentCycle: 'weekly', members: 300 }, { paymentCycle: 'daily', members: 0 }], [
      { paymentCycle: 'weekly', periodStart: '2026-08-17', periodEnd: '2026-08-23', payday: '2026-08-25', status: 'open' },
    ]);
    expect(preferencesHonoured(rows)).toEqual({ all: true, pending: [] });
  });

  it('a share of nothing is null, never 100%', () => {
    expect(preferenceMix([{ paymentCycle: 'weekly', members: 0 }], [])[0].shareBp).toBeNull();
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · the acts, and who may not perform them', () => {
  function harness(over: Record<string, unknown> = {}) {
    const centre = MccCentre.create({ ...base, operatorUserId: 'u1' });
    const repo = {
      getForUpdate: jest.fn().mockResolvedValue(centre),
      userHoldsRoleInTenant: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue(undefined),
      ...over,
    };
    const custody = {
      open: jest.fn().mockResolvedValue({ id: 'a1', operatorUserId: 'u1', assignedAt: new Date() }),
      close: jest.fn().mockResolvedValue(undefined),
      openNew: jest.fn().mockResolvedValue({ id: 'a2' }),
      history: jest.fn().mockResolvedValue([]),
    };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => fn()) };
    const svc = new MccCentreService(uow as never, { write: jest.fn() } as never, idem as never,
      { inc: jest.fn(), observe: jest.fn() } as never, { write: jest.fn() } as never, repo as never, custody as never);
    return { svc, repo, custody, centre };
  }
  const desk = { userId: 'desk', canManage: true };

  it('refuses an operator who holds no active role in this cooperative — with their id', async () => {
    // `mcc_centres.operator_user_id REFERENCES users(id)` and `users` is PLATFORM-WIDE (0003), so the foreign key says
    // nothing about tenancy. Without this, another cooperative's member could be written into a custody field and this
    // board would print their name and phone number.
    const h = harness({ userHoldsRoleInTenant: jest.fn().mockResolvedValue(false) });
    await expect(h.svc.assignOperator('t1', desk as never, 'k1', 'c1', { operatorUserId: 'stranger' }, null))
      .rejects.toBeInstanceOf(MccOperatorNotInTenantError);
    expect(h.custody.openNew).not.toHaveBeenCalled();
    expect(h.repo.update).not.toHaveBeenCalled();
  });

  it('closes the old custody and opens the new one at ONE instant', async () => {
    const h = harness();
    await h.svc.assignOperator('t1', desk as never, 'k1', 'c1', { operatorUserId: 'u2', reason: 'moved to Rajkot' }, null);
    expect(h.custody.close).toHaveBeenCalledTimes(1);
    expect(h.custody.openNew).toHaveBeenCalledTimes(1);
    const closedAt = h.custody.close.mock.calls[0][4] as Date;
    const openedAt = (h.custody.openNew.mock.calls[0][1] as { assignedAt: Date }).assignedAt;
    // THE SAME OBJECT, not two clocks that happened to agree. Two `new Date()` calls in one tick usually return the
    // same millisecond, so comparing values here would pass by luck and fail in production under load — and a gap of
    // one millisecond in which the register says nobody held the centre is a gap a shortfall investigation reads as a
    // fact.
    expect(openedAt).toBe(closedAt);
    expect((h.custody.openNew.mock.calls[0][1] as { reason: string | null }).reason).toBe('moved to Rajkot');
  });

  it('opens a custody even when there was none to close', async () => {
    const h = harness({ getForUpdate: jest.fn().mockResolvedValue(MccCentre.create({ ...base })) });
    h.custody.open.mockResolvedValue(null);
    await h.svc.assignOperator('t1', desk as never, 'k1', 'c1', { operatorUserId: 'u2' }, null);
    expect(h.custody.close).not.toHaveBeenCalled();
    expect(h.custody.openNew).toHaveBeenCalledTimes(1);
  });

  it('DOES NOT default the operator to whoever created the centre', async () => {
    // This is the defect: `dto.operatorUserId ?? actor.userId` made a dairy lead who added three centres the recorded
    // custodian of all three — 312 families' milk answerable to somebody who has never been to any of the villages.
    const h = harness();
    await h.svc.create('t1', desk as never, 'k1', { code: 'MCC-X', defaultName: 'Keshod' } as never, null);
    const inserted = h.repo.insert.mock.calls[0][1] as MccCentre;
    expect(inserted.toProps().operatorUserId).toBeNull();
    expect(h.custody.openNew).not.toHaveBeenCalled();
    // …and `created_by` is the ACTOR. It used to be the operator id, so the standard audit column named the person who
    // would be holding the milk as the person who created the record.
    expect(h.repo.insert.mock.calls[0][2]).toBe('desk');
  });

  it('opens a custody row when a centre IS created with an operator, in the same transaction', async () => {
    const h = harness();
    await h.svc.create('t1', desk as never, 'k1', { code: 'MCC-X', defaultName: 'Keshod', operatorUserId: 'u5' } as never, null);
    expect(h.custody.openNew).toHaveBeenCalledTimes(1);
    expect((h.custody.openNew.mock.calls[0][1] as { operatorUserId: string }).operatorUserId).toBe('u5');
    // …and `created_by` is STILL the actor. With an operator named, the two differ — which is the case the old code
    // got wrong and the no-operator case could never reveal, because there the two coincided.
    expect(h.repo.insert.mock.calls[0][2]).toBe('desk');
  });

  it('turns an aggregate refusal into a typed 422 rather than a raw Error', async () => {
    const h = harness();
    await expect(h.svc.setShiftWindow('t1', desk as never, 'c1', 'evening', { opens: '20:00', closes: '17:00' }, null))
      .rejects.toBeInstanceOf(MccCentreInvalidError);
  });

  it('refuses every act, and the custody register, without the dairy desk', async () => {
    const h = harness();
    const nope = { userId: 'x', canManage: false } as never;
    await expect(h.svc.assignOperator('t1', nope, 'k', 'c1', { operatorUserId: 'u2' }, null)).rejects.toBeInstanceOf(DairyForbiddenError);
    await expect(h.svc.releaseOperator('t1', nope, 'c1', null, null)).rejects.toBeInstanceOf(DairyForbiddenError);
    await expect(h.svc.setShiftWindow('t1', nope, 'c1', 'morning', null, null)).rejects.toBeInstanceOf(DairyForbiddenError);
    await expect(h.svc.custodyHistory('t1', nope, 'c1', 10)).rejects.toBeInstanceOf(DairyForbiddenError);
    expect(h.repo.getForUpdate).not.toHaveBeenCalled();
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · the read-model does not trust its caller', () => {
  it('refuses without `dairy.manage` before it reads anything', async () => {
    const console_ = { board: jest.fn(), tanks: jest.fn(), membershipTotal: jest.fn(), preferenceCounts: jest.fn(), cyclesByPreference: jest.fn() };
    const rm = new DairyCentresReadModel({ forTenant: jest.fn() } as never, console_ as never, { thresholds: jest.fn() } as never,
      { isEnabled: jest.fn() } as never, { inc: jest.fn(), observe: jest.fn() } as never);
    // TENANT-6c-6 shipped a console that took `canManage` from its caller on trust. A read-model is reachable from
    // anything.
    await expect(rm.view('t1', { userId: 'x', canManage: false } as never)).rejects.toBeInstanceOf(DairyForbiddenError);
    expect(console_.board).not.toHaveBeenCalled();
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · the route order trap, for the third time', () => {
  it('declares `console` BEFORE `:id`', () => {
    const proto = MccController.prototype as unknown as Record<string, unknown>;
    const order = Object.getOwnPropertyNames(proto)
      .filter((k) => k !== 'constructor' && typeof Reflect.getMetadata(PATH_METADATA, proto[k] as object) === 'string')
      .map((k) => ({ k, p: Reflect.getMetadata(PATH_METADATA, proto[k] as object) as string }));
    const at = (p: string) => order.findIndex((o) => o.p === p);
    // Nest matches in declaration order, so `:id` first would answer W171's board with "MCC centre 'console' not
    // found" — the same trap as TENANT-6c-6's cycle console and TENANT-6d-1's monitor.
    expect(at('console')).toBeGreaterThanOrEqual(0);
    expect(at(':id')).toBeGreaterThanOrEqual(0);
    expect(at('console')).toBeLessThan(at(':id'));
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · what migration 0163 promises in writing', () => {
  it('gives a shift BOTH ends or NEITHER, in whole minutes', () => {
    expect(MIG).toMatch(/ck_mcc_shift_morning/);
    // BOTH-OR-NEITHER is an AND. With `OR` the constraint permits exactly the half-window it exists to forbid, and
    // reads almost identically in a diff.
    expect(MIG).toContain('(morning_opens_at IS NULL AND morning_closes_at IS NULL)');
    expect(MIG).toContain('(evening_opens_at IS NULL AND evening_closes_at IS NULL)');
    expect(MIG).toMatch(/EXTRACT\(SECOND FROM morning_opens_at\) = 0 AND EXTRACT\(SECOND FROM morning_closes_at\) = 0/);
    expect(MIG).toMatch(/EXTRACT\(SECOND FROM evening_opens_at\) = 0 AND EXTRACT\(SECOND FROM evening_closes_at\) = 0/);
    // STRICTLY after: `>=` would allow a zero-length shift, which is a centre that is open for no minutes.
    expect(MIG).toContain('AND evening_closes_at > evening_opens_at');
    expect(MIG).toContain('AND morning_closes_at > morning_opens_at');
  });

  it('requires a custody ending to name its author, and to come after its beginning', () => {
    expect(MIG).toContain('CONSTRAINT ck_mcc_custody_ended CHECK ((ended_at IS NULL) = (ended_by IS NULL))');
    expect(MIG).toContain('CONSTRAINT ck_mcc_custody_window CHECK (ended_at IS NULL OR ended_at >= assigned_at)');
  });

  it('keeps ONE open custody per centre with a PARTIAL unique index', () => {
    expect(MIG).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_mcc_custody_open[\s\S]*?WHERE ended_at IS NULL AND deleted_at IS NULL/);
  });

  it('makes the custody register append-only except for its ending', () => {
    // Nothing may rewrite who held a centre in June: a custody register whose past is editable cannot answer the one
    // question it exists for.
    expect(MIG).toMatch(/GRANT UPDATE \(ended_at, ended_by, updated_at, updated_by\) ON mcc_operator_assignments TO kv_app;/);
    expect(MIG).toMatch(/REVOKE UPDATE, DELETE ON mcc_operator_assignments FROM kv_app;/);
    expect(MIG).toMatch(/REVOKE ALL ON mcc_operator_assignments FROM kv_relay;/);
  });

  it('gates the operator on tenancy with a TRIGGER, because no composite key exists to reference', () => {
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION assert_mcc_operator_in_tenant\(\)/);
    expect(MIG).toMatch(/CREATE TRIGGER trg_mcc_operator_in_tenant[\s\S]*?BEFORE INSERT OR UPDATE OF operator_user_id ON mcc_centres/);
    expect(MIG).toMatch(/CREATE TRIGGER trg_mcc_custody_in_tenant/);
  });

  it('takes write privileges on centres and memberships away from the BYPASSRLS relay tier', () => {
    expect(MIG).toMatch(/REVOKE INSERT, UPDATE, DELETE ON mcc_centres FROM kv_relay;/);
    expect(MIG).toMatch(/REVOKE INSERT, UPDATE, DELETE ON dairy_memberships FROM kv_relay;/);
  });

  it('indexes the two reads this board adds, and ships the flag OFF', () => {
    // The statement, not the NAME: a commented-out `CREATE INDEX` still contains the name, and at a federation's
    // 40,000 memberships an unindexed count per centre is the whole table on every page load.
    expect(MIG).toMatch(/CREATE INDEX IF NOT EXISTS idx_dairy_memberships_mcc\s*\n\s*ON dairy_memberships \(tenant_id, mcc_id\)/);
    expect(MIG).toMatch(/CREATE INDEX IF NOT EXISTS idx_dairy_memberships_cycle\s*\n\s*ON dairy_memberships \(tenant_id, payment_cycle\)/);
    expect(MIG).toMatch(/'dairy_centres_console'[\s\S]*?false, 100, 'experiment'/);
  });

  it('backfills custody ONLY where the stored operator is a member of the tenant', () => {
    // A backfill that wrote rows 163.4's gate then rejects would leave the table in a state the migration itself
    // could not reproduce. Asserted on the INSERT's own text, bounded to it: an unbounded `[\s\S]*?` would happily
    // match the EXISTS inside 163.4's trigger function further down the file and pass with the clause deleted.
    const insert = MIG.slice(MIG.indexOf('INSERT INTO mcc_operator_assignments (tenant_id'));
    const stmt = insert.slice(0, insert.indexOf(';'));
    expect(stmt).toContain('EXISTS (SELECT 1 FROM user_tenant_roles');
    expect(stmt).toContain('utr.tenant_id = c.tenant_id');
    expect(stmt).toContain('NOT EXISTS (SELECT 1 FROM mcc_operator_assignments a');
  });
});

/* =========================================================================================================== */
/* THE READS THEMSELVES — the SQL, and the read-model over it                                                  */
/* =========================================================================================================== */

describe('PC-56 TENANT-6d-2 · the queries say what the board depends on', () => {
  /** A fake executor that records every statement, so a clause can be asserted rather than hoped for. */
  function spy(rows: unknown[] = []) {
    const sql: string[] = [];
    const x = { query: jest.fn(async (q: string) => { sql.push(q); return { rows, rowCount: rows.length }; }) };
    return { x, sql, last: () => sql[sql.length - 1] };
  }

  it('reads the SHIFT BEING SHOWN, chosen in SQL — never four columns picked in TypeScript', async () => {
    const { x, last } = spy();
    const repo = new DairyCounterRepository({ forTenant: () => x } as never);
    await repo.centreShiftRows('t1', '2026-08-21', 'evening');
    // A board of the evening printing a morning window is a farmer sent to a closed door three hours early.
    expect(last()).toContain("CASE WHEN $3 = 'morning' THEN m.morning_opens_at  ELSE m.evening_opens_at  END");
    expect(last()).toContain("CASE WHEN $3 = 'morning' THEN m.morning_closes_at ELSE m.evening_closes_at END");
  });

  it('counts the tenant total INDEPENDENTLY, over active memberships only', async () => {
    const { x, last } = spy([{ n: 4 }]);
    const repo = new MccConsoleRepository({ forTenant: () => x } as never);
    expect(await repo.membershipTotal(x as never, 't1')).toBe(4);
    // `is_active` is what makes the footer's tick mean something: without it the total counts people who left, and no
    // cooperative's board would ever reconcile.
    expect(last()).toMatch(/FROM dairy_memberships\s+WHERE tenant_id = \$1 AND is_active AND deleted_at IS NULL/);
  });

  it('joins the operator through a TENANCY check, and only live coolers', async () => {
    const { x, sql } = spy();
    const repo = new MccConsoleRepository({ forTenant: () => x } as never);
    await repo.board(x as never, 't1', false, 100);
    // `users` is platform-wide (0003). Without this EXISTS, a uuid from another cooperative in the custody column
    // makes this board print that person's name and phone number.
    expect(sql[0]).toMatch(/LEFT JOIN users u[\s\S]*?AND EXISTS \(SELECT 1 FROM user_tenant_roles utr/);
    expect(sql[0]).toContain('utr.tenant_id = c.tenant_id');
    await repo.tanks(x as never, 't1');
    expect(sql[1]).toContain('b.is_active = true');
  });

  it('takes the NEWEST cycle per cadence, so the payday on screen is the one being worked to', async () => {
    const { x, last } = spy();
    const repo = new MccConsoleRepository({ forTenant: () => x } as never);
    await repo.cyclesByPreference(x as never, 't1');
    expect(last()).toContain('DISTINCT ON (payment_cycle)');
    expect(last()).toMatch(/ORDER BY payment_cycle, period_start DESC, id DESC/);
  });

  it('reads a custody register NEWEST first — the board\'s "since" is the current tenure', async () => {
    const { x, last } = spy();
    const repo = new MccOperatorAssignmentRepository({ forTenant: () => x } as never);
    await repo.history('t1', 'c1', 20);
    expect(last()).toMatch(/ORDER BY assigned_at DESC, id DESC LIMIT \$3/);
  });

  it('is FAIL-CLOSED on a centre update and on closing a custody', async () => {
    const zero = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const centre = MccCentre.create({ ...base });
    // A silent no-op here writes an audit row and an outbox event for a handover that did not happen.
    await expect(new MccCentreRepository({} as never).update(zero as never, centre, 'desk'))
      .rejects.toThrow(/matched no row/);
    // And a custody close that matched nothing leaves the register showing the previous holder as current — after
    // which the partial unique index makes every future handover at that centre impossible.
    await expect(new MccOperatorAssignmentRepository({} as never).close(zero as never, 't1', 'a1', 'desk', new Date()))
      .rejects.toThrow(/could not be closed/);
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · the board the read-model composes', () => {
  const NOW = new Date('2026-08-21T06:00:00Z');
  const boardRow = (o: Record<string, unknown> = {}) => ({
    id: 'c1', code: 'MCC-AND-01', name: 'Vanthali', isActive: true, capacityLitresShift: '1200.00',
    analyzerModel: 'Lactoscan SP', analyzerSerial: 'LS-000412',
    operatorUserId: 'u1', operatorName: 'Bhavna Ben K.', operatorPhone: '+919876543210',
    custodyOperatorUserId: 'u1', custodyAssignedAt: new Date('2026-03-14T05:00:00Z'),
    members: 108, morningOpensAt: null, morningClosesAt: null, eveningOpensAt: null, eveningClosesAt: null, ...o,
  });
  function rm(over: Record<string, unknown> = {}) {
    const repo = {
      board: jest.fn().mockResolvedValue([boardRow()]),
      tanks: jest.fn().mockResolvedValue([]),
      membershipTotal: jest.fn().mockResolvedValue(108),
      preferenceCounts: jest.fn().mockResolvedValue([{ paymentCycle: 'weekly', members: 108 }]),
      cyclesByPreference: jest.fn().mockResolvedValue([]),
      ...over,
    };
    const replica = { forTenant: () => ({ query: jest.fn().mockResolvedValue({ rows: [{ n: NOW }] }) }) };
    const units = { thresholds: jest.fn().mockResolvedValue({ divertDeci: 75, condemnDeci: 80, silenceMinutes: 15 }) };
    return new DairyCentresReadModel(replica as never, repo as never, units as never, { isEnabled: jest.fn() } as never,
      { inc: jest.fn(), observe: jest.fn() } as never);
  }
  const desk = { userId: 'desk', canManage: true } as never;

  it('masks the phone and the analyzer serial', async () => {
    const v = await rm().view('t1', desk);
    // One masking rule for the whole platform (`shared/utils/phone`), and a serial reduced to what matches a service
    // engineer's paperwork — not an equipment inventory anybody with `dairy.manage` can export.
    expect(v.centres[0].custody.operatorPhoneMasked).toBe('+9198****3210');
    expect(v.centres[0].analyzer.serialMasked).toBe('…0412');
    expect(v.centres[0].custody.operatorName).toBe('Bhavna Ben K.');
  });

  it('prints NO name and NO phone when the custody is one it cannot stand behind', async () => {
    const v = await rm({ board: jest.fn().mockResolvedValue([boardRow({ custodyOperatorUserId: 'u2' })]) }).view('t1', desk);
    expect(v.centres[0].custody.state).toBe('disagrees');
    expect(v.centres[0].custody.operatorName).toBeNull();
    expect(v.centres[0].custody.operatorPhoneMasked).toBeNull();
    expect(v.custodyGaps).toMatchObject({ disagrees: 1 });
  });

  it('takes the tenant total from the INDEPENDENT count, so the tick can disagree with the rows', async () => {
    const v = await rm({ membershipTotal: jest.fn().mockResolvedValue(312) }).view('t1', desk);
    expect(v.reconciliation).toMatchObject({ shown: 108, total: 312, reconciles: false, unaccounted: 204 });
  });

  it('shows the WARMEST cooler when a centre has several', async () => {
    const t = (id: string, temp: number) => ({
      mccId: 'c1', unitId: id, minDeci: 0, targetDeci: 40, toleranceDeci: 5,
      lastTempDeci: temp, lastAt: new Date('2026-08-21T05:58:00Z'),
    });
    // A board showing the coolest of three tanks hides the one losing the milk.
    const v = await rm({ tanks: jest.fn().mockResolvedValue([t('cold', 35), t('warm', 69)]) }).view('t1', desk);
    expect(v.centres[0].tank).toMatchObject({ unitId: 'warm', condition: 'above_band', tempC: '6.9' });
    expect(v.tanksNeedingAttention).toBe(1);
  });

  it('counts the centres with no hours recorded, and never claims the transfer is built', async () => {
    const v = await rm().view('t1', desk);
    expect(v.hoursUnrecorded).toBe(1);
    expect(v.gaps.transferBuilt).toBe(false);
  });
});

/* =========================================================================================================== */
describe('PC-56 TENANT-6d-2 · every dairy screen stays inside the dairy module\'s own kill-switch', () => {
  it('names BOTH the module flag and the screen flag on each screen controller', () => {
    // Before this wave the guard used `getAllAndOverride`, so a route's flag CANCELLED its controller's — and the three
    // screen controllers that named only their own flag were reachable on a tenant whose dairy module was switched off.
    for (const c of [BmcController, DairyCounterController, DairyQualityController]) {
      const keys = Reflect.getMetadata(FEATURE_FLAG_KEY, c) as string[];
      expect(Array.isArray(keys)).toBe(true);
      expect(keys).toContain('dairy');
      expect(keys.length).toBeGreaterThan(1);
    }
  });
});
