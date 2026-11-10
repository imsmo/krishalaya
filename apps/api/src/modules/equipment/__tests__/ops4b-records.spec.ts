// modules/equipment/__tests__/ops4b-records.spec.ts · PC-56 OPS-4b · THE RECORDS: UPKEEP — the first commit, unit (survey_ops4 B7, E11/E12):
//   B7 / E11 · recording maintenance is the machine OWNER's alone (MAINTENANCE_NOT_YOUR_MACHINE, 403 — an administrator too), dated on or before
//              the ORGANISATION's own today (MAINTENANCE_DATE_IN_FUTURE, 400 — the tenant-day rule, an IST/UTC boundary pair at 23:30 / 00:15 IST),
//              one audit row with the entry; E12 · both refusals BEFORE idem.remember, the unit of work and any write — an ordering log pins it;
//              the logs read: the owner only, anyone else 404; the alerts: the caller's own machines, `booking.manage` the organisation's;
//              the strict DTO;
//   cancel   · a hire cancelled by anyone but its renter without a reason → CANCEL_REASON_REQUIRED (400), BEFORE idem.remember (lead-applied
//              from OPS-2a); the renter's reason stays optional.
// Live twin: src/__tests__/ops4b-records.integration.spec.ts.
import { MaintenanceService } from '../services/maintenance.service';
import { MaintenanceRepository } from '../repositories/maintenance.repository';
import { EquipmentBookingService } from '../services/equipment-booking.service';
import { EquipmentAsset } from '../domain/equipment-asset.entity';
import { EquipmentBooking } from '../domain/equipment-booking.entity';
import { MaintenanceLogSchema } from '../dto/create-maintenance-log.dto';

const T = 't1';
const owner = { userId: 'owner1', isAdmin: false };
const stranger = { userId: 'owner2', isAdmin: false };
const admin = { userId: 'admin1', isAdmin: true };
const machine = EquipmentAsset.rehydrate({ id: 'a1', tenantId: T, ownerUserId: 'owner1', categoryId: 'c1', productId: null, regNo: null, yearOfMfg: null, engineHours: null,
  hpRating: null, baseAddressId: null, serviceRadiusKm: 25, gpsDeviceRef: null, status: 'active' });
/** The organisation's day of an instant, in India — what `tenantDay`'s SQL answers for a tenant whose country is IN. */
const istDay = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

function harness(found: EquipmentAsset | null = machine) {
  const log: string[] = [];
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn(tx); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => { log.push('idem'); return fn(); }) };
  const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { log.push(`audit:${e.action}`); }) };
  const repo = {
    tenantDay: jest.fn(async (_t: string, at: string) => { log.push('day'); return istDay(at); }),
    insertLog: jest.fn(async () => { log.push('insert'); }),
    listLogs: jest.fn(async () => { log.push('list'); return []; }),
    alerts: jest.fn(async () => { log.push('alerts'); return []; }),
  };
  const assets = { getById: jest.fn(async (_t: string, _id: string, t?: unknown) => { log.push(t ? 'asset:tx' : 'asset'); return found; }) };
  const svc = new MaintenanceService(uow as never, idem as never, audit as never, repo as never, assets as never);
  return { svc, log, audit, repo, idem };
}
const entry = (performedOn: string) => ({ logType: 'repair' as const, costMinor: '411100', engineHoursAt: '1200.5', notes: 'belt', performedOn });

afterEach(() => { jest.useRealTimers(); });

describe('PC-56 OPS-4b · B7 / E11 / E12 · a machine\'s maintenance is its owner\'s record', () => {
  it('the owner records → pre-read, the organisation\'s day, THEN idem, the unit of work, the owner check on the row, the insert, ONE audit row', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-10T06:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const h = harness();
    const out = await h.svc.record(T, owner, 'a1', 'k-1', entry('2026-11-10'), '10.0.0.3');
    expect(h.log).toEqual(['asset', 'day', 'idem', 'uow', 'asset:tx', 'insert', 'audit:equipment.maintenance.recorded']);
    expect((h.idem.remember.mock.calls[0] as unknown as [string, string, string])).toEqual(['k-1', 'owner1', 'equipment.maintenance.record', expect.any(Function)]);
    const row = (h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>])[1];
    expect([row.entityType, row.entityId, row.oldValue, row.ip]).toEqual(['equipment_maintenance_log', out.id, null, '10.0.0.3']);
    expect(row.newValue).toEqual({ id: out.id, assetId: 'a1', logType: 'repair', costMinor: '411100', notes: 'belt', engineHoursAt: '1200.5', performedOn: '2026-11-10' });
    expect(out).toEqual(row.newValue);   // the server's id and the entry
  });
  it.each([['another owner', stranger], ['an administrator (booking.manage)', admin]])('%s → MAINTENANCE_NOT_YOUR_MACHINE (403) BEFORE idem, the unit of work and any write', async (_n, actor) => {
    const h = harness();
    await expect(h.svc.record(T, actor, 'a1', 'k', entry('2026-01-01'))).rejects.toMatchObject({ code: 'MAINTENANCE_NOT_YOUR_MACHINE', httpStatus: 403 });
    expect(h.log).toEqual(['asset']); expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.repo.insertLog).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
  });
  it('an unknown machine → 404 before anything', async () => {
    const h = harness(null);
    await expect(h.svc.record(T, owner, 'nope', 'k', entry('2026-01-01'))).rejects.toMatchObject({ httpStatus: 404 });
    expect(h.log).toEqual(['asset']);
  });
  it('THE IST/UTC PAIR · at 23:30 IST on 10 Nov (18:00 UTC) the organisation\'s tomorrow, 11 Nov, is refused MAINTENANCE_DATE_IN_FUTURE (400) before idem', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-10T18:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const h = harness();
    await expect(h.svc.record(T, owner, 'a1', 'k', entry('2026-11-11'))).rejects.toMatchObject({ code: 'MAINTENANCE_DATE_IN_FUTURE', httpStatus: 400, details: { today: '2026-11-10' } });
    expect(h.log).toEqual(['asset', 'day']); expect(h.idem.remember).not.toHaveBeenCalled();
    expect(h.repo.tenantDay.mock.calls[0]).toEqual([T, '2026-11-10T18:00:00.000Z']);
  });
  it('THE IST/UTC PAIR · at 00:15 IST on 11 Nov (18:45 UTC on 10 Nov) 11 Nov IS the organisation\'s today → recorded (the UTC day would refuse it)', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-10T18:45:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const h = harness();
    const out = await h.svc.record(T, owner, 'a1', 'k', entry('2026-11-11'));
    expect(out.performedOn).toBe('2026-11-11'); expect(h.repo.insertLog).toHaveBeenCalledTimes(1);
  });
  it('the day query is the organisation\'s: countries.timezone through tenants.country_code, for the instant given', async () => {
    const q = jest.fn().mockResolvedValue({ rows: [{ day: '2026-11-11' }] });
    const repo = new MaintenanceRepository({ forTenant: () => ({ query: q }) } as never);
    expect(await repo.tenantDay(T, '2026-11-10T18:45:00.000Z')).toBe('2026-11-11');
    const [sql, params] = q.mock.calls[0];
    expect(params).toEqual(['2026-11-10T18:45:00.000Z', T]);
    expect(sql).toMatch(/AT TIME ZONE co\.timezone\)::date::text/); expect(sql).toMatch(/JOIN countries co ON co\.code = t\.country_code/);
  });
  it('an entry touches no machine row: the service has no path to the asset\'s status (the record writes the log and the audit row only)', async () => {
    const h = harness();
    await h.svc.record(T, owner, 'a1', 'k', entry('2020-01-01'));
    expect(Object.keys(h.repo)).not.toContain('setStatus');
    expect(h.log.filter((x) => !['asset', 'day', 'idem', 'uow', 'asset:tx'].includes(x))).toEqual(['insert', 'audit:equipment.maintenance.recorded']);
  });
});

describe('PC-56 OPS-4b · the logs read and the alerts', () => {
  it('logs: the owner reads; another owner and an administrator → 404 (no enumeration), nothing listed', async () => {
    const h = harness();
    await h.svc.logs(T, owner, 'a1');
    for (const a of [stranger, admin]) await expect(h.svc.logs(T, a, 'a1')).rejects.toMatchObject({ httpStatus: 404 });
    expect(h.repo.listLogs).toHaveBeenCalledTimes(1);
  });
  it('alerts: an owner gets her own machines; booking.manage the organisation\'s', async () => {
    const h = harness();
    await h.svc.alerts(T, owner); await h.svc.alerts(T, admin);
    expect(h.repo.alerts.mock.calls).toEqual([[T, 'owner1'], [T, null]]);
  });
  it('the alerts SQL filters by the owner when one is given', async () => {
    const q = jest.fn().mockResolvedValue({ rows: [] });
    await new MaintenanceRepository({ forTenant: () => ({ query: q }) } as never).alerts(T, 'owner1');
    expect(q.mock.calls[0][0]).toMatch(/\$2::uuid IS NULL OR a\.owner_user_id = \$2::uuid/); expect(q.mock.calls[0][1]).toEqual([T, 'owner1']);
  });
});

describe('PC-56 OPS-4b · the strict maintenance DTO', () => {
  it('the four types; a minor-unit cost string; engine hours to one decimal; notes 1–500; a real calendar day; nothing else', () => {
    const ok = (b: object) => MaintenanceLogSchema.safeParse(b).success;
    expect(ok({ logType: 'service', performedOn: '2026-11-10' })).toBe(true);
    expect(ok({ logType: 'breakdown', costMinor: '0', engineHoursAt: '12.5', notes: 'x', performedOn: '2024-02-29' })).toBe(true);
    expect([ok({ logType: 'completion', performedOn: '2026-11-10' }), ok({ logType: 'service', performedOn: '2026-02-31' }), ok({ logType: 'service', performedOn: '10/11/2026' })]).toEqual([false, false, false]);
    expect([ok({ logType: 'service', costMinor: '-1', performedOn: '2026-11-10' }), ok({ logType: 'service', costMinor: '12.50', performedOn: '2026-11-10' }), ok({ logType: 'service', costMinor: 1250, performedOn: '2026-11-10' })]).toEqual([false, false, false]);
    expect([ok({ logType: 'service', engineHoursAt: '12.55', performedOn: '2026-11-10' }), ok({ logType: 'service', notes: '   ', performedOn: '2026-11-10' }), ok({ logType: 'service', notes: 'x'.repeat(501), performedOn: '2026-11-10' })]).toEqual([false, false, false]);
    expect(ok({ logType: 'service', performedOn: '2026-11-10', assetId: 'a2' })).toBe(false);
  });
});

function bookingHarness(pre: EquipmentBooking) {
  const log: string[] = [];
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn({ query: jest.fn() }); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => { log.push('idem'); return fn(); }) };
  const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { log.push(`audit:${e.action}`); }) };
  const bookings = { getById: jest.fn(async () => { log.push('pre'); return pre; }), getForUpdate: jest.fn(async () => { log.push('lock'); return pre; }), update: jest.fn(async () => { log.push('update'); }) };
  const svc = new EquipmentBookingService(uow as never, { write: jest.fn() } as never, idem as never, {} as never, audit as never, { auth: { hashPepper: 'p' } } as never,
    { post: jest.fn() } as never, bookings as never, {} as never, {} as never);
  return { svc, log, idem, audit };
}
const requested = () => { const b = EquipmentBooking.request({ id: 'b1', tenantId: T, bookingNo: 'EQ-X', renterUserId: 'renter1', assetId: 'a1', ownerUserId: 'owner1',
  operatorUserId: null, taskDesc: null, rateBasis: 'per_hour', rateMinor: 50000n, estQuantityCenti: 400n, scheduledAt: new Date() }); b.pullEvents(); return b; };
const eq = (userId: string, isAdmin = false) => ({ userId, canManage: true, canRent: true, isAdmin });

describe('PC-56 OPS-4b · an owner\'s cancel needs a reason (lead-applied from OPS-2a)', () => {
  it.each([['the machine\'s owner', eq('owner1')], ['an administrator', eq('admin1', true)]])('%s cancelling without a reason → CANCEL_REASON_REQUIRED (400) BEFORE idem and any write', async (_n, actor) => {
    const h = bookingHarness(requested());
    await expect(h.svc.cancel(T, actor, 'b1', 'k', {}, null)).rejects.toMatchObject({ code: 'CANCEL_REASON_REQUIRED', httpStatus: 400 });
    expect(h.log).toEqual(['pre']); expect(h.idem.remember).not.toHaveBeenCalled();
  });
  it('the owner with a reason → cancelled, the reason in its audit row', async () => {
    const h = bookingHarness(requested());
    await h.svc.cancel(T, eq('owner1'), 'b1', 'k', { reason: 'engine fault' }, null);
    expect(h.log).toEqual(['pre', 'idem', 'uow', 'lock', 'update', 'audit:equipment.booking.cancelled']);
    expect(((h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>])[1]).newValue.reason).toBe('engine fault');
  });
  it('the renter without a reason → allowed (hers stays optional)', async () => {
    const h = bookingHarness(requested());
    await h.svc.cancel(T, eq('renter1'), 'b1', 'k', {}, null);
    expect(((h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>])[1]).newValue.reason).toBeNull();
  });
});
