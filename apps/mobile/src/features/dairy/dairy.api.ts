// apps/mobile/src/features/dairy/dairy.api.ts · data layer for the dairy-farmer vertical (PC-50 W10-2).
// Screens stay thin (guide §3). The farmer's OWN memberships/collections/bills (server-scoped: memberships
// box=mine; collections owner-checked per membership — 404 on cross-owner, no IDOR; bills box=mine).
// Rate cards + MCC names are slow-changing reference data → SWR cache. Reads degrade-never-die.
// This persona has NO writes — milk is recorded at the MCC counter (web-ops POS), bills are settled by the
// operator; the farmer's app is the TRUST MIRROR of what the cooperative did.
import type { DairyMembership, DairyCollection, MilkBill, DairyRateCard, DairyMcc, MilkBillStatus } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { POLICY } from '../../core/offline/cache-policies';
import { newId } from '../../core/util/ids';   // PC-55 B6: the dairy layer's FIRST write (D2C subscribe) needs an idempotency key

const SCOPE = 'public';

export async function myMemberships(): Promise<DairyMembership[]> {
  try { return (await apiClient().dairy.listMemberships({ box: 'mine', limit: 50 })).items; } catch { return []; }
}
export async function mccNames(): Promise<Record<string, string>> {
  try {
    const { value } = await cache.read<DairyMcc[]>({ scope: SCOPE, ns: 'dairy.mccs', parts: ['all'], policy: POLICY.reference, fetcher: async () => (await apiClient().dairy.listMccs({ limit: 100 })).items });
    return Object.fromEntries(value.map((m) => [m.id, m.defaultName]));
  } catch { return {}; }
}
export async function myCollections(membershipId: string, from: string, to: string): Promise<DairyCollection[] | null> {
  try { return (await apiClient().dairy.listCollections({ membershipId, from, to, limit: 100 })).items; } catch { return null; }
}
export async function myBills(status?: MilkBillStatus): Promise<MilkBill[]> {
  try { return (await apiClient().dairy.listBills({ box: 'mine', status, limit: 100 })).items; } catch { return []; }
}
export async function getBill(id: string): Promise<MilkBill | null> {
  try { return await apiClient().dairy.getBill(id); } catch { return null; }
}
export async function activeRateCards(): Promise<DairyRateCard[]> {
  try {
    const { value } = await cache.read<DairyRateCard[]>({ scope: SCOPE, ns: 'dairy.ratecards', parts: ['active'], policy: POLICY.reference, fetcher: () => apiClient().dairy.listRateCards({ activeOnly: true }) });
    return value;
  } catch { return []; }
}

// --- PC-55 B6 · D2C milk subscriptions (PC-54 W54-5 + PC-55 A5). Plans are slow-changing seller catalogue data →
// cached like other reference reads. MY subscriptions and MY deliveries are the household's private working set →
// live, and degrade to [] rather than blocking the tab. Subscribe is Idempotency-Keyed (a double tap must not create
// two standing orders); pause/resume/cancel are state transitions the SERVER re-checks, so they simply THROW and the
// screen reports the exact outcome.
export async function d2cPlans(): Promise<Array<Record<string, unknown>>> {
  try {
    const { value } = await cache.read<Array<Record<string, unknown>>>({ scope: SCOPE, ns: 'dairy.d2c.plans', parts: ['all'], policy: POLICY.reference, fetcher: () => apiClient().dairy.d2cPlans() });
    return value;
  } catch { return []; }
}
export async function myD2cSubscriptions(): Promise<Array<Record<string, unknown>>> {
  try { return await apiClient().dairy.myD2cSubscriptions(); } catch { return []; }
}
export function subscribeD2c(input: { planId: string; addressId: string; startsOn: string }): Promise<{ id: string; status: string }> {
  return apiClient().dairy.subscribeD2c(input, newId());
}
export function pauseD2c(id: string, pausedUntil: string): Promise<{ id: string; status: string }> { return apiClient().dairy.pauseD2c(id, pausedUntil); }
export function resumeD2c(id: string): Promise<{ id: string; status: string }> { return apiClient().dairy.resumeD2c(id); }
export function cancelD2c(id: string): Promise<{ id: string; status: string }> { return apiClient().dairy.cancelD2c(id); }
/** The household's own recent drops — what the postpaid statement will be built from. */
export async function myD2cDeliveries(from: string, to: string): Promise<Array<Record<string, unknown>>> {
  try { return await apiClient().dairy.d2cDeliveries({ box: 'customer', from, to, limit: 200 }); } catch { return []; }
}
/** Delivery addresses to choose from (the household must have one before a standing order can be delivered). */
export async function myAddresses(): Promise<Array<{ id: string; line1?: string; village?: string; pincode?: string }>> {
  try { return await apiClient().addresses.list() as unknown as Array<{ id: string; line1?: string; village?: string; pincode?: string }>; } catch { return []; }
}
