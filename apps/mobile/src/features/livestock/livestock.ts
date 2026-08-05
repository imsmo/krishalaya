// apps/mobile/src/features/livestock/livestock.ts · PURE Pashupalak-wave logic (PC-50 W10-1). Client-side
// mirrors of the server's zod DTOs (CreateAnimalSchema, BookVetSchema) and the vet-booking state machine
// (domain/vet-booking.state.ts) so screens only show LEGAL actions (Law 5: reflect, never grant). No IO.
export const SEXES = ['male', 'female'] as const;
export const LACTATION_STAGES = ['dry', 'early', 'mid', 'late'] as const;
export const PREGNANCY_STATUSES = ['open', 'pregnant', 'unknown'] as const;
export const RETIRE_REASONS = ['sold', 'deceased', 'lost'] as const;
export const URGENCIES = ['routine', 'urgent', 'emergency'] as const;
export const MODES = ['visit', 'tele'] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type AnimalDraftResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: 'species' | 'aadhaar' | 'name' | 'dob' | 'parity' | 'yield' };

/** Mirrors CreateAnimalSchema: speciesId required; pashuAadhaar is INAPH 12-digit or absent; empty optionals are OMITTED (zod .strict()). */
export function buildAnimalDraft(raw: {
  speciesId: string; breedId?: string; pashuAadhaar?: string; name?: string; sex?: string;
  dobEstimated?: string; parity?: string; lactationStage?: string; pregnancyStatus?: string; currentYieldLpd?: string;
}): AnimalDraftResult {
  if (!raw.speciesId) return { ok: false, error: 'species' };
  const out: Record<string, unknown> = { speciesId: raw.speciesId };
  if (raw.breedId) out.breedId = raw.breedId;
  const aadhaar = (raw.pashuAadhaar ?? '').trim();
  if (aadhaar) { if (!/^\d{12}$/.test(aadhaar)) return { ok: false, error: 'aadhaar' }; out.pashuAadhaar = aadhaar; }
  const name = (raw.name ?? '').trim();
  if (name) { if (name.length > 100) return { ok: false, error: 'name' }; out.name = name; }
  if (raw.sex && (SEXES as readonly string[]).includes(raw.sex)) out.sex = raw.sex;
  const dob = (raw.dobEstimated ?? '').trim();
  if (dob) { if (!DATE.test(dob)) return { ok: false, error: 'dob' }; out.dobEstimated = dob; }
  const parity = (raw.parity ?? '').trim();
  if (parity) {
    const n = Number(parity);
    if (!/^\d+$/.test(parity) || n < 0 || n > 30) return { ok: false, error: 'parity' };
    out.parity = n;
  }
  if (raw.lactationStage && (LACTATION_STAGES as readonly string[]).includes(raw.lactationStage)) out.lactationStage = raw.lactationStage;
  if (raw.pregnancyStatus && (PREGNANCY_STATUSES as readonly string[]).includes(raw.pregnancyStatus)) out.pregnancyStatus = raw.pregnancyStatus;
  const y = (raw.currentYieldLpd ?? '').trim();
  if (y) { if (!/^\d{1,4}(\.\d{1,2})?$/.test(y)) return { ok: false, error: 'yield' }; out.currentYieldLpd = y; }
  return { ok: true, value: out };
}

export type BookingDraftResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: 'vet' | 'service' | 'symptoms' };

/** Mirrors BookVetSchema. The FEE is never here — the server snapshots vet_services.price_minor (Law 11). */
export function buildBookingDraft(raw: { vetId: string; serviceId: string; animalId?: string; urgency: string; mode: string; symptomsText?: string }): BookingDraftResult {
  if (!raw.vetId) return { ok: false, error: 'vet' };
  if (!raw.serviceId) return { ok: false, error: 'service' };
  const out: Record<string, unknown> = {
    vetId: raw.vetId, serviceId: raw.serviceId,
    urgency: (URGENCIES as readonly string[]).includes(raw.urgency) ? raw.urgency : 'routine',
    mode: (MODES as readonly string[]).includes(raw.mode) ? raw.mode : 'visit',
  };
  if (raw.animalId) out.animalId = raw.animalId;
  const sym = (raw.symptomsText ?? '').trim();
  if (sym) { if (sym.length > 2000) return { ok: false, error: 'symptoms' }; out.symptomsText = sym; }
  return { ok: true, value: out };
}

// --- vet-booking state machine (farmer-visible gates; the server is the authority) ---
/** requested → accepted → en_route → in_consult → prescribed → completed | cancelled | no_show */
export function canCancelBooking(status: string | undefined | null): boolean { return status === 'requested' || status === 'accepted'; }
/** Service rendered → the farmer confirms completion, which settles the fee (idempotent, Law 3). */
export function canCompleteBooking(status: string | undefined | null): boolean { return status === 'in_consult' || status === 'prescribed'; }

export function bookingTone(status: string | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'no_show') return 'danger';
  if (status === 'requested') return 'neutral';
  return 'warning'; // accepted / en_route / in_consult / prescribed — in flight
}
export function animalTone(status: string | undefined): 'success' | 'danger' | 'neutral' {
  return status === 'active' ? 'success' : status ? 'danger' : 'neutral';
}
