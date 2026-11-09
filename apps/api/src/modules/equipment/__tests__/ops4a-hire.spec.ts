// modules/equipment/__tests__/ops4a-hire.spec.ts · PC-56 OPS-4a · THE HIRE — the first commit, unit (survey_ops4 B6/B18, E10/E12/E14/E15):
//   B6 / E10 · setRate writes ONE audit row with the line before and after; a line that has already priced a hire is refused
//              RATE_ALREADY_PRICED_A_HIRE before any write (the upsert, the audit row, the outbox) — an ordering log pins it; quote writes an
//              audit row (the deposit before / after); cancel's party refusal comes BEFORE idem.remember (E12) and a cancel writes one audit row;
//   E14      · a hire's rate day is the organisation's own day of `scheduledAt` (`tenantDay`, SQL over countries.timezone) — never the UTC slice;
//   E15      · quantities parsed and printed as scaled strings; no `Number(` on a quantity in the entity or the repository.
// Live twin: src/__tests__/ops4a-hire.integration.spec.ts.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EquipmentRateService } from '../services/equipment-rate.service';
import { EquipmentBookingService } from '../services/equipment-booking.service';
import { EquipmentRateRepository } from '../repositories/equipment-rate.repository';
import { EquipmentBookingRepository } from '../repositories/equipment-booking.repository';
import { EquipmentAsset } from '../domain/equipment-asset.entity';
import { EquipmentRate } from '../domain/equipment-rate.entity';
import { EquipmentBooking } from '../domain/equipment-booking.entity';
import { formatScaled, parseScaled } from '../domain/scaled';
import { CancelBookingSchema } from '../dto/create-equipment-booking.dto';

const T = 't1';
const owner = { userId: 'owner1', canManage: true, canRent: false, isAdmin: false };
const renter = { userId: 'renter1', canManage: false, canRent: true, isAdmin: false };
const stranger = { userId: 'other1', canManage: true, canRent: true, isAdmin: false };
const asset = EquipmentAsset.rehydrate({ id: 'a1', tenantId: T, ownerUserId: 'owner1', categoryId: 'c1', productId: null, regNo: null, yearOfMfg: null, engineHours: null,
  hpRating: null, baseAddressId: null, serviceRadiusKm: 25, gpsDeviceRef: null, status: 'active' });
const line = (rateMinor: bigint) => EquipmentRate.create({ id: 'r-old', assetId: 'a1', rateBasis: 'per_hour', rateMinor, includesOperator: true, includesFuel: false, effectiveFrom: '2027-03-10', effectiveTo: null });

function rateHarness(before: EquipmentRate | null, priced: boolean) {
  const log: string[] = [];
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn(tx); }) };
  const outbox = { write: jest.fn(async () => { log.push('outbox'); }) };
  const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };
  const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { log.push(`audit:${e.action}`); }) };
  const repo = {
    tenantDay: jest.fn(async () => { log.push('day'); return '2027-03-09'; }),
    findAtForUpdate: jest.fn(async () => { log.push('before'); return before; }),
    hasPricedAHire: jest.fn(async () => { log.push('priced?'); return priced; }),
    upsert: jest.fn(async () => { log.push('upsert'); }),
  };
  const assets = { getById: jest.fn(async () => asset) };
  const svc = new EquipmentRateService(uow as never, outbox as never, metrics as never, repo as never, assets as never, audit as never);
  return { svc, log, audit, repo };
}

describe('PC-56 OPS-4a · B6 / E10 · every rate change is recorded; a line that priced a hire is never overwritten', () => {
  it('a new line → one audit row (before = null, after = the line), then the outbox', async () => {
    const h = rateHarness(null, false);
    const out = await h.svc.setRate(T, owner, 'a1', { rateBasis: 'per_hour', rateMinor: '15000', includesOperator: true, includesFuel: false, effectiveFrom: '2027-03-10' }, '10.0.0.1');
    expect(h.log).toEqual(['uow', 'before', 'upsert', 'audit:equipment.rate.set', 'outbox']);
    const row = (h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>])[1];
    expect([row.entityType, row.entityId, row.oldValue, row.newValue.rateMinor, row.newValue.effectiveFrom, row.ip]).toEqual(['equipment_rate', out.id, null, '15000', '2027-03-10', '10.0.0.1']);
  });
  it('overwriting a line no hire has used → audit before / after, the SAME row id', async () => {
    const h = rateHarness(line(10000n), false);
    const out = await h.svc.setRate(T, owner, 'a1', { rateBasis: 'per_hour', rateMinor: '12000', includesOperator: true, includesFuel: false, effectiveFrom: '2027-03-10' });
    expect(h.log).toEqual(['uow', 'before', 'priced?', 'upsert', 'audit:equipment.rate.set', 'outbox']);
    const row = (h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>])[1];
    expect([out.id, row.oldValue.rateMinor, row.newValue.rateMinor]).toEqual(['r-old', '10000', '12000']);
  });
  it('a line that has priced a hire → RATE_ALREADY_PRICED_A_HIRE (409) before ANY write: no upsert, no audit row, no outbox', async () => {
    const h = rateHarness(line(10000n), true);
    await expect(h.svc.setRate(T, owner, 'a1', { rateBasis: 'per_hour', rateMinor: '99999', includesOperator: true, includesFuel: false, effectiveFrom: '2027-03-10' }))
      .rejects.toMatchObject({ code: 'RATE_ALREADY_PRICED_A_HIRE', httpStatus: 409 });
    expect(h.log).toEqual(['uow', 'before', 'priced?']);
  });
  it('an omitted effectiveFrom is the organisation\'s own today (tenantDay), not the UTC date', async () => {
    const h = rateHarness(null, false);
    const out = await h.svc.setRate(T, owner, 'a1', { rateBasis: 'per_hour', rateMinor: '15000', includesOperator: true, includesFuel: false });
    expect(out.effectiveFrom).toBe('2027-03-09'); expect(h.log[1]).toBe('day');
  });
  it('the priced-a-hire query reads hires by the organisation\'s day, the line\'s window, and no later line that took the day', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ priced: true }] }) };
    expect(await new EquipmentRateRepository({} as never).hasPricedAHire(tx as never, T, 'r1')).toBe(true);
    const [sql, params] = tx.query.mock.calls[0];
    expect(params).toEqual([T, 'r1']);
    expect(sql).toMatch(/JOIN countries co ON co\.code = t\.country_code/);
    expect(sql).toMatch(/b\.scheduled_at AT TIME ZONE z\.tz\)::date >= rl\.effective_from/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM equipment_rates r2/);
    expect(sql).toMatch(/b\.tenant_id = \$1/);
  });
});

function bookingHarness(pre: EquipmentBooking | null) {
  const log: string[] = [];
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn(tx); }) };
  const outbox = { write: jest.fn(async () => { log.push('outbox'); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => { log.push('idem'); return fn(); }) };
  const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };
  const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { log.push(`audit:${e.action}`); }) };
  const wallet = { post: jest.fn(async () => { log.push('wallet'); return { txnId: 't', alreadyApplied: false }; }), balanceMinor: jest.fn() };
  const bookings = { getById: jest.fn(async () => { log.push('pre'); return pre; }), getForUpdate: jest.fn(async () => { log.push('lock'); return pre; }),
    update: jest.fn(async () => { log.push('update'); }), insert: jest.fn(async () => { log.push('insert'); }), listFor: jest.fn(), confirmUsage: jest.fn() };
  const assets = { getById: jest.fn(async () => asset) };
  const rates = { tenantDay: jest.fn(async () => { log.push('day'); return '2027-03-11'; }), resolveActive: jest.fn(async () => { log.push('rate'); return line(20000n); }) };
  const cfg = { auth: { hashPepper: 'pepper', exposeOtp: false } } as never;
  const svc = new EquipmentBookingService(uow as never, outbox as never, idem as never, metrics as never, audit as never, cfg, wallet as never, bookings as never, assets as never, rates as never);
  return { svc, log, audit, rates, idem };
}
const requested = () => { const b = EquipmentBooking.request({ id: 'b1', tenantId: T, bookingNo: 'EQ-X', renterUserId: 'renter1', assetId: 'a1', ownerUserId: 'owner1',
  operatorUserId: null, taskDesc: null, rateBasis: 'per_hour', rateMinor: 50000n, estQuantityCenti: 400n, scheduledAt: new Date() }); b.pullEvents(); return b; };

describe('PC-56 OPS-4a · E10 / E12 · quote and cancel are recorded; cancel\'s refusal comes before the idempotency record', () => {
  it('quote → one audit row with the deposit before and after', async () => {
    const h = bookingHarness(requested());
    await h.svc.quote(T, owner, 'b1', { advanceMinor: '30000' }, '10.0.0.2');
    expect(h.log).toEqual(['pre', 'uow', 'lock', 'update', 'audit:equipment.booking.quoted', 'outbox']);
    const row = (h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>])[1];
    expect([row.oldValue, row.newValue, row.ip]).toEqual([{ status: 'requested', advanceMinor: '0' }, { status: 'quoted', advanceMinor: '30000' }, '10.0.0.2']);
  });
  it('a stranger cancelling → refused BEFORE idem.remember, the unit of work and any write', async () => {
    const h = bookingHarness(requested());
    await expect(h.svc.cancel(T, { ...stranger, isAdmin: false }, 'b1', 'k', { reason: 'x' }, null)).rejects.toMatchObject({ code: 'EQUIPMENT_FORBIDDEN', httpStatus: 403 });
    expect(h.log).toEqual(['pre']); expect(h.idem.remember).not.toHaveBeenCalled();
  });
  it('the renter cancels with a key and a reason → inside the idempotency record, one audit row (status before / after, the reason)', async () => {
    const h = bookingHarness(requested());
    await h.svc.cancel(T, renter, 'b1', 'k-1', { reason: 'rain' }, null);
    expect(h.log).toEqual(['pre', 'idem', 'uow', 'lock', 'update', 'audit:equipment.booking.cancelled', 'outbox']);
    expect((h.idem.remember.mock.calls[0] as unknown as [string, string, string])[0]).toBe('k-1');
    const row = (h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>])[1];
    expect([row.oldValue, row.newValue]).toEqual([{ status: 'requested' }, { status: 'cancelled', refundMinor: '0', reason: 'rain' }]);
  });
  it('the cancel body is a STRICT DTO: a reason of 1–250 characters or none; nothing else', () => {
    expect(CancelBookingSchema.safeParse({}).success).toBe(true);
    expect(CancelBookingSchema.safeParse({ reason: 'rain' }).success).toBe(true);
    expect(CancelBookingSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(CancelBookingSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(CancelBookingSchema.safeParse({ reason: 'x'.repeat(251) }).success).toBe(false);
    expect(CancelBookingSchema.safeParse({ reason: 5 }).success).toBe(false);
    expect(CancelBookingSchema.safeParse({ reason: 'rain', refund: '1' }).success).toBe(false);
  });
});

describe('PC-56 OPS-4a · E14 · a hire\'s rate day is the organisation\'s own day of scheduledAt', () => {
  it('request asks tenantDay for the day of the WHOLE timestamp and resolves the rate on exactly that day', async () => {
    const h = bookingHarness(null);
    const at = '2027-03-10T19:00:00.000Z';   // 00:30 on 11 March in India; the UTC slice would say 10 March
    await h.svc.request(T, renter, 'k', { assetId: 'a1', rateBasis: 'per_hour', estQuantity: '6.00', scheduledAt: at });
    expect(h.rates.tenantDay).toHaveBeenCalledWith(expect.anything(), T, at);
    expect(h.rates.resolveActive).toHaveBeenCalledWith(expect.anything(), 'a1', 'per_hour', '2027-03-11');
    expect(h.log.indexOf('day')).toBeLessThan(h.log.indexOf('rate'));
  });
  it('tenantDay converts in SQL through the tenant\'s country timezone', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ day: '2027-03-11' }] }) };
    expect(await new EquipmentRateRepository({} as never).tenantDay(tx as never, T, '2027-03-10T19:00:00.000Z')).toBe('2027-03-11');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/\(\(\$1::timestamptz\) AT TIME ZONE co\.timezone\)::date::text/); expect(sql).toMatch(/JOIN countries co ON co\.code = t\.country_code/);
    expect(params).toEqual(['2027-03-10T19:00:00.000Z', T]);
  });
  it('no service slices a timestamp into a day', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'equipment-booking.service.ts'), 'utf8');
    expect(/scheduledAt\.slice\(/.test(src.replace(/^\s*\/\/.*$/gm, ''))).toBe(false);
  });
});

describe('PC-56 OPS-4a · B18 / E15 · quantities as scaled strings, both ways', () => {
  it('parseScaled / formatScaled by string placement', () => {
    expect([parseScaled('3.5', 2), parseScaled('8', 2), parseScaled('8.00', 2), parseScaled('0.05', 2), parseScaled('12345678.99', 2)]).toEqual([350n, 800n, 800n, 5n, 1234567899n]);
    expect([formatScaled(350n, 2), formatScaled(5n, 2), formatScaled(0n, 2), formatScaled(1234567899n, 2)]).toEqual(['3.50', '0.05', '0.00', '12345678.99']);
    expect(() => parseScaled('1.234', 2)).toThrow(); expect(() => parseScaled('abc', 2)).toThrow();
  });
  it('the repository reads pg\'s numeric STRINGS and the entity prints them back unchanged', async () => {
    const row = { id: 'b1', tenant_id: T, booking_no: 'EQ-X', renter_user_id: 'r', asset_id: 'a1', owner_user_id: 'o', operator_user_id: null, task_desc: null,
      rate_basis: 'per_hour', rate_minor: '15000', est_quantity: '12345678.99', actual_quantity: '0.07', scheduled_at: new Date(), status: 'completed',
      advance_minor: '0', total_minor: '1', start_otp_hash: null, started_at: null, completed_at: null, created_at: new Date(), usage_confirmed_by: null, usage_confirmed_at: null };
    const exec = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
    const b = await new EquipmentBookingRepository({ forTenant: () => exec } as never).getById(T, 'b1');
    expect([b!.toJSON().estQuantity, b!.toJSON().actualQuantity]).toEqual(['12345678.99', '0.07']);
  });
  it('no Number( on a quantity in the entity, the repository or the service', () => {
    for (const f of ['domain/equipment-booking.entity.ts', 'repositories/equipment-booking.repository.ts', 'services/equipment-booking.service.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '');
      expect([f, /Number\(|parseFloat|toFixed|Math\.round/.test(src)]).toEqual([f, false]);
    }
  });
});
