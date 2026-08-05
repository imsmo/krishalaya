// PC-50 W10-3 · pure vet-professional logic. Pins the VET-side legal actions against
// domain/vet-booking.state.ts (completed is the FARMER's confirm — never offered to the vet),
// the float-free rupees→minor conversion, and the zod-mirror builders.
import { vetActionsFor, rupeesToMinor, buildVetRegistration, buildVetService } from '../../features/vet/vet';

describe('vet-side legal actions (reflect, never grant — Law 5)', () => {
  it('mirrors the state machine and never offers the farmer-owned complete', () => {
    expect(vetActionsFor('requested')).toEqual(['accept']);
    expect(vetActionsFor('accepted')).toEqual(['en_route', 'in_consult', 'no_show']);
    expect(vetActionsFor('en_route')).toEqual(['in_consult', 'no_show']);
    expect(vetActionsFor('in_consult')).toEqual(['prescribed']);
    expect(vetActionsFor('prescribed')).toEqual([]); // awaiting the farmer's confirm-and-pay
    expect(vetActionsFor('completed')).toEqual([]);
    expect(vetActionsFor('cancelled')).toEqual([]);
  });
});

describe('rupeesToMinor (Law 2 — no floats, ever)', () => {
  it('converts by string math and rejects zero/garbage', () => {
    expect(rupeesToMinor('125')).toBe('12500');
    expect(rupeesToMinor('125.5')).toBe('12550');
    expect(rupeesToMinor('0.01')).toBe('1');
    expect(rupeesToMinor('0')).toBeUndefined();
    expect(rupeesToMinor('12.345')).toBeUndefined();
    expect(rupeesToMinor('abc')).toBeUndefined();
  });
});

describe('builders (zod mirrors)', () => {
  it('registration: regno 2–60, radius 1–500 int or omitted; service: vocabulary code + positive price', () => {
    expect(buildVetRegistration({ registrationNo: 'G', isAiTechnician: false, serviceRadiusKm: '' })).toEqual({ ok: false, error: 'regno' });
    expect(buildVetRegistration({ registrationNo: 'GUJ-1234', isAiTechnician: true, serviceRadiusKm: '501' })).toEqual({ ok: false, error: 'radius' });
    expect(buildVetRegistration({ registrationNo: ' GUJ-1234 ', isAiTechnician: false, serviceRadiusKm: '25' }))
      .toEqual({ ok: true, value: { registrationNo: 'GUJ-1234', serviceRadiusKm: 25 } });
    expect(buildVetService({ serviceTypeCode: '', priceRupees: '100', pricingUnit: 'per_visit', isEmergencyAvailable: false })).toEqual({ ok: false, error: 'service' });
    expect(buildVetService({ serviceTypeCode: 'consult', priceRupees: '150.50', pricingUnit: 'bogus', isEmergencyAvailable: true }))
      .toEqual({ ok: true, value: { serviceTypeCode: 'consult', priceMinor: '15050', pricingUnit: 'per_visit', isEmergencyAvailable: true } });
  });
});
