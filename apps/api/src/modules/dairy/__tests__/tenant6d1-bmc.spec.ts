// modules/dairy/__tests__/tenant6d1-bmc.spec.ts · PC-56 TENANT-6d-1 · W170, the tank.
//
// What is asserted here, and why each one is a defect if it breaks:
//
//   • **A STALE READING IS NOT A TEMPERATURE.** *"Sensors buffer locally; a gap is a connectivity issue, not a
//     temperature unknown"* — a monitor that shows a forty-minute-old number as the tank's state is how a cooperative
//     throws away good milk, or keeps bad milk.
//   • **THE BAND IS THE TANK'S.** Every judgement uses `min … target + tolerance` read from the unit; a caller that can
//     supply its own band never breaches.
//   • **FREEZING IS A FAULT TOO.** `below_min` exists because milk that froze is damaged milk.
//   • **THE COMPRESSOR IS SOMEBODY'S WORD.** Nothing infers it from the temperature — ever, in any branch.
//   • **THE PLAYBOOK'S THRESHOLDS ARE THE TENANT'S**, and inverted ones are refused rather than silently reordered.
//   • **NO FLOATS.** Temperatures are deci-degrees and volumes centi-litres, parsed and printed by string.
//   • **`@Get('monitor')` IS DECLARED BEFORE `@Get(':id')`** — the trap TENANT-6c-6 documented, asserted the same way.
import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import {
  bandOf, cOfDeci, deciOfC, fillPct, isBreach, litresLostVerdict, playbook, readingVerdict, telemetryVerdict,
  timeInRangeBp,
} from '../domain/bmc';
import { BmcUnit } from '../domain/bmc-unit.entity';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { BmcController } from '../controllers/v1/bmc.controller';
import { RecordBmcReadingSchema, RegisterBmcSchema, QueryBmcMonitorSchema } from '../dto/bmc.dto';
import { DairyBmcReadModel } from '../read-models/dairy-bmc.read-model';
import { centiOfLitres } from '../services/bmc-unit.service';
import { BmcReadingService } from '../services/bmc-reading.service';
import * as fs from 'node:fs';
import * as path from 'node:path';

const UNIT = { minDeci: 0, targetDeci: 40, toleranceDeci: 5 };   // 0.0 … 4.5, target 4.0 — W170's own band

describe('PC-56 TENANT-6d-1 · W170 the BMC monitor', () => {
  /* ------------------------------------------------------------------------------------------------------- */
  /* THE BAND                                                                                                */
  /* ------------------------------------------------------------------------------------------------------- */

  it('derives the band from the tank: min … target + tolerance', () => {
    expect(bandOf(UNIT)).toEqual({ minDeci: 0, targetDeci: 40, maxDeci: 45 });
    // The canon's own numbers: 4.5 is IN range and 4.6 is not.
    expect(readingVerdict(45, bandOf(UNIT))).toBe('in_range');
    expect(readingVerdict(46, bandOf(UNIT))).toBe('above_band');
    expect(readingVerdict(69, bandOf(UNIT))).toBe('above_band');
  });

  it('treats freezing as a fault, not as a cooler doing well', () => {
    expect(readingVerdict(-1, bandOf(UNIT))).toBe('below_min');
    expect(isBreach(-1, bandOf(UNIT))).toBe(true);
    expect(isBreach(0, bandOf(UNIT))).toBe(false);
  });

  it('agrees with itself about what a breach is', () => {
    for (const t of [-10, -1, 0, 20, 40, 45, 46, 69, 120]) {
      expect(isBreach(t, bandOf(UNIT))).toBe(readingVerdict(t, bandOf(UNIT)) !== 'in_range');
    }
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE GAP                                                                                                 */
  /* ------------------------------------------------------------------------------------------------------- */

  it('reports a silent sensor as a GAP with its age, never as a temperature', () => {
    const now = new Date('2026-08-20T14:20:00Z');
    const live = telemetryVerdict(new Date('2026-08-20T14:12:00Z'), now, 15);
    expect(live).toEqual({ state: 'live', ageMinutes: 8, silenceMinutes: 15 });
    const stale = telemetryVerdict(new Date('2026-08-20T13:40:00Z'), now, 15);
    expect(stale).toEqual({ state: 'stale', ageMinutes: 40, silenceMinutes: 15 });
    // Exactly at the threshold is a gap: the promise is "after 15 minutes", and 15 minutes is after 15 minutes.
    expect(telemetryVerdict(new Date('2026-08-20T14:05:00Z'), now, 15).state).toBe('stale');
    expect(telemetryVerdict(null, now, 15)).toEqual({ state: 'never', ageMinutes: null, silenceMinutes: 15 });
  });

  it('does not report a negative age when a sensor clock runs fast', () => {
    const now = new Date('2026-08-20T14:20:00Z');
    const v = telemetryVerdict(new Date('2026-08-20T14:23:00Z'), now, 15);
    expect(v.state).toBe('live');
    expect(v.ageMinutes).toBe(0);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* HOW FULL, AND THE ARITHMETIC                                                                            */
  /* ------------------------------------------------------------------------------------------------------- */

  it('truncates the fill share and refuses to guess when either number is missing', () => {
    expect(fillPct(82000n, 200000n)).toBe(41);        // 820 L in a 2,000 L tank — W170's own tile
    expect(fillPct(199600n, 200000n)).toBe(99);       // truncated: 99.8% must not read as full
    expect(fillPct(null, 200000n)).toBeNull();
    expect(fillPct(82000n, null)).toBeNull();
    expect(fillPct(82000n, 0n)).toBeNull();           // a zero-capacity tank is bad data, not an infinite one
  });

  it('parses and prints temperatures by string, never through a float', () => {
    expect(deciOfC('6.9')).toBe(69);
    expect(deciOfC('4')).toBe(40);
    expect(deciOfC('-1.5')).toBe(-15);
    expect(cOfDeci(69)).toBe('6.9');
    expect(cOfDeci(40)).toBe('4.0');
    expect(cOfDeci(-15)).toBe('-1.5');
    // Two decimals are not storable and must be refused rather than rounded into somebody's band.
    expect(() => deciOfC('4.55')).toThrow();
    expect(() => deciOfC('cold')).toThrow();
  });

  it('parses litres to hundredths by string', () => {
    expect(centiOfLitres('2000')).toBe(200000n);
    expect(centiOfLitres('1500.5')).toBe(150050n);
    expect(centiOfLitres('0.01')).toBe(1n);
    expect(() => centiOfLitres('1500.555')).toThrow();
    expect(() => centiOfLitres('-5')).toThrow();
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE PLAYBOOK                                                                                            */
  /* ------------------------------------------------------------------------------------------------------- */

  it('turns each step on at the TENANT\'s threshold, and performs none of them', () => {
    const t = { divertDeci: 75, condemnDeci: 80 };
    const cold = playbook(40, t);
    expect(cold.map((p) => p.due)).toEqual([true, false, false]);
    const warm = playbook(76, t);
    expect(warm.map((p) => p.due)).toEqual([true, true, false]);
    const hot = playbook(80, t);
    expect(hot.map((p) => p.due)).toEqual([true, true, true]);        // AT the threshold, not above it
    for (const p of hot) expect(p.built).toBe(false);
    // A tenant that tightened its own numbers gets its own numbers.
    expect(playbook(70, { divertDeci: 65, condemnDeci: 70 }).map((p) => p.due)).toEqual([true, true, true]);
  });

  it('refuses an inverted playbook rather than reordering it silently', () => {
    // Divert at 8.0 and test-before-pooling at 7.5 would tell a cooperative to move milk AFTER testing it.
    expect(() => playbook(60, { divertDeci: 80, condemnDeci: 75 })).toThrow(/inverted/);
  });

  it('says nothing is due when no reading has ever arrived', () => {
    expect(playbook(null, { divertDeci: 75, condemnDeci: 80 }).map((p) => p.due)).toEqual([false, false, false]);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE QUARTER                                                                                             */
  /* ------------------------------------------------------------------------------------------------------- */

  it('refuses a share of nothing rather than printing 100%', () => {
    expect(timeInRangeBp(0, 0)).toBeNull();
    expect(timeInRangeBp(992, 1000)).toBe(9920);
    expect(timeInRangeBp(1000, 1000)).toBe(10_000);
  });

  it('will not claim litres it cannot measure', () => {
    const v = litresLostVerdict();
    expect(v.kind).toBe('not_measurable');
    expect(v.needs.length).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE AGGREGATE                                                                                           */
  /* ------------------------------------------------------------------------------------------------------- */

  const unit = (o: Partial<Parameters<typeof BmcUnit.register>[0]> = {}) => BmcUnit.register({
    id: 'u1', tenantId: 't1', mccId: 'm1', ...UNIT, capacityCenti: 200000n,
    iotDeviceRef: 'dev-1', model: 'IceCool 2000', serialNo: 'IC-1', ...o,
  });

  it('registers with the compressor UNKNOWN — never healthy because nobody has complained', () => {
    const u = unit();
    expect(u.toProps().compressorState).toBe('unknown');
    expect(u.toProps().compressorStateAt).toBeNull();
    expect(u.pullEvents().map((e) => e.type)).toEqual(['dairy.bmc_registered']);
  });

  it('refuses a band that is not a band', () => {
    expect(() => unit({ targetDeci: -10, minDeci: 0 })).toThrow(/colder than the floor/);
    expect(() => unit({ toleranceDeci: 60 })).toThrow(/tolerance/);
    expect(() => unit({ capacityCenti: 0n })).toThrow(/capacity/);
  });

  it('records a compressor statement with WHO and WHEN, and allows a withdrawal', () => {
    const u = unit();
    u.pullEvents();                                    // the registration event, already asserted above
    u.stateCompressor('healthy', new Date('2026-08-20T10:00:00Z'), 'op-1');
    expect(u.toProps()).toMatchObject({ compressorState: 'healthy', compressorStateBy: 'op-1' });
    expect(u.pullEvents().map((e) => e.type)).toEqual(['dairy.bmc_compressor_stated']);
    // Somebody who no longer stands behind last week's word must be able to say so.
    u.stateCompressor('unknown', new Date('2026-08-21T10:00:00Z'), 'op-2');
    expect(u.toProps().compressorState).toBe('unknown');
    expect(u.toProps().compressorStateBy).toBe('op-2');
  });

  it('refuses a level above the tank\'s capacity', () => {
    const u = unit();
    expect(() => u.reportLevel(200001n, new Date(), 'op-1')).toThrow(/faulty reading/);
    u.reportLevel(82000n, new Date('2026-08-20T10:00:00Z'), 'op-1');
    expect(u.toProps().volumeCenti).toBe(82000n);
  });

  it('accepts nothing at all once retired — the sensor on a sold tank is the fault to find', () => {
    const u = unit();
    u.retire(new Date('2026-08-20T10:00:00Z'), 'desk-1');
    expect(u.isActive).toBe(false);
    expect(() => u.retire(new Date(), 'desk-1')).toThrow(/already been retired/);
    expect(() => u.reportLevel(1000n, new Date(), 'op-1')).toThrow(/retired/);
    expect(() => u.stateCompressor('healthy', new Date(), 'op-1')).toThrow(/retired/);
    expect(() => u.setBand(0, 40, 5, 'desk-1')).toThrow(/retired/);
  });

  it('publishes a band change with both sides of it', () => {
    const u = unit();
    u.pullEvents();
    u.setBand(0, 45, 5, 'desk-1');
    const [e] = u.pullEvents();
    expect(e.type).toBe('dairy.bmc_band_changed');
    expect(e.payload).toMatchObject({ before: UNIT, after: { minDeci: 0, targetDeci: 45, toleranceDeci: 5 } });
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE READING PATH — the band comes from the TANK, and the refusals are refusals                          */
  /* ------------------------------------------------------------------------------------------------------- */

  const readingHarness = (over: { unit?: BmcUnit | null; byId?: BmcUnit | null } = {}) => {
    const found = over.unit === undefined ? unit() : over.unit;
    const appendForOwner = jest.fn(async (_t: string, input: any) => ({
      id: 'log-1', subjectType: input.subjectType, subjectId: input.subjectId, tempC: input.tempC,
      // The seam's own arithmetic, mirrored: this is what logistics computes from the band we hand it.
      isBreach: input.tempC < input.allowedMinC || input.tempC > input.allowedMaxC,
      recordedAt: input.recordedAt,
    }));
    const units = {
      byDeviceRef: jest.fn(async () => found),
      byId: jest.fn(async () => (over.byId === undefined ? found : over.byId)),
    };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn({ query: jest.fn() })) };
    const svc = new BmcReadingService(uow as never, { inc: jest.fn(), observe: jest.fn() } as never, units as never, { appendForOwner } as never);
    return { svc, appendForOwner, units };
  };

  const dairyActor = { userId: 'desk-1', canManage: true };

  it('hands logistics the TANK\'s band, never one the caller chose', async () => {
    const h = readingHarness();
    const r = await h.svc.record('t1', dairyActor as never, { deviceRef: 'dev-1', tempC: '6.9' });
    expect(h.appendForOwner).toHaveBeenCalledTimes(1);
    const [, input] = h.appendForOwner.mock.calls[0];
    // 0.0 … 4.5 — min_temp_c and target + tolerance, from the unit row (0162).
    expect(input.allowedMinC).toBe(0);
    expect(input.allowedMaxC).toBe(4.5);
    expect(input.subjectType).toBe('bmc_unit');
    expect(input.deviceRef).toBe('dev-1');
    expect(r.isBreach).toBe(true);
    expect(r.verdict).toBe('above_band');
    // The wire value comes from the INTEGER this module held, not from the float handed across the seam.
    expect(r.tempC).toBe('6.9');
    expect(r.band).toEqual({ minC: '0.0', maxC: '4.5' });
  });

  // The float round-trip is INVISIBLE at 6.9 and loud at 5.0: `String(5)` is "5", and a screen that prints "5" where
  // every other reading says "5.0" is a screen whose column no longer lines up — and, worse, a wire contract that
  // sometimes carries one decimal and sometimes none. The integer is the source of the string, always.
  it('prints the wire temperature to one decimal even at a whole degree', async () => {
    const h = readingHarness();
    const r = await h.svc.record('t1', dairyActor as never, { deviceRef: 'dev-1', tempC: '5.0' });
    const [, input] = h.appendForOwner.mock.calls[0];
    expect(input.tempC).toBe(5); // the seam took the number, and lost the decimal place doing it
    expect(r.tempC).toBe('5.0'); // the wire did not
  });

  it('writes a reading inside the band as no breach', async () => {
    const r = await readingHarness().svc.record('t1', dairyActor as never, { deviceRef: 'dev-1', tempC: '4.5' });
    expect(r.isBreach).toBe(false);
    expect(r.verdict).toBe('in_range');
  });

  it('refuses the stream without the dairy desk — before it reads anything', async () => {
    const h = readingHarness();
    await expect(h.svc.record('t1', { userId: 'x', canManage: false } as never, { deviceRef: 'dev-1', tempC: '4.0' }))
      .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    expect(h.units.byDeviceRef).not.toHaveBeenCalled();
    expect(h.appendForOwner).not.toHaveBeenCalled();
  });

  it('refuses a reading from a RETIRED cooler and writes nothing', async () => {
    const retired = unit();
    retired.retire(new Date('2026-08-01T00:00:00Z'), 'desk-1');
    const h = readingHarness({ unit: retired });
    await expect(h.svc.record('t1', dairyActor as never, { deviceRef: 'dev-1', tempC: '4.0' }))
      .rejects.toMatchObject({ code: 'BMC_READING_REFUSED' });
    expect(h.appendForOwner).not.toHaveBeenCalled();
  });

  it('refuses a payload that names BOTH a sensor and a tank, or neither', async () => {
    const h = readingHarness();
    for (const bad of [{ deviceRef: 'dev-1', unitId: 'u1', tempC: '4.0' }, { tempC: '4.0' }]) {
      await expect(h.svc.record('t1', dairyActor as never, bad as never)).rejects.toMatchObject({ code: 'BMC_READING_REFUSED' });
    }
    expect(h.appendForOwner).not.toHaveBeenCalled();
  });

  it('refuses an unknown SENSOR with that reason, and an unknown tank as not-found', async () => {
    const noSensor = readingHarness({ unit: null });
    await expect(noSensor.svc.record('t1', dairyActor as never, { deviceRef: 'dev-nobody', tempC: '4.0' }))
      .rejects.toMatchObject({ code: 'BMC_READING_REFUSED' });
    const noTank = readingHarness({ unit: null, byId: null });
    await expect(noTank.svc.record('t1', dairyActor as never, { unitId: 'u-nobody', tempC: '4.0' }))
      .rejects.toMatchObject({ code: 'BMC_UNIT_NOT_FOUND' });
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE SQL                                                                                                 */
  /* ------------------------------------------------------------------------------------------------------- */

  const repoHarness = () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const query = jest.fn(async (sql: string, params: readonly unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; });
    return { repo: new BmcUnitRepository({ forTenant: () => ({ query }) } as never), calls, query };
  };

  it('reads only THIS tenant\'s live coolers, with the latest reading and the 24-hour counts', async () => {
    const h = repoHarness();
    await h.repo.monitor('t1', 24);
    const sql = h.calls[0].sql;
    expect(sql).toMatch(/b\.tenant_id = \$1 AND b\.is_active = true AND b\.deleted_at IS NULL/);
    expect(sql).toMatch(/subject_type = 'bmc_unit'/);
    // The centre join is tenant-bound too, and the latest reading is the LATEST (not any row).
    expect(sql).toMatch(/JOIN mcc_centres m ON m\.id = b\.mcc_id AND m\.tenant_id = b\.tenant_id/);
    expect(sql).toMatch(/ORDER BY recorded_at DESC, id DESC LIMIT 1/);
  });

  it('draws the series oldest-first inside the window, bounded', async () => {
    const h = repoHarness();
    await h.repo.series('t1', 'u1', 6, 500);
    expect(h.calls[0].sql).toMatch(/ORDER BY recorded_at, id LIMIT \$4/);
    expect(h.calls[0].sql).toMatch(/recorded_at >= now\(\) - \(\$3 \|\| ' hours'\)::interval/);
    expect(h.calls[0].params).toEqual(['t1', 'u1', '6', 500]);
  });

  it('finds a cooler by its sensor WITHOUT filtering retired ones out', async () => {
    // A reading from a retired tank must be REFUSED with that reason, which needs the row to be found first.
    const h = repoHarness();
    await h.repo.byDeviceRef({ query: h.query } as never, 't1', 'dev-1');
    expect(h.calls[0].sql).toMatch(/tenant_id=\$1 AND iot_device_ref=\$2/);
    // `is_active` appears in the projection (the caller needs it to REFUSE the reading with the right reason) and must
    // not appear in the WHERE: a retired tank whose sensor is still reporting has to be findable to be refused.
    expect(h.calls[0].sql).not.toMatch(/WHERE[\s\S]*is_active/);
  });

  it('fails closed when the unit UPDATE touches no row', async () => {
    // The ruling this programme has now made on seven tables: a zero-row UPDATE means the row moved under us, and
    // returning success would publish a state nothing holds.
    const zero = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
    const repo = new BmcUnitRepository({ forTenant: () => zero } as never);
    await expect(repo.update(zero as never, unit())).rejects.toThrow(/was not updated/);
    const one = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
    await expect(new BmcUnitRepository({ forTenant: () => one } as never).update(one as never, unit())).resolves.toBeUndefined();
  });

  it('reads the playbook thresholds from the tenant\'s settings and refuses to default them', async () => {
    const rows = (v: Array<{ key: string; v: number }>) => ({
      query: jest.fn(async () => ({ rows: v, rowCount: v.length })),
    });
    const h = repoHarness();
    const ok = await h.repo.thresholds(rows([
      { key: 'dairy.bmc_divert_temp_decic', v: 75 },
      { key: 'dairy.bmc_condemn_temp_decic', v: 80 },
      { key: 'dairy.bmc_silence_minutes', v: 15 },
    ]) as never, 't1');
    expect(ok).toEqual({ divertDeci: 75, condemnDeci: 80, silenceMinutes: 15 });
    // A missing setting is a refusal, not a 7.5 nobody chose.
    await expect(h.repo.thresholds(rows([{ key: 'dairy.bmc_divert_temp_decic', v: 75 }]) as never, 't1')).rejects.toThrow(/refusing to guess/);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE ROUTE AND THE QUERY                                                                                 */
  /* ------------------------------------------------------------------------------------------------------- */

  it('declares /monitor BEFORE /:id, so the screen is reachable at all', () => {
    const proto = BmcController.prototype as unknown as Record<string, unknown>;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((m) => m !== 'constructor')
      .map((m) => Reflect.getMetadata(PATH_METADATA, proto[m] as never) as string | undefined)
      .filter((p): p is string => typeof p === 'string');
    expect(paths).toContain('monitor');
    expect(paths.indexOf('monitor')).toBeLessThan(paths.indexOf(':id'));
  });

  it('requires exactly one identifier on a reading', () => {
    expect(RecordBmcReadingSchema.safeParse({ tempC: '6.9', deviceRef: 'dev-1' }).success).toBe(true);
    expect(RecordBmcReadingSchema.safeParse({ tempC: '6.9', unitId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }).success).toBe(true);
    // BOTH is a gateway that is not sure which tank it is talking about; NEITHER is a reading about nothing.
    expect(RecordBmcReadingSchema.safeParse({ tempC: '6.9', deviceRef: 'd', unitId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }).success).toBe(false);
    expect(RecordBmcReadingSchema.safeParse({ tempC: '6.9' }).success).toBe(false);
    // Temperatures are one-decimal STRINGS — a double is how 4.5 becomes 4.499999.
    expect(RecordBmcReadingSchema.safeParse({ tempC: 6.9, deviceRef: 'd' }).success).toBe(false);
    expect(RecordBmcReadingSchema.safeParse({ tempC: '6.95', deviceRef: 'd' }).success).toBe(false);
  });

  it('defaults the register to W170\'s own band, and the chart to six hours', () => {
    const r = RegisterBmcSchema.parse({ mccId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', capacityLitres: '2000' });
    // The DTO leaves the defaults to the service so there is one place that says 4.0/0.0/0.5.
    expect(r.targetTempC).toBeUndefined();
    expect(QueryBmcMonitorSchema.parse({}).hours).toBe(6);
    expect(QueryBmcMonitorSchema.safeParse({ hours: 0 }).success).toBe(false);
    expect(QueryBmcMonitorSchema.safeParse({ hours: 169 }).success).toBe(false);
    expect(QueryBmcMonitorSchema.safeParse({ nonsense: 1 }).success).toBe(false);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE COMPOSITION                                                                                         */
  /* ------------------------------------------------------------------------------------------------------- */

  const NOW = new Date('2026-08-20T14:20:00Z');

  const tile = (o: { tempDeci?: number | null; lastAt?: Date | null; code?: string; breaches?: number; readings?: number; retired?: boolean } = {}) => ({
    unit: BmcUnit.rehydrate({
      id: `u-${o.code ?? 'a'}`, tenantId: 't1', mccId: 'm1', ...UNIT, capacityCenti: 200000n,
      volumeCenti: 82000n, volumeAt: NOW, volumeBy: 'op-1', iotDeviceRef: `dev-${o.code ?? 'a'}`,
      model: null, serialNo: null, compressorState: 'unknown', compressorStateAt: null, compressorStateBy: null,
      isActive: !o.retired, retiredAt: null, retiredBy: null,
    } as never),
    mccCode: `MCC-AND-0${o.code ?? '1'}`, mccName: 'Vanthali', operatorUserId: 'op-1',
    lastTempDeci: o.tempDeci === undefined ? 38 : o.tempDeci,
    lastAt: o.lastAt === undefined ? new Date('2026-08-20T14:18:00Z') : o.lastAt,
    lastIsBreach: false, breaches24h: o.breaches ?? 0, readings24h: o.readings ?? 120,
  });

  const rmHarness = (over: Record<string, unknown> = {}) => {
    const deps = {
      replica: { forTenant: () => ({ query: jest.fn(async (sql: string) => (sql.includes('now()') ? { rows: [{ n: NOW }] } : { rows: [{ ev: 1, sms: 3 }] })) }) },
      units: {
        monitor: jest.fn(async () => [tile({ code: '1' }), tile({ code: '3', tempDeci: 69 })]),
        thresholds: jest.fn(async () => ({ divertDeci: 75, condemnDeci: 80, silenceMinutes: 15 })),
        windowCounts: jest.fn(async () => ({ readings: 1000, breaches: 8, units: 3 })),
        series: jest.fn(async () => [
          { tempDeci: 40, at: new Date('2026-08-20T09:00:00Z'), isBreach: false },
          { tempDeci: 69, at: new Date('2026-08-20T14:18:00Z'), isBreach: true },
        ]),
      },
      alerts: { listRules: jest.fn(async () => [{ kind: 'cold_chain_breach', recipientUserIds: ['op-1', 'lead-1'] }]) },
      flags: { isEnabled: jest.fn(async () => true) },
      metrics: { inc: jest.fn(), observe: jest.fn() },
      ...over,
    };
    const rm = new DairyBmcReadModel(deps.replica as never, deps.units as never, deps.alerts as never, deps.flags as never, deps.metrics as never);
    return { rm, deps };
  };

  const actor = { userId: 'u1', canManage: true };

  it('composes W170: the tiles, the focus tank, the playbook and the quarter', async () => {
    const h = rmHarness();
    const v = await h.rm.view('t1', actor, {});
    expect(v.units).toHaveLength(2);
    expect(v.aboveBand).toBe(1);
    expect(v.units[1].tempC).toBe('6.9');
    expect(v.units[1].verdict).toBe('above_band');
    expect(v.units[0].fillPct).toBe(41);
    expect(v.thresholds).toEqual({ divertC: '7.5', condemnC: '8.0', silenceMinutes: 15 });
    expect(v.quarter.timeInRangeBp).toBe(9920);
    expect(v.quarter.litresLost.kind).toBe('not_measurable');
  });

  it('opens on the WARMEST out-of-band tank, which is the one an operator came to look at', async () => {
    const v = await rmHarness().rm.view('t1', actor, {});
    expect(v.focus?.unitId).toBe('u-3');
    expect(v.focus?.playbook.find((p) => p.step === 'divert_next_shift')?.due).toBe(false);   // 6.9 < 7.5
    expect(v.focus?.points).toHaveLength(2);
  });

  it('does not let a STALE tile count as above the band', async () => {
    // A tank whose sensor died an hour ago is a connectivity problem, and counting it in the header badge would send
    // an operator to a working cooler.
    const h = rmHarness({
      units: {
        monitor: jest.fn(async () => [tile({ code: '3', tempDeci: 69, lastAt: new Date('2026-08-20T13:00:00Z') })]),
        thresholds: jest.fn(async () => ({ divertDeci: 75, condemnDeci: 80, silenceMinutes: 15 })),
        windowCounts: jest.fn(async () => ({ readings: 0, breaches: 0, units: 0 })),
        series: jest.fn(async () => []),
      },
    });
    const v = await h.rm.view('t1', actor, {});
    expect(v.units[0].telemetry.state).toBe('stale');
    expect(v.units[0].telemetry.ageMinutes).toBe(80);
    expect(v.aboveBand).toBe(0);
    expect(v.quarter.timeInRangeBp).toBeNull();      // no readings ⇒ no share, never 100%
  });

  it('says whether an ops alert could actually be delivered, and who is named', async () => {
    const h = rmHarness();
    const v = await h.rm.view('t1', actor, {});
    expect(v.alerting.breachRules).toBe(1);
    expect(v.alerting.recipients).toBe(2);
    expect(v.alerting.eventCatalogued).toBe(true);
    expect(v.alerting.smsDeliverable).toBe(true);
    // `device_silent` measures whole hours, so 15 minutes cannot be expressed by any rule a tenant could write.
    expect(v.alerting.silenceExpressible).toBe(false);
  });

  it('reports the SMS leg as UNDELIVERABLE when its template is missing — the PC-55 defect this wave found', async () => {
    // 0086 catalogued the event with `default_channels = ["push","sms"]` and seeded push + inapp only, so every ops
    // alert produced a push and a FAILED text. A village operator's phone was the channel that mattered.
    const h = rmHarness({
      replica: { forTenant: () => ({ query: jest.fn(async (sql: string) => (sql.includes('now()') ? { rows: [{ n: NOW }] } : { rows: [{ ev: 1, sms: 0 }] })) }) },
    });
    const v = await h.rm.view('t1', actor, {});
    expect(v.alerting.eventCatalogued).toBe(true);
    expect(v.alerting.smsDeliverable).toBe(false);
  });

  it('refuses the monitor without the dairy desk', async () => {
    const h = rmHarness();
    await expect(h.rm.view('t1', { userId: 'u1', canManage: false }, {})).rejects.toBeDefined();
    expect(h.deps.units.monitor).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* WHAT 0162 AND THE SEED SAY OUT LOUD                                                                     */
  /* ------------------------------------------------------------------------------------------------------- */

  const sqlOf = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../../../..', rel), 'utf8');

  it('0162 constrains the band, the level, the compressor\'s author and the retirement stamp', () => {
    const m = sqlOf('db/migrations/0162_dairy_bmc_monitor.sql');
    expect(m).toMatch(/ADD CONSTRAINT ck_bmc_band CHECK \(/);
    expect(m).toMatch(/target_temp_c >= min_temp_c/);
    expect(m).toMatch(/ADD CONSTRAINT ck_bmc_volume CHECK \(/);
    expect(m).toMatch(/volume_litres <= capacity_litres/);
    // A stated compressor condition carries WHO said it and WHEN; only `unknown` may stand alone.
    expect(m).toMatch(/compressor_state = 'unknown'\) OR \(compressor_state_at IS NOT NULL AND compressor_state_by IS NOT NULL\)/);
    expect(m).toMatch(/ADD CONSTRAINT ck_bmc_retired CHECK \(/);
  });

  it('0162 gives one sensor to one cooler, by a PARTIAL unique index', () => {
    const m = sqlOf('db/migrations/0162_dairy_bmc_monitor.sql');
    expect(m).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_bmc_device_ref\s+ON bmc_units \(tenant_id, iot_device_ref\)\s+WHERE iot_device_ref IS NOT NULL/);
  });

  it('0162 closes the subject-type vocabulary that lived in a SQL comment', () => {
    const m = sqlOf('db/migrations/0162_dairy_bmc_monitor.sql');
    expect(m).toMatch(/ADD CONSTRAINT ck_cold_chain_subject\s+CHECK \(subject_type IN \('shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box'\)\)/);
  });

  it('0162 makes a platform notification template unique per event, channel and language', () => {
    const m = sqlOf('db/migrations/0162_dairy_bmc_monitor.sql');
    // The trap this closes: the table's own key includes a NULL tenant_id, so `ON CONFLICT` constrained nothing and the
    // seed duplicated 98 groups on every re-run (6c-4's finding, second instance).
    expect(m).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_templates_platform/);
    expect(m).toMatch(/WHERE tenant_id IS NULL AND deleted_at IS NULL/);
    expect(m).toMatch(/row_number\(\) OVER \(/);         // de-duplicated first, keeping the earliest
  });

  it('0162 ships the monitor OFF and keeps every threshold a TENANT setting', () => {
    const m = sqlOf('db/migrations/0162_dairy_bmc_monitor.sql');
    expect(m).toMatch(/\('dairy_bmc_monitor',[\s\S]*?\n   false, 100, 'experiment'\)/);
    for (const k of ['dairy.bmc_divert_temp_decic', 'dairy.bmc_condemn_temp_decic', 'dairy.bmc_silence_minutes']) {
      expect(m).toMatch(new RegExp(`SELECT '${k.replace('.', '\\.')}', 'int', 'tenant',`));
    }
    // ...and a cooperative's own numbers cannot be locked away at platform scope.
    expect(m).not.toMatch(/'int', 'platform',/);
  });

  it('the seed gives the ops alert the SMS wording a village operator actually receives', () => {
    const seed = sqlOf('db/seeds/core/0007_notification_events_templates.sql');
    for (const lang of ['gu', 'hi', 'en']) {
      expect(seed).toContain(`('ops.alert_fired','sms','${lang}'`);
    }
    // Untargeted ON CONFLICT: the four-column key includes a NULL tenant_id and therefore matched nothing.
    expect(seed).not.toMatch(/ON CONFLICT \(event_code, channel, language_code, tenant_id\) DO NOTHING;/);
    // And the block sits ABOVE the version backfill, or the new rows ship unversioned and unsendable (6c-2's gate).
    expect(seed.indexOf("('ops.alert_fired','sms','en'")).toBeLessThan(seed.indexOf('INSERT INTO notification_template_versions ('));
  });
});
