// PC-56 TENANT-5d · W225's and W244's rules — what the logistics desk may and may not say.
//
// W244's own framing is why this suite is strict: an FPO sets next quarter's freight RATES from that screen. So the
// tests hold two things equally — that a measured figure renders with its basis, and that a refused figure renders as
// a refusal with its missing inputs named, rather than quietly becoming a zero or a dash with no explanation.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LogisticsFailureBreakdown, LogisticsLane, LogisticsRate, LogisticsTransit } from '@krishalaya/sdk-js';
import {
  DECISIONS, DEFAULT_WINDOW, INSIGHT_WINDOWS, attentionHref, attentionKey, attentionTone, callAheadKey,
  consolidationKey, costPerQtlKmKey, daysAwayKey, decisionKey, decisionSupported, deskState, deskStateKey,
  exportFileName, exportHref, exportNoticeKey, historyBlocks, historyKey, insightsCsv, insightsHref, laneBasisKey,
  laneCandidateKey, laneName, mechanismKey, mechanismMark, mechanismTone, missingKey, onTimeKey, rateKey, rateText,
  reasonKey, reasonName, shareText, transitHoursText, transitKey, transitLossKey, transitPartial, unclassifiedKey,
  wastageShareKey, windowOf,
} from '../features/logistics/desk';
import { LOGISTICS_NAV, currentNavKey, unbuiltCount } from '../features/logistics/nav';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));

const measured = (bps: number, of = 100): LogisticsRate => ({ kind: 'measured', bps, of });
const lane = (o: Partial<LogisticsLane> = {}): LogisticsLane => ({
  fromRegionId: 'r1', toRegionId: 'r2', fromName: 'Vanthali', toName: 'Rajkot',
  shipments: 31, shareBps: 3100, candidate: true, ...o,
});
const breakdown = (o: Partial<LogisticsFailureBreakdown> = {}): LogisticsFailureBreakdown => ({
  total: 100, slices: [{ code: 'gate_closed', events: 60, shareBps: 6000 }], unclassified: 40, mostlyUnclassified: false, ...o,
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5d · the figures the desk refuses to print', () => {
  it('names every missing input in all three languages', () => {
    for (const m of ['shipment_promised_delivery_at', 'zone_delivery_sla', 'shipment_loss_record',
      'weighbridge_slips', 'wastage_baseline', 'shipment_distance_km', 'consignment_weight', 'shipment_charge_minor']) {
      expect(hasKey(missingKey(m))).toBe(true);
    }
  });

  it('has one sentence each for on-time, transit loss and cost per qtl-km', () => {
    expect(onTimeKey({ kind: 'not_promised', missing: [] })).toBe('logistics.onTime.notPromised');
    expect(transitLossKey({ kind: 'not_recorded', missing: [], nearest: 'buyer_disputes_damaged' })).toBe('logistics.transitLoss.notRecorded');
    expect(costPerQtlKmKey({ kind: 'not_computable', missing: [] })).toBe('logistics.cost.notComputable');
    for (const k of ['logistics.onTime.notPromised', 'logistics.transitLoss.notRecorded', 'logistics.cost.notComputable']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('refuses the wastage share, and the copy says there is no whole to take a share of', () => {
    expect(wastageShareKey()).toBe('logistics.wastage.noBaseline');
    expect(hasKey('logistics.wastage.noBaseline')).toBe(true);
    const en = dict('en');
    expect(en.slice(en.indexOf("'logistics.wastage.noBaseline':"), en.indexOf("'logistics.wastage.noBaseline':") + 260))
      .toMatch(/measures total wastage/);
  });

  it('says on-time is not PROMISED rather than not measured — the distinction an operator can act on', () => {
    const en = dict('en');
    expect(en.slice(en.indexOf("'logistics.onTime.notPromised':"), en.indexOf("'logistics.onTime.notPromised':") + 220))
      .toMatch(/promises a delivery time/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5d · the figures it does print', () => {
  it('renders a rate from basis points, and nothing at all when there was nothing to measure', () => {
    expect(rateText(measured(9237))).toBe('92.4%');
    expect(rateText(measured(10_000))).toBe('100.0%');
    expect(rateText({ kind: 'no_deliveries' })).toBeNull();
    expect(rateKey(measured(1))).toBe('logistics.rate.measured');
    expect(rateKey({ kind: 'no_deliveries' })).toBe('logistics.rate.noDeliveries');
    expect(hasKey('logistics.rate.noDeliveries')).toBe(true);
  });

  it('says "no deliveries" rather than 0%, because 0% is a claim about performance', () => {
    const en = dict('en');
    expect(en.slice(en.indexOf("'logistics.rate.noDeliveries':"), en.indexOf("'logistics.rate.noDeliveries':") + 200))
      .toMatch(/not the same as 0%/);
  });

  it('renders the transit median with its coverage, and flags a partial one', () => {
    const full: LogisticsTransit = { kind: 'measured', medianHours: 6.5, of: 50, missingPickupStamp: 0 };
    const partial: LogisticsTransit = { kind: 'measured', medianHours: 6.5, of: 45, missingPickupStamp: 5 };
    const none: LogisticsTransit = { kind: 'not_measurable', missingPickupStamp: 12 };
    expect(transitHoursText(full)).toBe('6.5');
    expect(transitHoursText(none)).toBeNull();
    expect(transitKey(full)).toBe('logistics.transit.median');
    expect(transitKey(none)).toBe('logistics.transit.notMeasurable');
    expect(transitPartial(full)).toBe(false);
    expect(transitPartial(partial)).toBe(true);
    // A median over an unknown fraction of the window is a number an operator should distrust, so the screen says so.
    expect(transitPartial(none)).toBe(true);
    for (const k of ['logistics.transit.median', 'logistics.transit.notMeasurable', 'logistics.transit.partial']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('renders a share to one decimal from basis points', () => {
    expect(shareText(3100)).toBe('31.0%');
    expect(shareText(9999)).toBe('100.0%');
    expect(shareText(0)).toBe('0.0%');
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5d · "Needs you today" (W225)', () => {
  const items = {
    noDriver: { kind: 'pickup_no_driver' as const, shipmentId: 's1', orderId: 'o1', at: 'x', hasVehicle: true },
    due: { kind: 'pickup_due' as const, shipmentId: 's2', orderId: 'o2', at: 'x' },
    reefer: (breaches: number) => ({ kind: 'cold_chain_live' as const, shipmentId: 's3', orderId: 'o3', lastTempC: '4.2', lastAt: 'x', breaches }),
    run: { kind: 'village_run' as const, routeId: 'rt', routeName: 'Saturday Run', dayKey: 'route.day.sat', daysAway: 5, consolidation: 'not_tracked' as const },
  };

  it('has a key and a translation for every row kind', () => {
    for (const i of [items.noDriver, items.due, items.reefer(0), items.run]) {
      expect(attentionKey(i)).toBe(`logistics.attention.${i.kind}`);
      expect(hasKey(attentionKey(i))).toBe(true);
    }
  });

  it('reads a breaching reefer as the loudest row on the screen', () => {
    expect(attentionTone(items.reefer(2))).toBe('bad');
    expect(attentionTone(items.reefer(0))).toBe('ok');
    expect(attentionTone(items.noDriver)).toBe('warn');
    expect(attentionTone(items.due)).toBe('muted');
  });

  it('links each row to a route this console actually has', () => {
    expect(attentionHref(items.noDriver)).toBe('/logistics/s1');
    expect(attentionHref(items.reefer(0))).toBe('/logistics/s3');
    expect(attentionHref(items.run)).toBe('/logistics/routes');
    // ids are encoded, because a shipment id lands in a path segment
    expect(attentionHref({ ...items.due, shipmentId: 'a b' })).toBe('/logistics/a%20b');
  });

  it('states that the consolidation count is not tracked — only on the run row', () => {
    expect(consolidationKey(items.run)).toBe('logistics.attention.consolidationNotTracked');
    expect(consolidationKey(items.reefer(0))).toBeNull();
    expect(hasKey('logistics.attention.consolidationNotTracked')).toBe(true);
  });

  it('says "today" and "tomorrow" in words, because "loads in 0 days" is not English', () => {
    expect(daysAwayKey(0)).toBe('logistics.run.today');
    expect(daysAwayKey(1)).toBe('logistics.run.tomorrow');
    expect(daysAwayKey(5)).toBe('logistics.run.inDays');
    expect(daysAwayKey(null)).toBe('logistics.run.onDemand');
    for (const k of ['logistics.run.today', 'logistics.run.tomorrow', 'logistics.run.inDays', 'logistics.run.onDemand']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('says there is no arrival estimate on the reefer row, where the canon printed one', () => {
    expect(hasKey('logistics.coldChain.noEta')).toBe(true);
    const en = dict('en');
    expect(en.slice(en.indexOf("'logistics.coldChain.noEta':"), en.indexOf("'logistics.coldChain.noEta':") + 160))
      .toMatch(/routing engine/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5d · the philosophy block, checked against the software', () => {
  it('ticks only what is ON, and marks the rest without a tick', () => {
    expect(mechanismMark({ key: 'otp_both_ends', state: 'on' })).toBe('✓');
    expect(mechanismMark({ key: 'village_run', state: 'partial' })).toBe('~');
    expect(mechanismMark({ key: 'weighbridge', state: 'absent' })).toBe('✕');
    expect(mechanismMark({ key: 'weighbridge', state: 'off' })).toBe('✕');
    expect(mechanismTone({ key: 'otp_both_ends', state: 'on' })).toBe('ok');
    expect(mechanismTone({ key: 'otp_both_ends', state: 'partial' })).toBe('warn');
    expect(mechanismTone({ key: 'weighbridge', state: 'absent' })).toBe('muted');
  });

  it('has a distinct sentence for every state each mechanism can actually be in', () => {
    for (const key of ['otp_both_ends', 'weighbridge', 'village_run'] as const) {
      for (const state of ['on', 'off', 'partial', 'absent'] as const) {
        expect(hasKey(mechanismKey({ key, state }))).toBe(true);
      }
    }
  });

  it('says the weighbridge does not exist, rather than that it is switched off', () => {
    // A safety claim an FPO would quote in a quantity dispute. "Off" invites somebody to look for the setting.
    const en = dict('en');
    const i = en.indexOf("'logistics.mech.weighbridge.absent':");
    expect(en.slice(i, i + 300)).toMatch(/does not exist yet/);
  });

  it('says the pickup half of the OTP promise is the missing one', () => {
    const en = dict('en');
    const i = en.indexOf("'logistics.mech.otp_both_ends.partial':");
    expect(en.slice(i, i + 300)).toMatch(/farm gate is not proven/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5d · the insights screen (W244)', () => {
  it('offers only the three windows the API accepts, defaulting to 90', () => {
    expect(INSIGHT_WINDOWS).toEqual([30, 90, 180]);
    expect(DEFAULT_WINDOW).toBe(90);
    expect(windowOf('30')).toBe(30);
    expect(windowOf('3650')).toBe(90);
    expect(windowOf(undefined)).toBe(90);
    expect(windowOf('abc')).toBe(90);
  });

  it('keeps the default window OUT of the URL, and carries the others', () => {
    expect(insightsHref(90)).toBe('/logistics/insights');
    expect(insightsHref(30)).toBe('/logistics/insights?window=30');
    expect(exportHref(180)).toBe('/logistics/insights/export?window=180');
  });

  it('blocks the body on the two history states the canon draws, and not on the third', () => {
    expect(historyBlocks({ kind: 'no_data' })).toBe(true);
    expect(historyBlocks({ kind: 'not_enough_history', days: 4, needDays: 30 })).toBe(true);
    expect(historyBlocks({ kind: 'ready', days: 90 })).toBe(false);
    expect(historyKey({ kind: 'no_data' })).toBe('logistics.history.none');
    expect(historyKey({ kind: 'not_enough_history', days: 4, needDays: 30 })).toBe('logistics.history.tooShort');
    for (const k of ['logistics.history.none', 'logistics.history.tooShort', 'logistics.history.ready']) expect(hasKey(k)).toBe(true);
  });

  it('reads "not enough history" as encouragement, not as a failure', () => {
    const en = dict('en');
    expect(en.slice(en.indexOf("'logistics.history.tooShort':"), en.indexOf("'logistics.history.tooShort':") + 200))
      .toMatch(/the picture builds/);
  });

  it('names a slice from the TENANT\'S vocabulary first, then this console\'s translation', () => {
    const names = [{ code: 'ferry_missed', name: 'Ferry missed' }];
    expect(reasonName(names, 'ferry_missed')).toBe('Ferry missed');
    expect(reasonName(names, 'gate_closed')).toBeNull();
    for (const c of ['gate_closed', 'reschedule_requested', 'address_problem', 'vehicle_problem', 'weather', 'other']) {
      expect(hasKey(reasonKey(c))).toBe(true);
    }
  });

  it('has one sentence for a minority of unclassified attempts and a louder one for a majority', () => {
    expect(unclassifiedKey(breakdown({ unclassified: 0 }))).toBeNull();
    expect(unclassifiedKey(breakdown({ unclassified: 40 }))).toBe('logistics.failures.someUnclassified');
    expect(unclassifiedKey(breakdown({ unclassified: 70, mostlyUnclassified: true }))).toBe('logistics.failures.mostlyUnclassified');
    expect(hasKey('logistics.failures.someUnclassified')).toBe(true);
    expect(hasKey('logistics.failures.mostlyUnclassified')).toBe(true);
  });

  it('says WHY those attempts have no reason: the platform did not store one', () => {
    const en = dict('en');
    expect(en.slice(en.indexOf("'logistics.failures.someUnclassified':"), en.indexOf("'logistics.failures.someUnclassified':") + 200))
      .toMatch(/before this platform stored one/);
  });

  it('offers the call-ahead pilot only when the API says the evidence supports it', () => {
    expect(callAheadKey({ callAhead: true, failures: breakdown() })).toBe('logistics.decide.callAhead');
    // Not supported, and MOSTLY blank history — the screen says what to do about it instead of going quiet.
    expect(callAheadKey({ callAhead: false, failures: breakdown({ mostlyUnclassified: true }) })).toBe('logistics.decide.needCodedReasons');
    // Not supported because a different reason leads: no sentence, because this one is specifically about calling ahead.
    expect(callAheadKey({ callAhead: false, failures: breakdown() })).toBeNull();
    // Nothing failed at all: nothing to say.
    expect(callAheadKey({ callAhead: false, failures: breakdown({ total: 0, slices: [], unclassified: 0 }) })).toBeNull();
    expect(hasKey('logistics.decide.callAhead')).toBe(true);
    expect(hasKey('logistics.decide.needCodedReasons')).toBe(true);
  });

  it('labels the lane share as SHIPMENTS and never as qtl-km', () => {
    expect(laneBasisKey('shipments')).toBe('logistics.lane.basisShipments');
    const en = dict('en');
    const i = en.indexOf("'logistics.lane.basisShipments':");
    expect(en.slice(i, i + 250)).toMatch(/not of quintal-km/);
    expect(hasKey('logistics.lane.basisShipments')).toBe(true);
  });

  it('names a lane from both ends, falling back to a short id rather than showing nothing', () => {
    expect(laneName(lane())).toBe('Vanthali ↔ Rajkot');
    expect(laneName(lane({ fromName: null, fromRegionId: 'abcdefgh-1111' }))).toBe('abcdefgh ↔ Rajkot');
    expect(laneCandidateKey(lane())).toBe('logistics.lane.candidate');
    expect(laneCandidateKey(lane({ candidate: false }))).toBeNull();
    expect(hasKey('logistics.lane.candidate')).toBe(true);
  });

  it('supports one of the canon\'s three decisions, half-supports the second, and refuses the third', () => {
    expect(DECISIONS).toEqual(['laneCandidate', 'routeProposal', 'tarpStandard']);
    expect(decisionSupported('laneCandidate', { hasCandidate: true })).toBe(true);
    expect(decisionSupported('laneCandidate', { hasCandidate: false })).toBe(false);
    expect(decisionSupported('routeProposal', { hasCandidate: false })).toBe(true);
    // The tarp standard would be judged on a transit-loss trend, and nothing measures transit loss.
    expect(decisionSupported('tarpStandard', { hasCandidate: true })).toBe(false);
    for (const d of DECISIONS) expect(hasKey(decisionKey(d))).toBe(true);
    expect(hasKey('logistics.decide.noMeasure')).toBe(true);
    expect(hasKey('logistics.decide.noCandidateYet')).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5d · the export (W2385/W2386)', () => {
  const payload = {
    window: 90, windowFrom: '2026-05-21', windowTo: '2026-08-19',
    firstAttempt: measured(9280, 118) as LogisticsRate,
    transit: { kind: 'measured', medianHours: 6.5, of: 45, missingPickupStamp: 5 } as LogisticsTransit,
    failures: breakdown(),
    reasonNames: [{ code: 'gate_closed', name: 'Gate closed' }],
    lanes: { lanes: [lane()], totalShipments: 100, basis: 'shipments' as const },
    freightRecovered: [{ currencyCode: 'INR', recoveredMinor: '1184000' }],
  };

  it('says the export is immediate and bounded, because no export queue exists on this platform', () => {
    expect(exportNoticeKey()).toBe('logistics.export.synchronous');
    expect(hasKey('logistics.export.synchronous')).toBe(true);
    expect(hasKey('logistics.export.failed')).toBe(true);
  });

  it('names the file after the window and the day it covers', () => {
    expect(exportFileName(90, '2026-08-19')).toBe('logistics-insights-90d-2026-08-19.csv');
  });

  it('carries the measured figures with their basis', () => {
    const csv = insightsCsv(payload);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('section,key,value,unit,basis');
    expect(csv).toContain('window,days,90,days,2026-05-21..2026-08-19');
    expect(csv).toContain('delivery,first_attempt_bps,9280,bps,of 118 delivered');
    expect(csv).toContain('delivery,median_transit_hours,6.5,hours,of 45 timed');
  });

  it('carries the REFUSALS into the file, so nobody recomputes them from the wrong columns', () => {
    const csv = insightsCsv(payload);
    expect(csv).toContain('delivery,on_time_pct,,pct,not_promised:no_promised_delivery_at');
    expect(csv).toContain('cost,cost_per_qtl_km,,currency_minor_per_qtl_km,not_computable:no_distance,no_weight,no_charge'.replace('not_computable:no_distance,no_weight,no_charge', '"not_computable:no_distance,no_weight,no_charge"'));
    expect(csv).toContain('loss,transit_loss,,currency_minor,not_recorded:no_loss_record');
  });

  it('keeps money in MINOR UNITS with its currency in its own column', () => {
    // A spreadsheet cannot sum "₹11,840", and a float in a CSV is how a rate card acquires a rounding error.
    const csv = insightsCsv(payload);
    expect(csv).toContain('freight,recovered_minor,1184000,INR,resolved_disputes');
    expect(csv).not.toContain('₹');
  });

  it('reports the unclassified attempts as their own row, not folded into a bar', () => {
    const csv = insightsCsv(payload);
    expect(csv).toContain('failures,gate_closed,60,events,60.0% of coded');
    expect(csv).toContain('failures,unclassified,40,events,recorded before a coded reason existed');
  });

  it('omits the unclassified row when there is none', () => {
    const csv = insightsCsv({ ...payload, failures: breakdown({ unclassified: 0 }) });
    expect(csv).not.toContain('unclassified');
  });

  it('quotes a lane name containing the separator, so one comma cannot shift every column', () => {
    const csv = insightsCsv({ ...payload, lanes: { lanes: [lane({ fromName: 'Vanthali, GJ' })], totalShipments: 100, basis: 'shipments' } });
    expect(csv).toContain('"Vanthali, GJ ↔ Rajkot"');
  });

  it('escapes a quote inside a name rather than breaking the row', () => {
    const csv = insightsCsv({ ...payload, lanes: { lanes: [lane({ fromName: 'A"B' })], totalShipments: 1, basis: 'shipments' } });
    expect(csv).toContain('"A""B ↔ Rajkot"');
  });

  it('leaves the value EMPTY rather than zero when there was nothing to measure', () => {
    const csv = insightsCsv({ ...payload, firstAttempt: { kind: 'no_deliveries' }, transit: { kind: 'not_measurable', missingPickupStamp: 3 } });
    expect(csv).toContain('delivery,first_attempt_bps,,bps,no_deliveries');
    expect(csv).toContain('delivery,median_transit_hours,,hours,not_measurable');
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5d · states and the way in', () => {
  it('tells the flagged-off desk from the restricted one and from a real failure', () => {
    expect(deskState(null)).toBe('ok');
    expect(deskState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(deskState('FORBIDDEN', 403)).toBe('restricted');
    expect(deskState('generic', 500)).toBe('error');
    for (const screen of ['overview', 'insights'] as const) {
      for (const s of ['ok', 'flaggedOff', 'restricted', 'error'] as const) {
        expect(hasKey(deskStateKey(s, screen))).toBe(true);
      }
    }
  });

  it('says "nothing is broken" for flagged-off and keeps the trucks moving in the error copy', () => {
    const en = dict('en');
    expect(en.slice(en.indexOf("'logistics.overview.state.flaggedOff':"), en.indexOf("'logistics.overview.state.flaggedOff':") + 220))
      .toMatch(/Nothing is broken/);
    expect(en).toMatch(/Riders and 3PLs keep moving/);
    expect(en).toMatch(/Operational screens are unaffected/);
  });

  it('opens the canon\'s FIRST sub-nav entry, which had pointed at nothing since 5b', () => {
    const overview = LOGISTICS_NAV.find((i) => i.key === 'overview');
    expect(overview).toEqual({ key: 'overview', href: '/logistics/overview', built: true });
    expect(currentNavKey('/logistics/overview')).toBe('overview');
  });

  it('adds insights to the nav, because the canon links W244 from NOWHERE', () => {
    // `grep -rl W244-tenant-logistics-insights` over all 1,955 canon screens returns nothing — not an operational
    // screen, not a breadcrumb, not even its own chain states, while W225 is referenced by 589.
    expect(LOGISTICS_NAV.find((i) => i.key === 'insights')).toEqual({ key: 'insights', href: '/logistics/insights', built: true });
    expect(hasKey('logistics.nav.insights')).toBe(true);
    expect(currentNavKey('/logistics/insights')).toBe('insights');
  });

  it('keeps every canon entry in the canon\'s order, and only two sections still have no screen', () => {
    expect(LOGISTICS_NAV.filter((i) => !['freight', 'insights'].includes(i.key)).map((i) => i.key))
      .toEqual(['overview', 'shipments', 'carriers', 'vehicles', 'routes', 'zones', 'coldChain']);
    expect(LOGISTICS_NAV.filter((i) => !i.built).map((i) => i.key)).toEqual(['carriers', 'zones', 'coldChain']);
    expect(unbuiltCount()).toBe(3);
  });
});
