'use server';
// apps/web-ops/src/app/warehouse/actions.ts · warehouse-wave mutations (PC-32 OW-2). All server-gated by
// warehousing.manage; release + eNWR issue are Idempotency-Keyed (Law 3 — a release or a receipt must never
// double-fire); 409s degrade to honest state messages (Law 12).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildNwr, buildAssay } from '../../features/warehouse/manage';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/warehouse/${encodeURIComponent(id)}?${qs}`); }

export async function bookingLifecycleAction(formData: FormData): Promise<void> {
  await requireSession('/warehouse');
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect('/warehouse');
  try {
    const w = opsClient().warehousing;
    if (kind === 'confirm') await w.confirmBooking(id);
    else if (kind === 'store') await w.storeBooking(id);
    else if (kind === 'release') await w.releaseBooking(id, randomUUID());
    else if (kind === 'cancel') await w.cancelBooking(id, String(formData.get('reason') ?? '').trim() || undefined);
    else back(id, 'error=action');
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath(`/warehouse/${id}`); revalidatePath('/warehouse');
  back(id, `ok=${kind}`);
}

export async function recordAssayAction(formData: FormData): Promise<void> {
  await requireSession('/warehouse');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/warehouse');
  const built = buildAssay({
    assayerName: String(formData.get('assayerName') ?? ''),
    paramsText: String(formData.get('paramsText') ?? ''),
    validUntil: String(formData.get('validUntil') ?? ''),
  });
  if (!built.ok) back(id, `error=as_${built.error}`);
  try { await opsClient().warehousing.recordAssay(id, built.value); }
  catch { back(id, 'error=assay'); }
  revalidatePath(`/warehouse/${id}`);
  back(id, 'ok=assay');
}

export async function issueNwrAction(formData: FormData): Promise<void> {
  await requireSession('/warehouse');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/warehouse');
  const built = buildNwr({
    storageBookingId: id,
    repository: String(formData.get('repository') ?? ''),
    enwrNo: String(formData.get('enwrNo') ?? ''),
    valuationMajor: String(formData.get('valuationMajor') ?? ''),
    expiresAt: String(formData.get('expiresAt') ?? ''),
  });
  if (!built.ok) back(id, `error=nwr_${built.error}`);
  try { await opsClient().warehousing.issueNwr(built.value, randomUUID()); }
  catch (e) { back(id, `error=${e instanceof SdkError && e.status === 409 ? 'nwr_dup' : 'nwr'}`); }
  revalidatePath(`/warehouse/${id}`);
  back(id, 'ok=nwr');
}
