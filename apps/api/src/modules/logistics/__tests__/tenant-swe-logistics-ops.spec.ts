// modules/logistics/__tests__/tenant-swe-logistics-ops.spec.ts · PC-56 TENANT-SW-e — the pure domain of logistics ops: every figure is a
// ratio of two counts or refused by name; the slot windows mirror 0201's check; the suggestion grid is a read of facts; the run state
// machine never offers the drafter a confirm; the ingest signature is constant-time over `<ts>.<nonce>.<raw body>` within ±5 min; the
// breach acts are once each; the median is refused when nothing has an action; a loss is only what was recorded. Plus the seams:
// the manual reading carries no band and no time; the module registers its two clocks and its two export datasets.
import { createHmac } from 'node:crypto';
import {
  REFUSED_BY_NAME, UNSIGNED_EXPORT_NOTE, breachActsFor, consolidation, ingestFreshness, istDay, keyHint, medianAlertToAction, medianSeconds, newDeviceKey,
  onTimeVerdict, ratioBps, readIngestHeaders, recordedLoss, riderFacts, runWeek, signIngest, slotWindowsRefusal, suggestionsFrom, verifyIngestSignature,
} from '../domain/logistics-ops';
import { RUN_ACTS, runActsFor, runMove } from '../domain/route-run.state';
import { ColdChainLog, excursion } from '../domain/cold-chain-log.entity';
import { RecordColdChainSchema, DeviceReadingSchema, BreachActSchema } from '../dto/cold-chain.dto';
import { CreateLogisticsPartnerSchema, SetPartnerActiveSchema } from '../dto/create-logistics-partner.dto';
import { encodeFleetCursor } from '../services/logistics-partner.service';

describe('SW-e · figures are facts or refused by name', () => {
  it('ratioBps is a floor of integers; nothing to divide by → null', () => {
    expect(ratioBps(13, 32)).toEqual({ numerator: 13, denominator: 32, bps: 4062 });
    expect(ratioBps(0, 0)).toBeNull(); expect(ratioBps(1, -1)).toBeNull(); expect(ratioBps(1.5, 3)).toBeNull();
  });
  it('on-time and insurance are refused, never a number; the rider facts are read per fact', () => {
    expect(onTimeVerdict()).toEqual({ kind: 'refused', code: 'NO_PROMISED_DELIVERY_TIME' });
    expect(riderFacts({ kyc: 'verified', riderTerms: false, defaultTerms: true })).toEqual({ kycVerified: true, kyc: 'verified', wageProtected: true, wageTerms: 'tenant_default',
      insured: { kind: 'refused', code: 'NO_RIDER_INSURANCE_RECORD' } });
    expect(riderFacts({ kyc: 'pending', riderTerms: false, defaultTerms: false })).toMatchObject({ kycVerified: false, wageProtected: false, wageTerms: 'none' });
    expect(Object.values(REFUSED_BY_NAME)).toEqual(expect.arrayContaining(['NO_PICKUP_ATTEMPT_RECORD', 'NO_VOICE_CHANNEL', 'NO_AD_HOC_FREIGHT_FACT', 'NO_CROSS_TENANT_SHIPMENT']));
  });
  it('median: middle value / floor of the two middles; median alert → action refused until an action exists', () => {
    expect(medianSeconds([])).toBeNull(); expect(medianSeconds([5, 1, 3])).toBe(3); expect(medianSeconds([1, 2, 3, 4])).toBe(2);
    expect(medianAlertToAction([{ openedAt: '2026-10-04T10:00:00Z', actionAt: null }])).toEqual({ kind: 'refused', code: 'NO_ACTION_RECORDED', over: 0 });
    expect(medianAlertToAction([{ openedAt: '2026-10-04T10:00:00Z', actionAt: '2026-10-04T10:10:00Z' }, { openedAt: '2026-10-04T10:00:00Z', actionAt: null }]))
      .toMatchObject({ kind: 'measured', seconds: 600, over: 1 });
  });
  it('loss: only what was recorded, per currency; none recorded is not zero', () => {
    expect(recordedLoss([{ lossMinor: null, lossCurrency: null }])).toEqual({ kind: 'none_recorded', breachesWithLoss: 0 });
    expect(recordedLoss([{ lossMinor: '24000', lossCurrency: 'INR' }, { lossMinor: '1000', lossCurrency: 'INR' }, { lossMinor: null, lossCurrency: null }]))
      .toEqual({ kind: 'recorded', breachesWithLoss: 2, totals: [{ currency: 'INR', minor: '25000' }] });
  });
  it('the export note says unsigned', () => { expect(UNSIGNED_EXPORT_NOTE).toBe('unsigned — signing is a founder-physical key; the sha256 is printed'); });
});

describe('SW-e · pickup slots', () => {
  it('windows mirror 0201: 1–14, weekday 0–6, start < end, none repeated', () => {
    expect(slotWindowsRefusal([])).toBe('SLOT_WINDOWS_EMPTY');
    expect(slotWindowsRefusal(Array.from({ length: 15 }, (_, i) => ({ weekday: i % 7, start: '06:00', end: `0${7 + (i % 3)}:00` })))).toBe('SLOT_WINDOWS_TOO_MANY');
    expect(slotWindowsRefusal([{ weekday: 7, start: '06:00', end: '07:00' }])).toBe('SLOT_WINDOWS_INVALID');
    expect(slotWindowsRefusal([{ weekday: 1, start: '09:00', end: '08:00' }])).toBe('SLOT_WINDOWS_INVALID');
    expect(slotWindowsRefusal([{ weekday: 1, start: '08:00', end: '09:00' }, { weekday: 1, start: '08:00', end: '09:00' }])).toBe('SLOT_WINDOWS_DUPLICATE');
    expect(slotWindowsRefusal([{ weekday: 1, start: '08:00', end: '09:00' }])).toBeNull();
  });
  it('suggestions are counts per IST weekday × block, ranked by first-attempt deliveries — no model', () => {
    // Tue 2026-10-06 08:30 IST = 03:00Z ; 16:00 IST = 10:30Z
    const s = suggestionsFrom([
      { pickedUpAt: new Date('2026-10-06T03:00:00Z'), deliveryAttempts: 1, delivered: true },
      { pickedUpAt: new Date('2026-10-06T03:10:00Z'), deliveryAttempts: 2, delivered: true },
      { pickedUpAt: new Date('2026-10-06T10:30:00Z'), deliveryAttempts: 0, delivered: false },
      { pickedUpAt: new Date('2026-10-06T18:00:00Z'), deliveryAttempts: 1, delivered: true },   // 23:30 IST — outside every block
    ]);
    expect(s).toEqual([
      { weekday: 2, start: '06:00', end: '09:00', pickups: 2, attempted: 2, firstAttempt: 1, deliveryFirstAttempt: { numerator: 1, denominator: 2, bps: 5000 } },
      { weekday: 2, start: '15:00', end: '18:00', pickups: 1, attempted: 0, firstAttempt: 0, deliveryFirstAttempt: null },
    ]);
    expect(istDay(new Date('2026-10-04T20:00:00Z'))).toMatchObject({ ymd: '2026-10-05', weekday: 1 });
  });
});

describe('SW-e · Village Run', () => {
  it('the state machine: one road, the drafter never offered a confirm', () => {
    expect(runMove('draft', 'confirm')).toBe('confirmed'); expect(runMove('confirmed', 'start_loading')).toBe('loading');
    expect(runMove('loading', 'depart')).toBe('in_transit'); expect(runMove('in_transit', 'complete')).toBe('completed');
    expect(runMove('in_transit', 'cancel')).toBeNull(); expect(runMove('completed', 'cancel')).toBeNull(); expect(runMove('draft', 'depart')).toBeNull();
    expect(runActsFor('draft', { isDrafter: true })).toEqual(['cancel']);
    expect(runActsFor('draft', { isDrafter: false })).toEqual(['confirm', 'cancel']);
    for (const a of RUN_ACTS) expect(runMove('cancelled', a)).toBeNull();
  });
  it('consolidation is a ratio of two counts; the run week is the seven days ending on the run day', () => {
    expect(consolidation(13, 32)).toEqual({ onRun: 13, boundForVillages: 32, ratio: { numerator: 13, denominator: 32, bps: 4062 } });
    expect(consolidation(0, 0).ratio).toBeNull();
    expect(runWeek('2026-10-08')).toEqual({ from: '2026-10-02', to: '2026-10-08' });
  });
});

describe('SW-e · device ingest (HMAC, ±5 min, nonce)', () => {
  const key = 'ccdk_test-key-test-key-test-key-test-key-0001';
  it('the signature is HMAC-SHA256 over `<ts>.<nonce>.<raw body>`, checked in constant time; any change fails', () => {
    const sig = signIngest(key, '1791100000', 'nonce-aaaaaaaaaaaa', '{"tempC":4}');
    expect(sig).toBe('v1=' + createHmac('sha256', key).update('1791100000.nonce-aaaaaaaaaaaa.{"tempC":4}').digest('hex'));
    expect(verifyIngestSignature(key, '1791100000', 'nonce-aaaaaaaaaaaa', '{"tempC":4}', sig)).toBe(true);
    expect(verifyIngestSignature(key, '1791100001', 'nonce-aaaaaaaaaaaa', '{"tempC":4}', sig)).toBe(false);
    expect(verifyIngestSignature(key, '1791100000', 'nonce-bbbbbbbbbbbb', '{"tempC":4}', sig)).toBe(false);
    expect(verifyIngestSignature(key, '1791100000', 'nonce-aaaaaaaaaaaa', '{"tempC":40}', sig)).toBe(false);
    expect(verifyIngestSignature(`${key}x`, '1791100000', 'nonce-aaaaaaaaaaaa', '{"tempC":4}', sig)).toBe(false);
    expect(verifyIngestSignature(key, '1791100000', 'nonce-aaaaaaaaaaaa', '{"tempC":4}', 'v1=zz')).toBe(false);
  });
  it('headers are read strictly; freshness is ±300 s', () => {
    const ok = readIngestHeaders({ 'x-kv-device': '0190A0A0-0000-7000-8000-000000000001', 'x-kv-timestamp': '1791100000', 'x-kv-nonce': 'n'.repeat(16), 'x-kv-signature': `v1=${'a'.repeat(64)}` });
    expect(ok).toMatchObject({ ok: true, deviceId: '0190a0a0-0000-7000-8000-000000000001' });
    expect(readIngestHeaders({ 'x-kv-device': 'x' })).toEqual({ ok: false, code: 'INGEST_DEVICE_HEADER' });
    expect(readIngestHeaders({ 'x-kv-device': '0190a0a0-0000-7000-8000-000000000001', 'x-kv-timestamp': '1791100000', 'x-kv-nonce': 'short', 'x-kv-signature': `v1=${'a'.repeat(64)}` })).toEqual({ ok: false, code: 'INGEST_NONCE_HEADER' });
    expect(ingestFreshness(1000, 1_300_000)).toBe('fresh'); expect(ingestFreshness(1000, 1_301_000)).toBe('stale'); expect(ingestFreshness(1301, 1_000_000)).toBe('future');
  });
  it('a device key is 32 random bytes, prefixed; the hint is its last four characters', () => {
    const a = newDeviceKey(); const b = newDeviceKey();
    expect(a).toMatch(/^ccdk_[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b); expect(keyHint(a)).toBe(a.slice(-4));
  });
});

describe('SW-e · the band never comes from a request body', () => {
  it('the manual DTO is strict: allowedMinC / allowedMaxC / recordedAt are refused by name; a device body cannot carry a band either', () => {
    const base = { subjectType: 'shipment', subjectId: '0190a0a0-0000-7000-8000-000000000001', tempC: 4 };
    expect(RecordColdChainSchema.safeParse(base).success).toBe(true);
    for (const extra of [{ allowedMinC: 2 }, { allowedMaxC: 8 }, { recordedAt: '2026-10-04T10:00:00Z' }, { bandMinC: 2 }]) {
      const r = RecordColdChainSchema.safeParse({ ...base, ...extra });
      expect(r.success).toBe(false);
      expect(JSON.stringify((r as { error: unknown }).error)).toContain(Object.keys(extra)[0]);
    }
    expect(DeviceReadingSchema.safeParse({ tempC: 4, recordedAt: '2026-10-04T10:00:00Z', bandMaxC: 50 }).success).toBe(false);
    expect(BreachActSchema.safeParse({ note: 'x', extra: 1 }).success).toBe(false);
  });
  it('the manual reading entity has no band and no time to carry; its excursion is judged only against a band handed back by the store', () => {
    const log = ColdChainLog.manual({ tenantId: 't', subjectType: 'shipment', subjectId: 's', tempC: 11, humidityPct: null, deviceRef: null });
    const props = log.toProps() as Record<string, unknown>;
    for (const k of ['allowedMinC', 'allowedMaxC']) expect(k in props).toBe(false);
    for (const k of ['recordedAt', 'bandMinC', 'bandMaxC']) expect(props[k] ?? null).toBeNull();   // the server's time and the store's band, filled by the database
    expect(props.source).toBe('manual');
    expect(excursion(log.toProps().tempC, { minC: 2, maxC: 8 })).toBe(true); expect(excursion(5, { minC: 2, maxC: 8 })).toBe(false); expect(excursion(11, null)).toBeNull();
  });
  it('carriers: a rider names its rider and no phone; a (de)activation carries a reason ≥ 10; the fleet cursor is µs only (F-14)', () => {
    expect(CreateLogisticsPartnerSchema.safeParse({ partnerKind: 'rider', defaultName: 'R' }).success).toBe(false);
    expect(CreateLogisticsPartnerSchema.safeParse({ partnerKind: 'rider', defaultName: 'R', riderUserId: '0190a0a0-0000-7000-8000-000000000001', contactPhone: '+919812345678' }).success).toBe(false);
    expect(SetPartnerActiveSchema.safeParse({ isActive: false }).success).toBe(false);
    expect(SetPartnerActiveSchema.safeParse({ isActive: false, reason: 'in the workshop' }).success).toBe(true);
    expect(() => encodeFleetCursor('2026-10-04T10:00:00.123Z', 'x')).toThrow(/microsecond/);
    expect(Buffer.from(encodeFleetCursor('2026-10-04T10:00:00.123456Z', 'x'), 'base64').toString()).toBe('2026-10-04T10:00:00.123456Z|x');
  });
});

describe('SW-e · breach acts', () => {
  it('each act once; the outcome only after the breach closed', () => {
    expect(breachActsFor({ acknowledgedAt: null, actionAt: null, outcome: null, closedAt: null })).toEqual(['acknowledge', 'record_action']);
    expect(breachActsFor({ acknowledgedAt: 'x', actionAt: null, outcome: null, closedAt: 'y' })).toEqual(['record_action', 'record_outcome']);
    expect(breachActsFor({ acknowledgedAt: 'x', actionAt: 'x', outcome: 'none', closedAt: 'y' })).toEqual([]);
  });
});
