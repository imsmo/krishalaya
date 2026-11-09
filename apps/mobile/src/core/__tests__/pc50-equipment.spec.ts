// PC-50 W10-6 · pure equipment-owner logic. Pins owner-legal actions against the rental state machine
// (CONFIRM is the renter's move — never offered to the owner) and the zod-mirror builders.
import { ownerActionsFor, buildAssetDraft, buildRateDraft, settleRefusalKey } from '../../features/equipment/equipment';
import en from '../i18n/locales/en.json';
import hi from '../i18n/locales/hi.json';
import gu from '../i18n/locales/gu.json';

describe('ownerActionsFor (reflect, never grant — Law 5)', () => {
  it('quote on requested; start (renter OTP) on confirmed; settle on completed; confirm never appears', () => {
    expect(ownerActionsFor('requested')).toEqual(['quote', 'cancel']);
    expect(ownerActionsFor('quoted')).toEqual(['cancel']);          // renter's confirm, not ours
    expect(ownerActionsFor('confirmed')).toEqual(['start', 'cancel']);
    expect(ownerActionsFor('in_progress')).toEqual(['complete']);
    expect(ownerActionsFor('completed')).toEqual(['settle']);
    expect(ownerActionsFor('settled')).toEqual([]);
    expect(ownerActionsFor('cancelled')).toEqual([]);
  });
});

describe('builders (zod mirrors)', () => {
  it('asset: category required, year 1950–2100, hp 1–2000, empty optionals omitted', () => {
    expect(buildAssetDraft({ categoryId: '', regNo: '', yearOfMfg: '', engineHours: '', hpRating: '', serviceRadiusKm: '' })).toEqual({ ok: false, error: 'category' });
    expect(buildAssetDraft({ categoryId: 'c1', regNo: '', yearOfMfg: '1949', engineHours: '', hpRating: '', serviceRadiusKm: '' })).toEqual({ ok: false, error: 'year' });
    expect(buildAssetDraft({ categoryId: 'c1', regNo: ' GJ-01-AB-1234 ', yearOfMfg: '2021', engineHours: '350.5', hpRating: '55', serviceRadiusKm: '' }))
      .toEqual({ ok: true, value: { categoryId: 'c1', regNo: 'GJ-01-AB-1234', yearOfMfg: 2021, engineHours: '350.5', hpRating: 55 } });
  });
  it('rate: real basis + float-free positive rupees→minor', () => {
    expect(buildRateDraft({ rateBasis: 'per_lightyear', rateRupees: '100', includesOperator: true, includesFuel: false })).toEqual({ ok: false, error: 'basis' });
    expect(buildRateDraft({ rateBasis: 'per_hour', rateRupees: '0', includesOperator: true, includesFuel: false })).toEqual({ ok: false, error: 'rate' });
    expect(buildRateDraft({ rateBasis: 'per_acre', rateRupees: '850.50', includesOperator: true, includesFuel: true }))
      .toEqual({ ok: true, value: { rateBasis: 'per_acre', rateMinor: '85050', includesOperator: true, includesFuel: true } });
  });
});

// PC-56 HOTFIX-13 (founder Q1-A): the owner's settle refused because the renter has not confirmed the hours is shown BY NAME, ×3.
describe('settleRefusalKey — SETTLE_HOURS_NOT_CONFIRMED by name', () => {
  it('maps the code to its own key; anything else → null (the generic message)', () => {
    expect(settleRefusalKey({ code: 'SETTLE_HOURS_NOT_CONFIRMED', status: 409 })).toBe('equip.detail.settleHoursNotConfirmed');
    expect(settleRefusalKey({ code: 'EQ_NOT_MACHINE_OWNER' })).toBeNull();
    expect(settleRefusalKey(new Error('x'))).toBeNull();
    expect(settleRefusalKey(undefined)).toBeNull();
  });
  it('the key exists in en, hi and gu; the English is the founder\'s sentence, after the fact the refusal proves', () => {
    const k = 'equip.detail.settleHoursNotConfirmed';
    for (const l of [en, hi, gu] as Record<string, string>[]) expect(typeof l[k] === 'string' && l[k].length > 0).toBe(true);
    expect((en as Record<string, string>)[k]).toBe("Not settled: the renter has not confirmed these hours in her own app. Nothing beyond the deposit leaves the renter's wallet until she confirms those hours in her own app.");
  });
});
