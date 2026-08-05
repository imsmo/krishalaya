// apps/mobile/src/features/vet/vet.ts · PURE vet-professional logic (PC-50 W10-3). The VET-side of the
// booking state machine (domain/vet-booking.state.ts): which progress actions are legal from each status
// (reflect, never grant — Law 5), plus zod-mirror builders for self-registration and service pricing.
// Prices are typed in RUPEES and converted to bigint minor STRINGS here (Law 2) — never floats.
export const VET_ACTIONS = ['accept', 'en_route', 'in_consult', 'prescribed', 'no_show'] as const;
export type VetAction = (typeof VET_ACTIONS)[number];
export const PRICING_UNITS = ['per_visit', 'per_dose', 'per_animal', 'per_minute'] as const;

/** requested→[accept]; accepted→[en_route,in_consult,no_show]; en_route→[in_consult,no_show];
 *  in_consult→[prescribed]. `completed` is the FARMER's confirm-and-pay — never a vet action. */
export function vetActionsFor(status: string | undefined | null): VetAction[] {
  switch (status) {
    case 'requested': return ['accept'];
    case 'accepted': return ['en_route', 'in_consult', 'no_show'];
    case 'en_route': return ['in_consult', 'no_show'];
    case 'in_consult': return ['prescribed'];
    default: return []; // prescribed (awaiting farmer confirm) + terminal states
  }
}

/** "125" or "125.50" rupees → minor-unit string ("12550"). Digits only — no floats ever. */
export function rupeesToMinor(raw: string): string | undefined {
  const v = raw.trim();
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(v)) return undefined;
  const [whole, frac = ''] = v.split('.');
  const minor = whole + (frac + '00').slice(0, 2);
  const norm = minor.replace(/^0+(?=\d)/, '');
  return norm === '0' ? undefined : norm;
}

export type VetRegResult =
  | { ok: true; value: { registrationNo: string; isAiTechnician?: boolean; serviceRadiusKm?: number } }
  | { ok: false; error: 'regno' | 'radius' };

/** Mirrors RegisterVetSchema.strict(): registrationNo 2–60; radius 1–500 int or omitted. */
export function buildVetRegistration(raw: { registrationNo: string; isAiTechnician: boolean; serviceRadiusKm: string }): VetRegResult {
  const registrationNo = raw.registrationNo.trim();
  if (registrationNo.length < 2 || registrationNo.length > 60) return { ok: false, error: 'regno' };
  const out: { registrationNo: string; isAiTechnician?: boolean; serviceRadiusKm?: number } = { registrationNo };
  if (raw.isAiTechnician) out.isAiTechnician = true;
  const radius = raw.serviceRadiusKm.trim();
  if (radius) {
    if (!/^\d+$/.test(radius) || Number(radius) < 1 || Number(radius) > 500) return { ok: false, error: 'radius' };
    out.serviceRadiusKm = Number(radius);
  }
  return { ok: true, value: out };
}

export type VetServiceResult =
  | { ok: true; value: { serviceTypeCode: string; priceMinor: string; pricingUnit: string; isEmergencyAvailable?: boolean } }
  | { ok: false; error: 'service' | 'price' };

/** Mirrors UpsertVetServiceSchema.strict(): a real vocabulary code + a float-free positive price. */
export function buildVetService(raw: { serviceTypeCode: string; priceRupees: string; pricingUnit: string; isEmergencyAvailable: boolean }): VetServiceResult {
  if (!raw.serviceTypeCode) return { ok: false, error: 'service' };
  const priceMinor = rupeesToMinor(raw.priceRupees);
  if (!priceMinor) return { ok: false, error: 'price' };
  const out: { serviceTypeCode: string; priceMinor: string; pricingUnit: string; isEmergencyAvailable?: boolean } = {
    serviceTypeCode: raw.serviceTypeCode, priceMinor,
    pricingUnit: (PRICING_UNITS as readonly string[]).includes(raw.pricingUnit) ? raw.pricingUnit : 'per_visit',
  };
  if (raw.isEmergencyAvailable) out.isEmergencyAvailable = true;
  return { ok: true, value: out };
}
