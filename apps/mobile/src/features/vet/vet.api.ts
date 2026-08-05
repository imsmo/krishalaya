// apps/mobile/src/features/vet/vet.api.ts · data layer for the vet-professional vertical (PC-50 W10-3).
// My practice (profile + services) is a live private read; the vet_service vocabulary is seeded reference
// data → cached. Bookings box=vet. Writes THROW (screens show the outcome); registration is Idempotency-
// Keyed. Money: prices leave here ONLY as minor strings the pure builder produced; booking fees are
// server-snapshotted (the vet is PAID via the farmer's confirm — earnings are read, never computed).
import type { VetProfile, VetService, VetBooking, LookupValue } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { POLICY } from '../../core/offline/cache-policies';
import { newId } from '../../core/util/ids';

export async function myPractice(): Promise<{ vet: VetProfile | null; services: VetService[] } | null> {
  try { return await apiClient().livestock.myVetProfile(); } catch { return null; }
}
export function registerPractice(input: { registrationNo: string; isAiTechnician?: boolean; serviceRadiusKm?: number }): Promise<VetProfile> {
  return apiClient().livestock.registerVet(input, newId());
}
export function upsertService(input: { serviceTypeCode: string; priceMinor: string; pricingUnit?: string; isEmergencyAvailable?: boolean }): Promise<VetService> {
  return apiClient().livestock.upsertVetService(input);
}
export async function serviceTypes(): Promise<LookupValue[]> {
  try {
    const { value } = await cache.read<LookupValue[]>({ scope: 'public', ns: 'lookups.vet_service', parts: ['all'], policy: POLICY.reference, fetcher: () => apiClient().lookups.values('vet_service') });
    return value;
  } catch { return []; }
}
export async function myVetBookings(status?: string): Promise<VetBooking[]> {
  try { return (await apiClient().livestock.vetBookings({ box: 'vet', status, limit: 100 })).items; } catch { return []; }
}
export async function getVetBooking(id: string): Promise<VetBooking | null> {
  try { return await apiClient().livestock.vetBooking(id); } catch { return null; }
}
export function progressBooking(id: string, action: 'accept' | 'en_route' | 'in_consult' | 'prescribed' | 'no_show'): Promise<VetBooking> {
  return apiClient().livestock.progressVetBooking(id, action);
}
