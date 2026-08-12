'use server';
// apps/web-tenant/src/app/listings/qc/actions.ts · W127's two decisions (PC-56 TENANT-2a).
//
// Approve publishes immediately; reject requires a teaching reason from the closed vocabulary. The server is
// the law on both (permission `listing.approve`, reviewer ≠ seller/creator, status precondition) — these
// actions just carry the decision and translate the refusal into the page's own words.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';

function errorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.code === 'QC_OWN_LISTING' || e.code === 'QC_OWN_DRAFT') return 'selfreview';
    if (e.code === 'QC_UNKNOWN_REJECT_REASON' || e.code === 'QC_REJECT_REASON') return 'reason';
    if (e.code === 'LISTING_ILLEGAL_TRANSITION') return 'raced';   // somebody decided first — the queue moved on
    if (e.status === 403) return 'grant';
  }
  return 'failed';
}

export async function qcApproveAction(formData: FormData): Promise<void> {
  await requireSession('/listings/qc');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/listings/qc');
  try { await tenantClient().listings.qcApprove(id); }
  catch (e) { redirect(`/listings/qc/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath('/listings/qc'); revalidatePath('/listings');
  redirect('/listings/qc?ok=approved');
}

export async function qcRejectAction(formData: FormData): Promise<void> {
  await requireSession('/listings/qc');
  const id = String(formData.get('id') ?? '').trim();
  const reasonCode = String(formData.get('reasonCode') ?? '').trim();
  if (!id) redirect('/listings/qc');
  if (!reasonCode) redirect(`/listings/qc/${encodeURIComponent(id)}?error=reason`);
  try { await tenantClient().listings.qcReject(id, reasonCode); }
  catch (e) { redirect(`/listings/qc/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath('/listings/qc'); revalidatePath('/listings');
  redirect('/listings/qc?ok=rejected');
}
