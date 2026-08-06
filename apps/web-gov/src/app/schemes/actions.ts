'use server';
// apps/web-gov/src/app/schemes/actions.ts · reviewer mutations (PC-41 GW-1). Server perms authoritative;
// 409 → honest illegal-state message. Reject requires a reason (a farmer must always know why).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { govClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { randomUUID } from 'node:crypto';
import { buildDbt } from '../../features/schemes/review';
import { buildVisitSubmission } from '../../features/verification/review';
import { SdkError } from '@krishalaya/sdk-js';
import type { MediaKind, MediaUploadTicket } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/schemes/${encodeURIComponent(id)}?${qs}`); }

export async function applicationAction(formData: FormData): Promise<void> {
  await requireSession('/schemes');
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect('/schemes');
  const s = govClient().schemes;
  try {
    if (kind === 'verify') await s.verifyApplication(id);
    else if (kind === 'clarify') await s.requestClarification(id, String(formData.get('note') ?? '').trim() || undefined);
    else if (kind === 'approve') await s.approveApplication(id, String(formData.get('govtAppRef') ?? '').trim() || undefined);
    else if (kind === 'reject') {
      const reason = String(formData.get('reason') ?? '').trim();
      if (!reason) back(id, 'error=reason');
      await s.rejectApplication(id, reason);
    } else if (kind === 'close') await s.closeApplication(id);
    else back(id, 'error=action');
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath(`/schemes/${id}`); revalidatePath('/schemes');
  back(id, `ok=${kind}`);
}

// GW-2: record a DBT credit against an approved application (per-application — the API's only DBT write).
export async function recordDbtAction(formData: FormData): Promise<void> {
  await requireSession('/schemes');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/schemes');
  const built = buildDbt({
    amountMajor: String(formData.get('amountMajor') ?? ''),
    creditedOn: String(formData.get('creditedOn') ?? ''),
    instalmentNo: String(formData.get('instalmentNo') ?? ''),
    pfmsRef: String(formData.get('pfmsRef') ?? ''),
  });
  if (!built.ok) back(id, `error=dbt_${built.error}`);
  try { await govClient().schemes.recordDbt(id, built.value); }
  catch (e) { back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'dbt'}`); }
  revalidatePath(`/schemes/${id}`);
  back(id, 'ok=dbt');
}

// --- GW-4 (PC-55 B1): field visits on the application under review (W54-3 · canon W337) ---
// The server owns the hard rules — scheme.process, ONE open visit per application (DB unique → 409), and
// OFFICER-OF-RECORD ONLY on submit. These actions add nothing to that; they just refuse locally what can be
// refused honestly (no photos = no evidence, out-of-range coordinates, an unparseable measurement line) so an
// officer standing in a field learns immediately instead of after a round trip.

/** Step 1 of the media flow (authed, server-side): mint a presigned PUT ticket. Holds no session token client-side. */
export async function requestUploadAction(input: { kind: MediaKind; mimeType: string; declaredBytes: number }): Promise<MediaUploadTicket> {
  await requireSession('/schemes');
  return govClient().media.requestUpload(input, randomUUID());
}
/** Step 3: confirm the uploaded asset's real size + sha256 (+dims). The confirmed mediaId is the evidence pointer. */
export async function confirmUploadAction(mediaId: string, input: { bytes: number; sha256: string; width?: number; height?: number }): Promise<{ mediaId: string; status: string }> {
  await requireSession('/schemes');
  return govClient().media.confirmUpload(mediaId, input, randomUUID());
}

export async function scheduleVisitAction(formData: FormData): Promise<void> {
  await requireSession('/schemes');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/schemes');
  const scheduledFor = String(formData.get('scheduledFor') ?? '').trim();
  try { await govClient().schemes.scheduleFieldVisit(id, scheduledFor || undefined); }
  catch (e) {
    const status = e instanceof SdkError ? e.status : 0;
    // 409 = an open visit already exists (the DB's uniqueness, not a guess); 403 = no scheme.process grant.
    back(id, `error=${status === 409 ? 'visit_open' : status === 403 ? 'visit_forbidden' : 'visit'}`);
  }
  revalidatePath(`/schemes/${id}`);
  back(id, 'ok=visit_scheduled');
}

export async function submitVisitAction(formData: FormData): Promise<void> {
  await requireSession('/schemes');
  const id = String(formData.get('id') ?? '').trim();
  const visitId = String(formData.get('visitId') ?? '').trim();
  if (!id || !visitId) redirect('/schemes');
  const built = buildVisitSubmission({
    mediaIds: formData.getAll('mediaIds').map((m) => String(m)),
    lat: String(formData.get('lat') ?? ''),
    lng: String(formData.get('lng') ?? ''),
    capturedAt: String(formData.get('capturedAt') ?? ''),
    measured: String(formData.get('measured') ?? ''),
    walkTraceMediaId: String(formData.get('walkTraceMediaId') ?? ''),
  });
  if (!built.ok) back(id, `error=visit_${built.error}`);
  try { await govClient().schemes.submitFieldVisit(visitId, built.value); }
  catch (e) {
    const status = e instanceof SdkError ? e.status : 0;
    // 403 = not the officer of record (or no grant); 409 = the visit is not submittable in its current state.
    back(id, `error=${status === 403 ? 'visit_officer' : status === 409 ? 'visit_state' : 'visit'}`);
  }
  revalidatePath(`/schemes/${id}`);
  back(id, 'ok=visit_submitted');
}
