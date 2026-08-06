// apps/mobile/src/features/livestock/livestock.api.ts · data layer for the Pashupalak vertical (PC-50 W10-1).
// Screens stay thin (guide §3). Species/breeds/vet-directory are slow-changing reference data → SWR cache
// (usable offline). The herd + bookings are the user's PRIVATE working set → fetched live, degrade-never-die
// (reads return []/null on failure). Writes THROW so screens show the precise outcome, and every money-adjacent
// write is idempotent (Law 3: register animal, book vet, complete+pay). Fees are bigint minor STRINGS the
// SERVER computed (Law 2/11 — the app never prices a visit).
import type { Animal, AnimalSpecies, AnimalBreed, VetProfile, VetService, VetBooking } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { POLICY } from '../../core/offline/cache-policies';
import { newId } from '../../core/util/ids';

const SCOPE = 'public';

export async function listSpecies(): Promise<AnimalSpecies[]> {
  try {
    const { value } = await cache.read<AnimalSpecies[]>({ scope: SCOPE, ns: 'livestock.species', parts: ['all'], policy: POLICY.reference, fetcher: () => apiClient().livestock.species() });
    return value;
  } catch { return []; }
}
export async function listBreeds(speciesId: string): Promise<AnimalBreed[]> {
  try {
    const { value } = await cache.read<AnimalBreed[]>({ scope: SCOPE, ns: 'livestock.breeds', parts: [speciesId], policy: POLICY.reference, fetcher: () => apiClient().livestock.breeds(speciesId) });
    return value;
  } catch { return []; }
}

// --- my herd (private, live) ---
export async function myAnimals(status?: string): Promise<Animal[]> {
  try { return (await apiClient().livestock.animals({ box: 'mine', status, limit: 100 })).items; } catch { return []; }
}
export async function getAnimal(id: string): Promise<Animal | null> {
  try { return await apiClient().livestock.animal(id); } catch { return null; }
}
export function registerAnimal(input: Record<string, unknown>): Promise<Animal> {
  return apiClient().livestock.registerAnimal(input as never, newId());
}
export function retireAnimal(id: string, reason: 'sold' | 'deceased' | 'lost'): Promise<Animal> {
  return apiClient().livestock.retireAnimal(id, reason);
}

// --- vets + bookings ---
export async function listVets(): Promise<VetProfile[]> {
  try {
    const { value } = await cache.read<VetProfile[]>({ scope: SCOPE, ns: 'livestock.vets', parts: ['all'], policy: POLICY.reference, fetcher: async () => (await apiClient().livestock.vets({ limit: 100 })).items });
    return value;
  } catch { return []; }
}
export async function getVet(id: string): Promise<{ vet: VetProfile | null; services: VetService[] }> {
  try { return await apiClient().livestock.vet(id); } catch { return { vet: null, services: [] }; }
}
export function bookVet(input: Record<string, unknown>): Promise<VetBooking> {
  return apiClient().livestock.bookVet(input as never, newId());
}
export async function myBookings(status?: string): Promise<VetBooking[]> {
  try { return (await apiClient().livestock.vetBookings({ box: 'farmer', status, limit: 100 })).items; } catch { return []; }
}
export async function getBooking(id: string): Promise<VetBooking | null> {
  try { return await apiClient().livestock.vetBooking(id); } catch { return null; }
}
export function cancelBooking(id: string): Promise<VetBooking> { return apiClient().livestock.cancelVetBooking(id); }
/** Confirms the visit happened and settles the fee — idempotent (Law 3). */
export function completeBooking(id: string): Promise<VetBooking> { return apiClient().livestock.completeVetBooking(id, newId()); }

// --- PC-55 B5 · the lifetime HEALTH FILE (PC-54 W54-4). Reads degrade to [] like every other private read; the
// write THROWS so the screen can name the exact refusal. Deliberately NOT cached: a health file drives "what is
// due next", and a stale answer here is worse than a spinner — a farmer could skip a vaccination believing it was
// still weeks away.
export async function listHealthEvents(animalId: string): Promise<Array<Record<string, unknown>>> {
  try { return await apiClient().livestock.healthEvents(animalId); } catch { return []; }
}
export function recordHealthEvent(animalId: string, input: { eventTypeCode: string; vetBookingId?: string; batchNo?: string; diagnosis?: string; outcome?: string; nextDueDate?: string }): Promise<{ id: string }> {
  return apiClient().livestock.recordHealthEvent(animalId, input);
}
/** Ear-tag (Pashu Aadhaar / INAPH) lookup — the whole tenant's registry, so it is the OPERATOR's read, not a
 *  farmer's: the API applies the caller's own scope, and box='all' simply asks for what they are allowed to see. */
export async function findAnimalsByEarTag(pashuAadhaar: string): Promise<Array<Record<string, unknown>>> {
  try { return (await apiClient().livestock.animals({ box: 'all', pashuAadhaar, limit: 20 })).items as unknown as Array<Record<string, unknown>>; }
  catch { return []; }
}
