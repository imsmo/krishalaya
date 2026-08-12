'use server';
// apps/web-admin/src/app/analytics/demand-map/actions.ts · W108's one write (PC-56 ADMIN-SWEEP-c3).
//
// The only write on this plane is the export receipt. The server enforces the grant CONJUNCTION (analytics.read
// to look, analytics.export to take the file away), applies the k-anonymity floor BEFORE the digest, and returns
// the receipt synchronously — the page prints the delivery truth and the suppressed-cell count, never an ETA.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../lib/admin-client';
import { buildExport } from '../../../features/analytics/demand-map';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'exportGrant';
    if (e.status === 422) return 'reason';
    if (e.status === 503) return 'assembly';
  }
  return 'generic';
}

export async function exportDemandAction(formData: FormData): Promise<void> {
  requireAdmin();
  const week = String(formData.get('week') ?? '').trim() || undefined;
  const back = week ? `?week=${encodeURIComponent(week)}&` : '?';
  const built = buildExport({ reason: String(formData.get('reason') ?? ''), week });
  if (!built.ok) redirect(`/analytics/demand-map${back}error=${built.error}`);
  let receiptId = ''; let suppressed = '0';
  try {
    const r = await adminPost<{ receipt: { id: string }; suppressed: { cells: number } }>('analytics/demand-map/export', { body: built.value });
    receiptId = r.data.receipt.id;
    suppressed = String(r.data.suppressed.cells);
  } catch (e) { redirect(`/analytics/demand-map${back}error=${errorKey(e)}`); }
  revalidatePath('/analytics/demand-map');
  redirect(`/analytics/demand-map${back}ok=exported&receipt=${encodeURIComponent(receiptId)}&suppressed=${suppressed}`);
}
