'use server';
// apps/web-ops/src/app/warehouse/assay/actions.ts · PC-56 OPS-2b · W372 — THE ASSAY RECORD ACT (moved from app/warehouse/actions.ts), REAL over the
// EXISTING `POST /v1/warehousing/storage-bookings/:id/assays` — now the warehouse's NAMED operator's only (403 WAREHOUSE_OPERATOR_ONLY), on a stored
// booking only (409 BOOKING_NOT_STORED), and audited server-side (one row). What it records is "the warehouse's own entry — not a lab certificate,
// and it sets no price" (founder Q13-A). The outcome is the assay chain as a query state of /warehouse/assay: `?act=success` after a 201;
// `?act=failure&reason=<code>` with the SERVER's named reason or the console's own pre-check (`buildAssay`). The booking is an id only.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { opsClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildAssay } from '../../../features/warehouse/manage';
import { ASSAY_PAGE, assayFailureReason, assayHref, parseId } from '../../../features/ops2/receipts';

export async function recordAssayAction(formData: FormData): Promise<void> {
  await requireSession(ASSAY_PAGE);
  const bookingId = parseId(String(formData.get('booking') ?? ''));
  if (!bookingId) redirect(ASSAY_PAGE);
  const failure = (reason: string): never => redirect(assayHref(bookingId, { act: 'failure', reason }));
  const built = buildAssay({
    assayerName: String(formData.get('assayerName') ?? ''),
    paramsText: String(formData.get('paramsText') ?? ''),
    validUntil: String(formData.get('validUntil') ?? ''),
  });
  if (!built.ok) return failure(built.error);
  try { await opsClient().warehousing.recordAssay(bookingId, built.value); }
  catch (e) { failure(e instanceof SdkError ? assayFailureReason(e.status, e.code) : 'record'); }
  revalidatePath(ASSAY_PAGE);
  redirect(assayHref(bookingId, { act: 'success' }));
}
