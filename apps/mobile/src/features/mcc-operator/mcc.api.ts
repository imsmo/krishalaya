// apps/mobile/src/features/mcc-operator/mcc.api.ts · data layer for the MCC-counter vertical (PC-50 W10-7).
// The operator's centre is found from the REAL MCC registry (operatorUserId match — a display filter over
// reference data). Members box=mcc; slips are Idempotency-Keyed and SERVER-priced; the farmer ledger reads
// the same owner-or-manage collection/bill endpoints the farmer's own app reads (one truth, two viewers).
import type { DairyMcc, DairyMembership, DairyCollection, MilkBill } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { POLICY } from '../../core/offline/cache-policies';
import { newId } from '../../core/util/ids';

export async function myMcc(userId: string): Promise<DairyMcc | null> {
  try {
    const { value } = await cache.read<DairyMcc[]>({ scope: 'public', ns: 'dairy.mccs', parts: ['all'], policy: POLICY.reference, fetcher: async () => (await apiClient().dairy.listMccs({ limit: 100 })).items });
    return value.find((m) => m.operatorUserId === userId) ?? null;
  } catch { return null; }
}
export async function mccMembers(mccId: string): Promise<DairyMembership[]> {
  try { return (await apiClient().dairy.listMemberships({ box: 'mcc', mccId, limit: 100 })).items; } catch { return []; }
}
/** The counter slip — idempotent (Law 3); the SERVER prices it from the rate card (Law 2/11). */
export function recordSlip(input: Record<string, unknown>): Promise<DairyCollection> {
  return apiClient().dairy.recordCollection(input as never, newId());
}
export async function memberSlips(membershipId: string, from: string, to: string): Promise<DairyCollection[] | null> {
  try { return (await apiClient().dairy.listCollections({ membershipId, from, to, limit: 100 })).items; } catch { return null; }
}
export async function memberBills(membershipId: string): Promise<MilkBill[]> {
  try { return (await apiClient().dairy.listBills({ box: 'all', membershipId, limit: 50 })).items; } catch { return []; }
}
