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
