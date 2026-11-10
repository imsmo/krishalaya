// apps/web-ops/src/test-render/ops5b-fixtures.ts · PC-56 OPS-5b — W369's read (`GET /v1/dairy/insights`) in every kind and the export plane's job in
// every state. Figures are invented and anonymised (never the canon's F-12 literals). A rate card's NAME is person-shaped on purpose: the page
// prints no card name (the cards are shown by kind and date), so the render test can prove no typed name reaches it.
import type { DairyInsights, DairyInsightsReady, ExportJob } from '@krishalaya/sdk-js';

export const CARD_NAME = 'Testperson buffalo card';
export const JOB = '0192d2c4-e5b0-7000-8000-000000000001';
export const ME = '00000000-0000-7000-8000-00000000a001';
export const OTHER = '00000000-0000-7000-8000-00000000a002';
export const SHA = '3f1a9c0d5e7b2a4c6d8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e';

const ranges = { current: { from: '2026-08-13', to: '2026-11-10', days: 90 }, previous: { from: '2026-05-15', to: '2026-08-12', days: 90 }, lookbackFrom: '2025-08-13', window: 90 as const };
const slab = { metric: 'fat' as const, minCentiPct: 650, bonusMinorPerLitre: 50 };

export const READY: DairyInsightsReady = {
  kind: 'ready', ranges, endsOnPartialDay: true, currencyCode: 'INR', minorUnits: 2,
  history: { kind: 'ready', days: 400, cycle: 'fortnightly', cycleDays: 15, haveCycles: 26, atLeast: true },
  volume: { perDayMilli: '1234567', totalMilli: '111111030', days: 90, basis: 'per_calendar_day', daysWithPours: 87, change: { kind: 'changed', deltaBps: 812, delta: '92716', from: '1141851', to: '1234567' } },
  ratePerLitre: { kind: 'measured', basis: 'gross_at_counter', centiMinorPerLitre: '471249', amountMinor: '523621004', milli: '111111030', change: { kind: 'changed', deltaBps: -77, delta: '-3651', from: '474900', to: '471249' } },
  pourers: { kind: 'measured', active: 171, newcomers: 13, winBacks: 3, continuing: 155, lookbackDays: 365, basis: 'first_pour_within_lookback', change: { kind: 'changed', deltaBps: 300, delta: '5', from: '166', to: '171' } },
  payoutStreak: { kind: 'not_recorded', missing: ['dairy_bill_cycles.paid_at', 'milk_bills.paid_at', 'payouts.settled_at'], cyclesClosed: 6, cyclesAllBillsApproved: 5 },
  byShift: { bucketDays: 7, firstBucketDays: 6, shifts: ['morning', 'evening'], buckets: [
    { from: '2026-08-13', to: '2026-08-18', days: 6, byShift: { morning: '4100000', evening: '3020500' }, totalMilli: '7120500' },
    { from: '2026-08-19', to: '2026-08-25', days: 7, byShift: { morning: '4800250', evening: '3900000' }, totalMilli: '8700250' },
  ] },
  premium: { current: { kind: 'measured', basis: 'earned', qualifying: 57, pourers: 171, shareBps: 3333, slabs: [slab] }, previous: { kind: 'basis_unknown', slabs: [slab] }, change: null, comparable: false },
  rateCards: { byAnimal: [
    { animalType: 'buffalo', cards: [
      { id: 'c1', defaultName: CARD_NAME, animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', baseRatePerLitreMinor: null, slabs: [slab], effectiveFrom: '2026-10-01', effectiveTo: null },
      { id: 'c2', defaultName: CARD_NAME, animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '71000', ratePerKgSnfMinor: '33000', baseRatePerLitreMinor: null, slabs: [], effectiveFrom: '2026-07-01', effectiveTo: null },
    ], effectiveId: 'c1', ambiguous: true },
    { animalType: 'cow', cards: [{ id: 'c3', defaultName: CARD_NAME, animalType: 'cow', pricingModel: 'fat_pooled', ratePerKgFatMinor: '61000', ratePerKgSnfMinor: null, baseRatePerLitreMinor: null, slabs: [], effectiveFrom: '2026-09-01', effectiveTo: null }], effectiveId: 'c3', ambiguous: false },
  ], ambiguousAnimalTypes: ['buffalo'], supersedeRecorded: true, checkerRequired: true },
  spoilage: { kind: 'not_measurable', needs: ['a write-off act on a tank', 'a link from a breach to the pours it spoiled'] },
  bonusMinor: '1987650', slabsApplied: true, memberDrillDown: true,
};
/** The other verdict kinds, each once: from_zero / to_zero / both_zero / no_previous, no_pours, no_pourers, inconsistent, would_qualify, no_slabs,
 *  slabs off, a currency with no minor digits (JPY — through formatMoneyMinor, never an 'INR' fallback). */
export const READY_OTHER: DairyInsightsReady = {
  ...READY, currencyCode: 'JPY', minorUnits: 0,
  volume: { ...READY.volume, change: { kind: 'from_zero', to: '1234567' } },
  ratePerLitre: { kind: 'no_pours' },
  pourers: { kind: 'inconsistent', active: 4, newcomers: 3, winBacks: 3, lookbackDays: 365 },
  premium: { current: { kind: 'measured', basis: 'would_qualify', qualifying: 9, pourers: 40, shareBps: 2250, slabs: [slab] }, previous: { kind: 'no_slabs' }, change: null, comparable: false },
  rateCards: { byAnimal: [], ambiguousAnimalTypes: [], supersedeRecorded: true, checkerRequired: true },
  bonusMinor: '0', slabsApplied: false,
};
export const READY_THIRD: DairyInsightsReady = {
  ...READY,
  volume: { ...READY.volume, change: { kind: 'both_zero' } },
  ratePerLitre: { ...(READY.ratePerLitre as Extract<DairyInsightsReady['ratePerLitre'], { kind: 'measured' }>), change: { kind: 'no_previous' } },
  pourers: { kind: 'no_pourers', lookbackDays: 365 },
  premium: { current: { kind: 'no_slabs' }, previous: { kind: 'measured', basis: 'would_qualify', qualifying: 2, pourers: 11, shareBps: 1818, slabs: [slab] }, change: null, comparable: false },
  byShift: { ...READY.byShift, buckets: [] },
};
export const NO_DATA: DairyInsights = { kind: 'no_data', ranges, history: { kind: 'no_data' }, memberDrillDown: false };
export const SHORT: DairyInsights = { kind: 'not_enough_history', ranges, history: { kind: 'not_enough_history', days: 12, needDays: 30, cycle: 'fortnightly', cycleDays: 15, haveCycles: 0, atLeast: false }, memberDrillDown: false, pourersSoFar: 19 };
export const NOT_ENABLED: DairyInsights = { kind: 'not_enabled', flag: 'dairy_insights' };
export const UNAVAILABLE: DairyInsights = { kind: 'unavailable', missing: ['tenants.country_code -> countries.currency_code', 'currencies.minor_units'] };

const base: ExportJob = {
  id: JOB, datasetCode: 'dairy.insights', params: { window: 90 }, status: 'queued', attempts: 0, requestedBy: ME,
  queuedAt: '2026-11-10T11:40:00.000Z', startedAt: null, generatedAt: null, failedAt: null, expiredAt: null, expiresAt: null,
  receipt: null, failure: null, standing: { position: 2, ahead: 1, eta: { kind: 'no_history' } }, fetches: null, download: { kind: 'not_ready' },
};
export const JOB_QUEUED: ExportJob = base;
export const JOB_QUEUED_ETA: ExportJob = { ...base, status: 'running', standing: { position: 1, ahead: 0, eta: { kind: 'estimate', seconds: 42, basis: 'median_of_recent_runs', sample: 7, runsIncluded: 7 } } };
const receipt = { fileName: 'dairy-insights-90d-2026-11-10.csv', rowCount: 41, sha256: SHA, byteSize: 2048, contentType: 'text/csv; charset=utf-8', generatedAt: '2026-11-10T11:41:02.000Z', requestedBy: ME, notes: ['payout streak: NOT in this file'] };
export const JOB_READY: ExportJob = { ...base, status: 'ready', standing: null, generatedAt: receipt.generatedAt, expiresAt: '2026-11-17T11:41:02.000Z', receipt,
  fetches: { attempts: 3, served: 2, refused: 1, mismatched: 0, lastServedAt: '2026-11-10T11:45:00.000Z' }, download: { kind: 'available', linkTtlSec: 900 } };
export const JOB_READY_OTHER: ExportJob = { ...JOB_READY, requestedBy: OTHER, receipt: { ...receipt, requestedBy: OTHER } };
export const JOB_EXPIRED: ExportJob = { ...JOB_READY, status: 'expired', expiredAt: '2026-11-17T11:41:03.000Z', download: { kind: 'file_expired', expiredAt: '2026-11-17T11:41:03.000Z' } };
export const JOB_FAILED: ExportJob = { ...base, status: 'failed', standing: null, failedAt: '2026-11-10T11:41:00.000Z', failure: { code: 'dataset_disabled', detail: 'the screen flag is off' }, download: { kind: 'failed' } };
export const JOB_OTHER_DATASET: ExportJob = { ...JOB_READY, datasetCode: 'traceability.lot_record' };
