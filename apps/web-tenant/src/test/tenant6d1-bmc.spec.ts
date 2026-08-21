// apps/web-tenant/src/test/tenant6d1-bmc.spec.ts · W170 (BMC monitor) — PC-56 TENANT-6d-1.
//
// The view-model decides what the monitor SAYS, and its two hardest calls are refusals:
//   • a stale sensor leads with the GAP, never with a temperature — *"a gap is a connectivity issue, not a temperature
//     unknown"*, and a forty-minute-old number presented as "now" is how good milk gets thrown away;
//   • *"compressor healthy"* appears only where a human said it. `unknown` is the state of a machine nobody has spoken
//     about, and it is grey rather than red because nobody has said anything is wrong either.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DairyBmcMonitor, DairyBmcTile } from '@krishalaya/sdk-js';
import {
  BMC_HREF, alertingKey, alertingTone, bmcHref, bmcState, bmcStateKey, chartPath, compressorKey, compressorTone,
  fillText, litresLostKey, pctOfBp, playbookNoteKey, playbookStepKey, readingSourceKey, silenceGapKey, tempIsCurrent,
  tileHeadlineKey, tileTone, timeInRangeText,
} from '../features/dairy/bmc';
import { DAIRY_NAV, currentDairyNavKey, dairyUnbuiltCount } from '../features/dairy/nav';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));

const STEPS = ['operator_confirm', 'divert_next_shift', 'test_before_pooling'] as const;

const tile = (o: Partial<DairyBmcTile> = {}): DairyBmcTile => ({
  unitId: 'u1', mccId: 'm1', mccCode: 'MCC-AND-01', mccName: 'Vanthali', operatorUserId: 'op-1',
  tempC: '3.8', verdict: 'in_range',
  telemetry: { state: 'live', ageMinutes: 2, silenceMinutes: 15 },
  band: { minC: '0.0', targetC: '4.0', maxC: '4.5' },
  capacityLitres: '2000.00', volumeLitres: '820.00', fillPct: 41, volumeAt: '2026-08-20T14:00:00.000Z',
  compressor: { state: 'unknown', at: null },
  deviceRef: 'dev-1', model: 'IceCool 2000', serialNo: 'IC-1', readings24h: 120, breaches24h: 0, ...o,
});

const view = (o: Partial<DairyBmcMonitor> = {}): DairyBmcMonitor => ({
  now: '2026-08-20T14:20:00.000Z',
  units: [tile()],
  aboveBand: 0,
  focus: {
    unitId: 'u1', hours: 6,
    points: [
      { atMinutesAgo: 320, at: '2026-08-20T09:00:00.000Z', tempC: '4.0', isBreach: false },
      { atMinutesAgo: 2, at: '2026-08-20T14:18:00.000Z', tempC: '6.9', isBreach: true },
    ],
    playbook: [
      { step: 'operator_confirm', due: true, atDeci: null, built: false },
      { step: 'divert_next_shift', due: false, atDeci: 75, built: false },
      { step: 'test_before_pooling', due: false, atDeci: 80, built: false },
    ],
  },
  thresholds: { divertC: '7.5', condemnC: '8.0', silenceMinutes: 15 },
  quarter: { days: 90, readings: 1000, breaches: 8, units: 3, timeInRangeBp: 9920, litresLost: { kind: 'not_measurable', needs: ['a write-off act on a tank'] } },
  alerting: {
    breachRules: 1, silentRules: 1, recipients: 2, eventCatalogued: true, smsDeliverable: true,
    // TENANT-6d-5: minutes, the cadence, and the two questions about whether a critical alert may wake anybody.
    silenceRuleMinutes: 15, silenceMatchesGap: true, evaluationMinutes: 10,
    criticalCatalogued: true, criticalVoiceDeliverable: true,
  },
  callEnabled: true,
  ...o,
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6d-1 · W170 the BMC monitor', () => {
  it('leads a stale tile with the GAP, never with the temperature', () => {
    expect(tileHeadlineKey(tile())).toBe('dairy.bmc.tile.inRange');
    const stale = tile({ telemetry: { state: 'stale', ageMinutes: 40, silenceMinutes: 15 }, verdict: 'in_range' });
    expect(tileHeadlineKey(stale)).toBe('dairy.bmc.tile.gap');
    expect(tempIsCurrent(stale)).toBe(false);
    // ...even when the last reading was a breach: the tank may have recovered, and nobody knows.
    expect(tileHeadlineKey(tile({ telemetry: { state: 'stale', ageMinutes: 80, silenceMinutes: 15 }, verdict: 'above_band' }))).toBe('dairy.bmc.tile.gap');
    expect(tileHeadlineKey(tile({ telemetry: { state: 'never', ageMinutes: null, silenceMinutes: 15 }, tempC: null, verdict: null }))).toBe('dairy.bmc.tile.noReadings');
    for (const k of ['inRange', 'aboveBand', 'belowMin', 'gap', 'noReadings']) expect(hasKey(`dairy.bmc.tile.${k}`)).toBe(true);
  });

  it('colours a gap amber and a breach red — they are different problems', () => {
    expect(tileTone(tile())).toBe('ok');
    expect(tileTone(tile({ telemetry: { state: 'stale', ageMinutes: 40, silenceMinutes: 15 } }))).toBe('warn');
    expect(tileTone(tile({ verdict: 'above_band' }))).toBe('bad');
    expect(tileTone(tile({ verdict: 'below_min' }))).toBe('bad');      // freezing is a fault too
    expect(tileTone(tile({ telemetry: { state: 'never', ageMinutes: null, silenceMinutes: 15 } }))).toBe('muted');
  });

  it('never dresses `unknown` up as healthy, and never paints it red', () => {
    expect(compressorKey(tile())).toBe('dairy.bmc.compressor.unknown');
    expect(compressorTone(tile())).toBe('muted');
    expect(compressorTone(tile({ compressor: { state: 'healthy', at: '2026-08-20T10:00:00.000Z' } }))).toBe('ok');
    expect(compressorTone(tile({ compressor: { state: 'attention', at: '2026-08-20T10:00:00.000Z' } }))).toBe('warn');
    for (const s of ['healthy', 'attention', 'unknown']) expect(hasKey(`dairy.bmc.compressor.${s}`)).toBe(true);
    // The copy must say WHOSE word it is — a machine state nobody senses, presented as fact, is the lie this avoids.
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes("'dairy.bmc.compressor.unknown':"))!;
      expect(line.length).toBeGreaterThan(40);
    }
  });

  it('says how full the tank is, or that nobody has said', () => {
    expect(fillText(tile())).toEqual({ pct: 41, litres: '820.00' });
    expect(fillText(tile({ fillPct: null, volumeLitres: null }))).toBeNull();
    expect(hasKey('dairy.bmc.tile.levelUnknown')).toBe(true);
  });

  it('says whether a tank is watched or read by hand', () => {
    expect(readingSourceKey(tile())).toBe('dairy.bmc.source.sensor');
    expect(readingSourceKey(tile({ deviceRef: null }))).toBe('dairy.bmc.source.byHand');
    for (const k of ['dairy.bmc.source.sensor', 'dairy.bmc.source.byHand']) expect(hasKey(k)).toBe(true);
  });

  it('names every playbook step, and says this platform performs none of them', () => {
    for (const s of STEPS) expect(hasKey(playbookStepKey(s))).toBe(true);
    expect(hasKey(playbookNoteKey())).toBe(true);
    for (const p of view().focus!.playbook) expect(p.built).toBe(false);
  });

  it('prints a share from basis points without a float, and refuses a share of nothing', () => {
    expect(pctOfBp(9920)).toBe('99.2');
    expect(pctOfBp(10_000)).toBe('100.0');
    expect(pctOfBp(5)).toBe('0.0');
    expect(timeInRangeText(view().quarter)).toEqual({ pct: '99.2', readings: 1000 });
    expect(timeInRangeText({ ...view().quarter, timeInRangeBp: null, readings: 0 })).toBeNull();
    expect(hasKey('dairy.bmc.quarter.noReadings')).toBe(true);
    expect(hasKey(litresLostKey())).toBe(true);
  });

  it('tells an operator WHICH way the alerting promise is broken', () => {
    expect(alertingKey(view().alerting)).toBe('dairy.bmc.alerting.ok');
    // The PC-55 defect this wave found: the alert's default channels include SMS and no SMS template was ever seeded,
    // so a village operator's text failed with `no_template` every time.
    expect(alertingKey({ ...view().alerting, smsDeliverable: false })).toBe('dairy.bmc.alerting.noSmsTemplate');
    expect(alertingTone({ ...view().alerting, smsDeliverable: false })).toBe('bad');
    // ...and a deployment behind migration 0086 has no ops alert at all, which outranks it.
    expect(alertingKey({ ...view().alerting, eventCatalogued: false, smsDeliverable: false })).toBe('dairy.bmc.alerting.notCatalogued');
    expect(alertingTone({ ...view().alerting, eventCatalogued: false })).toBe('bad');
    expect(alertingKey({ ...view().alerting, breachRules: 0 })).toBe('dairy.bmc.alerting.noRules');
    expect(alertingKey({ ...view().alerting, recipients: 0 })).toBe('dairy.bmc.alerting.noRecipients');
    expect(alertingTone({ ...view().alerting, recipients: 0 })).toBe('warn');
    for (const k of ['ok', 'noRules', 'noRecipients', 'notCatalogued', 'noSmsTemplate']) expect(hasKey(`dairy.bmc.alerting.${k}`)).toBe(true);
  });

  it('says nothing about the silence rule only when the canon\'s sentence is true as written', () => {
    // A rule exists, its threshold IS the number the screen calls a gap, and it is not tighter than the cadence.
    // TENANT-6d-5 moved this assertion from *"the threshold cannot be expressed"* to *"the promise is kept"* — the
    // three states below are what used to be hidden behind that one.
    expect(silenceGapKey(view().alerting, view().thresholds)).toBeNull();
  });

  it('draws a chart from two points or more, and refuses one', () => {
    const c = chartPath(view().focus!.points)!;
    expect(c.path.startsWith('M')).toBe(true);
    expect(c.path).toContain('L');
    expect(c.minC).toBe('4.0');
    expect(c.maxC).toBe('6.9');
    expect(chartPath([view().focus!.points[0]])).toBeNull();
    expect(chartPath([])).toBeNull();
    expect(hasKey('dairy.bmc.chart.tooFew')).toBe(true);
  });

  it('pads a FLAT series instead of drawing it along the ceiling', () => {
    const c = chartPath([
      { atMinutesAgo: 60, tempC: '4.0' },
      { atMinutesAgo: 0, tempC: '4.0' },
    ])!;
    expect(c.minC).toBe('3.0');
    expect(c.maxC).toBe('5.0');
    // Both points sit in the middle of the box, which is what a steady tank looks like.
    expect(c.path).toMatch(/,75\.0/);
  });

  it('keeps the tank and the window in the URL', () => {
    expect(BMC_HREF).toBe('/dairy/bmc');
    expect(bmcHref()).toBe('/dairy/bmc');
    expect(bmcHref('u1')).toBe('/dairy/bmc?unit=u1');
    expect(bmcHref('u1', 24)).toBe('/dairy/bmc?unit=u1&hours=24');
    expect(bmcHref('u1', 6)).toBe('/dairy/bmc?unit=u1');          // six is the default: one view, one address
  });

  it('splits the states the same way every wave since TENANT-5c', () => {
    expect(bmcState(null)).toBe('ok');
    expect(bmcState('FORBIDDEN', 403)).toBe('restricted');
    expect(bmcState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(bmcState('BOOM', 500)).toBe('error');
    for (const s of ['ok', 'flaggedOff', 'restricted', 'error'] as const) expect(hasKey(bmcStateKey(s))).toBe(true);
    for (const k of ['dairy.bmc.title', 'dairy.bmc.lead', 'dairy.bmc.buffersLocally', 'dairy.bmc.empty.noUnits',
      'dairy.bmc.empty.registerHint', 'form.bmc.add', 'dairy.bmc.header.aboveBand', 'dairy.bmc.header.allInRange',
      'dairy.bmc.header.asOf', 'dairy.bmc.tile.lastSeen', 'dairy.bmc.tile.minutesAgo', 'dairy.bmc.tile.gapAfter',
      'dairy.bmc.tile.band', 'dairy.bmc.tile.target', 'dairy.bmc.tile.capacity', 'dairy.bmc.tile.full',
      'dairy.bmc.tile.readings24h', 'dairy.bmc.tile.breaches24h', 'dairy.bmc.tile.open', 'dairy.bmc.chart.heading',
      'dairy.bmc.chart.hoursShort', 'dairy.bmc.chart.aria', 'dairy.bmc.chart.readings', 'dairy.bmc.playbook.heading',
      'dairy.bmc.playbook.due', 'dairy.bmc.playbook.notYet', 'dairy.bmc.playbook.at', 'dairy.bmc.acts.heading',
      'dairy.bmc.acts.tempC', 'dairy.bmc.acts.recordReading', 'dairy.bmc.acts.volumeLitres', 'dairy.bmc.acts.reportLevel',
      'dairy.bmc.acts.compressor', 'dairy.bmc.acts.stateCompressor', 'dairy.bmc.acts.minC', 'dairy.bmc.acts.targetC',
      'dairy.bmc.acts.toleranceC', 'dairy.bmc.acts.setBand', 'dairy.bmc.quarter.heading', 'dairy.bmc.quarter.timeInRange',
      'dairy.bmc.quarter.readings', 'dairy.bmc.quarter.tanks', 'dairy.bmc.alerting.heading', 'dairy.bmc.alerting.breachRules',
      'dairy.bmc.alerting.silentRules', 'dairy.bmc.alerting.recipients', 'dairy.bmc.thresholds.divert',
      'dairy.bmc.thresholds.condemn', 'dairy.bmc.thresholds.silence', 'dairy.bmc.error.act',
      'dairy.bmc.ok.registered', 'dairy.bmc.ok.band', 'dairy.bmc.ok.level', 'dairy.bmc.ok.compressor',
      'dairy.bmc.ok.reading', 'dairy.bmc.ok.retired']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('builds the sub-nav entry that could not have pointed anywhere before this wave', () => {
    const bmc = DAIRY_NAV.find((i) => i.key === 'bmc')!;
    expect(bmc.built).toBe(true);
    expect(bmc.href).toBe('/dairy/bmc');
    expect(currentDairyNavKey('/dairy/bmc')).toBe('bmc');
    expect(currentDairyNavKey('/dairy')).toBe('collections');
    for (const i of DAIRY_NAV) expect(i.built).toBe(i.href !== null);
    expect(dairyUnbuiltCount()).toBe(1);      // insights only — TENANT-6d-2 built the centres board
  });
});
