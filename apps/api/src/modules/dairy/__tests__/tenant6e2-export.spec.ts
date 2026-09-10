// modules/dairy/__tests__/tenant6e2-export.spec.ts · PC-56 TENANT-6e-2 · W172's file, as rows and as notes.
//
// Two claims and their guards. (1) The file is the PAGE: every figure the read model produces appears once, money at
// the currency's own scale, and the three refused figures are NOT rows — they are notes on the receipt. (2) The notice
// that says "your export is ready" renders against the payload the entity actually emits, in three languages, with no
// blank token and no platform code inside vernacular copy (TENANT-6d-7's four rules, applied to the first non-dairy
// event catalogued after the guard existed).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DairyInsightsReady, DairyInsightsView } from '../read-models/dairy-insights.read-model';
import { INSIGHTS_EXPORT_HEADER, INSIGHTS_EXPORT_STANDING_NOTES, changeCells, insightsExportRows, litresText3, majorText, pctText } from '../domain/dairy-insights-export';
import { DAIRY_INSIGHTS_DATASET, DAIRY_INSIGHTS_DATASET_NAME_KEY, DairyInsightsExportParamsSchema } from '../exports/dairy-insights.dataset';
import { ExportJob } from '../../../core/exports-plane/domain/export-job.entity';
import { NotificationTemplate } from '../../communication/domain/notification-template.entity';
import { NotifChannel } from '../../communication/domain/communication.events';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';
import { langMapFrom } from '../../../core/i18n/lang-map';

const SEED = path.join(__dirname, '../../../../../../db/seeds/core/0007_notification_events_templates.sql');
const UI_SEED = path.join(__dirname, '../../../../../../db/seeds/core/0017_ui_messages_export_datasets.sql');

const ranges = { window: 90 as const, current: { from: '2026-06-13', to: '2026-09-10', days: 90 }, previous: { from: '2026-03-15', to: '2026-06-12', days: 90 }, lookbackFrom: '2025-09-10' };
const slabs = [{ metric: 'fat' as const, minCentiPct: 620, bonusMinorPerLitre: 50 }];
const ready = (over: Partial<DairyInsightsReady> = {}): DairyInsightsReady => ({
  kind: 'ready', ranges, endsOnPartialDay: true, currencyCode: 'INR', minorUnits: 2,
  history: { kind: 'ready', days: 400, cycle: 'fortnightly', cycleDays: 15, haveCycles: 26, atLeast: true },
  volume: { perDayMilli: '4180000', totalMilli: '376200000', days: 90, basis: 'per_calendar_day', daysWithPours: 62, change: { kind: 'changed', deltaBps: 900, delta: '345000', from: '3835000', to: '4180000' } },
  ratePerLitre: { kind: 'measured', basis: 'gross_at_counter', centiMinorPerLitre: '516000', amountMinor: '1941192000', milli: '376200000', change: { kind: 'changed', deltaBps: 424, delta: '21000', from: '495000', to: '516000' } },
  pourers: { kind: 'measured', active: 312, newcomers: 18, winBacks: 4, continuing: 290, lookbackDays: 365, basis: 'first_pour_within_lookback', change: { kind: 'changed', deltaBps: 612, delta: '18', from: '294', to: '312' } },
  payoutStreak: { kind: 'not_recorded', missing: ['dairy_bill_cycles.paid_at', 'milk_bills.paid_at', 'payouts.settled_at'], cyclesClosed: 6, cyclesAllBillsApproved: 5 },
  byShift: { bucketDays: 7, firstBucketDays: 6, shifts: ['morning', 'evening'], buckets: [
    { from: '2026-06-13', to: '2026-06-18', days: 6, byShift: { morning: '12000000', evening: '11000000' }, totalMilli: '23000000' },
    { from: '2026-06-19', to: '2026-06-25', days: 7, byShift: { morning: '14000000', evening: '13500000' }, totalMilli: '27500000' },
  ] },
  premium: { current: { kind: 'measured', basis: 'earned', qualifying: 184, pourers: 312, shareBps: 5897, slabs }, previous: { kind: 'measured', basis: 'earned', qualifying: 141, pourers: 300, shareBps: 4700, slabs }, change: { kind: 'changed', deltaBps: 3050, delta: '43', from: '141', to: '184' }, comparable: true },
  rateCards: { byAnimal: [{ animalType: 'buffalo', cards: [{ id: 'c1', defaultName: 'Buffalo two-axis', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '70000', ratePerKgSnfMinor: '30000', baseRatePerLitreMinor: null, slabs, effectiveFrom: '2026-04-01', effectiveTo: null }], effectiveId: 'c1', ambiguous: false }], ambiguousAnimalTypes: [], supersedeRecorded: false, checkerRequired: false },
  spoilage: { kind: 'not_measurable', needs: ['a write-off act on a tank', 'a link from a breach to the pours it spoiled'] },
  bonusMinor: '4520000', slabsApplied: true, memberDrillDown: false,
  ...over,
} as DairyInsightsReady);

const cell = (rows: string[][], section: string, metric: string) => rows.find((r) => r[0] === section && r[1] === metric);

describe('PC-56 TENANT-6e-2 · the file is the page', () => {
  it('formats money at the currency\'s own scale, without grouping — and the yen at zero', () => {
    expect(majorText(516000n, 2)).toBe('5160.00');
    expect(majorText(5n, 2)).toBe('0.05');
    expect(majorText(-12345n, 2)).toBe('-123.45');
    expect(majorText(5160n, 0)).toBe('5160');
    expect(majorText(1234567n, 3)).toBe('1234.567');
    expect(() => majorText(1n, 5)).toThrow();
    expect(litresText3(4180000n)).toBe('4180.000'); expect(litresText3(19845n)).toBe('19.845'); expect(litresText3(5n)).toBe('0.005');
    expect(pctText(900)).toBe('9.00'); expect(pctText(-25)).toBe('-0.25'); expect(pctText(10001)).toBe('100.01');
  });

  it('turns a non-movement into words, never a zero', () => {
    expect(changeCells({ kind: 'from_zero', to: '5' }).value).toBe('no comparable period');
    expect(changeCells({ kind: 'both_zero' }).value).toBe('nothing in either period');
    expect(changeCells({ kind: 'to_zero', from: '5' }).value).toBe('fell to zero');
    expect(changeCells({ kind: 'no_previous' }).value).toBe('no previous window');
    expect(changeCells({ kind: 'changed', deltaBps: 900, delta: '1', from: '1', to: '2' }).value).toBe('9.00');
  });

  it('every measured figure is a row, at the right scale, with its basis beside it', () => {
    const f = insightsExportRows(ready(), { lookbackDaysNote: '365 days' });
    expect(INSIGHTS_EXPORT_HEADER).toEqual(['section', 'metric', 'value', 'unit', 'basis', 'note']);
    for (const r of f.rows) expect(r).toHaveLength(6);
    expect(cell(f.rows, 'volume', 'per_day_avg')).toEqual(['volume', 'per_day_avg', '4180.000', 'L', 'per_calendar_day', 'collected on 62 of 90 days']);
    expect(cell(f.rows, 'volume', 'change_vs_previous')?.[2]).toBe('9.00');
    // ₹51.60/L carried as centi-minor 516000 → "51.6000" (two extra places), currency in its own column.
    expect(cell(f.rows, 'rate', 'member_per_litre')?.slice(2, 5)).toEqual(['51.6000', 'INR/L', 'gross_at_counter']);
    expect(cell(f.rows, 'rate', 'gross_paid_at_counter')?.slice(2, 4)).toEqual(['19411920.00', 'INR']);
    expect(cell(f.rows, 'rate', 'change_vs_previous')?.slice(2, 4)).toEqual(['2.1000', 'INR/L']);   // the canon's "▲ ₹2.10"
    expect(cell(f.rows, 'pourers', 'new')?.[5]).toContain('365 days');
    expect(cell(f.rows, 'pourers', 'continuing')?.[2]).toBe('290');
    expect(cell(f.rows, 'cycles', 'closed_in_window')?.slice(2, 5)).toEqual(['6', 'cycles', 'substitute_for_unrecorded_payout_streak']);
    expect(cell(f.rows, 'premium', 'qualifying_pourers')?.slice(2, 5)).toEqual(['184', 'pourers', 'earned']);
    expect(cell(f.rows, 'premium', 'paid_in_window')?.slice(2, 5)).toEqual(['45200.00', 'INR', 'earned']);
    expect(cell(f.rows, 'rate_card', 'buffalo')?.[5]).toContain('pricing now');
    // Two buckets × (2 shifts + total) = 6 chart rows; the partial first bucket says so on every one of its rows.
    const chart = f.rows.filter((r) => r[0] === 'by_shift');
    expect(chart).toHaveLength(6);
    expect(chart.filter((r) => r[5].startsWith('partial bucket: 6 of 7')).length).toBe(3);
    // MUTATION PASS (D7): only the FIRST bucket may be called partial; a full week carrying the note would make every
    // week read as short. The second bucket's three rows have an empty note.
    expect(chart.filter((r) => r[4].includes('2026-06-19')).every((r) => r[5] === '')).toBe(true);
    expect(f.fileSuffix).toBe('90d');
  });

  it('THE REFUSED FIGURES ARE NOT ROWS — they are notes on the receipt', () => {
    const f = insightsExportRows(ready());
    // No METRIC and no VALUE is a streak, a spoilage figure or a card version. (The word "streak" may appear in a BASIS
    // column — `substitute_for_unrecorded_payout_streak` — which is the row saying what it stands in for, not the figure.)
    // MUTATION PASS (D9): the SECTION column is included — a row `payout_streak,consecutive_on_time,6` has no "streak" in
    // its metric or value and slipped past the first version of this assertion.
    const metricsAndValues = f.rows.map((r) => `${r[0]}|${r[1]}|${r[2]}`).join('\n');
    expect(metricsAndValues).not.toMatch(/streak/i);
    expect(metricsAndValues).not.toMatch(/spoilage|litres_lost/i);
    expect(metricsAndValues).not.toMatch(/version/i);
    expect(f.notes.filter((n) => /payout streak: NOT in this file/.test(n))).toHaveLength(1);
    expect(f.notes.filter((n) => /spoilage: NOT in this file/.test(n))).toHaveLength(1);
    expect(f.notes.filter((n) => /rate card version: NOT in this file/.test(n))).toHaveLength(1);
    expect(f.notes.some((n) => /COUNTER rate/.test(n))).toBe(true);
    for (const n of INSIGHTS_EXPORT_STANDING_NOTES) expect(f.notes).toContain(n);
  });

  it('a yen tenant gets whole-unit money and never a guessed decimal', () => {
    const f = insightsExportRows(ready({ currencyCode: 'JPY', minorUnits: 0, bonusMinor: '5160' }));
    expect(cell(f.rows, 'premium', 'paid_in_window')?.slice(2, 4)).toEqual(['5160', 'JPY']);
    expect(cell(f.rows, 'rate', 'member_per_litre')?.slice(2, 4)).toEqual(['5160.00', 'JPY/L']);   // ratio keeps its two extra places
  });

  it('with the slabs OFF the premium is a forecast and the paid figure says nobody was paid', () => {
    const f = insightsExportRows(ready({ slabsApplied: false, bonusMinor: '0', premium: { current: { kind: 'measured', basis: 'would_qualify', qualifying: 184, pourers: 312, shareBps: 5897, slabs }, previous: { kind: 'basis_unknown', slabs }, change: null, comparable: false } }));
    expect(cell(f.rows, 'premium', 'qualifying_pourers')?.[4]).toBe('would_qualify');
    expect(cell(f.rows, 'premium', 'qualifying_pourers_previous')?.slice(2, 5)).toEqual(['not comparable', '', 'basis_unknown']);
    expect(cell(f.rows, 'premium', 'paid_in_window')?.[5]).toContain('nobody was paid');
  });

  it('an ambiguous rate card is flagged on its row and in the notes', () => {
    const base = ready();
    const g = base.rateCards.byAnimal[0];
    const f = insightsExportRows(ready({ rateCards: { ...base.rateCards, ambiguousAnimalTypes: ['buffalo'], byAnimal: [{ ...g, ambiguous: true, cards: [...g.cards, { ...g.cards[0], id: 'c2', defaultName: 'Older card', effectiveFrom: '2026-01-01' }] }] } }));
    expect(f.rows.filter((r) => r[0] === 'rate_card').every((r) => r[5].includes('MORE THAN ONE CARD IN FORCE'))).toBe(true);
    expect(f.notes.some((n) => n.includes('more than one rate card is in force for: buffalo'))).toBe(true);
  });

  it('no_data and not_enough_history produce a window and a sentence, not a page of zeroes', () => {
    const nd = insightsExportRows({ kind: 'no_data', ranges, history: { kind: 'no_data' }, memberDrillDown: false } as DairyInsightsView as never);
    expect(nd.rows.filter((r) => r[0] === 'volume')).toHaveLength(0);
    expect(cell(nd.rows, 'history', 'state')?.[2]).toBe('no_data');
    const ne = insightsExportRows({ kind: 'not_enough_history', ranges, history: { kind: 'not_enough_history', days: 20, needDays: 30, cycle: 'fortnightly', cycleDays: 15, haveCycles: 1, atLeast: false }, memberDrillDown: false, pourersSoFar: 62 } as never);
    expect(cell(ne.rows, 'history', 'state')?.[5]).toBe('1 of 2 fortnightly cycles');
    expect(cell(ne.rows, 'pourers', 'so_far')?.[2]).toBe('62');
    expect(ne.rows.filter((r) => r[0] === 'rate')).toHaveLength(0);
  });

  it('the export accepts exactly the windows the page accepts', () => {
    expect(DairyInsightsExportParamsSchema.parse({}).window).toBe(90);
    expect(DairyInsightsExportParamsSchema.parse({ window: '30' }).window).toBe(30);
    expect(DairyInsightsExportParamsSchema.safeParse({ window: 3650 }).success).toBe(false);
    expect(DairyInsightsExportParamsSchema.safeParse({ window: 90, extra: 1 }).success).toBe(false);
    expect(DAIRY_INSIGHTS_DATASET).toBe('dairy.insights');
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/* THE NOTICE, held to 6d-7's four rules                                                                          */
/* ------------------------------------------------------------------------------------------------------------- */

interface SeededTemplate { channel: string; lang: string; tokens: string[] }
function seededExportTemplates(): SeededTemplate[] {
  const out: SeededTemplate[] = [];
  for (const line of fs.readFileSync(SEED, 'utf8').split('\n')) {
    const m = /^\s*\('exports\.export_ready','([a-z]+)','([a-z]+)'/.exec(line);
    if (!m) continue;
    out.push({ channel: m[1], lang: m[2], tokens: [...line.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((t) => t[1]) });
  }
  return out;
}
function declaredExportVars(): Array<{ name: string; required: boolean }> {
  const out: Array<{ name: string; required: boolean }> = [];
  for (const line of fs.readFileSync(SEED, 'utf8').split('\n')) {
    const m = /^\s*\('exports\.export_ready',\s*'([a-z_]+)',\s*'[^']*'.*?(true|false)\)/.exec(line);
    if (!m || ['sms', 'push', 'inapp', 'email', 'whatsapp', 'ivr'].includes(m[1])) continue;
    out.push({ name: m[1], required: m[2] === 'true' });
  }
  return out;
}
function seededDatasetName() {
  const rows = new Map<string, string>();
  for (const line of fs.readFileSync(UI_SEED, 'utf8').split('\n')) {
    const m = /^\s*\('([a-z0-9._]+)',\s*'([a-z]+)',\s*'(.*)'\)[,;]?\s*$/.exec(line);
    if (m && m[1] === DAIRY_INSIGHTS_DATASET_NAME_KEY) rows.set(m[2], m[3]);
  }
  return langMapFrom(rows, DAIRY_INSIGHTS_DATASET_NAME_KEY);
}

describe('PC-56 TENANT-6e-2 · "your export is ready" renders against what the worker emits', () => {
  const templates = seededExportTemplates();
  const name = seededDatasetName();
  const job = ExportJob.create({ id: 'j', tenantId: 't', datasetCode: DAIRY_INSIGHTS_DATASET, params: { window: 90 }, paramsSha256: 'b'.repeat(64), requestedBy: 'u' });
  job.claim(); job.pullEvents();
  job.succeed({ fileName: 'dairy-insights-90d-2026-09-10.csv', contentType: 'text/csv; charset=utf-8', rowCount: 27, sha256: 'c'.repeat(64), byteSize: 10, storageKey: 'k', notes: [] }, name);
  const payload = job.pullEvents().find((e) => e.type === 'exports.export_ready')!.payload;
  const render = (t: SeededTemplate, tokens = t.tokens) => NotificationTemplate.rehydrate({
    id: `x|${t.channel}|${t.lang}`, eventCode: 'exports.export_ready', channel: t.channel as NotifChannel, languageCode: t.lang, tenantId: null,
    subject: null, body: tokens.map((k) => `{{${k}}}`).join(' '), providerTemplateRef: null, isActive: true, versionId: 'v1', versionNo: 1,
  }).render(payload);

  it('is seeded for inapp and push in en/hi/gu, and named in three languages', () => {
    expect(templates.length).toBe(6);
    for (const ch of ['inapp', 'push']) expect(templates.filter((t) => t.channel === ch).map((t) => t.lang).sort()).toEqual(['en', 'gu', 'hi']);
    expect(Object.keys(name).sort()).toEqual(['en', 'gu', 'hi']);
  });
  it('resolves every token, prints no object, and puts no platform code in vernacular copy', () => {
    for (const t of templates) {
      for (const tok of t.tokens) expect(render(t, [tok]).body.trim()).not.toBe('');
      const body = render(t).body;
      expect(body).not.toMatch(/[[{]"/); expect(body).not.toContain('[object Object]');
      if (t.lang !== 'en') expect(body).not.toContain('dairy.insights');
    }
    expect(render(templates.find((t) => t.lang === 'gu')!).body).toContain('ડેરી ઇનસાઇટ્સ');
  });
  it('every declared REQUIRED variable is used by every body, and nothing undeclared is', () => {
    const declared = declaredExportVars();
    expect(declared.map((d) => d.name).sort()).toEqual(['dataset', 'file', 'rows']);
    for (const t of templates) {
      for (const d of declared.filter((x) => x.required)) expect(t.tokens).toContain(d.name);
      for (const tok of t.tokens) expect(declared.map((d) => d.name)).toContain(tok);
    }
  });
  it('is bridged from the outbox with the REQUESTER as the recipient', () => {
    const row = NOTIFICATION_EVENT_MAP.find((e) => e.outboxType === 'exports.export_ready');
    expect(row).toEqual({ outboxType: 'exports.export_ready', eventCode: 'exports.export_ready', recipientKeys: ['userId'] });
    expect(payload.userId).toBe('u');
  });
});
