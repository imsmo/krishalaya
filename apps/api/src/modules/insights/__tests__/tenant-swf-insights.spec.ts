// modules/insights/__tests__/tenant-swf-insights.spec.ts · PC-56 TENANT-SW-f — the pure rules: refusals and methods (one list, the seed's
// English), the demand map's stock fit / value / reach, the wastage fold (a POD and its dispute once; money with its currency, quantity
// with its unit), loss ÷ GMV, the report builder's allow-list / range / SQL / watermark / IST schedule, the run state machine, and W417's
// capture + 50-learner floor.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  METHODS, REFUSED, REFUSAL_SENTENCES, stockFit, demandValue, reachOf, measuredLoss, lossShareOfGmv, istWeekStart, thousandths, fromThousandths, shareBps,
  encodeUsCursor, decodeUsCursor,
} from '../domain/insights';
import {
  REPORT_DATASETS, resolveSpec, checkRange, compileRunSql, runHeader, watermarkLines, nextRunAt, checkSchedule, relativeRange, istStamp, MAX_RANGE_DAYS, ROW_CAP,
} from '../domain/report-builder';
import { canTransition, assertTransition } from '../domain/report-run.state';
import { dtoRangeRefusal, RunBodySchema } from '../dto/insights.dto';
import { modalChange } from '../services/insights.service';
import { LEARNER_FLOOR, LEARNER_METHODS, LEARNER_REFUSAL_SENTENCES, captureAnswers, checkWatchInterval, progressDelta, floorVerdict, missBps } from '../../education/domain/learner-insights';
import { WASTAGE_SOURCE_EVENTS } from '../events/handlers/wastage-source.handler';

const ROOT = path.join(__dirname, '../../../../../..');
const seed = fs.readFileSync(path.join(ROOT, 'db/seeds/core/0029_ui_messages_insights.sql'), 'utf8');
const mig = fs.readFileSync(path.join(ROOT, 'db/migrations/0202_insights_offline.sql'), 'utf8');
const seedText = (key: string, lang: string): string | null => {
  const re = new RegExp(`\\('${key.replace(/\./g, '\\.')}', '${lang}', '((?:[^']|'')*)'\\)`);
  const m = re.exec(seed); return m ? m[1].replace(/''/g, "'") : null;
};

describe('SW-f · one list of methods and refusals — the seed says exactly what the domain says', () => {
  it('every method has its en (identical to the domain), hi and gu in seed 0029', () => {
    for (const [code, en] of Object.entries({ ...METHODS, ...LEARNER_METHODS })) {
      expect(seedText(`insights.method.${code}`, 'en')).toBe(en);
      expect(seedText(`insights.method.${code}`, 'hi')).toBeTruthy();
      expect(seedText(`insights.method.${code}`, 'gu')).toBeTruthy();
    }
  });
  it('every refusal has its en (identical), hi and gu; the codes the brief names are all there', () => {
    for (const [code, en] of Object.entries({ ...REFUSAL_SENTENCES, ...LEARNER_REFUSAL_SENTENCES })) {
      expect(seedText(`insights.refusal.${code}`, 'en')).toBe(en);
      expect(seedText(`insights.refusal.${code}`, 'hi')).toBeTruthy(); expect(seedText(`insights.refusal.${code}`, 'gu')).toBeTruthy();
    }
    expect(Object.values(REFUSED).sort()).toEqual(['EXTERNAL_STATISTIC_UNSOURCED', 'MANUAL_WASTAGE_REFUSED', 'MEMBER_DIMENSION_NOT_OFFERED', 'NO_ANALYTICS_REPLICA', 'NO_CAUSAL_METHOD',
      'NO_COUNTERFACTUAL_METHOD', 'NO_GEO_REACH', 'NO_PRICE_ON_REQUIREMENT', 'NO_REGISTERED_MODEL', 'NO_STOCK_DECLARATION', 'NO_UNMET_DEMAND_METHOD', 'NO_WEIGHBRIDGE_OBJECT', 'UNSIGNED_FOUNDER_PHYSICAL_KEY']);
  });
  it('the four dataset names exist in three languages', () => {
    for (const c of ['mandi_pulse_member_crops', 'demand_map', 'wastage_events', 'report_run']) for (const l of ['en', 'hi', 'gu']) expect(seedText(`exports.dataset.${c}`, l)).toBeTruthy();
  });
});

describe('SW-f · W193 / W194 pure rules', () => {
  it('Δ against the previous earlier day, in basis points truncated toward zero (market-intel\'s rule); none without an earlier day', () => {
    expect(modalChange({ modalMinor: '2485000', prevModalMinor: '2400000', prevDate: '2026-10-03' })).toEqual({ previousDate: '2026-10-03', previousModalMinor: '2400000', changeMinor: '85000', changeBps: 354 });
    expect(modalChange({ modalMinor: '2390000', prevModalMinor: '2400000', prevDate: '2026-10-03' })?.changeBps).toBe(-41);
    expect(modalChange({ modalMinor: '1', prevModalMinor: null, prevDate: null })).toBeNull();
  });
  it('quantities are thousandths, never floats', () => {
    expect(thousandths('418')).toBe(418000n); expect(thousandths('12.5')).toBe(12500n); expect(fromThousandths(12500n)).toBe('12.5'); expect(fromThousandths(418000n)).toBe('418');
    expect(() => thousandths('1e3')).toThrow();
  });
  it('stock fit: covers ≥ wanted, partial > 0, none', () => {
    expect(stockFit(200000n, 518000n)).toBe('covers'); expect(stockFit(200000n, 200000n)).toBe('covers');
    expect(stockFit(1000000n, 518000n)).toBe('partial'); expect(stockFit(10n, 0n)).toBe('none');
  });
  it('value = qty × per-unit budget (floor), or REFUSED BY NAME without a budget', () => {
    expect(demandValue('200', '2400000', '2500000')).toEqual({ kind: 'value', upToMinor: '500000000', fromMinor: '480000000' });
    expect(demandValue('0.333', null, '1000')).toEqual({ kind: 'value', upToMinor: '333', fromMinor: null });
    expect(demandValue('200', null, null)).toEqual({ kind: 'refused', code: 'NO_PRICE_ON_REQUIREMENT' });
  });
  it('reach: in / out by district, unknown without a mapped pincode', () => {
    const mine = new Set(['d1']);
    expect(reachOf('d1', mine)).toBe('in_reach'); expect(reachOf('d2', mine)).toBe('out_of_reach'); expect(reachOf(null, mine)).toBe('unknown');
  });
  it('"this week" starts Monday 00:00 IST', () => {
    const thu = new Date('2026-10-08T10:00:00Z');                               // Thursday 15:30 IST
    expect(istWeekStart(thu).toISOString()).toBe('2026-10-04T18:30:00.000Z');   // Monday 5 Oct 00:00 IST
    expect(istWeekStart(new Date('2026-10-04T18:29:00Z')).toISOString()).toBe('2026-09-27T18:30:00.000Z');   // Sunday 23:59 IST → the week before
  });
  it('µs cursors only (F-14)', () => {
    const c = encodeUsCursor('2026-10-04T10:00:00.123456Z', '01890000-0000-7000-8000-000000000001');
    expect(decodeUsCursor(c)).toEqual({ us: '2026-10-04T10:00:00.123456Z', id: '01890000-0000-7000-8000-000000000001' });
    expect(() => encodeUsCursor('2026-10-04T10:00:00.123Z', '01890000-0000-7000-8000-000000000001')).toThrow();
    expect(decodeUsCursor('garbage')).toBeNull();
  });
});

describe('SW-f · W195 the measured loss', () => {
  const lines = [
    { kind: 'other', currency: 'INR', unit: null, events: 2, valueMinor: '40000', quantity: null },
    { kind: 'milk', currency: 'INR', unit: null, events: 1, valueMinor: '4500', quantity: null },
    { kind: 'transit', currency: 'INR', unit: null, events: 1, valueMinor: '20000', quantity: null },
    { kind: 'transit', currency: null, unit: 'quintal', events: 1, valueMinor: null, quantity: '2.000' },
    { kind: 'transit', currency: null, unit: null, events: 1, valueMinor: null, quantity: null },
    { kind: 'storage', currency: 'AED', unit: null, events: 1, valueMinor: '900', quantity: null },
  ];
  it('money per currency, quantity per unit, neither counted — never mixed, never zero-filled', () => {
    const m = measuredLoss(lines);
    expect(m.byCurrency).toEqual([{ currency: 'AED', valueMinor: '900', events: 1 }, { currency: 'INR', valueMinor: '64500', events: 4 }]);
    expect(m.byUnit).toEqual([{ unit: 'quintal', quantity: '2', events: 1 }]);
    expect(m.withoutValueOrQuantity).toBe(1); expect(m.events).toBe(7);
    expect(m.split.map((s) => s.kind)).toEqual(['transit', 'storage', 'milk', 'other']);
  });
  it('÷ GMV only in one currency on both sides; else refused by name', () => {
    const one = measuredLoss(lines.filter((l) => l.currency !== 'AED'));
    expect(lossShareOfGmv(one, [{ currency: 'INR', goodsMinor: '10000000' }])).toEqual({ kind: 'share', bps: 64, currency: 'INR', lossMinor: '64500', gmvMinor: '10000000' });
    expect(lossShareOfGmv(measuredLoss(lines), [{ currency: 'INR', goodsMinor: '10000000' }])).toEqual({ kind: 'refused', code: 'MIXED_CURRENCY' });
    expect(lossShareOfGmv(one, [])).toEqual({ kind: 'refused', code: 'NO_GMV' });
    expect(shareBps(1n, 0n)).toBeNull();
  });
  it('the five source events and the five source tables the database derives from — one list', () => {
    expect(WASTAGE_SOURCE_EVENTS.map((s) => s.table).sort()).toEqual(['cold_chain_breaches', 'disputes', 'milk_quality_reviews', 'pod_reviews', 'returns']);
    for (const s of WASTAGE_SOURCE_EVENTS) expect(mig).toContain(`p_table = '${s.table}'`);
    expect(mig).toContain('[WASTAGE_EVENT_ONCE]'); expect(mig).toContain('[WASTAGE_APPEND_ONLY]'); expect(mig).toContain('[WASTAGE_SOURCE_NOT_A_FACT]');
    expect(mig).toMatch(/GRANT SELECT, INSERT ON wastage_events TO kv_app;/);
    expect(mig).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*ON wastage_events/);
  });
});

describe('SW-f · W196 the bounded builder', () => {
  it('eight datasets, keys only; money pulls its currency in, quantity its unit', () => {
    expect(REPORT_DATASETS.map((d) => d.code)).toEqual(['orders', 'settlements', 'listings', 'memberships', 'dairy_cycles', 'cold_chain_breaches', 'wastage_events', 'mandi_pulse']);
    const r = resolveSpec({ datasetCode: 'orders', dimensions: ['month'], measures: ['goods_value_minor'] });
    expect(r.ok && r.spec.implied).toEqual(['currency']);
    const q = resolveSpec({ datasetCode: 'listings', dimensions: [], measures: ['quantity_available'] });
    expect(q.ok && q.spec.implied).toEqual(['unit']);
    expect(resolveSpec({ datasetCode: 'users', dimensions: [], measures: ['x'] })).toMatchObject({ ok: false, code: 'UNKNOWN_DATASET' });
    expect(resolveSpec({ datasetCode: 'orders', dimensions: ['member'], measures: ['orders'] })).toMatchObject({ ok: false, code: 'UNKNOWN_DIMENSION' });
    expect(resolveSpec({ datasetCode: 'orders', dimensions: [], measures: ["orders; DROP TABLE users"] })).toMatchObject({ ok: false, code: 'UNKNOWN_MEASURE' });
    expect(resolveSpec({ datasetCode: 'orders', dimensions: ['month', 'status', 'source', 'currency'], measures: ['orders'] })).toMatchObject({ ok: false, code: 'TOO_MANY_DIMENSIONS' });
    expect(resolveSpec({ datasetCode: 'orders', dimensions: [], measures: [] })).toMatchObject({ ok: false, code: 'NO_MEASURE' });
  });
  it('only orders and settlements are in the auditor realm', () => {
    expect(REPORT_DATASETS.filter((d) => d.auditor).map((d) => d.code)).toEqual(['orders', 'settlements']);
  });
  it('the 92-day bound, inclusive, in the DTO, the service rule and the database', () => {
    expect(MAX_RANGE_DAYS).toBe(92);
    expect(checkRange('2026-07-05', '2026-10-04')).toEqual({ ok: true, days: 92 });
    expect(checkRange('2026-07-04', '2026-10-04')).toEqual({ ok: false, code: 'RANGE_TOO_WIDE' });
    expect(checkRange('2026-10-05', '2026-10-04')).toEqual({ ok: false, code: 'RANGE_ORDER' });
    expect(checkRange('2026-02-30', '2026-03-01')).toEqual({ ok: false, code: 'DATE_INVALID' });
    expect(dtoRangeRefusal({ from: '2026-07-04', to: '2026-10-04' })).toBe('RANGE_TOO_WIDE');
    expect(dtoRangeRefusal({ from: '2026-07-05', to: '2026-10-04' })).toBeNull();
    expect(RunBodySchema.safeParse({ datasetCode: 'orders', measures: ['orders'], from: '2026-10-01' }).success).toBe(false);   // From without To
    expect(mig).toContain('(to_day - from_day) <= 91');
  });
  it('the SQL is assembled from the allow-list only, tenant-scoped, IST-bounded, cap + 1', () => {
    const r = resolveSpec({ datasetCode: 'orders', dimensions: ['month', 'status'], measures: ['orders', 'goods_value_minor'] });
    if (!r.ok) throw new Error('spec');
    const sql = compileRunSql(r.spec);
    expect(sql).toContain('t.tenant_id = $1');
    expect(sql).toContain(`($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`);
    expect(sql).toContain(`LIMIT ${ROW_CAP + 1}`);
    expect(sql).toContain('GROUP BY 1, 2, 3');
    expect(runHeader(r.spec)).toEqual(['month', 'status', 'currency', 'orders', 'goods_value_minor']);
  });
  it('the watermark: tenant, user, generated-at IST, run, definition, row count, the limits, unsigned', () => {
    const lines = watermarkLines({ tenantId: 'T', tenantSlug: 'anand', requestedBy: 'U', requesterName: 'Kiran', generatedAt: new Date('2026-10-04T15:37:33Z'), runId: 'R', definitionId: null,
      datasetCode: 'orders', from: '2026-09-05', to: '2026-10-04', rowCount: 214, dimensions: ['month'], measures: ['orders'] });
    const m = Object.fromEntries(lines);
    expect(m['# tenant']).toBe('anand (T)'); expect(m['# requested_by']).toBe('Kiran (U)'); expect(m['# generated_at']).toBe('2026-10-04 21:07:33 IST');
    expect(m['# run_id']).toBe('R'); expect(m['# definition_id']).toContain('ad hoc'); expect(m['# row_count']).toBe('214');
    expect(m['# limits']).toContain('statement timeout 60s on the primary — an analytics replica is not provisioned');
    expect(m['# signature']).toContain('unsigned');
    expect(istStamp(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01 05:30:00 IST');
  });
  it('the next run, in IST: daily, weekly (ISO weekday), monthly (day ≤ 28) — strictly after now', () => {
    const now = new Date('2026-10-04T15:00:00Z');                              // Sunday 20:30 IST
    expect(nextRunAt({ cadence: 'daily', timeIst: '07:30' }, now).toISOString()).toBe('2026-10-05T02:00:00.000Z');
    expect(nextRunAt({ cadence: 'daily', timeIst: '21:00' }, now).toISOString()).toBe('2026-10-04T15:30:00.000Z');
    expect(nextRunAt({ cadence: 'weekly', weekdayIso: 1, timeIst: '07:30' }, now).toISOString()).toBe('2026-10-05T02:00:00.000Z');
    expect(nextRunAt({ cadence: 'weekly', weekdayIso: 7, timeIst: '20:30' }, now).toISOString()).toBe('2026-10-11T15:00:00.000Z');   // exactly now → next week
    expect(nextRunAt({ cadence: 'monthly', monthDay: 1, timeIst: '06:00' }, now).toISOString()).toBe('2026-11-01T00:30:00.000Z');
    expect(nextRunAt({ cadence: 'daily', timeIst: '00:15' }, new Date('2026-10-04T18:40:00Z')).toISOString()).toBe('2026-10-04T18:45:00.000Z');   // 00:10 IST Monday → 00:15 IST the same Monday
    expect(checkSchedule({ cadence: 'monthly', monthDay: 31, timeIst: '07:00' })).toEqual({ ok: false, code: 'SCHEDULE_SHAPE' });
    expect(checkSchedule({ cadence: 'weekly', timeIst: '07:00' })).toEqual({ ok: false, code: 'SCHEDULE_SHAPE' });
    expect(relativeRange(30, now)).toEqual({ from: '2026-09-04', to: '2026-10-03' });
  });
  it('the run state machine: terminal states are terminal; a retry is a new run', () => {
    expect(canTransition('queued', 'running')).toBe(true); expect(canTransition('running', 'ready')).toBe(true); expect(canTransition('queued', 'refused')).toBe(true);
    expect(canTransition('ready', 'running')).toBe(false); expect(canTransition('refused', 'queued')).toBe(false);
    expect(() => assertTransition('failed', 'ready')).toThrow(/REPORT|Cannot/);
  });
});

describe('SW-f · W417 the capture and the floor', () => {
  const doc = { questions: [{ q: 'a', options: ['x', 'y'], answer: 0, explanations: ['', ''] }, { q: 'b', options: ['x', 'y', 'z'], answer: 2, explanations: ['', '', ''] }] };
  it('answers per question; unanswered and out-of-range count as not correct', () => {
    expect(captureAnswers(doc, [0, null])).toEqual([{ questionNo: 1, chosen: 0, correct: true }, { questionNo: 2, chosen: null, correct: false }]);
    expect(captureAnswers(doc, [1, 9])).toEqual([{ questionNo: 1, chosen: 1, correct: false }, { questionNo: 2, chosen: null, correct: false }]);
  });
  it('a watch interval is a played interval of the last 24 h; the delta never negative', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    expect(checkWatchInterval(new Date('2026-10-04T11:00:00Z'), new Date('2026-10-04T11:03:00Z'), now)).toEqual({ ok: true, seconds: 180 });
    expect(checkWatchInterval(new Date('2026-10-04T13:00:00Z'), new Date('2026-10-04T13:03:00Z'), now)).toEqual({ ok: false, code: 'WATCH_INTERVAL_INVALID' });
    expect(checkWatchInterval(new Date('2026-10-02T11:00:00Z'), new Date('2026-10-02T11:03:00Z'), now)).toEqual({ ok: false, code: 'WATCH_INTERVAL_INVALID' });
    expect(checkWatchInterval(new Date('2026-10-04T11:03:00Z'), new Date('2026-10-04T11:00:00Z'), now).ok).toBe(false);
    expect(progressDelta(null, 120)).toBe(120); expect(progressDelta(120, 120)).toBe(0); expect(progressDelta(300, 100)).toBe(0);
  });
  it('the 50-learner floor: 0 = nothing captured yet, 1–49 refused with the count, 50 shown', () => {
    expect(LEARNER_FLOOR).toBe(50);
    expect(floorVerdict(0)).toEqual({ kind: 'refused', code: 'NO_CAPTURE_YET', learners: 0, floor: 50 });
    expect(floorVerdict(49)).toEqual({ kind: 'refused', code: 'BELOW_LEARNER_FLOOR', learners: 49, floor: 50 });
    expect(floorVerdict(50)).toEqual({ kind: 'shown', learners: 50, floor: 50 });
    expect(missBps(1, 50)).toBe(200); expect(missBps(1, 0)).toBeNull();
  });
});
