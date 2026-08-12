'use server';
// apps/web-admin/src/app/analytics/farmer-360/actions.ts · W109's one write (PC-56 ADMIN-SWEEP-b4).
//
// The export is audited WITH ITS REASON — the reason travels in the body and lands in the audit row server-side.
// The server enforces the grant CONJUNCTION (analytics.farmer360 to look, analytics.export to take a file away)
// and returns the receipt synchronously; the page prints the delivery truth rather than an invented ETA.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../lib/admin-client';
import { buildExport } from '../../../features/analytics/farmer360';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'exportGrant';
    if (e.status === 422) return 'reason';
    if (e.status === 503) return 'assembly';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

export async function exportProfileAction(formData: FormData): Promise<void> {
  requireAdmin();
  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) redirect('/analytics/farmer-360');
  const built = buildExport({ reason: String(formData.get('reason') ?? '') });
  if (!built.ok) redirect(`/analytics/farmer-360?u=${encodeURIComponent(userId)}&error=${built.error}`);
  let receiptId = '';
  try {
    const r = await adminPost<{ receipt: { id: string } }>(`analytics/farmer360/${encodeURIComponent(userId)}/export`, { body: built.value });
    receiptId = r.data.receipt.id;
  } catch (e) { redirect(`/analytics/farmer-360?u=${encodeURIComponent(userId)}&error=${errorKey(e)}`); }
  revalidatePath('/analytics/farmer-360');
  redirect(`/analytics/farmer-360?u=${encodeURIComponent(userId)}&ok=exported&receipt=${encodeURIComponent(receiptId)}`);
}
