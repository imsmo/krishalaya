// apps/mobile/src/features/store-owner/store.api.ts · data layer for the store-owner vertical (PC-50 W10-4).
// Batches are the store's OWN stock ledger (product.manage-gated server-side); the product picker searches
// the real catalogue. Goods-inward is Idempotency-Keyed (Law 3); MRP leaves here only as the minor string
// the pure builder produced (Law 2). Reads degrade-never-die. Orders + inventory reuse the existing
// features/orders and features/listings layers — one data path per domain, never a second copy.
import type { ProductBatch, ProductCard } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export async function myBatches(includeExpired: boolean): Promise<ProductBatch[] | null> {
  try { return await apiClient().catalogue.listBatches({ includeExpired, limit: 100 }); } catch { return null; }
}
export function receiveBatch(input: Record<string, unknown>): Promise<{ id: string }> {
  return apiClient().catalogue.createBatch(input as never, newId());
}
export function recallBatch(id: string, reason: string): Promise<{ ok: boolean }> {
  return apiClient().catalogue.recallBatch(id, reason);
}
export async function searchProducts(q: string): Promise<ProductCard[]> {
  try { return (await apiClient().catalogue.browseProducts({ q: q || undefined, limit: 20 })).items; } catch { return []; }
}
export async function businessKyc() {
  try { return await apiClient().kyc.businessStatus(); } catch { return null; }
}

// --- PC-55 B6 · EXPIRING DOCUMENTS (PC-54 W54-14 `store-licence-reminders`). A self-read of the caller's own KYC
// documents nearing expiry. This is what replaced the old "reminders are coming" note: the dates are REAL rows with
// real validUntil values, so the countdown is arithmetic on the server's data rather than a fabricated one.
export async function expiringDocuments(days = 90): Promise<Array<{ id: string; status: string; docTypeId?: string; validUntil?: string | null; docNoMasked?: string | null }>> {
  try { return await apiClient().kyc.expiringDocuments(days) as unknown as Array<{ id: string; status: string; docTypeId?: string; validUntil?: string | null; docNoMasked?: string | null }>; }
  catch { return []; }
}
