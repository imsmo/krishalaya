// apps/mobile/src/features/equipment/equipment.api.ts · data layer for the equipment-owner vertical
// (PC-50 W10-6). MY fleet (box=mine) + MY incoming rentals (box=owner) — both server-scoped. Registration
// is Idempotency-Keyed; the settle step is the money leg (server-side, idempotent). Categories come from
// the real taxonomy. Reads degrade-never-die; writes THROW.
import type { EquipmentAsset, EquipmentRate, EquipmentRental, CategoryNode } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { POLICY } from '../../core/offline/cache-policies';
import { newId } from '../../core/util/ids';

export async function myFleet(): Promise<EquipmentAsset[]> {
  try { return (await apiClient().equipment.assets({ box: 'mine', limit: 100 })).items; } catch { return []; }
}
export function registerAsset(input: Record<string, unknown>): Promise<EquipmentAsset> {
  return apiClient().equipment.registerAsset(input as never, newId());
}
export function setAssetStatus(id: string, status: string): Promise<EquipmentAsset> {
  return apiClient().equipment.setAssetStatus(id, status);
}
export async function assetRates(assetId: string): Promise<EquipmentRate[]> {
  try { return await apiClient().equipment.rates(assetId); } catch { return []; }
}
export function setRate(assetId: string, input: { rateBasis: string; rateMinor: string; includesOperator?: boolean; includesFuel?: boolean }): Promise<EquipmentRate> {
  return apiClient().equipment.setRate(assetId, input);
}
export async function equipmentCategories(): Promise<CategoryNode[]> {
  try {
    const { value } = await cache.read<CategoryNode[]>({ scope: 'public', ns: 'equipment.categories', parts: ['all'], policy: POLICY.reference, fetcher: () => apiClient().lookups.categories({ rootCode: 'equipment', activeOnly: true }) });
    return value;
  } catch { return []; }
}
export async function ownerRentals(status?: string): Promise<EquipmentRental[]> {
  try { return (await apiClient().equipment.rentals({ box: 'owner', status, limit: 100 })).items; } catch { return []; }
}
export async function getRental(id: string): Promise<EquipmentRental | null> {
  try { return await apiClient().equipment.rental(id); } catch { return null; }
}
export function quoteRental(id: string, advanceMinor: string): Promise<EquipmentRental> { return apiClient().equipment.quoteRental(id, advanceMinor); }
export function startRental(id: string, otp: string): Promise<EquipmentRental> { return apiClient().equipment.startRental(id, otp); }
export function completeRental(id: string, actualQuantity: string): Promise<EquipmentRental> { return apiClient().equipment.completeRental(id, actualQuantity); }
/** The money leg — settles server-side, idempotent (Law 3). */
export function settleRental(id: string): Promise<EquipmentRental> { return apiClient().equipment.settleRental(id, newId()); }
export function cancelRental(id: string, reason?: string): Promise<EquipmentRental> { return apiClient().equipment.cancelRental(id, reason); }
