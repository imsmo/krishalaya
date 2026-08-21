// apps/web-tenant/src/test/tenant6d2-centres.spec.ts · W171's board, as the screen decides what to say — TENANT-6d-2.
//
// The view-model is pure, so these are the sentences themselves: which one leads, which tone it carries, and — the two
// that matter most — when the screen must print NOTHING rather than something plausible.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CENTRES_HREF, centresHref, centresState, centresStateKey, custodyIsNamed, custodyKey, custodyTone,
  hoursHistoryGapKey, hoursKey, hoursText, moveDisabledKey, moveHeadingKey, movePickerGapKey, preferenceLabelKey,
  preferenceStateKey, preferenceTone, reconciliationKey, reconciliationTone, reliefOperatorGapKey, shareText,
  statusKey, tankKey, tankTempIsCurrent, tankTone,
} from '../features/dairy/centres';
import { DAIRY_NAV, currentDairyNavKey, dairyUnbuiltCount } from '../features/dairy/nav';
import type { DairyCentreRow } from '@krishalaya/sdk-js';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));

const custody = (o: Partial<DairyCentreRow['custody']> = {}): DairyCentreRow['custody'] => ({
  state: 'held', operatorUserId: 'u1', operatorName: 'Bhavna Ben K.', operatorPhoneMasked: '+9198****4334',
  since: '2026-03-14T05:00:00.000Z', days: 160, columnUserId: 'u1', ...o,
});
const tank = (o: Partial<DairyCentreRow['tank']> = {}): DairyCentreRow['tank'] => ({
  condition: 'in_range', unitId: 'b1', tempC: '3.8', bandMaxC: '4.5', ageMinutes: 2, ...o,
});

/* =========================================================================================================== */
describe('TENANT-6d-2 · W171 the centres board', () => {
  it('maps a flagged-off screen to a NOTICE and a forbidden one to the permission it needs', () => {
    expect(centresState(null)).toBe('ok');
    // The flag guard answers 404 by design: a disabled feature is invisible, never "exists but forbidden".
    expect(centresState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(centresState('FORBIDDEN', 403)).toBe('restricted');
    expect(centresState('generic', 500)).toBe('error');
    for (const s of ['ok', 'flaggedOff', 'restricted', 'error'] as const) expect(hasKey(centresStateKey(s))).toBe(true);
    // W171's restricted copy explains WHY assignment is gated, not just that it is.
    expect(hasKey('dairy.centres.state.custodyReason')).toBe(true);
    expect(hasKey('dairy.centres.offlineFirst')).toBe(true);
  });

  it('keeps the wider view in the URL so a shortfall is bookmarkable and Back works', () => {
    expect(centresHref()).toBe(CENTRES_HREF);
    expect(centresHref({ includeInactive: true })).toBe('/dairy/centres?includeInactive=1');
  });

  it('builds the sub-nav entry that has said "not built" since TENANT-6a', () => {
    const item = DAIRY_NAV.find((i) => i.key === 'centres')!;
    expect(item).toMatchObject({ href: '/dairy/centres', built: true });
    expect(currentDairyNavKey('/dairy/centres')).toBe('centres');
    // …and it must not light up the collections tab as well.
    expect(currentDairyNavKey('/dairy')).toBe('collections');
    expect(dairyUnbuiltCount()).toBe(1);      // insights only — TENANT-6e
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-2 · custody, and the two states where the screen prints no name', () => {
  it('names the holder, calmly, when the record and the centre agree', () => {
    const c = custody();
    expect(custodyKey(c)).toBe('dairy.centres.custody.held');
    expect(custodyTone(c)).toBe('ok');
    expect(custodyIsNamed(c)).toBe(true);
  });

  it('treats an unheld centre as AMBER, not red — it is a decision, not a fault', () => {
    const c = custody({ state: 'nobody', operatorUserId: null, operatorName: null, operatorPhoneMasked: null, since: null, days: null, columnUserId: null });
    expect(custodyTone(c)).toBe('warn');
    expect(custodyIsNamed(c)).toBe(false);
  });

  it('prints NO NAME for an operator the platform cannot verify, or a contradiction', () => {
    // `mcc_centres.operator_user_id` references the platform-wide `users` table, so before 0163 it could hold another
    // cooperative's member — and this board is what would print their name and phone.
    for (const state of ['unrecorded', 'disagrees'] as const) {
      const c = custody({ state });
      expect(custodyTone(c)).toBe('bad');
      expect(custodyIsNamed(c)).toBe(false);
      expect(hasKey(custodyKey(c))).toBe(true);
    }
    // …and even a `held` row with no name resolved shows none.
    expect(custodyIsNamed(custody({ operatorName: null }))).toBe(false);
    expect(hasKey('dairy.centres.custody.noName')).toBe(true);
  });

  it('has copy for every custody state, in three languages', () => {
    for (const state of ['held', 'nobody', 'unrecorded', 'disagrees'] as const) {
      expect(hasKey(`dairy.centres.custody.${state}`)).toBe(true);
    }
    for (const k of ['since', 'days']) expect(hasKey(`dairy.centres.custody.${k}`)).toBe(true);
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-2 · the hours', () => {
  it('prints a window with an en dash, and nothing at all when there is none', () => {
    expect(hoursText({ opens: '06:00', closes: '09:00' })).toBe('06:00–09:00');
    expect(hoursText(null)).toBeNull();
  });

  it('leads with which windows exist — including "neither", which is TENANT-6a\'s honest answer', () => {
    expect(hoursKey({ morning: null, evening: null })).toBe('dairy.centres.hours.none');
    expect(hoursKey({ morning: { opens: '06:00', closes: '09:00' }, evening: null })).toBe('dairy.centres.hours.morningOnly');
    expect(hoursKey({ morning: null, evening: { opens: '17:00', closes: '20:00' } })).toBe('dairy.centres.hours.eveningOnly');
    expect(hoursKey({ morning: { opens: '06:00', closes: '09:00' }, evening: { opens: '17:00', closes: '20:00' } })).toBe('dairy.centres.hours.both');
    for (const k of ['none', 'both', 'morningOnly', 'eveningOnly']) expect(hasKey(`dairy.centres.hours.${k}`)).toBe(true);
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-2 · the status column, *"active · BMC warm"*', () => {
  it('says whether the centre is taking milk at all', () => {
    expect(statusKey({ isActive: true })).toBe('dairy.centres.status.active');
    expect(statusKey({ isActive: false })).toBe('dairy.centres.status.inactive');
    expect(hasKey('dairy.centres.status.active')).toBe(true);
    expect(hasKey('dairy.centres.status.inactive')).toBe(true);
  });

  it('NEVER presents a stale reading as the tank\'s present temperature', () => {
    const stale = tank({ condition: 'stale', ageMinutes: 40 });
    expect(tankTone(stale)).toBe('warn');
    // The number is forty minutes old. Printing it as "now" is the one thing that would get a tank of milk thrown
    // away — so the screen shows the gap and its age instead.
    expect(tankTempIsCurrent(stale)).toBe(false);
    expect(tankTempIsCurrent(tank({ condition: 'above_band' }))).toBe(true);
    expect(tankTempIsCurrent(tank({ condition: 'never', tempC: null }))).toBe(false);
  });

  it('greys a centre with no cooler and reddens a real breach', () => {
    expect(tankTone(tank({ condition: 'no_unit', unitId: null, tempC: null }))).toBe('muted');
    expect(tankTone(tank({ condition: 'never', tempC: null }))).toBe('muted');
    expect(tankTone(tank({ condition: 'above_band' }))).toBe('bad');
    expect(tankTone(tank({ condition: 'below_min' }))).toBe('bad');
    expect(tankTone(tank())).toBe('ok');
  });

  it('has copy for every tank condition, in three languages', () => {
    for (const c of ['no_unit', 'never', 'stale', 'in_range', 'above_band', 'below_min'] as const) {
      expect(hasKey(tankKey(tank({ condition: c })))).toBe(true);
    }
    expect(hasKey('dairy.centres.tank.minutesAgo')).toBe(true);
    expect(hasKey('dairy.centres.tank.open')).toBe(true);
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-2 · the footer\'s tick', () => {
  it('ticks when the counts add up and names the shortfall when they do not', () => {
    const ok = { centres: 3, shown: 312, total: 312, reconciles: true, unaccounted: 0 };
    expect(reconciliationKey(ok)).toBe('dairy.centres.footer.reconciles');
    expect(reconciliationTone(ok)).toBe('ok');
    const bad = { centres: 3, shown: 300, total: 312, reconciles: false, unaccounted: 12 };
    expect(reconciliationKey(bad)).toBe('dairy.centres.footer.unaccounted');
    expect(reconciliationTone(bad)).toBe('warn');
    for (const k of ['reconciles', 'unaccounted', 'unroutedCount', 'showInactive', 'custodyGaps', 'hoursUnrecorded']) {
      expect(hasKey(`dairy.centres.footer.${k}`)).toBe(true);
    }
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-2 · the preference mix', () => {
  const row = (o: Partial<Parameters<typeof preferenceStateKey>[0]> = {}) => ({
    paymentCycle: 'weekly', members: 214, shareBp: 6859, state: 'honoured' as const, window: null, ...o,
  });

  it('prints a share to one decimal, by string — never through a float', () => {
    expect(shareText(6859)).toBe('68.5');
    expect(shareText(10000)).toBe('100.0');
    expect(shareText(5)).toBe('0.0');
    expect(shareText(null)).toBeNull();
  });

  it('says CYCLE OPEN or NO CYCLE YET, and never "honoured" over a cadence nothing serves', () => {
    expect(preferenceStateKey(row())).toBe('dairy.centres.pref.honoured');
    expect(preferenceTone(row())).toBe('ok');
    expect(preferenceStateKey(row({ state: 'pending' }))).toBe('dairy.centres.pref.pending');
    expect(preferenceTone(row({ state: 'pending' }))).toBe('warn');
    for (const k of ['heading', 'honoured', 'pending', 'pays', 'pendingWarn']) expect(hasKey(`dairy.centres.pref.${k}`)).toBe(true);
  });

  it('labels each cadence from the vocabulary the rest of the dairy already uses', () => {
    for (const c of ['daily', 'weekly', 'fortnightly', 'monthly']) {
      expect(hasKey(preferenceLabelKey(row({ paymentCycle: c })))).toBe(true);
    }
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-2 · what the board says it cannot do', () => {
  // [UPDATED BY PC-56 TENANT-6d-3] The transfer left this list when it was BUILT — together with the three reads it
  // would otherwise have broken. What remains named are the two gaps this board still has.
  it('still names the gaps it has, and no longer names the transfer as one', () => {
    expect(hasKey(hoursHistoryGapKey())).toBe(true);
    expect(hasKey(reliefOperatorGapKey())).toBe(true);
    expect(hasKey('dairy.centres.gap.heading')).toBe(true);
    // The move's own copy, including the off-for-this-tenant case: a form that answered 404 would be worse than a
    // sentence saying it is not switched on.
    expect(hasKey(moveHeadingKey())).toBe(true);
    expect(hasKey(moveDisabledKey())).toBe(true);
    expect(hasKey(movePickerGapKey())).toBe(true);
  });

  it('has copy for every act, every add-form field and every outcome', () => {
    for (const k of ['heading', 'operatorUserId', 'reason', 'assign', 'release', 'shift', 'opens', 'closes', 'setHours', 'clearHint']) {
      expect(hasKey(`dairy.centres.acts.${k}`)).toBe(true);
    }
    // TENANT-6d-4 replaced this board's inline create with W2555-W2558's chain, so the add-form's own field copy is
    // GONE rather than unused: `heading` and `submit` are all the board still says, and the fields are `form.centre.*`.
    for (const k of ['heading', 'submit']) expect(hasKey(`dairy.centres.add.${k}`)).toBe(true);
    for (const k of ['code', 'name', 'capacity', 'operator', 'operatorOptional']) {
      expect(hasKey(`dairy.centres.add.${k}`)).toBe(false);
    }
    // Every `?ok=` the actions can redirect with must have copy, or a successful handover shows a raw key.
    for (const k of ['assigned', 'released', 'hours', 'hoursCleared']) expect(hasKey(`dairy.centres.ok.${k}`)).toBe(true);
    expect(hasKey('dairy.centres.error.act')).toBe(true);
    for (const k of ['title', 'lead']) expect(hasKey(`dairy.centres.${k}`)).toBe(true);
    for (const k of ['centres', 'memberships', 'tanksWarm', 'asOf', 'memberCodeNote']) expect(hasKey(`dairy.centres.header.${k}`)).toBe(true);
    for (const k of ['members', 'perShift', 'capacityUnknown', 'analyzerUnknown', 'serial']) expect(hasKey(`dairy.centres.row.${k}`)).toBe(true);
    for (const k of ['none', 'hint']) expect(hasKey(`dairy.centres.empty.${k}`)).toBe(true);
  });
});
