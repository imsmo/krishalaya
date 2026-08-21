// PC-56 TENANT-6a · W167's rules as the console applies them — what the counter board may and may not say.
//
// W167 is a screen about 312 families' milk money, and its lead sentence makes four claims that are not equally true
// on this platform. This suite holds the console to the split: print the two that hold, qualify the one that half
// holds, refuse the one that does not — and never let a refusal degrade into a blank cell, a dash, or a zero.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  DairyAccrual, DairyAnalyzer, DairyBmcTemp, DairyCounterCentre, DairyCoverage, DairyCycleWindow, DairyFlagSummary,
} from '@krishalaya/sdk-js';
import {
  MUTATE_CHAIN_IS_RETRY, SHIFTS, accrualKey, analyzerKey, analyzerText, analyzerVerified, billsGapKey, bmcKey,
  bmcText, bmcTone, boardHref, bonusIgnoredKey, centreCoverageText, centreQuietKey, coverageKey, coverageShareText,
  dairyState, dairyStateKey, flagKindKey, flagWorkflowKey, flagsKey, paydayKey, qualityText, retryChainKey,
  shiftClockKey, shiftKey, shiftOf, totalsFoot, uniquenessKey, windowBasisKey, windowKey,
} from '../features/dairy/counter';
import { DAIRY_NAV, currentDairyNavKey, dairyNavLabelKey, dairyUnbuiltCount } from '../features/dairy/nav';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));

const centre = (o: Partial<DairyCounterCentre> = {}): DairyCounterCentre => ({
  mccId: 'm1', code: 'MCC-VNT', name: 'Vanthali', litres: '812.4', pours: 104, pourers: 104,
  membershipsEnrolled: 118, fatPct: '6.4', snfPct: '8.9', amountMinor: '4881200', flags: 1,
  analyzer: { kind: 'none_on_file' }, bmc: { kind: 'no_unit' }, ...o,
});
const accrual = (o: Partial<DairyAccrual> = {}): DairyAccrual => ({
  kind: 'accrued', amountMinor: '248820000', currencyCode: 'INR',
  window: { from: '2026-07-01', to: '2026-07-15', cycle: 'fortnightly', basis: 'derived_from_membership_preference' },
  bonusRulesIgnored: false, membersWithPours: 312, billsExisting: 0, ...o,
});
const flags = (o: Partial<DairyFlagSummary> = {}): DairyFlagSummary => ({
  total: 0, water: 0, other: 0, kinds: [], workflow: 'not_built', ...o,
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6a · the shift, and the hours the console will not invent', () => {
  it('offers exactly the two shifts the column allows, both named in all three languages', () => {
    expect([...SHIFTS]).toEqual(['morning', 'evening']);
    for (const s of SHIFTS) expect(hasKey(shiftKey(s))).toBe(true);
  });

  it('treats anything that is not "evening" as the morning board rather than 500-ing on a typo', () => {
    expect(shiftOf('evening')).toBe('evening');
    expect(shiftOf('morning')).toBe('morning');
    expect(shiftOf(undefined)).toBe('morning');
    expect(shiftOf('MORNING')).toBe('morning');
    expect(shiftOf('night')).toBe('morning');
  });

  it('refuses to print "evening starts 17:00" — no shift clock exists to print', () => {
    const key = shiftClockKey({ kind: 'not_recorded', missing: ['mcc_shift_open_at', 'mcc_shift_close_at'] });
    expect(key).toBe('dairy.shift.clockNotRecorded');
    expect(hasKey(key)).toBe(true);
  });

  it('keeps the day and the shift in the URL so yesterday evening is bookmarkable and Back works', () => {
    expect(boardHref('morning')).toBe('/dairy');
    expect(boardHref('evening')).toBe('/dairy?shift=evening');
    expect(boardHref('morning', '2026-07-14')).toBe('/dairy?day=2026-07-14');
    expect(boardHref('evening', '2026-07-14')).toBe('/dairy?shift=evening&day=2026-07-14');
    expect(boardHref('morning', null)).toBe('/dairy');
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6a · the centre row', () => {
  it('says an analyzer is ON FILE and never that it metered the pour', () => {
    const on: DairyAnalyzer = { kind: 'on_file', model: 'Lactoscan MCC', serial: 'LS-9182', perPourEvidence: false };
    expect(analyzerKey(on)).toBe('dairy.analyzer.onFile');
    expect(analyzerText(on)).toBe('Lactoscan MCC · LS-9182');
    expect(analyzerText({ kind: 'on_file', model: 'Lactoscan MCC', serial: null, perPourEvidence: false }))
      .toBe('Lactoscan MCC');
    expect(analyzerKey({ kind: 'none_on_file' })).toBe('dairy.analyzer.none');
    expect(analyzerText({ kind: 'none_on_file' })).toBeNull();
    for (const k of ['dairy.analyzer.onFile', 'dairy.analyzer.none']) expect(hasKey(k)).toBe(true);
  });

  it('never renders the analyzer as verified — `device_payload` is dead, so no reading has a device', () => {
    expect(analyzerVerified({ kind: 'on_file', model: 'Lactoscan MCC', serial: 'LS-9182', perPourEvidence: false }))
      .toBe(false);
    expect(analyzerVerified({ kind: 'none_on_file' })).toBe(false);
  });

  it('distinguishes no cooler, a cooler with no readings, and a reading over target — never a blank cell', () => {
    const noUnit: DairyBmcTemp = { kind: 'no_unit' };
    const noReads: DairyBmcTemp = { kind: 'no_readings', unitId: 'b1', targetC: '4.0' };
    const cold: DairyBmcTemp = { kind: 'reading', tempC: '3.8', recordedAt: 'x', targetC: '4.0', overTarget: false };
    const warm: DairyBmcTemp = { kind: 'reading', tempC: '6.9', recordedAt: 'x', targetC: '4.0', overTarget: true };

    expect([bmcKey(noUnit), bmcKey(noReads), bmcKey(cold), bmcKey(warm)])
      .toEqual(['dairy.bmc.noUnit', 'dairy.bmc.noReadings', 'dairy.bmc.inRange', 'dairy.bmc.overTarget']);
    expect([bmcTone(noUnit), bmcTone(noReads), bmcTone(cold), bmcTone(warm)])
      .toEqual(['muted', 'muted', 'ok', 'bad']);
    expect([bmcText(noUnit), bmcText(noReads), bmcText(cold), bmcText(warm)])
      .toEqual([null, null, '3.8°C', '6.9°C']);
    for (const k of ['dairy.bmc.noUnit', 'dairy.bmc.noReadings', 'dairy.bmc.inRange', 'dairy.bmc.overTarget']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('marks a centre that has poured nothing rather than letting its zero read as data', () => {
    expect(centreQuietKey(centre({ pours: 0 }))).toBe('dairy.centre.noPoursYet');
    expect(centreQuietKey(centre({ pours: 1 }))).toBeNull();
    expect(hasKey('dairy.centre.noPoursYet')).toBe(true);
  });

  it('shows each centre\'s coverage as a PAIR against its own roll, and nothing when it has no roll', () => {
    expect(centreCoverageText(centre({ pourers: 104, membershipsEnrolled: 118 }))).toBe('104/118');
    expect(centreCoverageText(centre({ pourers: 0, membershipsEnrolled: 0 }))).toBeNull();
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6a · the tiles', () => {
  it('gives W167\'s "287 of 312 pourers" as the count first and the share second', () => {
    const measured: DairyCoverage = { kind: 'measured', poured: 287, enrolled: 312, shareBps: 9198 };
    expect(coverageKey(measured)).toBe('dairy.coverage.measured');
    expect(coverageShareText(measured)).toBe('92.0%');
    expect(coverageKey({ kind: 'no_memberships' })).toBe('dairy.coverage.noMemberships');
    expect(coverageShareText({ kind: 'no_memberships' })).toBeNull();
    for (const k of ['dairy.coverage.measured', 'dairy.coverage.noMemberships']) expect(hasKey(k)).toBe(true);
  });

  it('prints no quality at all when nothing was poured — "0.0 fat" would read as water', () => {
    expect(qualityText('6.4', '8.9')).toBe('6.4 / 8.9');
    expect(qualityText('6.4', null)).toBe('6.4 / —');
    expect(qualityText(null, '8.9')).toBe('— / 8.9');
    expect(qualityText(null, null)).toBeNull();
  });

  it('labels the money an ACCRUAL, because W169\'s bills subtract feed credit, EMI and insurance from it', () => {
    expect(accrualKey(accrual())).toBe('dairy.accrual.beforeDeductions');
    expect(hasKey('dairy.accrual.beforeDeductions')).toBe(true);
  });

  it('says the premium band paid nothing whenever a card carrying bonus slabs priced the window', () => {
    expect(bonusIgnoredKey(accrual({ bonusRulesIgnored: true }))).toBe('dairy.accrual.bonusIgnored');
    expect(bonusIgnoredKey(accrual({ bonusRulesIgnored: false }))).toBeNull();
    expect(hasKey('dairy.accrual.bonusIgnored')).toBe(true);
  });

  it('refuses W167\'s "312 milk_bills building" and shows the gap instead', () => {
    expect(billsGapKey(accrual({ membersWithPours: 312, billsExisting: 0 }))).toBe('dairy.accrual.noBillsYet');
    expect(billsGapKey(accrual({ membersWithPours: 312, billsExisting: 40 }))).toBe('dairy.accrual.billsPartial');
    // Nobody poured: there is no gap to complain about, so no sentence.
    expect(billsGapKey(accrual({ membersWithPours: 0, billsExisting: 0 }))).toBeNull();
    for (const k of ['dairy.accrual.noBillsYet', 'dairy.accrual.billsPartial']) expect(hasKey(k)).toBe(true);
  });

  it('names the window\'s cycle AND labels it derived, in every cycle the preference allows', () => {
    for (const cycle of ['daily', 'weekly', 'fortnightly', 'monthly'] as const) {
      const w: DairyCycleWindow = { from: 'a', to: 'b', cycle, basis: 'derived_from_membership_preference' };
      expect(windowKey(w)).toBe(`dairy.window.${cycle}`);
      expect(hasKey(windowKey(w))).toBe(true);
      expect(hasKey(`dairy.cycleName.${cycle}`)).toBe(true); // the mix line names them too
      expect(windowBasisKey(w)).toBe('dairy.window.derived');
    }
    expect(hasKey('dairy.window.derived')).toBe(true);
    expect(hasKey('dairy.window.mix')).toBe(true);
  });

  it('refuses the payday by name — 312 families plan a week around a date nothing records', () => {
    expect(paydayKey({ kind: 'not_recorded', closesOn: '2026-07-15', missing: ['dairy_cycle_calendar'] }))
      .toBe('dairy.payday.notRecorded');
    expect(hasKey('dairy.payday.notRecorded')).toBe(true);
  });

  it('counts flags, names their kinds, and says the workflow after the flag does not exist', () => {
    const some = flags({ total: 3, water: 2, other: 1, kinds: ['water_flag', 'urea'] });
    expect(flagsKey(some)).toBe('dairy.flags.some');
    expect(flagWorkflowKey(some)).toBe('dairy.flags.workflowNotBuilt');
    expect(flagsKey(flags())).toBe('dairy.flags.none');
    expect(flagWorkflowKey(flags())).toBeNull();
    for (const k of ['dairy.flags.some', 'dairy.flags.none', 'dairy.flags.workflowNotBuilt']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('names the four known adulterants and folds anything a tenant invents into "other"', () => {
    for (const k of ['water_flag', 'urea', 'starch', 'detergent']) {
      expect(flagKindKey(k)).toBe(`dairy.flagKind.${k}`);
      expect(hasKey(flagKindKey(k))).toBe(true);
    }
    expect(flagKindKey('neutraliser')).toBe('dairy.flagKind.other');
    expect(flagKindKey('')).toBe('dairy.flagKind.other');
    expect(hasKey('dairy.flagKind.other')).toBe(true);
  });

  it('states the one promise W167 makes that IS enforced end to end', () => {
    expect(uniquenessKey()).toBe('dairy.pour.unique');
    expect(hasKey('dairy.pour.unique')).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6a · W167\'s foot-of-table tick, which is a CHECK', () => {
  it('foots when the centre rows sum to the header total', () => {
    const f = totalsFoot([centre({ litres: '812.4' }), centre({ litres: '1335.6' })], '2148.0');
    expect(f).toEqual({ centres: 2, litres: '2148.0', foots: true });
  });

  it('fails LOUDLY on a tenth of a litre, because a tick that is not a check is decoration', () => {
    expect(totalsFoot([centre({ litres: '812.4' })], '812.5').foots).toBe(false);
    expect(totalsFoot([centre({ litres: '812.4' })], '812.3').foots).toBe(false);
    expect(hasKey('dairy.totals.foots')).toBe(true);
    expect(hasKey('dairy.totals.mismatch')).toBe(true);
  });

  it('compares in integer tenths, so no float rounding can turn a mismatch into a tick', () => {
    // 0.1 × 3 is 0.30000000000000004 in float; in tenths it is exactly 3.
    expect(totalsFoot([centre({ litres: '0.1' }), centre({ litres: '0.1' }), centre({ litres: '0.1' })], '0.3').foots)
      .toBe(true);
    expect(totalsFoot([], '0.0')).toEqual({ centres: 0, litres: '0.0', foots: true });
  });

  it('handles a whole-litre string with no decimal point on either side', () => {
    expect(totalsFoot([centre({ litres: '12' }), centre({ litres: '8' })], '20').foots).toBe(true);
    expect(totalsFoot([centre({ litres: '12' })], '12.0').foots).toBe(true);
  });

  it('reports the centre COUNT it actually summed, not one the header claims', () => {
    expect(totalsFoot([centre(), centre(), centre()], '0.0').centres).toBe(3);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6a · the dairy sub-nav', () => {
  it('draws all six canon sections and marks the five with no screen as NOT BUILT, not hidden', () => {
    const canon = ['collections', 'quality', 'cycles', 'bmc', 'centres', 'insights'];
    for (const k of canon) {
      const item = DAIRY_NAV.find((i) => i.key === k);
      expect(item).toBeDefined();
      expect(hasKey(dairyNavLabelKey(item!))).toBe(true);
    }
    // [UPDATED BY PC-56 TENANT-6b-2, THEN 6c-6] `quality` joined the built set when W168 landed (the canon links that
    // screen from nowhere at all, so the sub-nav is its only way in), and `cycles` when W169 landed. This assertion
    // tracks the set as 6d and 6e land theirs, and its whole job is to fail when a section is silently unbuilt again.
    expect(DAIRY_NAV.filter((i) => canon.includes(i.key) && i.built).map((i) => i.key)).toEqual(['collections', 'quality', 'cycles', 'bmc']);
    // [PC-56 TENANT-6c-6] Three now: W169 landed, so `cycles` has an href. This number is the point of the tile —
    // "five of these do nothing yet" must count DOWN as waves land, or it becomes decoration.
    expect(dairyUnbuiltCount()).toBe(2);
    expect(hasKey('dairy.nav.unbuilt')).toBe(true);
    expect(hasKey('dairy.nav.label')).toBe(true);
  });

  it('keeps the pre-canon operator console reachable at /dairy/console — it owns acts no canon screen has yet', () => {
    const legacy = DAIRY_NAV.find((i) => i.key === 'console');
    expect(legacy).toEqual({ key: 'console', href: '/dairy/console', built: true });
    expect(hasKey('dairy.nav.console')).toBe(true);
  });

  it('never leaves a built entry without an href, nor an unbuilt entry WITH one', () => {
    for (const i of DAIRY_NAV) expect(i.built).toBe(i.href !== null);
  });

  it('lights the console entry on /dairy/console rather than lighting collections as well', () => {
    expect(currentDairyNavKey('/dairy')).toBe('collections');
    expect(currentDairyNavKey('/dairy/console')).toBe('console');
    expect(currentDairyNavKey('/dairy/console/rate-cards')).toBe('console');
  });

  it('lights nothing on a path that merely starts with the same letters', () => {
    expect(currentDairyNavKey('/dairy-archive')).toBeNull();
    expect(currentDairyNavKey('/logistics')).toBeNull();
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6a · states, and the chain this screen does not have', () => {
  it('separates the flag guard\'s 404 from a permission\'s 403 from an actual failure', () => {
    expect(dairyState(null)).toBe('ok');
    expect(dairyState(undefined)).toBe('ok');
    expect(dairyState('NOT_FOUND')).toBe('flaggedOff');
    expect(dairyState('generic', 404)).toBe('flaggedOff');
    expect(dairyState('FORBIDDEN')).toBe('restricted');
    expect(dairyState('generic', 403)).toBe('restricted');
    expect(dairyState('generic', 500)).toBe('error');
    expect(dairyState('DB_DOWN')).toBe('error');
  });

  it('has copy for every state, plus W167\'s own promise that the counters buffer offline', () => {
    for (const s of ['ok', 'flaggedOff', 'restricted', 'error'] as const) {
      expect(dairyStateKey(s)).toBe(`dairy.state.${s}`);
      expect(hasKey(dairyStateKey(s))).toBe(true);
    }
    expect(hasKey('dairy.counter.buffersOffline')).toBe(true);
    expect(hasKey('dairy.retry')).toBe(true);
  });

  it('refuses W2559–W2561 as a route: a retry of a READ is a page load, not an audited act', () => {
    expect(MUTATE_CHAIN_IS_RETRY).toBe(true);
    expect(retryChainKey()).toBe('dairy.retryIsReload');
    expect(hasKey(retryChainKey())).toBe(true);
  });

  it('has the board\'s own chrome in all three languages', () => {
    for (const k of ['dairy.counter.title', 'dairy.counter.lead', 'dairy.litres', 'dairy.centresWord',
      'dairy.centre.none', 'dairy.shift.label', 'dairy.tile.litres', 'dairy.tile.quality',
      'dairy.tile.qualityBasis', 'dairy.tile.accrued', 'dairy.tile.flags', 'dairy.col.centre',
      'dairy.col.litres', 'dairy.col.pourers', 'dairy.col.quality', 'dairy.col.bmc', 'dairy.col.analyzer',
      'dairy.col.value']) {
      expect(hasKey(k)).toBe(true);
    }
  });
});
