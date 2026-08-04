// apps/mobile/src/features/addresses/addresses.api.ts · the buyer's delivery address book (P-09). Thin data layer
// (guide §3) over the SDK addresses resource. Reads degrade-never-die ([] on failure). Create throws so the form
// can show validation errors. Contact name/phone are PII held server-side; we only show them back to the owner.
import type { Address } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';

export async function listAddresses(): Promise<Address[]> {
  try { return await apiClient().addresses.list(); } catch { return []; }
}

export function createAddress(input: { line1: string; line2?: string; village?: string; pincode?: string; contactName?: string; contactPhone?: string; isDefault?: boolean }): Promise<Address> {
  return apiClient().addresses.create(input);
}

export function updateAddress(id: string, patch: Partial<{ line1: string; line2: string; village: string; pincode: string; contactName: string; contactPhone: string; isDefault: boolean }>): Promise<Address> {
  return apiClient().addresses.update(id, patch); // throws so the edit form shows the outcome
}

/** Make an address the delivery default (screen 134 "Make primary"). The server flips the previous default off. */
export function setPrimaryAddress(id: string): Promise<Address> {
  return apiClient().addresses.update(id, { isDefault: true });
}

export function deleteAddress(id: string): Promise<{ ok: boolean }> {
  return apiClient().addresses.remove(id);
}
