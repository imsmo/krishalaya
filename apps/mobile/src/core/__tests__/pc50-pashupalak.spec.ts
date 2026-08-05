// PC-50 W10-1 · pure Pashupalak logic. Pins the zod-mirror builders (strict-DTO omission of empty optionals,
// INAPH 12-digit, parity 0–30) and the farmer-visible vet-booking gates against domain/vet-booking.state.ts.
import { buildAnimalDraft, buildBookingDraft, canCancelBooking, canCompleteBooking, bookingTone } from '../../features/livestock/livestock';

describe('buildAnimalDraft (mirrors CreateAnimalSchema.strict())', () => {
  it('omits empty optionals — a .strict() server rejects empty strings', () => {
    const r = buildAnimalDraft({ speciesId: 's1', pashuAadhaar: '', name: '  ', parity: '', currentYieldLpd: '' });
    expect(r).toEqual({ ok: true, value: { speciesId: 's1' } });
  });
  it('validates the INAPH Pashu Aadhaar (12 digits), parity 0–30, yield decimal', () => {
    expect(buildAnimalDraft({ speciesId: 's1', pashuAadhaar: '12345678901' })).toEqual({ ok: false, error: 'aadhaar' });
    expect(buildAnimalDraft({ speciesId: 's1', parity: '31' })).toEqual({ ok: false, error: 'parity' });
    expect(buildAnimalDraft({ speciesId: 's1', currentYieldLpd: '12.345' })).toEqual({ ok: false, error: 'yield' });
    expect(buildAnimalDraft({ speciesId: '' })).toEqual({ ok: false, error: 'species' });
    const ok = buildAnimalDraft({ speciesId: 's1', pashuAadhaar: '123456789012', name: 'Gauri', sex: 'female', parity: '3', currentYieldLpd: '12.5' });
    expect(ok).toEqual({ ok: true, value: { speciesId: 's1', pashuAadhaar: '123456789012', name: 'Gauri', sex: 'female', parity: 3, currentYieldLpd: '12.5' } });
  });
});

describe('buildBookingDraft (mirrors BookVetSchema — fee NEVER client-side)', () => {
  it('requires vet + service; defaults urgency/mode; never carries a fee', () => {
    expect(buildBookingDraft({ vetId: '', serviceId: 's', urgency: 'routine', mode: 'visit' })).toEqual({ ok: false, error: 'vet' });
    const r = buildBookingDraft({ vetId: 'v1', serviceId: 'sv1', urgency: 'bogus', mode: 'bogus', symptomsText: ' limping ' });
    expect(r).toEqual({ ok: true, value: { vetId: 'v1', serviceId: 'sv1', urgency: 'routine', mode: 'visit', symptomsText: 'limping' } });
    if (r.ok) expect(r.value).not.toHaveProperty('feeMinor');
  });
});

describe('vet-booking farmer gates (reflect, never grant — Law 5)', () => {
  it('cancel only pre-service (requested|accepted); complete only after service (in_consult|prescribed)', () => {
    expect(canCancelBooking('requested')).toBe(true);
    expect(canCancelBooking('accepted')).toBe(true);
    expect(canCancelBooking('en_route')).toBe(false);
    expect(canCompleteBooking('in_consult')).toBe(true);
    expect(canCompleteBooking('prescribed')).toBe(true);
    expect(canCompleteBooking('completed')).toBe(false);
    expect(bookingTone('no_show')).toBe('danger');
  });
});
