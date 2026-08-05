// PC-50 W10-6 · pure equipment-owner logic. Pins owner-legal actions against the rental state machine
// (CONFIRM is the renter's move — never offered to the owner) and the zod-mirror builders.
import { ownerActionsFor, buildAssetDraft, buildRateDraft } from '../../features/equipment/equipment';

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
