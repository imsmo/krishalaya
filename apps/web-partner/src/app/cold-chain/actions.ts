'use server';
// apps/web-partner/src/app/cold-chain/actions.ts · record a reefer/vaccine temperature reading — the ONLY place the
// partner session writes for the logistics/cold-chain path. Readings are APPEND-ONLY telemetry (each is a distinct
// timestamped fact), so NO Idempotency-Key (mirrors the controller). PC-56 TENANT-SW-e: the reading is MANUAL — no band and no
// time leave this form (the server copies the band from the threshold store and stamps its own time). SdkError → localized token. 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildRecordReading, NetworkError } from '../../features/logistics/network';

function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'conflict';
  }
  return 'generic';
}
const inputErrorKey = (e: unknown, fallback = 'generic') => (e instanceof NetworkError ? e.fieldKey : fallback);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const opt = (fd: FormData, k: string) => (fd.has(k) ? String(fd.get(k) ?? '') : undefined);
const enc = encodeURIComponent;

export async function recordReadingAction(formData: FormData): Promise<void> {
  await requirePartner();
  const subjectType = str(formData, 'subjectType');
  const subjectId = str(formData, 'subjectId');
  const scope = `subjectType=${enc(subjectType)}&subjectId=${enc(subjectId)}`;
  let body;
  try {
    body = buildRecordReading({
      subjectType, subjectId, tempC: str(formData, 'tempC'), humidityPct: opt(formData, 'humidityPct'),
      deviceRef: opt(formData, 'deviceRef'),
    });
  } catch (e) { redirect(`/cold-chain?${scope}&error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', 'logistics/cold-chain/readings', { body }); }
  catch (e) { redirect(`/cold-chain?${scope}&error=${apiErrorKey(e)}`); }
  revalidatePath('/cold-chain');
  redirect(`/cold-chain?${scope}&ok=recorded`);
}
